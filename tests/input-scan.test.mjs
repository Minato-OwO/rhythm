import test from 'node:test';
import assert from 'node:assert/strict';
import { RhythmGame } from '../src/game.js';
import { DEFAULT_SETTINGS } from '../src/config.js';

test('曲の後半で過去の判定済み始点を毎入力読み直さず、リセットで先頭へ戻る', () => {
  const notes = Array.from({ length: 4000 }, (_, id) => ({ id, time: id, lane: 0, endTime: null }));
  const game = new RhythmGame({ notes, duration: 4001 }, { now: 0 }, { ...DEFAULT_SETTINGS });
  game.state = 'playing'; game.anchor = 0;
  let reads = 0;
  for (const note of game.notes.slice(0, 3990)) {
    Object.defineProperty(note, 'judged', { get() { reads++; return true; } });
  }
  assert.equal(game.hit(0, 3990), 'perfectPlus');
  reads = 0;
  for (let time = 3991; time < 4000; time++) assert.equal(game.hit(0, time), 'perfectPlus');
  assert.equal(reads, 0, '過去3990ノーツを繰り返し走査しない');
  game.reset();
  assert.equal(game.hit(0, 0), 'perfectPlus');
});

test('近い方の未判定ノーツを選び、LNの始点通過後も次のノーツを判定する', () => {
  const notes = [
    { id: 0, time: 1, lane: 0, endTime: 3 },
    { id: 1, time: 1.2, lane: 0, endTime: null },
    { id: 2, time: 1.28, lane: 0, endTime: null },
  ];
  const game = new RhythmGame({ notes, duration: 5 }, { now: 0 }, { ...DEFAULT_SETTINGS });
  game.state = 'playing'; game.anchor = 0;
  assert.equal(game.hit(0, 1), 'perfectPlus');
  assert.equal(game.notes[0].started, true);
  assert.equal(game.hit(0, 1.27), 'perfectPlus');
  assert.equal(game.notes[2].judged, true);
  assert.equal(game.notes[1].judged, false);
  assert.equal(game.hit(0, 1.21), 'perfectPlus');
  assert.equal(game.activeHolds.has(game.notes[0]), true, '始点の検索を進めても保持中LNは残す');
});
