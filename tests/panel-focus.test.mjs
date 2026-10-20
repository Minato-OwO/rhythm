import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialUI } from '../src/spatial-ui.js';

function panel(id) {
  const material = { opacity: 1, depthWrite: true };
  const value = {
    id, mesh: { visible: true, material, userData: {} }, canvas: { width: 100, height: 100 },
    regions: [{ id: 'button', x: 0, y: 0, width: 100, height: 100 }], dirty: false,
    opacity: 1, displayOpacity: 1, targetVisible: true, viewKey: id, desiredViewKey: id,
    fadeTo: 1, focusOpacity: 1, focusFrom: 1, focusTo: 1, focusStarted: 0, focusDuration: 0, lastFocused: -Infinity,
    fadeMaterials: [{ material, opacity: 1 }, { material: { opacity: 0.45 }, opacity: 0.45 }],
  };
  value.mesh.userData.panel = value;
  return value;
}

function fixture() {
  const ui = Object.create(SpatialUI.prototype);
  Object.assign(ui, {
    game: { state: 'playing' }, settingsOpen: false, songSelectionOpen: false, screenPhase: 'stable',
    left: panel('track'), right: panel('stats'), center: panel('menu'),
    focusedPanels: new Set(), hover: new Map(), mousePresent: false, mouse: {},
    rayOrigin: {}, rayDirection: {}, canvas: { style: {} },
  });
  ui.sidePanels = [ui.left, ui.right];
  ui.panels = [...ui.sidePanels, ui.center];
  ui.center.targetVisible = ui.center.mesh.visible = false;
  let gaze = null, mouse = null, vr = false;
  ui.scene = { is: () => vr, camera: { getWorldPosition() {}, getWorldDirection() {} } };
  ui.raycaster = {
    ray: { origin: {}, direction: {} },
    setFromCamera() {},
  };
  ui.pick = origin => {
    const hit = origin === ui.rayOrigin ? gaze : mouse;
    return hit && (hit.mesh.visible || ui.panelFocusable(hit)) ? { panel: hit, region: hit.regions[0] } : null;
  };
  return {
    ui, setGaze: value => { gaze = value; }, setMouse: value => { mouse = value; }, setVR: value => { vr = value; },
    step(now) {
      ui.updateSidePanelFocus(now);
      for (const side of ui.sidePanels) ui.updatePanelTransition(side, now);
    },
  };
}

test('プレイ中は左右の画像と子要素を消し、見えないパネルへの視線で再表示する', () => {
  const f = fixture(), { ui } = f;
  f.step(0); f.step(240);
  assert.equal(ui.left.displayOpacity, 0);
  assert.equal(ui.right.displayOpacity, 0);
  assert.equal(ui.left.mesh.visible, false);
  assert.ok(ui.left.fadeMaterials.every(entry => entry.material.opacity === 0));
  assert.equal(ui.panelInteractive(ui.left), false);
  f.setGaze(ui.left);
  f.step(300);
  assert.equal(ui.left.focusTo, 1);
  assert.equal(ui.panelInteractive(ui.left), false);
  f.step(440);
  assert.equal(ui.left.displayOpacity, 1);
  assert.equal(ui.left.mesh.visible, true);
  assert.equal(ui.panelInteractive(ui.left), true);
  assert.equal(ui.right.displayOpacity, 0);
  assert.equal(ui.left.dirty, false, 'フォーカスだけではパネル画像を再描画しない');
});

test('フォーカスが短く外れても消さず、猶予後にフェードする', () => {
  const f = fixture(), { ui } = f;
  f.setGaze(ui.left); f.step(0);
  f.setGaze(null); f.step(219);
  assert.equal(ui.left.focusTo, 1);
  f.step(220); f.step(340);
  assert.equal(ui.left.displayOpacity, 0.5);
  assert.equal(ui.left.mesh.material.depthWrite, false);
  f.setGaze(ui.left); f.step(350); f.step(490);
  assert.equal(ui.left.displayOpacity, 1);
  assert.equal(ui.left.mesh.material.depthWrite, true);
});

test('マウスは静止していても現在の視点で再判定し、VRではコントローラーを使う', () => {
  const f = fixture(), { ui } = f;
  f.step(0); f.step(240);
  ui.mousePresent = true;
  f.setMouse(ui.right); f.step(300); f.step(440);
  assert.equal(ui.right.displayOpacity, 1);
  assert.equal(ui.left.displayOpacity, 0);
  f.setVR(true);
  ui.hover.set('mouse', { panel: ui.left });
  const source = {};
  ui.hover.set(source, { panel: ui.right });
  f.step(500); f.step(750);
  assert.equal(ui.left.displayOpacity, 0, 'VR中に古いマウスのホバーを使わない');
  assert.equal(ui.right.displayOpacity, 1);
});

test('ポーズ・設定・リザルトでは通常表示に戻し、中央パネルに影響しない', () => {
  for (const mode of ['paused', 'finished', 'settings']) {
    const f = fixture(), { ui } = f;
    f.step(0); f.step(240);
    if (mode === 'settings') ui.settingsOpen = true;
    else ui.game.state = mode;
    f.step(300); f.step(440);
    assert.equal(ui.left.displayOpacity, 1);
    assert.equal(ui.right.displayOpacity, 1);
    assert.equal(ui.center.focusOpacity, 1);
  }
});

test('画面切替の準備中は左右パネルを透明に揃えて、一瞬の再表示を防ぐ', () => {
  const f = fixture(), { ui } = f;
  for (const side of ui.sidePanels) { side.opacity = 0; side.fadeTo = 0; }
  f.step(0);
  assert.equal(ui.left.focusOpacity, 0);
  assert.equal(ui.right.focusOpacity, 0);
  for (const side of ui.sidePanels) { side.opacity = 1; ui.applyPanelOpacity(side); }
  f.step(140);
  assert.equal(ui.left.mesh.visible, false);
  assert.equal(ui.left.displayOpacity, 0);
});
