import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChart } from '../src/chart.js';
import { CONFIG, DEFAULT_SETTINGS, PLAY_SETTING_DEFINITIONS, clampSetting } from '../src/config.js';
import { RhythmGame } from '../src/game.js';
import { PersonalBests } from '../src/personal-bests.js';
import { SpatialUI } from '../src/spatial-ui.js';

function fixture(notes, settings = {}, chartSettings = {}) {
  const chart = normalizeChart({ bpm: 120, durationSeconds: 10, notes, ...chartSettings });
  const audio = { now: 0, update() {}, prepare() {}, resume() {}, pause() {}, play() {}, stop() {} };
  const game = new RhythmGame(chart, audio, { ...DEFAULT_SETTINGS, autoplay: 1, ...settings });
  game.anchor = 0; game.state = 'playing';
  const hits = [], holds = [];
  game.addEventListener('judgement', event => hits.push(event.detail));
  game.addEventListener('holdstart', event => holds.push(event.detail));
  return { game, audio, hits, holds, step(time) { audio.now = game.anchor + time; game.update(); } };
}

test('オートは既定OFFで、ON/OFFを保存でき、通常プレイの判定を維持する', () => {
  assert.equal(DEFAULT_SETTINGS.autoplay, 0);
  const definition = PLAY_SETTING_DEFINITIONS.find(item => item.key === 'autoplay');
  assert.equal(definition.type, 'toggle');
  assert.equal(clampSetting(definition, 5), 1);
  assert.equal(clampSetting(definition, -5), 0);
  const f = fixture([{ timeSeconds: 1, lane: 0 }, { timeSeconds: 1.1, lane: 1 }], { autoplay: 0 });
  f.step(1);
  assert.equal(f.game.judgedCount, 0);
  assert.equal(f.game.hit(0, 1), 'perfectPlus');
  f.step(2);
  assert.equal(f.game.counts.miss, 1);
});

test('0秒・同時押し・フレーム間の連打を、時刻が来てから正確に自動判定する', () => {
  for (const offset of [-200, 0, 200]) {
    const f = fixture([
      { timeSeconds: 0, lane: 0 }, { timeSeconds: 1, lane: 0 },
      { timeSeconds: 1, lane: 1 }, { timeSeconds: 1.001, lane: 0 },
      { timeSeconds: 1.002, lane: 0 }, { timeSeconds: 2, lane: 3 },
    ], { offset });
    f.step(-0.001);
    assert.equal(f.game.judgedCount, 0);
    f.step(0);
    assert.equal(f.game.judgedCount, 1);
    f.step(0.999);
    assert.equal(f.game.judgedCount, 1);
    f.step(1.08);
    assert.equal(f.game.judgedCount, 5);
    assert.equal(f.game.notes.at(-1).judged, false);
    f.step(2.2);
    f.step(2.3);
    assert.equal(f.game.counts.perfectPlus, 6);
    assert.equal(f.game.counts.miss, 0);
    assert.equal(f.game.maxCombo, 6);
    assert.equal(f.game.score, CONFIG.baseScore + 6);
    assert.equal(f.game.accuracy, 100);
    assert.equal(f.game.bonusAccuracy, 10);
    assert.ok(f.hits.every(hit => hit.source === 'autoplay' && hit.deltaMs === 0));
  }
});

test('キーボード・VRの早押しや離し操作でオートの判定を変えない', () => {
  const f = fixture([{ timeSeconds: 1, endTimeSeconds: 3, lane: 0 }], { offset: -200 });
  for (const source of ['keyboard', 'left', 'right']) {
    f.game.setHeld(0, true, source, 0.9);
    assert.equal(f.game.hit(0, 0.9, source), null);
  }
  f.step(1);
  assert.equal(f.holds.length, 1);
  assert.equal(f.game.held(0), true);
  for (const source of ['keyboard', 'left', 'right']) f.game.releaseSource(source);
  f.step(2.899);
  assert.equal(f.game.judgedCount, 0);
  assert.equal(f.game.held(0), true);
  f.step(2.9);
  assert.equal(f.game.counts.perfectPlus, 1);
  assert.equal(f.game.held(0), false);
  assert.equal(f.game.heldSources.size, 0);
});

test('LNは終点100ms前に1回だけ完了し、短いLNと終点直後のノーツにも対応する', () => {
  const f = fixture([
    { timeSeconds: 1, endTimeSeconds: 1.05, lane: 0 },
    { timeSeconds: 1.05, endTimeSeconds: 2, lane: 0 },
    { timeSeconds: 2, lane: 0 },
  ]);
  f.step(1);
  assert.equal(f.game.counts.perfectPlus, 1);
  f.step(1.05);
  assert.equal(f.game.activeHolds.size, 1);
  f.step(1.9);
  assert.equal(f.game.counts.perfectPlus, 2);
  assert.equal(f.game.activeHolds.size, 0);
  f.step(2);
  f.step(3);
  assert.equal(f.game.counts.perfectPlus, 3);
  assert.equal(f.holds.length, 2);
  assert.equal(f.hits.length, 3);
  assert.ok(f.holds.every(hit => hit.rating === 'perfectPlus' && hit.deltaMs === 0 && hit.source === 'autoplay'));
});

