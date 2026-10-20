import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioTransport, HOLD_SOUND_GAIN_DB, HIT_SOUND_GAIN_DB } from '../src/audio.js';
import { RhythmGame } from '../src/game.js';
import { DEFAULT_SETTINGS, PLAY_SETTING_DEFINITIONS, clampSetting } from '../src/config.js';
import { SpatialUI } from '../src/spatial-ui.js';

class Node {
  connections = []; stops = 0; disconnects = 0;
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.disconnects++; }
  start(...args) { this.started = args; }
  stop() { this.stops++; }
  end() { this.onended?.({ target: this }); }
}
const parameter = () => ({ value: 0, setTargetAtTime(value, time, constant) { Object.assign(this, { value, time, constant }); } });
class Context {
  state = 'running'; currentTime = 0; sampleRate = 100;
  destination = {}; gains = []; sources = []; decodes = 0;
  createGain() { const node = new Node(); node.gain = parameter(); this.gains.push(node); return node; }
  createDynamicsCompressor() { return Object.assign(new Node(), { threshold: parameter(), knee: parameter(), ratio: parameter() }); }
  createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  createBufferSource() { const node = new Node(); this.sources.push(node); return node; }
  async decodeAudioData(bytes) { assert.ok(bytes instanceof ArrayBuffer); this.decodes++; return { duration: 0.15 }; }
  async suspend() { this.state = 'suspended'; }
  async resume() { this.state = 'running'; }
}

function fixture(t) {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch;
  globalThis.window = { AudioContext: Context };
  let requests = 0;
  globalThis.fetch = async url => {
    assert.ok(['/assets/hit_se.mp3', '/assets/LNLN.mp3'].some(path => url.pathname.endsWith(path)));
    requests++;
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  });
  const audio = new AudioTransport();
  audio.ensureContext();
  return { audio, context: audio.context, requests: () => requests };
}

test('SEを開始前に読み込み、同時押し・連打・リトライでは同じバッファと音量ノードを使う', async t => {
  const { audio, context, requests } = fixture(t);
  await Promise.all([audio.prepareHitSound(), audio.prepareHitSound()]);
  assert.equal(requests(), 1);
  assert.equal(context.decodes, 1);
  for (let i = 0; i < 4; i++) audio.playHitSound();
  assert.equal(context.sources.length, 4);
  assert.equal(context.gains.length, 3, '曲用・SE共通音量・LNの音量補正だけを生成する');
  for (const source of context.sources) {
    assert.equal(source.buffer, audio.hitBuffer);
    assert.equal(source.connections[0], audio.hitGain);
    assert.equal(source.onended, context.sources[0].onended, '終了処理も使い回す');
  }
  context.sources[0].end();
  assert.equal(audio.hitNodes.size, 3);
  assert.equal(context.sources[0].disconnects, 1);
  audio.stop(true);
  await audio.prepareHitSound();
  assert.equal(requests(), 1);
  assert.equal(context.decodes, 1);
});

test('曲とSEの音量は独立し、0%・停止中・未読込時はSEを生成しない', async t => {
  const { audio, context } = fixture(t);
  audio.playHitSound();
  assert.equal(context.sources.length, 0);
  await audio.prepareHitSound();
  audio.setVolume(0);
  audio.setHitVolume(1);
  assert.equal(audio.master.gain.value, 0);
  assert.equal(audio.hitGain.gain.value, 10 ** (HIT_SOUND_GAIN_DB / 20));
  assert.notEqual(audio.master, audio.hitGain);
  audio.playHitSound();
  assert.equal(context.sources.length, 1, '曲がミュートでもSEは鳴る');
  audio.setHitVolume(0);
  audio.playHitSound();
  context.state = 'suspended';
  audio.setHitVolume(0.4);
  audio.playHitSound();
  assert.equal(context.sources.length, 1);
  assert.equal(audio.master.gain.value, 0, 'SE音量で曲の音量を変更しない');
  audio.setHitVolume(9); assert.equal(audio.hitVolume, 1);
  audio.setHitVolume(-1); assert.equal(audio.hitVolume, 0);
});

test('KB・VRのヒットとLN始点で鳴り、空打ち・MISS・LN終点では二重に鳴らさない', async t => {
  const { audio, context } = fixture(t);
  await audio.prepareHitSound();
  const chart = { duration: 8, notes: [
    { id: 0, time: 1, lane: 0, endTime: null },
    { id: 1, time: 1, lane: 1, endTime: 2 },
    { id: 2, time: 3, lane: 2, endTime: null },
    { id: 3, time: 4, lane: 3, endTime: 6 },
  ] };
  const game = new RhythmGame(chart, audio, { ...DEFAULT_SETTINGS });
  game.state = 'playing'; game.anchor = 0;
  const detach = audio.attachHitSounds(game);
  game.hit(0, 1, 'keyboard');
  game.setHeld(1, true, 'left', 1);
  game.hit(1, 1, 'left');
  assert.equal(context.sources.length, 2);
  assert.equal(game.hit(3, 2.5), null);
  context.currentTime = 1.9; game.update();
  assert.equal(game.notes[1].judged, true);
  context.currentTime = 3.2; game.update();
  assert.equal(game.notes[2].judged, true);
  assert.equal(context.sources.length, 2);
  game.setHeld(3, true, 'right', 4);
  game.hit(3, 4, 'right');
  assert.equal(context.sources.length, 3);
  game.setHeld(3, false, 'right', 4.3);
  context.currentTime = 4.5; game.update();
  assert.equal(game.notes[3].judged, true, '保持失敗でも追加の音は鳴らさない');
  assert.equal(context.sources.length, 3);
  detach();
  game.reset();
  game.hit(0, 1);
  assert.equal(context.sources.length, 3, '解除後はイベントを再生しない');
});

