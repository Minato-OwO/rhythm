import { CONFIG, DEFAULT_SETTINGS, SETTING_DEFINITIONS, LANE_SETTING_DEFINITIONS, GAUGE_SETTING_DEFINITIONS, PANEL_GROUPS, PANEL_OFFSET_DEFINITIONS, PAIRED_PANEL_ANGLE_SETTING, clampSetting } from './config.js';
import { loadChart } from './chart.js';
import { loadSongLibrary } from './song-library.js';
import { PersonalBests } from './personal-bests.js';
import { analyzeChart, readAudioDuration } from './chart-analysis.js';
import { AudioTransport } from './audio.js';
import { RhythmGame } from './game.js';
import { SongFrameClock } from './frame-clock.js';
import { RenderResolution } from './render-resolution.js';
import { StageView } from './view.js';
import { VRInput } from './vr-input.js';
import { SpatialUI } from './spatial-ui.js';
import { TimelineEffects } from './timeline-effects.js';
import { BackgroundEffects } from './background-effects.js';
import { downloadSettings } from './settings-export.js';

const storageKey = 'fourflow.settings.v1';
const settings = { ...DEFAULT_SETTINGS };
let saved = {};
try { saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}'); } catch { /* 保存が使えない場合は初期値。 */ }
for (const definition of SETTING_DEFINITIONS) {
  const candidate = saved?.[definition.key];
  if (typeof candidate === 'number' && Number.isFinite(candidate)) settings[definition.key] = clampSetting(definition, candidate);
}

