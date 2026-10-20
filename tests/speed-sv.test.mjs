import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChart } from '../src/chart.js';
import { CONFIG, DEFAULT_SETTINGS } from '../src/config.js';
import { ScrollTrack, SpeedTrack, ScrollNoteIndex, SV_MULTIPLIER_LIMIT } from '../src/scroll-track.js';
import { StageView } from '../src/view.js';
import { RhythmGame } from '../src/game.js';
import { ChartDocument } from '../editor/src/editor/ChartDocument.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const baseRate = CONFIG.laneDepth / CONFIG.travelSeconds;
const source = (scrollVelocities, notes = [{ timeSeconds: 5, lane: 0 }, { timeSeconds: 6, lane: 1 }]) => ({
  bpm: 120, durationSeconds: 30, notes, scrollVelocities,
});
const vector = () => ({ set(x, y, z) { Object.assign(this, { x, y, z }); } });
const part = () => ({ position: vector(), scale: vector(), visible: true });

// ゲームとエディタが共有する実際の配置処理を、画面を開かずに実行する。
function stageFixture(data) {
  const chart = normalizeChart(data);
  const game = { chart, notes: chart.notes.map(note => ({ ...note, judged: false, started: false })), state: 'paused' };
  const stage = Object.create(StageView.prototype);
  Object.assign(stage, {
    settings: { ...DEFAULT_SETTINGS, speed: 1 }, laneRoot: {}, noteMeshes: new Map(), pool: [], noteFrame: 0,
    pressed: [false, false, false, false], flashes: [0, 0, 0, 0], scrollBounds: {},
    materials: [{}, {}, {}, {}], holdMaterials: [{}, {}, {}, {}], activeHoldMaterials: [{}, {}, {}, {}],
    pads: Array.from({ length: 4 }, () => ({ material: {} })), effects: { update() {} }, gauges: { update() {} },
    judgement: { mesh: {} }, judgementLabel: { setOpacity() {} }, judgementTiming: { setOpacity() {} },
    lastJudgement: -Infinity, countdownLabel: '',
    makeNote: () => ({ userData: {}, position: {}, head: part(), tail: part(), body: part() }),
  });
  stage.drawIndexedNote = item => stage.drawNote(item.entry);
  return {
    stage, game,
    update(time) { stage.update(game, 1000 + time * 1000, time); },
    mesh(index) { return stage.noteMeshes.get(game.notes[index].id); },
    distance(index, end = 'head') { return CONFIG.hitZ - this.mesh(index)[end].position.z; },
  };
}

test('type省略は従来SV、speedは固定・範囲・正負の上限を受け付ける', () => {
  const chart = normalizeChart(source([
    { timeSeconds: 0, multiplier: 2 },
    { timeSeconds: 2, type: 'speed', mode: 'range', multiplier: -SV_MULTIPLIER_LIMIT, endMultiplier: SV_MULTIPLIER_LIMIT, durationBeats: 4 },
    { timeSeconds: 5, type: 'speed', mode: 'constant', multiplier: 0, endMultiplier: 99, durationBeats: 4 },
  ]));
  assert.equal(chart.scrollVelocities[0].type, 'scroll');
  assert.equal(chart.scrollVelocities[1].type, 'speed');
  assert.equal(chart.scrollVelocities[1].duration, 2);
  assert.equal(chart.scrollVelocities[2].duration, 0, '固定を明示した場合は残った範囲用データを使わない');
  assert.equal(new SpeedTrack(chart.scrollVelocities).multiplierAt(5), 0);
  for (const type of ['invalid', null]) assert.throws(() => normalizeChart(source([{ timeSeconds: 0, type, multiplier: 1 }])), /type/);
  assert.throws(() => normalizeChart(source([{ timeSeconds: 0, type: 'speed', multiplier: SV_MULTIPLIER_LIMIT + 1 }])), /倍率/);
});

test('speedと従来SVは別々に範囲変化・保持・同時刻の上書きを評価する', () => {
  const chart = normalizeChart(source([
    { timeSeconds: 2, type: 'speed', mode: 'range', multiplier: 1, endMultiplier: 3, durationSeconds: 2, easing: 'smoothstep' },
    { timeSeconds: 3, multiplier: 2 },
    { timeSeconds: 6, type: 'speed', multiplier: 0.5 },
    { timeSeconds: 6, multiplier: 4 },
    { timeSeconds: 6, type: 'speed', multiplier: 1.5 },
  ]));
  const speed = new SpeedTrack(chart.scrollVelocities), scroll = new ScrollTrack(chart.scrollVelocities);
  for (const [time, expected] of [[-1, 1], [1.9, 1], [2, 1], [3, 2], [4, 3], [5.99, 3], [6, 1.5]]) close(speed.multiplierAt(time), expected);
  assert.equal(scroll.multiplierAt(3), 2);
  assert.equal(scroll.multiplierAt(6), 4);
  close(scroll.positionAt(5), 7, 'speedの倍率を積分距離に混ぜない');
});

