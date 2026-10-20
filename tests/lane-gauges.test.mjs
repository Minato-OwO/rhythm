import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, DEFAULT_SETTINGS } from '../src/config.js';
import { CLEAR_STATUS, clearStatusForScore } from '../src/clear-status.js';
import { LaneGauges } from '../src/lane-gauges.js';
import { StageView } from '../src/view.js';
import { RhythmGame } from '../src/game.js';
import { SpatialUI } from '../src/spatial-ui.js';
import { PersonalBests } from '../src/personal-bests.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const vector = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } });
class Group {
  children = []; position = vector(); scale = vector(); rotation = {};
  add(...items) { for (const item of items) { this.children.push(item); item.parent = this; } }
  removeFromParent() { this.parent.children = this.parent.children.filter(item => item !== this); this.parent = null; }
}
class Mesh extends Group {
  constructor(geometry, material) { super(); Object.assign(this, { geometry, material, visible: true }); }
}
class PlaneGeometry {
  rotateX(angle) { this.rotationX = angle; return this; }
  dispose() { this.disposed = true; }
}
class MeshBasicMaterial {
  constructor(options) { Object.assign(this, options); this.color = { value: options.color, set(value) { this.value = value; } }; }
  dispose() { this.disposed = true; }
}
const T = { Group, Mesh, PlaneGeometry, MeshBasicMaterial, DoubleSide: 2 };

function runwaySurfaces() {
  const view = Object.create(StageView.prototype), boxes = [];
  Object.assign(view, {
    pads: [], laneAccents: Array.from({ length: 4 }, () => []), applyLaneCoverOpacity() {},
    box(width, height, depth, color, x, y, z) {
      const mesh = { width, height, depth, color, position: { x, y, z } };
      boxes.push(mesh);
      return mesh;
    },
  });
  view.makeRunway();
  return boxes.filter(mesh => mesh.color === '#101d30');
}

test('600k・900kの境界を、追加点込みのスコアで判定する', () => {
  assert.equal(CONFIG.baseScore, 1000000);
  assert.equal(CONFIG.clearScore, 600000);
  assert.equal(CONFIG.highClearScore, 900000);
  for (const [score, expected] of [[0, 'failed'], [599999, 'failed'], [600000, 'clear'], [899999, 'clear'], [900000, 'highClear'], [1000000, 'highClear'], [1001000, 'highClear']]) {
    assert.equal(clearStatusForScore(score).id, expected, `score=${score}`);
  }
  const notes = Array.from({ length: 3 }, (_, id) => ({ id, time: id + 1, lane: id, endTime: null }));
  const game = new RhythmGame({ notes, duration: 5 }, { now: 0 }, { ...DEFAULT_SETTINGS, autoplay: 0 });
  game.state = 'playing'; game.anchor = 0;
  game.hit(0, 1);
  game.hit(1, 2.03);
  game.hit(2, 3.06);
  assert.equal(game.baseScore, 900000);
  assert.equal(game.bonusScore, 1);
  assert.equal(game.score, 900001);
  assert.equal(game.clearStatus, CLEAR_STATUS.highClear);
});

test('左の残量バーはレーン1の外にあり、手前を固定して奥から手前へ減る', () => {
  const parent = new Group(), gauges = new LaneGauges(T, parent, null, { ...DEFAULT_SETTINGS, progressBarLength: 15 });
  assert.equal(gauges.root.parent, parent, 'レーンと同じ親の移動・傾きに追従する');
  const lane = runwaySurfaces()[0];
  near(gauges.remaining.position.x + gauges.remaining.scale.x / 2, lane.position.x - lane.width / 2);
  near(gauges.remaining.position.y, lane.position.y + lane.height / 2 + 0.001);
  let previousTip = -Infinity;
  for (const [time, length] of [[-3, 15], [0, 15], [25, 11.25], [50, 7.5], [100, 0], [110, 0]]) {
    gauges.update(0, time, 100);
    near(gauges.remaining.scale.z, length);
    near(gauges.remaining.position.z + length / 2, CONFIG.hitZ);
    near(gauges.remainingTip.position.z, CONFIG.hitZ - length);
    assert.ok(gauges.remainingTip.position.z >= previousTip, '先端が手前へ動く');
    assert.equal(gauges.remaining.visible, length > 0);
    previousTip = gauges.remainingTip.position.z;
  }
  gauges.update(0, 0, 100);
  near(gauges.remaining.scale.z, 15, 'リトライ時は満タンに戻る');
});

