import { CONFIG, DEFAULT_SETTINGS, holdCompletionTime } from '../../src/config.js';
import { StageView } from '../../src/view.js';
import { TimelineEffects } from '../../src/timeline-effects.js';
import { BackgroundEffects } from '../../src/background-effects.js';
import { RenderResolution } from '../../src/render-resolution.js';
import { ChartNoteSkins } from '../../src/chart-note-skins.js';

async function init() {
  if (!window.AFRAME) throw new Error('3Dプレビューを読み込めませんでした。接続を確認して再読み込みしてください。');
  const clock = window.frameElement?.fourFlowClock;
  if (!clock) throw new Error('プレビューはエディタから開いてください。');
  const frameState = {};
  const scene = document.getElementById('scene');
  if (!scene.hasLoaded) await new Promise(resolve => scene.addEventListener('loaded', resolve, { once: true }));
  if (!scene.canvas) await new Promise(resolve => scene.addEventListener('render-target-loaded', resolve, { once: true }));
  const settings = { ...DEFAULT_SETTINGS };
  const view = new StageView(scene, settings);
  const noteSkinTrack = new ChartNoteSkins(view.noteSkins);
  const renderResolution = new RenderResolution(scene);
  let chart = { notes: [], events: [], duration: 60 };
  const timeline = new TimelineEffects(scene, view, settings, chart);
  const background = new BackgroundEffects(scene, view, chart);
  let judgedCount = 0;
  const game = {
    state: 'paused', chart, notes: [], playableNotes: [], songTime: 0,
    get totalNotes() { return this.playableNotes.length; },
    get score() { return this.totalNotes ? Math.round(judgedCount / this.totalNotes * CONFIG.baseScore) + judgedCount : 0; },
  };
  const activeHolds = new Set();
  let previous = -Infinity;
  let hitCursor = 0;
  let revision = 0;
  let skinsReady = false;
  function reset() {
    view.clearNotes(); timeline.reset(); background.reset(); previous = -Infinity; hitCursor = 0;
    activeHolds.clear();
    judgedCount = 0;
    for (const note of game.notes) { note.judged = false; note.started = false; }
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.channel !== 'four-flow-preview') return;
    const data = event.data;
    if (data.type === 'chart') {
      chart = data.chart;
      game.chart = chart;
      game.notes = chart.notes.map(note => ({ ...note, judged: false }));
      game.playableNotes = game.notes.filter(note => !note.fake);
      timeline.setChart(chart);
      background.setChart(chart);
      reset();
      revision = data.revision;
      skinsReady = false;
      const loadingRevision = revision;
      Promise.all([background.preload(), noteSkinTrack.preload(chart)]).then(() => {
        if (loadingRevision !== revision) return;
        noteSkinTrack.setChart(chart);
        skinsReady = true;
        document.getElementById('error').textContent = '';
        parent.postMessage({ channel: 'four-flow-preview', type: 'prepared', revision }, location.origin);
      }).catch(error => {
        if (loadingRevision !== revision) return;
        document.getElementById('error').textContent = error.message;
        parent.postMessage({ channel: 'four-flow-preview', type: 'error', message: error.message, revision }, location.origin);
      });
    }
    if (data.type === 'transport') reset();
  });
  document.addEventListener('keydown', event => {
    if (event.isComposing || !['Space', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyS', 'KeyZ', 'KeyY', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace'].includes(event.code)) return;
    event.preventDefault();
    parent.postMessage({ channel: 'four-flow-preview', type: 'key', code: event.code, repeat: event.repeat, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey }, location.origin);
  });
  AFRAME.registerComponent('editor-preview-loop', {
    init() {
      this.render = (timestamp, frame) => { renderResolution.update(); scene.render(timestamp, frame); };
      this.install = () => scene.renderer.setAnimationLoop(this.render);
      if (scene.renderStarted) this.install(); else scene.addEventListener('renderstart', this.install, { once: true });
    },
    tick() {
      const now = performance.now();
      clock.sample(frameState);
      // 譜面メッセージの到着前に、新しい時計で古いSVを描画しない。
      if (frameState.revision !== revision || !skinsReady) return;
      const time = Math.max(0, Math.min(chart.duration, frameState.time));
      if (time < previous) reset();
      while (hitCursor < game.playableNotes.length && (game.playableNotes[hitCursor].time < time || frameState.playing && game.playableNotes[hitCursor].time <= time)) {
        const note = game.playableNotes[hitCursor++];
        if (note.endTime !== null && note.endTime !== undefined && time < holdCompletionTime(note)) {
          note.started = true; activeHolds.add(note);
        } else { note.judged = true; judgedCount++; }
        if (frameState.playing && previous !== -Infinity && note.time > previous && time - note.time < 0.1) view.flash(note.lane, true);
      }
      for (const note of activeHolds) if (time >= holdCompletionTime(note)) { note.judged = true; judgedCount++; activeHolds.delete(note); }
      game.state = frameState.playing ? 'playing' : 'paused';
      game.songTime = time;
      // 停止中のシークでも画面演出を確認できるよう、演出は再生表示として評価する。
      timeline.update(time, 'playing');
      background.update(time, 'playing');
      noteSkinTrack.update(time);
      view.update(game, now, time);
      previous = time;
    },
    remove() {
      scene.removeEventListener('renderstart', this.install);
      if (scene.renderStarted) scene.renderer.setAnimationLoop(scene.render);
      renderResolution.dispose();
      revision++;
      timeline.dispose(); background.dispose(); view.effects.dispose(); view.disposeText(); view.disposeNotes();
    },
  });
  scene.setAttribute('editor-preview-loop', '');
  parent.postMessage({ channel: 'four-flow-preview', type: 'ready' }, location.origin);
}
init().catch(error => {
  document.getElementById('error').textContent = error.message;
  parent.postMessage({ channel: 'four-flow-preview', type: 'error', message: error.message }, location.origin);
});