test('TAP間隔が設定時刻で一斉に切り替わり、未来のspeed設定を先取りしない', () => {
  const f = stageFixture(source([
    { timeSeconds: 4, type: 'speed', multiplier: 2 },
    { timeSeconds: 5, type: 'speed', multiplier: 0.5 },
  ]));
  for (const [time, multiplier] of [[2, 1], [3.999, 1], [4, 2], [4.75, 2], [5, 0.5], [2, 1]]) {
    f.update(time);
    close(f.distance(0), (5 - time) * baseRate * multiplier);
    close(f.distance(1) - f.distance(0), baseRate * multiplier);
  }
  assert.equal(f.game.notes[0].time, 5);
  assert.equal(f.game.notes[1].time, 6);
});

test('LNの始点・胴・終点と個別SVへspeedを適用し、保持中の始点は判定線に残す', () => {
  const f = stageFixture(source([
    { timeSeconds: 4, type: 'speed', multiplier: 2 },
  ], [{ timeSeconds: 5, endTimeSeconds: 6, lane: 0, scrollMultiplier: 0.5 }]));
  for (const [time, multiplier] of [[3.9, 1], [4, 2]]) {
    f.update(time);
    close(f.distance(0), (5 - time) * baseRate * 0.5 * multiplier);
    close(f.distance(0, 'tail'), (6 - time) * baseRate * 0.5 * multiplier);
    close(f.mesh(0).body.scale.z, baseRate * 0.5 * multiplier);
  }
  f.game.notes[0].started = true;
  f.update(5.2);
  close(f.distance(0), 0);
  close(f.distance(0, 'tail'), 0.8 * baseRate);
  close(f.mesh(0).body.scale.z, 0.8 * baseRate);
});

test('従来SVのノーツ間隔と連続した切替位置は変わらない', () => {
  const f = stageFixture(source([{ timeSeconds: 4, multiplier: 2 }]));
  f.update(3.999);
  const before = f.distance(0);
  close(f.distance(1) - before, baseRate * 2);
  f.update(4);
  close(f.distance(0), before - 0.001 * baseRate);
  close(f.distance(1) - f.distance(0), baseRate * 2);
});

test('縮小で遠方ノーツを表示し、拡大で範囲外を隠し、0からも復帰する', () => {
  const f = stageFixture(source([
    { timeSeconds: 0, type: 'speed', multiplier: 0.5 },
    { timeSeconds: 1, type: 'speed', multiplier: 4 },
    { timeSeconds: 2, type: 'speed', multiplier: 0 },
    { timeSeconds: 3, type: 'speed', multiplier: 0.5 },
  ], [{ timeSeconds: 8, lane: 0 }, { timeSeconds: 4, lane: 1 }]));
  const far = f.game.notes.findIndex(note => note.time === 8);
  const near = f.game.notes.findIndex(note => note.time === 4);
  f.update(0);
  assert.equal(f.mesh(far)?.head.visible, true);
  f.update(1);
  assert.equal(f.mesh(far)?.head.visible ?? false, false);
  f.update(2);
  close(f.distance(near), 0);
  f.update(3);
  assert.equal(f.mesh(far)?.head.visible, true);
  close(f.distance(far), 5 * baseRate * 0.5);
});