test('右のノルマバーは600k・900kの目印に一致し、金色と満タンへの切替を行う', () => {
  const gauges = new LaneGauges(T, new Group(), null, { ...DEFAULT_SETTINGS, normaGaugeLength: 15 });
  const lane = runwaySurfaces()[3];
  near(gauges.norma.position.x - gauges.norma.scale.x / 2, lane.position.x + lane.width / 2);
  near(gauges.norma.position.y, lane.position.y + lane.height / 2 + 0.001);
  for (const [score, length, status] of [[0, 0, 'failed'], [599999, 15 * 0.599999, 'failed'], [600000, 9, 'clear'], [900000, 13.5, 'highClear'], [1000000, 15, 'highClear'], [1001000, 15, 'highClear']]) {
    gauges.update(score, 0, 100);
    near(gauges.norma.scale.z, length);
    near(gauges.norma.position.z + length / 2, CONFIG.hitZ);
    assert.equal(gauges.norma.material.color.value, CLEAR_STATUS[status].color);
  }
  near(gauges.clearMark.position.z, CONFIG.hitZ - 9);
  near(gauges.highClearMark.position.z, CONFIG.hitZ - 13.5);
  gauges.update(0, 0, 100);
  assert.equal(gauges.norma.visible, false);
  assert.equal(gauges.norma.material.color.value, CLEAR_STATUS.failed.color);
});

test('ポーズ中の長さ変更でも残量とノルマを保ち、形状を作り直さず終了時に解放する', () => {
  const settings = { ...DEFAULT_SETTINGS, progressBarLength: 15, normaGaugeLength: 15 };
  const gauges = new LaneGauges(T, new Group(), null, settings);
  const geometry = gauges.geometry, children = [...gauges.root.children];
  for (let frame = 0; frame < 120; frame++) gauges.update(700000, 50, 100);
  near(gauges.remaining.scale.z, 7.5);
  settings.progressBarLength = 4;
  settings.normaGaugeLength = 6;
  gauges.applyLayout();
  near(gauges.remaining.scale.z, 2);
  near(gauges.norma.scale.z, 4.2);
  near(gauges.remaining.position.z + gauges.remaining.scale.z / 2, CONFIG.hitZ);
  near(gauges.norma.position.z + gauges.norma.scale.z / 2, CONFIG.hitZ);
  near(gauges.clearMark.position.z, CONFIG.hitZ - 3.6);
  near(gauges.highClearMark.position.z, CONFIG.hitZ - 5.4);
  near(gauges.remainingTip.position.z, CONFIG.hitZ - 2);
  settings.progressBarLength = DEFAULT_SETTINGS.progressBarLength;
  settings.normaGaugeLength = DEFAULT_SETTINGS.normaGaugeLength;
  gauges.applyLayout();
  near(gauges.remaining.scale.z, DEFAULT_SETTINGS.progressBarLength / 2);
  near(gauges.norma.scale.z, DEFAULT_SETTINGS.normaGaugeLength * 0.7);
  assert.deepEqual(gauges.root.children, children);
  assert.ok(children.every(mesh => mesh.geometry === geometry));
  gauges.dispose();
  assert.equal(gauges.root.parent, null);
  assert.equal(geometry.disposed, true);
  assert.ok(gauges.materials.every(material => material.disposed));
});

