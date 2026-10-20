import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonalBests } from '../src/personal-bests.js';

function storageFixture(t) {
  const original = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  t.after(() => { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original; });
  return values;
}

test('旧v1と基本10万点のv2を残し、基本100万点＋PERFECT+をv3に保存する', t => {
  const values = storageFixture(t);
  const old = JSON.stringify({ version: 1, charts: { chart: { score: 1000000, accuracy: 100, maxCombo: 1000 } } });
  values.set('fourflow.personal-bests.v1', old);
  const oldV2 = JSON.stringify({ version: 2, charts: { chart: { score: 101000, accuracy: 100, bonusAccuracy: 10, maxCombo: 1000 } } });
  values.set('fourflow.personal-bests.v2', oldV2);
  const bests = new PersonalBests();
  assert.equal(bests.get('chart'), null);
  bests.record('chart', { score: 1001000, accuracy: 100, bonusAccuracy: 10, maxCombo: 1000 });
  assert.equal(values.get('fourflow.personal-bests.v1'), old);
  assert.equal(values.get('fourflow.personal-bests.v2'), oldV2);
  assert.equal(JSON.parse(values.get('fourflow.personal-bests.v3')).version, 3);
  assert.deepEqual(new PersonalBests().get('chart'), { score: 1001000, accuracy: 100, bonusAccuracy: 10, maxCombo: 1000 });
});

test('精度は合計で比較し、同じプレイの内訳を保つ', t => {
  storageFixture(t);
  const bests = new PersonalBests();
  bests.record('chart', { score: 1000020, accuracy: 100, bonusAccuracy: 2, maxCombo: 100 });
  bests.record('chart', { score: 990050, accuracy: 99, bonusAccuracy: 5, maxCombo: 90 });
  bests.record('chart', { score: 1000030, accuracy: 100, bonusAccuracy: 3, maxCombo: 95 });
  assert.deepEqual(bests.get('chart'), { score: 1000030, accuracy: 99, bonusAccuracy: 5, maxCombo: 100 });
});

test('追加精度が未保存のv3記録は0として扱い、範囲外の追加精度は保存しない', t => {
  const values = storageFixture(t);
  values.set('fourflow.personal-bests.v3', JSON.stringify({ version: 3, charts: { chart: { score: 1000000, accuracy: 100, maxCombo: 4 } } }));
  const bests = new PersonalBests();
  assert.equal(bests.get('chart').bonusAccuracy, 0);
  bests.record('chart', { score: 1000004, accuracy: 100, bonusAccuracy: 10, maxCombo: 4 });
  assert.equal(bests.get('chart').bonusAccuracy, 10);
  bests.record('chart', { score: 1000005, accuracy: 100, bonusAccuracy: 11, maxCombo: 4 });
  assert.equal(bests.get('chart').score, 1000004);
});
