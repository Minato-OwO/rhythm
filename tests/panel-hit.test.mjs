import test from 'node:test';
import assert from 'node:assert/strict';
import { intersectPanel } from '../src/panel-hit.js';
import { SpatialUI } from '../src/spatial-ui.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const vector = (x = 0, y = 0, z = 0) => ({ x, y, z, set(x, y, z) { Object.assign(this, { x, y, z }); } });
const result = () => ({ panel: null, region: null, point: vector(), x: 0, y: 0, distance: 8 });
function panel(yaw = 0, pitch = 0, sx = 1, sy = 1, shear = 0, z = -3) {
  const cy = Math.cos(yaw), sn = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const m = [cy * sx, 0, -sn * sx, 0, sn * sp * sy + cy * shear, cp * sy, cy * sp * sy - sn * shear, 0, sn * cp, -sp, cy * cp, 0, 0, 1, z, 1];
  return {
    width: 2, height: 1.5, canvas: { width: 1000, height: 750 },
    mesh: { visible: true, matrixWorld: { elements: m }, updateWorldMatrix() {} },
    regions: [{ id: 'button', x: 400, y: 200, width: 200, height: 350 }],
    targetVisible: true, viewKey: 'panel', desiredViewKey: 'panel', displayOpacity: 1, fadeTo: 1,
  };
}

test('回転・反転・拡縮されたパネルでも表裏から同じピクセル位置を選択できる', () => {
  const hit = result(), point = hit.point;
  for (const yaw of [-1.3, 0, 1.1]) for (const pitch of [-0.8, 0, 0.6]) {
    for (const sx of [-1.4, 0.6, 2]) for (const sy of [0.5, 1.8]) for (const side of [-1, 1]) {
      const p = panel(yaw, pitch, sx, sy, 0.2);
      const m = p.mesh.matrixWorld.elements;
      for (const u of [-0.9, 0, 0.9]) for (const v of [-0.6, 0, 0.6]) {
        const target = vector(m[12] + m[0] * u + m[4] * v, m[13] + m[1] * u + m[5] * v, m[14] + m[2] * u + m[6] * v);
        const origin = vector(target.x + side * 5 * m[8], target.y + side * 5 * m[9], target.z + side * 5 * m[10]);
        const direction = vector(-side * 2 * m[8], -side * 2 * m[9], -side * 2 * m[10]);
        assert.equal(intersectPanel(p, origin, direction, hit), true);
        close(hit.x, (u / 2 + 0.5) * 1000);
        close(hit.y, (0.5 - v / 1.5) * 750);
        close(hit.distance, 5);
        close(hit.point.x, target.x); close(hit.point.y, target.y); close(hit.point.z, target.z);
        assert.equal(hit.point, point, '交点の格納先を再生成しない');
      }
    }
  }
});

test('矩形外・平行・背後・8mより遠い交点を除外し、境界は選択できる', () => {
  const p = panel(), hit = result();
  for (const [origin, direction] of [
    [vector(1.01, 1, 0), vector(0, 0, -1)],
    [vector(0, 1.76, 0), vector(0, 0, -1)],
    [vector(0, 1, 0), vector(1, 0, 0)],
    [vector(0, 1, 0), vector(0, 0, 1)],
    [vector(0, 1, 6), vector(0, 0, -1)],
  ]) assert.equal(intersectPanel(p, origin, direction, hit), false);
  assert.equal(intersectPanel(p, vector(1, 1.75, 0), vector(0, 0, -1), hit), true);
  close(hit.x, 1000); close(hit.y, 0);
});

test('最も手前のパネルを選び、消えた左右パネルもフォーカスだけで復帰できる', () => {
  const ui = Object.create(SpatialUI.prototype), far = panel(), near = panel(0, 0, 1, 1, 0, -2);
  Object.assign(ui, { panels: [far, near], left: near, right: far, game: { state: 'playing' }, settingsOpen: false, songSelectionOpen: false, mouseHit: result() });
  const origin = vector(0, 1, 0), direction = vector(0, 0, -1);
  const hit = ui.pick(origin, direction);
  assert.equal(hit.panel, near);
  assert.equal(hit.region.id, 'button');
  near.mesh.visible = false;
  near.displayOpacity = 0;
  assert.equal(ui.pick(origin, direction), hit, '結果オブジェクトも再利用する');
  assert.equal(hit.panel, near);
  assert.equal(hit.region, null, '透明な間はボタンを操作できない');
  near.targetVisible = false;
  assert.equal(ui.pick(origin, direction).panel, far);
});

test('再利用した判定結果でホバー元のボタンを見失わず、別の入力の結果も上書きしない', () => {
  const ui = Object.create(SpatialUI.prototype), first = panel(), second = panel(0, 0, 1, 1, 0, -4);
  Object.assign(ui, { panels: [first, second], mouseHit: result(), hover: new Map() });
  ui.panelFocusable = () => false;
  const hit = ui.pick(vector(0, 1, 0), vector(0, 0, -1));
  ui.setHover('mouse', hit);
  first.dirty = second.dirty = false;
  const xrHit = result();
  ui.pick(vector(0, 1, -3.5), vector(0, 0, -1), xrHit);
  assert.equal(hit.panel, first);
  assert.equal(xrHit.panel, second);
  first.mesh.visible = false;
  ui.setHover('mouse', ui.pick(vector(0, 1, 0), vector(0, 0, -1)));
  assert.equal(first.dirty, true);
  assert.equal(second.dirty, true);
  assert.equal(ui.hover.get('mouse').panel, second);
});