test('下地を生成せず、色バーと目印の描画と深度の優先度を保つ', () => {
  const gauges = new LaneGauges(T, new Group());
  assert.deepEqual(gauges.root.children, [gauges.remaining, gauges.norma, gauges.remainingTip, gauges.clearMark, gauges.highClearMark]);
  assert.ok(gauges.geometry instanceof PlaneGeometry);
  near(gauges.geometry.rotationX, -Math.PI / 2);
  for (const [score, time] of [[0, 0], [1000000, 0], [600000, 50], [0, 100]]) {
    gauges.update(score, time, 100);
    for (const [fill, mark] of [[gauges.remaining, gauges.remainingTip], [gauges.norma, gauges.clearMark], [gauges.norma, gauges.highClearMark]]) {
      assert.equal(fill.geometry, mark.geometry);
      near(fill.position.y, mark.position.y);
      assert.ok(fill.renderOrder < mark.renderOrder);
      assert.ok(fill.material.polygonOffsetUnits > mark.material.polygonOffsetUnits);
      for (const mesh of [fill, mark]) {
        assert.equal(mesh.material.transparent, false);
        assert.equal(mesh.material.polygonOffset, true);
        assert.equal(mesh.material.depthTest, true, '手前の物体による遮蔽を維持する');
        assert.equal(mesh.material.depthWrite, true);
      }
    }
  }
});

function uiFixture(game) {
  const calls = [];
  const ui = Object.create(SpatialUI.prototype);
  Object.assign(ui, {
    game, settings: {}, actions: {}, scene: { is: () => false },
    center: { texture: {} }, details: { texture: {}, ctx: { fillRect() {} } },
    background() {}, wrap() {}, button() {}, drawDensityGraph() {},
    text(panel, value, x, y, size, color) { calls.push({ value, y, color }); },
  });
  return { ui, calls };
}

test('上位クリアのリザルトでランクとスコアを金色にし、通常クリアと区別する', () => {
  for (const score of [599999, 600000, 899999, 900000, 1000001]) {
    const game = { state: 'finished', grade: 'S', score, baseScore: score, bonusScore: 0, accuracy: 100, bonusAccuracy: 0, maxCombo: 100, counts: {} };
    const { ui, calls } = uiFixture(game);
    ui.drawMenu();
    const rank = calls.find(call => call.value === 'RANK S');
    const points = calls.find(call => call.y === 328);
    const gold = CLEAR_STATUS.highClear.color;
    assert.equal(rank.color === gold, score >= 900000);
    assert.equal(points.color === gold, score >= 900000);
    assert.equal(calls.find(call => call.y === 105).value, `${clearStatusForScore(score).title} / ${clearStatusForScore(score).label}`);
  }
});

test('選曲の金色は保存した最高スコアから判定し、後の低いスコアや再読込で失わない', t => {
  const oldStorage = globalThis.localStorage, values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  t.after(() => { if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage; });
  const bests = new PersonalBests();
  bests.record('chart', { score: 900001, accuracy: 90, bonusAccuracy: 1, maxCombo: 100 });
  bests.record('chart', { score: 800000, accuracy: 95, bonusAccuracy: 2, maxCombo: 120 });
  const { ui, calls } = uiFixture({ chart: {}, score: 800000 });
  const analysis = { duration: 60, averageDensity: 1, peakDensity: 1, binSeconds: 1, total: 4, longNotes: 0, lanes: Array.from({ length: 4 }, () => ({ taps: 1, longNotes: 0, total: 1 })) };
  ui.songLibrary = {
    selectedId: 'song', selectedDifficultyId: 'chart', analysis, personalBests: new PersonalBests(),
    songs: [{ id: 'song', title: 'Song', difficulties: [{ id: 'chart', difficulty: 'Normal' }] }],
  };
  ui.difficultyPage = 0;
  ui.drawSongDetails();
  const score = calls.find(call => call.y === 1180);
  assert.equal(score.value, (900001).toLocaleString());
  assert.equal(score.color, CLEAR_STATUS.highClear.color);
});