test('オートの同時押しとLNも対応し、ポーズ・退出で鳴り残りを解放する', async t => {
  const { audio, context } = fixture(t);
  await audio.prepareHitSound();
  const game = new RhythmGame({ duration: 5, notes: [
    { id: 0, time: 1, lane: 0, endTime: null },
    { id: 1, time: 1, lane: 1, endTime: 2 },
  ] }, audio, { ...DEFAULT_SETTINGS, autoplay: 1 });
  game.state = 'playing'; game.anchor = 0;
  audio.attachHitSounds(game);
  context.currentTime = 0.99; game.update();
  assert.equal(context.sources.length, 0);
  context.currentTime = 1; game.update();
  context.currentTime = 1.9; game.update();
  assert.equal(context.sources.length, 2);
  await game.pause();
  assert.equal(audio.hitNodes.size, 0);
  assert.ok(context.sources.every(source => source.stops === 1 && source.disconnects === 1 && source.onended === null));
  await game.resume();
  assert.equal(context.sources.length, 2, '古いSEを再開しない');
  audio.playHitSound();
  await game.exit();
  assert.equal(audio.hitNodes.size, 0);
  assert.equal(context.sources.at(-1).stops, 1);
});

test('SEが読み込み終わるまで曲の準備を完了せず、読み込み失敗後も再試行できる', async t => {
  const { audio, context } = fixture(t);
  const pendingFetches = [];
  let ready = false;
  globalThis.fetch = () => new Promise(resolve => { pendingFetches.push(resolve); });
  const pending = audio.prepare({ audioUrl: null }).then(() => { ready = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ready, false);
  assert.equal(context.decodes, 0);
  assert.equal(pendingFetches.length, 2);
  for (const resolve of pendingFetches) resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  await pending;
  assert.equal(ready, true);
  assert.equal(context.decodes, 2);

  const retry = new AudioTransport(); retry.context = context;
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(retry.prepareHitSound(), /ヒットSE/);
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  await retry.prepareHitSound();
  assert.ok(retry.hitBuffer);
});

test('LNは保持中にループし、同時保持でも重複せず、最後の保持完了で止まる', async t => {
  const { audio, context, requests } = fixture(t);
  await Promise.all([audio.prepareHitSound(), audio.prepareHoldSound(), audio.prepareHoldSound()]);
  assert.equal(requests(), 2);
  assert.equal(context.decodes, 2);
  const game = new RhythmGame({ duration: 5, notes: [
    { id: 0, time: 1, lane: 0, endTime: 2 },
    { id: 1, time: 1.3, lane: 1, endTime: 3 },
  ] }, audio, { ...DEFAULT_SETTINGS, autoplay: 1 });
  game.state = 'playing'; game.anchor = 0;
  audio.attachHitSounds(game);
  context.currentTime = 0.99; game.update();
  assert.equal(audio.holdSource, null);
  context.currentTime = 1; game.update();
  const loop = audio.holdSource;
  assert.ok(loop);
  assert.equal(loop.loop, true);
  assert.equal(loop.buffer, audio.holdBuffer);
  assert.equal(loop.connections[0], audio.holdGain);
  assert.equal(context.sources.length, 2, '通常ヒットと保持音をそれぞれ1つ開始する');
  for (const time of [1.1, 1.2, 1.3, 1.5, 1.9, 2.5]) {
    context.currentTime = time; game.update();
    assert.equal(audio.holdSource, loop, '途中に別のLNが加わっても再生成しない');
  }
  assert.equal(context.sources.length, 3, '2つ目の始点では通常ヒット音だけを追加する');
  context.currentTime = 2.9; game.update();
  assert.equal(audio.holdSource, null);
  assert.equal(loop.stops, 1);
  assert.equal(loop.disconnects, 1);
  audio.stop(true);
  await audio.prepareHoldSound();
  assert.equal(context.decodes, 2, 'リトライでLN音をデコードし直さない');
});

test('KB・VRの保持を離すと猶予中でも止まり、再保持・ポーズ復帰・退出に追従する', async t => {
  const { audio, context } = fixture(t);
  await Promise.all([audio.prepareHitSound(), audio.prepareHoldSound()]);
  const game = new RhythmGame({ duration: 8, notes: [
    { id: 0, time: 1, lane: 0, endTime: 5 },
    { id: 1, time: 1, lane: 1, endTime: 6 },
  ] }, audio, { ...DEFAULT_SETTINGS });
  game.state = 'playing'; game.anchor = 0;
  const detach = audio.attachHitSounds(game);
  game.setHeld(0, true, 'keyboard', 1); game.hit(0, 1);
  game.setHeld(1, true, 'left', 1); game.hit(1, 1, 'left');
  const loop = audio.holdSource;
  assert.ok(loop);
  game.setHeld(0, false, 'keyboard', 1.5);
  assert.equal(audio.holdSource, loop, 'もう片方のLNの保持音を続ける');
  game.setHeld(1, false, 'left', 1.6);
  assert.equal(game.notes[1].judged, false, 'VRの保持猶予はまだ残っている');
  assert.equal(audio.holdSource, null, '入力が離れた時点で音だけは止める');
  game.setHeld(1, true, 'left', 1.65);
  assert.ok(audio.holdSource);
  assert.notEqual(audio.holdSource, loop);
  context.currentTime = 1.65; game.update();
  await game.pause();
  assert.equal(audio.holdSource, null);
  game.releaseSource('left');
  await game.resume();
  assert.equal(audio.holdSource, null, '再開しただけでは鳴らさない');
  game.setHeld(1, true, 'left', 1.66);
  assert.ok(audio.holdSource);
  audio.setHitVolume(0);
  assert.equal(audio.holdSource, null, 'ミュート中はループを解放する');
  audio.setHitVolume(0.6);
  assert.ok(audio.holdSource);
  const exiting = audio.holdSource;
  await game.exit();
  assert.equal(audio.holdSource, null);
  assert.equal(exiting.stops, 1);
  detach();
  assert.equal(audio.hitSoundGame, null);
});

test('通常SEとLNは同じ音量設定を通り、LNだけに測定済みのdB補正を掛ける', async t => {
  const { audio, context } = fixture(t);
  await audio.prepareHoldSound();
  assert.equal(audio.holdGain.connections[0], audio.hitGain);
  assert.ok(Math.abs(20 * Math.log10(audio.holdGain.gain.value) - HOLD_SOUND_GAIN_DB) < 1e-10);
  assert.equal(HOLD_SOUND_GAIN_DB, -13.50);
  const gain = audio.holdGain.gain.value;
  const boost = 10 ** (HIT_SOUND_GAIN_DB / 20);
  assert.equal(HIT_SOUND_GAIN_DB, 12);
  assert.equal(audio.hitGain.gain.value, DEFAULT_SETTINGS.hitVolume / 100 * boost, '初期化時も増幅を適用する');
  for (const volume of [0, 0.3, 0.6, 1]) {
    audio.setHitVolume(volume);
    assert.equal(audio.hitGain.gain.value, volume * boost);
    assert.equal(audio.holdGain.gain.value, gain);
  }
  assert.equal(context.gains.length, 3, '調整のたびにノードを増やさない');
});

test('SE音量を保存・復元でき、追加後のプレイ設定の行が互いに重ならない', () => {
  const definition = PLAY_SETTING_DEFINITIONS.find(item => item.key === 'hitVolume');
  assert.equal(DEFAULT_SETTINGS.hitVolume, 60);
  const restored = JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, hitVolume: 32 }));
  assert.equal(clampSetting(definition, restored.hitVolume), 32);
  assert.equal(clampSetting(definition, -100), 0);
  assert.equal(clampSetting(definition, 300), 100);
  const texts = [], buttons = [];
  const panel = { ctx: { fillRect() {} }, regions: [], texture: {} };
  const ui = Object.create(SpatialUI.prototype);
  Object.assign(ui, {
    center: panel, settingsTab: 'play', settings: restored, actions: {},
    background() {}, closeSettings() {},
    text(panel, value, x, y, size) { texts.push({ value, y, size }); },
    button(panel, id, label, x, y, width, height) { buttons.push({ id, y, height }); },
  });
  ui.drawSettings();
  for (let index = 0; index < PLAY_SETTING_DEFINITIONS.length; index++) {
    const current = PLAY_SETTING_DEFINITIONS[index];
    const label = texts.find(text => text.value === current.label);
    const control = current.type === 'toggle' ? buttons.find(button => button.id === current.key + '-off') : panel.regions.find(region => region.id === current.key + '-slider');
    assert.ok(label.y + label.size / 2 + 12 <= control.y);
    const next = PLAY_SETTING_DEFINITIONS[index + 1];
    if (next) {
      const nextLabel = texts.find(text => text.value === next.label);
      assert.ok(control.y + control.height + 12 <= nextLabel.y - nextLabel.size / 2);
    } else assert.ok(control.y + control.height < 840);
  }
  assert.equal(buttons.find(button => button.id === 'close').y, 875);
});