async function bootstrap() {
  if (!window.AFRAME) throw new Error('A-Frameを読み込めませんでした。ネット接続を確認して再読み込みしてください。');
  const scene = document.getElementById('scene');
  if (!scene.hasLoaded) await new Promise(resolve => scene.addEventListener('loaded', resolve, { once: true }));
  if (!scene.canvas) await new Promise(resolve => scene.addEventListener('render-target-loaded', resolve, { once: true }));
  const audio = new AudioTransport();
  audio.setVolume(settings.volume / 100);
  audio.setHitVolume(settings.hitVolume / 100);
  audio.setAudioOffset(settings.audioOffset);
  const songs = await loadSongLibrary();
  let savedSong = null;
  try { savedSong = localStorage.getItem('fourflow.song.v1'); } catch { /* 保存不可でも選曲可能。 */ }
  const initialSong = songs.find(song => song.id === savedSong || song.difficulties.some(difficulty => difficulty.id === savedSong)) ?? songs[0];
  const initialDifficulty = initialSong.difficulties.find(difficulty => difficulty.id === savedSong) ?? initialSong.difficulties[0];
  const chart = await loadChart(initialDifficulty.chartUrl);
  const songLibrary = { songs, selectedId: initialSong.id, selectedDifficultyId: initialDifficulty.id, analysis: analyzeChart(chart), personalBests: new PersonalBests() };
  const rememberedDifficulties = new Map([[initialSong.id, initialDifficulty.id]]);
  const game = new RhythmGame(chart, audio, settings);
  const detachHitSounds = audio.attachHitSounds(game);
  const frameClock = new SongFrameClock(game);
  const renderResolution = new RenderResolution(scene);
  const view = new StageView(scene, settings);
  const timeline = new TimelineEffects(scene, view, settings, chart);
  const background = new BackgroundEffects(scene, view, chart);
  const trackingRig = scene.querySelector('#rig').object3D;
  let ui;
  let vr;
  let actionBusy = false;
  let pauseRequested = false;
  let lastAnchor = game.anchor;
  let pendingVRHeight = false;
  let lowHeightSamples = 0;
  let analysisController = null;

  function updateChartAnalysis(selectedChart) {
    analysisController?.abort();
    const controller = new AbortController();
    analysisController = controller;
    songLibrary.analysis = analyzeChart(selectedChart);
    void readAudioDuration(selectedChart.audioUrl, controller.signal).then(duration => {
      if (controller.signal.aborted || duration === null) return;
      songLibrary.analysis = analyzeChart(selectedChart, duration);
      ui?.invalidate('details');
    });
  }

  async function selectDifficulty(song, difficulty, reload = false) {
    if (!difficulty) throw new Error('難易度を選択してください。');
    if (!reload && song.id === songLibrary.selectedId && difficulty.id === songLibrary.selectedDifficultyId) return;
    await game.pause();
    // 譜面の検証を終えてから選択を確定する。背景素材はプレイ開始時に読み込む。
    const nextChart = await loadChart(difficulty.chartUrl);
    songLibrary.selectedId = song.id;
    songLibrary.selectedDifficultyId = difficulty.id;
    rememberedDifficulties.set(song.id, difficulty.id);
    updateChartAnalysis(nextChart);
    game.setChart(nextChart);
    ui.selectionChanged();
    try { localStorage.setItem('fourflow.song.v1', difficulty.id); } catch { /* 保存不可でも選曲可能。 */ }
  }

  function updateVRHeight() {
    if (!pendingVRHeight || !scene.is('vr-mode')) return;
    const xr = scene.renderer?.xr;
    const xrFrame = xr?.getFrame();
    const referenceSpace = xr?.getReferenceSpace();
    if (!xr?.isPresenting || !xrFrame || !referenceSpace) return;
    const pose = xrFrame.getViewerPose(referenceSpace);
    if (!pose || pose.emulatedPosition) return;
    const headY = pose.transform.position.y;
    if (!Number.isFinite(headY)) return;
    if (headY < CONFIG.minTrackedEyeHeight && ++lowHeightSamples < 3) return;
    trackingRig.position.y = headY < CONFIG.minTrackedEyeHeight ? CONFIG.vrEyeHeight - headY : 0;
    trackingRig.updateMatrixWorld(true);
    pendingVRHeight = false;
    view.recenter();
    vr?.reset();
  }

  async function runAction(action) {
    if (actionBusy) return;
    actionBusy = true;
    ui?.setBusy(true);
    ui?.setMessage('');
    try {
      await action();
    } catch (error) {
      try { await game.pause(); } catch { /* 元のエラーを表示する。 */ }
      ui?.setMessage(error.message ?? '操作を完了できませんでした。');
    } finally {
      actionBusy = false;
      ui?.setBusy(false);
      const session = scene.renderer?.xr.getSession();
      const shouldPause = pauseRequested || document.hidden || session && session.visibilityState !== 'visible';
      pauseRequested = false;
      if (game.state === 'playing' && shouldPause) void runAction(() => game.pause());
    }
  }

  async function startSelectedSong() {
    const song = songLibrary.songs.find(item => item.id === songLibrary.selectedId);
    if (!song?.difficulties.some(difficulty => difficulty.id === songLibrary.selectedDifficultyId)) throw new Error('プレイする曲と難易度を選んでください。');
    await background.preload();
    await game.start();
  }

  const actions = {
    toggle: () => runAction(async () => {
      if (ui.settingsOpen) return;
      if (ui.songSelectionOpen) { await startSelectedSong(); return; }
      if (game.state === 'idle') { ui.showSongSelection(); return; }
      if (game.state === 'playing') await game.pause();
      else if (game.state === 'paused') await game.resume();
      else await startSelectedSong();
    }),
    startSelected: () => runAction(async () => {
      if (!ui.songSelectionOpen || ui.settingsOpen) return;
      await startSelectedSong();
    }),
    resume: () => runAction(async () => {
      if (ui.settingsOpen || ui.songSelectionOpen) return;
      await game.resume();
    }),
    restart: () => runAction(async () => {
      if (game.state === 'idle') { ui.showSongSelection(); return; }
      await game.pause();
      await startSelectedSong();
    }),
    leave: () => runAction(async () => {
      await game.exit();
      ui.showSongSelection();
    }),
    title: () => runAction(async () => {
      await game.exit();
      ui.closeSettings(false);
      ui.closeSongSelection();
    }),
    pause: () => runAction(() => game.pause()),
    previewLaneEffects: () => { if (!actionBusy) view.previewLaneEffects(); },
    settings: () => runAction(async () => {
      await game.pause();
      ui.showSettings();
    }),
    songs: () => runAction(async () => {
      await game.pause();
      ui.showSongSelection();
    }),
    refreshSongs: () => runAction(async () => {
      const nextSongs = await loadSongLibrary();
      const song = nextSongs.find(item => item.difficulties.some(difficulty => difficulty.id === songLibrary.selectedDifficultyId)) ?? nextSongs[0];
      const difficulty = song.difficulties.find(item => item.id === songLibrary.selectedDifficultyId) ?? song.difficulties[0];
      await selectDifficulty(song, difficulty, true);
      songLibrary.songs = nextSongs;
      ui.selectionChanged();
    }),
    chooseSong: id => runAction(async () => {
      const song = songLibrary.songs.find(item => item.id === id);
      if (!song) throw new Error('曲が見つかりません。一覧を更新してください。');
      const remembered = rememberedDifficulties.get(song.id);
      await selectDifficulty(song, song.difficulties.find(item => item.id === remembered) ?? song.difficulties[0]);
    }),
    chooseDifficulty: id => runAction(async () => {
      const song = songLibrary.songs.find(item => item.id === songLibrary.selectedId);
      if (!song) throw new Error('曲を選択してください。');
      const difficulty = song.difficulties.find(item => item.id === id);
      if (!difficulty) throw new Error('難易度が見つかりません。一覧を更新してください。');
      await selectDifficulty(song, difficulty);
    }),
    recenter: () => runAction(async () => {
      await game.pause();
      if (scene.is('vr-mode')) {
        pendingVRHeight = true;
        lowHeightSamples = 0;
        updateVRHeight();
        view.recenter();
      } else {
        // KBの見回し角度も正面に戻す。
        const camera = scene.querySelector('#camera');
        const look = camera.components['look-controls'];
        look.pitchObject.rotation.x = 0;
        look.yawObject.rotation.y = 0;
        camera.object3D.rotation.set(0, 0, 0);
        view.useKeyboardView();
      }
      vr.reset();
      ui.invalidate();
    }),
    setSetting: (name, value) => {
      if (actionBusy || !Number.isFinite(value)) return;
      const definition = SETTING_DEFINITIONS.find(item => item.key === name);
      if (!definition) return;
      const nextValue = clampSetting(definition, value);
      if (settings[name] === nextValue) return;
      settings[name] = nextValue;
      if (name === 'volume') audio.setVolume(settings.volume / 100);
      if (name === 'hitVolume') audio.setHitVolume(settings.hitVolume / 100);
      if (name === 'audioOffset') audio.setAudioOffset(settings.audioOffset);
      if (name === 'laneCoverTransparency') view.applyLaneCoverOpacity();
      else if (GAUGE_SETTING_DEFINITIONS.some(item => item.key === name)) view.gauges.applyLayout();
      else if (LANE_SETTING_DEFINITIONS.some(item => item.key === name)) { view.applyLaneLayout(); vr.reset(); }
      if (name.startsWith('panel')) ui.layoutChanged();
      try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* 保存不可でもプレイ可能。 */ }
      ui.invalidate('menu');
    },
    exportSettings: () => {
      if (actionBusy) return;
      try {
        downloadSettings(settings);
        ui.setMessage('');
      } catch {
        ui.setMessage('設定ファイルを書き出せませんでした。');
      }
    },
    resetGaugeLengths: () => {
      if (actionBusy) return;
      for (const definition of GAUGE_SETTING_DEFINITIONS) settings[definition.key] = DEFAULT_SETTINGS[definition.key];
      view.gauges.applyLayout();
      try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* 保存不可でも調整可能。 */ }
      ui.invalidate('menu');
    },
    resetLaneLayout: () => {
      if (actionBusy) return;
      for (const definition of LANE_SETTING_DEFINITIONS) settings[definition.key] = DEFAULT_SETTINGS[definition.key];
      view.applyLaneLayout();
      view.applyLaneCoverOpacity();
      vr.reset();
      try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* 保存不可でも調整可能。 */ }
      ui.invalidate('menu');
    },
    setSidePanelAngle: value => {
      if (actionBusy || !Number.isFinite(value)) return;
      const angle = clampSetting(PAIRED_PANEL_ANGLE_SETTING, value);
      if (settings.panelLeftYaw === angle && settings.panelRightYaw === -angle) return;
      settings.panelLeftYaw = angle;
      settings.panelRightYaw = -angle;
      try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* 保存不可でも調整可能。 */ }
      ui.layoutChanged();
      ui.invalidate('menu');
    },
    resetPanelLayout: id => {
      if (actionBusy) return;
      if (!id || id === 'all') {
        for (const definition of PANEL_OFFSET_DEFINITIONS) settings[definition.key] = DEFAULT_SETTINGS[definition.key];
        settings.panelLeftYaw = DEFAULT_SETTINGS.panelLeftYaw;
        settings.panelRightYaw = DEFAULT_SETTINGS.panelRightYaw;
      }
      for (const group of PANEL_GROUPS) {
        if (id && group.id !== id) continue;
        for (const suffix of ['X', 'Y', 'Distance', 'Yaw']) {
          const key = `${group.prefix}${suffix}`;
          settings[key] = DEFAULT_SETTINGS[key];
        }
      }
      try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* 保存不可でも調整可能。 */ }
      ui.layoutChanged();
      ui.invalidate('menu');
    },
    switchVR: () => runAction(async () => {
      if (scene.is('vr-mode')) {
        await scene.exitVR();
        await game.pause();
        return;
      }
      if (!window.isSecureContext) throw new Error('VRモードはHTTPSまたはlocalhostで開いてください。');
      if (!navigator.xr) throw new Error('このブラウザーではWebXRを利用できません。VRヘッドセットの対応ブラウザーで開いてください。');
      // 3Dボタンの入力経路で開始する。一時停止中の音声時計は進めない。
      const unlock = game.state === 'paused' ? Promise.resolve() : audio.resume();
      const enter = scene.enterVR();
      await Promise.all([unlock, enter]);
      await game.pause();
    }),
    select: source => ui.selectXR(source),
    canQuickStart: () => !ui.settingsOpen && !ui.songSelectionOpen && game.state !== 'paused',
    updatePointers: (frame, space, sources) => ui.updateXR(frame, space, sources),
    clearPointers: () => ui.clearXR(),
  };

  ui = new SpatialUI(scene, view, game, settings, actions, songLibrary);
  vr = new VRInput(scene, game, view, settings, actions);
  updateChartAnalysis(chart);
  ui.selectionChanged();

  game.addEventListener('statechange', () => {
    frameClock.synchronize();
    if (game.state === 'playing') {
      ui.closeSettings(false);
      ui.closeSongSelection();
      if (lastAnchor !== game.anchor) { view.clearNotes(); timeline.reset(); background.reset(); }
    }
    if (game.state === 'idle') { view.clearNotes(); timeline.reset(); background.reset(); }
    if (game.state === 'finished') {
      songLibrary.personalBests.record(songLibrary.selectedDifficultyId, {
        score: game.score,
        accuracy: game.accuracy,
        bonusAccuracy: game.bonusAccuracy,
        maxCombo: game.maxCombo,
        autoplay: game.autoplay,
      });
      ui.closeSettings(false);
    }
    lastAnchor = game.anchor;
    vr.reset();
    ui.invalidate();
  });
  game.addEventListener('chartchange', () => {
    view.clearNotes();
    timeline.setChart(game.chart);
    background.setChart(game.chart);
    ui.chartChanged();
  });
  game.addEventListener('stats', () => ui.markStatsDirty());
  game.addEventListener('judgement', ({ detail }) => {
    view.showJudgement(detail);
    if (detail.rating !== 'miss') view.flash(detail.note.lane, true);
  });
  game.addEventListener('holdstart', ({ detail }) => {
    view.drawJudgement('HOLD', CONFIG.colors[detail.note.lane]);
    view.lastJudgement = performance.now();
    view.flash(detail.note.lane, true);
  });

  function releaseKeys() { view.pressed.fill(false); game.releaseSource('keyboard'); }

  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
    const lane = CONFIG.keys.indexOf(event.code);
    if (lane !== -1) {
      event.preventDefault();
      if (game.autoplay) return;
      if (event.repeat || view.pressed[lane] || scene.is('vr-mode')) return;
      view.pressed[lane] = true;
      game.setHeld(lane, true);
      view.flash(lane);
      game.hit(lane);
      return;
    }
    if (event.repeat) return;
    if (event.code === 'Space') { event.preventDefault(); actions.toggle(); }
    if (event.code === 'KeyR') { event.preventDefault(); actions.restart(); }
    if (event.code === 'KeyO') { event.preventDefault(); ui.settingsOpen ? ui.closeSettings() : actions.settings(); }
    if (event.code === 'KeyS') { event.preventDefault(); ui.songSelectionOpen ? actions.title() : actions.songs(); }
    if (event.code === 'KeyC') { event.preventDefault(); actions.recenter(); }
    if (event.code === 'KeyP') { event.preventDefault(); ui.closeSettings(); actions.resetPanelLayout(); }
    if (event.code === 'KeyV') { event.preventDefault(); actions.switchVR(); }
    if (event.code === 'Escape') {
      if (ui.settingsOpen) ui.closeSettings();
      else if (ui.songSelectionOpen) actions.title();
      else if (game.state === 'paused') actions.resume();
      else actions.pause();
    }
  });
  document.addEventListener('keyup', event => {
    const lane = CONFIG.keys.indexOf(event.code);
    if (lane !== -1) { view.pressed[lane] = false; game.setHeld(lane, false); }
  });
  function interruptPlayback() {
    // 開始・再開処理の途中でも、フォーカス喪失による停止要求を取りこぼさない。
    pauseRequested ||= actionBusy || game.state === 'playing';
    frameClock.invalidate();
    if (game.state === 'playing') actions.pause();
    releaseKeys();
    vr.reset();
  }
  const invalidateClock = () => frameClock.invalidate();
  window.addEventListener('blur', interruptPlayback);
  window.addEventListener('focus', invalidateClock);
  window.addEventListener('pageshow', invalidateClock);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) interruptPlayback();
    else frameClock.invalidate();
  });
  document.addEventListener('freeze', interruptPlayback);
  document.addEventListener('resume', invalidateClock);

  scene.addEventListener('enter-vr', () => {
    ui.releaseMouse();
    releaseKeys();
    pendingVRHeight = true;
    lowHeightSamples = 0;
    view.resetPosition();
    trackingRig.position.set(0, CONFIG.vrEyeHeight, 0);
    const mount = scene.querySelector('#camera-mount').object3D;
    mount.position.set(0, 0, 0);
    mount.rotation.set(0, 0, 0);
    trackingRig.updateMatrixWorld(true);
    view.recenter();
    vr.connect(scene.renderer.xr.getSession());
    ui.invalidate();
    if (game.state === 'playing') actions.pause();
  });
  scene.addEventListener('exit-vr', () => {
    pendingVRHeight = false;
    lowHeightSamples = 0;
    vr.disconnect();
    view.useKeyboardView();
    ui.invalidate();
    actions.pause();
  });

  AFRAME.registerComponent('four-flow-loop', {
    init() {
      this.frameTime = null;
      // A-Frameのtick引数は内部時計の経過時間で、rAFの時刻そのものではない。
      // 既存の描画ループを包み、同じフレーム時刻をKB・VR両方で受け取る。
      this.onFrame = (timestamp, frame) => {
        this.frameTime = timestamp;
        renderResolution.update();
        scene.render(timestamp, frame);
      };
      this.installLoop = () => scene.renderer.setAnimationLoop(this.onFrame);
      if (scene.renderStarted) this.installLoop();
      else scene.addEventListener('renderstart', this.installLoop, { once: true });
    },
    tick() {
      const now = performance.now();
      // 処理開始の遅れや音声時計の更新刻みを、ノーツの移動量に混ぜない。
      const songTime = frameClock.sample(this.frameTime ?? now);
      updateVRHeight();
      // レーン移動後の3Dパネル位置を先に同期し、その位置でレーザーを判定する。
      ui.update(now, songTime);
      vr.update(now);
      game.update();
      timeline.update(songTime, game.state);
      background.update(songTime, game.state);
      view.update(game, now, songTime);
    },
    remove() {
      scene.removeEventListener('renderstart', this.installLoop);
      if (scene.renderStarted) scene.renderer.setAnimationLoop(scene.render);
      frameClock.dispose();
      renderResolution.dispose();
      vr.disconnect();
      ui.dispose();
      view.disposeText();
      view.disposeNotes();
      timeline.dispose();
      background.dispose();
      view.effects.dispose();
      detachHitSounds();
      audio.stop();
    },
  });
  scene.setAttribute('four-flow-loop', '');
  window.addEventListener('pagehide', () => {
    analysisController?.abort();
    vr.disconnect();
    detachHitSounds();
    audio.stop();
    audio.context?.close().catch(() => {});
  }, { once: true });
}

bootstrap().catch(error => {
  // WebGL/A-Frame自体を開始できないときだけ、通常のテキストで通知する。
  const fallback = document.getElementById('fallback');
  fallback.textContent = error.message ?? 'ゲームを準備できませんでした。';
  fallback.hidden = false;
});