test('ポーズ・再開で進行とLNを維持し、SV・入力オフセットから独立して動く', async () => {
  const f = fixture([{ timeSeconds: 1, endTimeSeconds: 3, lane: 0 }, { timeSeconds: 2, lane: 1 }], { offset: 200 }, {
    scrollVelocities: [
      { timeSeconds: 0, multiplier: -5 },
      { timeSeconds: 1, type: 'speed', mode: 'range', multiplier: -9, endMultiplier: 1, durationSeconds: 2 },
    ],
  });
  f.step(1.5);
  await f.game.pause();
  f.step(5);
  assert.equal(f.game.judgedCount, 0);
  assert.equal(f.game.autoCursor, 1);
  f.audio.now = f.game.anchor + 1.5;
  await f.game.resume();
  f.step(2.9);
  assert.equal(f.game.counts.perfectPlus, 2);
  assert.equal(f.game.counts.miss, 0);
  assert.equal(f.game.activeHolds.size, 0);
});

test('モード変更は次の開始から反映し、リトライでカーソル・入力・判定をリセットする', async () => {
  const f = fixture([{ timeSeconds: 1, lane: 0 }]);
  f.game.settings.autoplay = 0;
  assert.equal(f.game.autoplay, true);
  assert.equal(f.game.hit(0, 1), null);
  f.step(1);
  assert.equal(f.game.counts.perfectPlus, 1);
  await f.game.pause();
  await f.game.start();
  assert.equal(f.game.autoplay, false);
  assert.equal(f.game.autoCursor, 0);
  assert.equal(f.game.judgedCount, 0);
  f.game.settings.autoplay = 1;
  f.step(1);
  assert.equal(f.game.autoplay, false);
  assert.equal(f.game.judgedCount, 0);
  assert.equal(f.game.hit(0, f.game.songTime), 'perfectPlus');
  await f.game.pause();
  await f.game.start();
  assert.equal(f.game.autoplay, true);
  f.step(1);
  assert.equal(f.game.counts.perfectPlus, 1);
});

test('フレームを大きく跨いでも全ノーツを完了し、音声オフセットの末尾まで再生する', () => {
  const notes = Array.from({ length: 1000 }, (_, index) => ({ timeSeconds: index * 0.005, lane: index % 4 }));
  notes.push({ timeSeconds: 5, endTimeSeconds: 6, lane: 0 });
  const f = fixture(notes, { audioOffset: 300 }, { durationSeconds: 7 });
  f.step(7);
  assert.equal(f.game.judgedCount, notes.length);
  assert.equal(f.game.counts.miss, 0);
  assert.equal(f.game.state, 'playing');
  f.step(7.3);
  assert.equal(f.game.state, 'finished');
  assert.equal(f.hits.length, notes.length);
  f.step(8);
  assert.equal(f.hits.length, notes.length);
});

test('オートの結果は未プレイにも既存ベストにも保存しない', t => {
  const original = globalThis.localStorage, values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  t.after(() => { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original; });
  const bests = new PersonalBests();
  const manual = { score: 900000, accuracy: 90, bonusAccuracy: 0, maxCombo: 1, autoplay: false };
  bests.record('existing', manual);
  const saved = values.get('fourflow.personal-bests.v3');
  const f = fixture([{ timeSeconds: 1, lane: 0 }]);
  f.step(10);
  const result = { score: f.game.score, accuracy: f.game.accuracy, bonusAccuracy: f.game.bonusAccuracy, maxCombo: f.game.maxCombo, autoplay: f.game.autoplay };
  bests.record('new', result);
  bests.record('existing', result);
  assert.equal(bests.get('new'), null);
  assert.equal(bests.get('existing').score, 900000);
  assert.equal(values.get('fourflow.personal-bests.v3'), saved);
});

test('3Dリザルトに実際のプレイモードを表示し、次回設定で表示を変えない', () => {
  const f = fixture([{ timeSeconds: 1, lane: 0 }]);
  f.step(10);
  f.game.settings.autoplay = 0;
  const labels = [];
  const ui = Object.create(SpatialUI.prototype);
  Object.assign(ui, {
    center: { texture: {} }, game: f.game, settings: f.game.settings, actions: {},
    scene: { is: () => false }, background() {}, button() {},
    text(panel, value) { labels.push(value); },
  });
  ui.drawMenu();
  assert.ok(labels.includes('AUTO PLAY / 自己ベストには保存されません'));
});