test('表示索引は正負のspeed・個別SV・折り返すLNを取りこぼさない', () => {
  const scroll = new ScrollTrack([
    { time: 0, multiplier: 1 },
    { time: 3, multiplier: -3, endMultiplier: 2, duration: 4, easing: 'smoothstep' },
    { time: 9, multiplier: 0 },
    { time: 11, multiplier: 1 },
  ]);
  const entries = [];
  for (const multiplier of [-1e6, -3, -1.9, -1, -0.2, 0, 0.1, 1, 1.9, 2, 1e6]) {
    for (let time = 1; time <= 15; time += 0.5) {
      const note = { time, endTime: time % 2 === 0 ? time + 2 : null, scrollMultiplier: multiplier };
      const position = scroll.positionAt(time);
      const entry = { note, position, min: position, max: position };
      if (note.endTime !== null) scroll.bounds(time, note.endTime, entry);
      entries.push(entry);
    }
  }
  const index = new ScrollNoteIndex(entries, baseRate, CONFIG.laneDepth);
  for (const speed of [-1e6, -3, -0.25, 0.1, 1, 2.5, 1e6]) for (let time = 0; time < 14; time += 0.25) {
    const position = scroll.positionAt(time), visited = new Set();
    index.visit(position, time, speed, item => {
      assert.ok(!visited.has(item.entry), '同じノーツを二重に描画しない');
      visited.add(item.entry);
    });
    for (const entry of entries) {
      const note = entry.note;
      if ((note.endTime ?? note.time) < time - 0.4) continue;
      if (note.scrollMultiplier === 0) {
        if (time >= note.time - CONFIG.travelSeconds) assert.ok(visited.has(entry));
        continue;
      }
      const rate = baseRate * speed * note.scrollMultiplier;
      const a = (entry.min - position) * rate, b = (entry.max - position) * rate;
      if (Math.max(a, b) >= -0.6 && Math.min(a, b) <= CONFIG.laneDepth) {
        assert.ok(visited.has(entry), `time=${time}, speed=${speed}, individual=${note.scrollMultiplier}`);
      }
    }
  }
});

test('範囲speedで毎フレーム倍率が変わっても表示索引を作り直さない', () => {
  const f = stageFixture(source([
    { timeSeconds: 0, type: 'speed', mode: 'range', multiplier: -2, endMultiplier: 2, durationSeconds: 4 },
  ]));
  f.update(0);
  const index = f.stage.noteIndex;
  for (let frame = 1; frame <= 240; frame++) {
    f.update(frame / 60);
    assert.equal(f.stage.noteIndex, index);
  }
  f.stage.settings.speed = 2;
  f.update(4);
  assert.notEqual(f.stage.noteIndex, index, 'プレイヤーの基準速度を変更した時は索引を更新する');
});

test('事前に用意したノーツを曲全体とリトライで再利用し、表示上限は設けない', () => {
  const f = stageFixture({ ...source([], Array.from({ length: 500 }, (_, index) => ({ timeSeconds: index * 0.1, lane: index % 4 }))), durationSeconds: 60 });
  let created = 0;
  const makeNote = f.stage.makeNote;
  f.stage.makeNote = lane => { created++; return makeNote(lane); };
  f.update(0);
  const preparedCount = created;
  assert.ok(preparedCount > 0 && preparedCount < 500, '全譜面分を生成せず、再利用用の枠を準備する');
  for (let frame = 1; frame < 3000; frame++) f.update(frame / 60);
  assert.equal(created, preparedCount, '通常の接近時間では曲の途中で追加生成しない');
  f.stage.clearNotes = StageView.prototype.clearNotes;
  f.stage.effects.reset = () => {};
  f.stage.clearNotes();
  f.game.notes = f.game.notes.map(note => ({ ...note, judged: false, started: false }));
  f.update(0);
  assert.equal(created, preparedCount, 'リトライ時も既存の枠を使う');

  const dense = stageFixture(source([], Array.from({ length: 513 }, (_, index) => ({ timeSeconds: 1 + index * 0.004, lane: index % 4 }))));
  dense.update(0);
  assert.equal(dense.stage.noteMeshes.size, 513, '事前準備した数を超えても全ノーツを描画する');
});

test('エディタの追加・複製・Undo/Redo・JSON保存でspeedと範囲設定を保つ', () => {
  const doc = new ChartDocument(source([]));
  const id = doc.add('sv', 2, undefined, { type: 'speed', mode: 'range', multiplier: 0.5, endMultiplier: 2, durationBeats: 4, easing: 'smoothstep' });
  const copy = doc.duplicate(id, 6);
  assert.equal(doc.get(copy).data.type, 'speed');
  doc.undo();
  assert.equal(doc.get(copy), undefined);
  doc.redo();
  const saved = doc.export();
  const restored = new ChartDocument(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.export(), saved);
  assert.equal(new SpeedTrack(restored.normalized().scrollVelocities).multiplierAt(4), 2);
  assert.equal(new ScrollTrack(restored.normalized().scrollVelocities).multiplierAt(4), 1);
});

test('speedで見た目を変えても判定時刻・判定幅は変わらない', () => {
  const chart = normalizeChart(source([{ timeSeconds: 0, type: 'speed', multiplier: -5 }]));
  const audio = { now: 0, update() {} };
  const game = new RhythmGame(chart, audio, { ...DEFAULT_SETTINGS, autoplay: 0 });
  game.state = 'playing'; game.anchor = 0;
  assert.equal(game.hit(0, 5.02), 'perfectPlus');
  assert.equal(game.hit(1, 6.045), 'perfect');
  assert.equal(game.baseScore, CONFIG.baseScore);
});
