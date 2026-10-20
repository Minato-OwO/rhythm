import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, DEFAULT_SETTINGS, PLAY_SETTING_DEFINITIONS, clampSetting } from '../src/config.js';
import { RhythmGame } from '../src/game.js';
import { StageView } from '../src/view.js';
import { SpatialUI } from '../src/spatial-ui.js';

function gameFixture(count = 1, overrides = {}) {
  const notes = Array.from({ length: count }, (_, index) => ({ id: index, time: index + 1, lane: index % 4, endTime: null }));
  const audio = { now: 0, update() {}, stop() {} };
  const game = new RhythmGame({ notes, bpm: 120, duration: 10 }, audio, { ...DEFAULT_SETTINGS, autoplay: 0, ...overrides });
  game.anchor = 0; game.state = 'playing';
  return game;
}

test('PERFECT+を含む判定窓の内外を、早押し・遅押しの両方で判定する', () => {
  const cases = [[0, 'perfectPlus'], [0.020, 'perfectPlus'], [0.020001, 'perfect'], [0.045, 'perfect'], [0.045001, 'great'], [0.090, 'great'], [0.090001, 'good'], [0.150, 'good'], [0.150001, null]];
  for (const sign of [-1, 1]) for (const [delta, expected] of cases) {
    const game = gameFixture();
    assert.equal(game.hit(0, 1 + sign * delta), expected, 'delta=' + sign * delta);
    assert.equal(game.judgedCount, expected === null ? 0 : 1);
  }
});

test('理論値は基本1,000,000点＋総ノーツ数、追加精度は最大10%', () => {
  const game = gameFixture(4);
  for (let index = 0; index < 4; index++) game.hit(index, index + 1);
  assert.equal(game.baseScore, 1000000);
  assert.equal(game.bonusScore, 4);
  assert.equal(game.score, 1000004);
  assert.equal(game.accuracy, 100);
  assert.equal(game.bonusAccuracy, 10);
  assert.equal(game.counts.perfectPlus, 4);
  assert.equal(game.maxCombo, 4);
});

test('通常PERFECTも基本点は満点だが、追加点・追加精度は加算しない', () => {
  const game = gameFixture(4);
  for (let index = 0; index < 4; index++) game.hit(index, index + 1.03);
  assert.equal(game.baseScore, 1000000);
  assert.equal(game.score, 1000000);
  assert.equal(game.accuracy, 100);
  assert.equal(game.bonusAccuracy, 0);
  assert.equal(game.counts.perfect, 4);
});

test('混在判定は基本点を四捨五入してからPERFECT+分を加え、追加精度は総数で割る', () => {
  const game = gameFixture(4);
  for (const [index, delta] of [0, 0.03, 0.06, 0.12].entries()) game.hit(index, index + 1 + delta);
  assert.equal(game.baseScore, 775000);
  assert.equal(game.score, 775001);
  assert.equal(game.accuracy, 77.5);
  assert.equal(game.bonusAccuracy, 2.5);
  game.reset();
  assert.equal(game.bonusAccuracy, 0);
  assert.equal(game.score, 0);
  assert.ok(Object.values(game.counts).every(value => value === 0));
});

test('LNは始点のPERFECT+を保持し、終点100ms前の完了時に1回だけ加算する', () => {
  const game = gameFixture();
  game.notes[0].endTime = 2;
  game.setHeld(0, true, 'keyboard', 1);
  assert.equal(game.hit(0, 1), 'perfectPlus');
  assert.equal(game.score, 0);
  game.updateHolds(1.899999);
  assert.equal(game.judgedCount, 0);
  game.updateHolds(1.9);
  game.updateHolds(2);
  assert.equal(game.counts.perfectPlus, 1);
  assert.equal(game.score, 1000001);
  assert.equal(game.bonusAccuracy, 10);
  assert.equal(game.judgedCount, 1);
});

test('LNを早く離した場合はPERFECT+の追加点が付かない', () => {
  const game = gameFixture();
  game.notes[0].endTime = 2;
  game.setHeld(0, true, 'keyboard', 1);
  game.hit(0, 1);
  game.setHeld(0, false, 'keyboard', 1.8);
  assert.equal(game.counts.miss, 1);
  assert.equal(game.bonusScore, 0);
  assert.equal(game.bonusAccuracy, 0);
});

test('速度を10倍まで保存でき、速度と入力機器を変えても判定窓は変わらない', () => {
  const definition = PLAY_SETTING_DEFINITIONS.find(item => item.key === 'speed');
  assert.equal(clampSetting(definition, 10), 10);
  assert.equal(clampSetting(definition, 100), 10);
  assert.equal(clampSetting(definition, 0), 0.6);
  assert.equal(DEFAULT_SETTINGS.speed, 2.5);
  for (const speed of [0.6, 1, 10]) for (const source of ['keyboard', 'left', 'right']) {
    const game = gameFixture(1, { speed, offset: 30 });
    assert.equal(game.hit(0, 1.05, source), 'perfectPlus');
    assert.equal(game.score, CONFIG.baseScore + 1);
  }
});

test('判定ラベルとHUDにはPERFECT+と2つの精度を表示する', () => {
  const game = gameFixture(4);
  for (let index = 0; index < 4; index++) game.hit(index, index + 1 + (index === 3 ? 0.03 : 0));
  let judgement;
  StageView.prototype.showJudgement.call({ drawJudgement: (...values) => { judgement = values; } }, { rating: 'perfectPlus', deltaMs: 0 });
  assert.equal(judgement[0], 'PERFECT+');
  const text = () => ({ setText(value) { this.value = value; } });
  const hud = { game, scoreText: text(), accuracyText: text(), comboText: text(), maxComboText: text(), countTexts: Object.fromEntries(Object.keys(game.counts).map(key => [key, text()])) };
  SpatialUI.prototype.updateStatsText.call(hud);
  assert.equal(hud.accuracyText.value, '100.00% + 7.50%');
  assert.equal(hud.scoreText.value, '1000003');
  assert.equal(hud.countTexts.perfectPlus.value, 3);
});
