import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialUI } from '../src/spatial-ui.js';

function panel(id, visible, viewKey = id) {
  const material = { opacity: visible ? 1 : 0 };
  return {
    id, mesh: { visible, material }, targetVisible: visible, dirty: false,
    opacity: visible ? 1 : 0, displayOpacity: visible ? 1 : 0,
    fadeFrom: visible ? 1 : 0, fadeTo: visible ? 1 : 0, fadeDuration: 0,
    focusOpacity: 1, viewKey, desiredViewKey: viewKey, lastDraw: 0,
    fadeMaterials: [{ material, opacity: 1 }],
  };
}

function fixture() {
  const ui = Object.create(SpatialUI.prototype);
  const root = { position: { x: 0, z: 0 }, rotation: { y: 0 } };
  Object.assign(ui, {
    center: panel('menu', true, 'songs:0:first'),
    details: panel('details', true, 'details:first:normal:0'),
    left: panel('track', false), right: panel('stats', false), notice: panel('notice', false, ''),
    screenKey: 'songs', pendingScreenKey: 'songs', screenPhase: 'stable',
    settingsOpen: false, songSelectionOpen: true, songPage: 0, difficultyPage: 0,
    panelLayoutDirty: false, anchorDirty: false, root,
    game: { state: 'paused', songTime: 0, chart: { duration: 10 } },
    songLibrary: { selectedId: 'first', selectedDifficultyId: 'normal' },
    scene: { is: () => false }, focusedPanels: new Set(), sidePanels: [], message: '',
    view: { root, pressed: [false, false, false, false], flashes: [0, 0, 0, 0] },
    progressFill: { scale: {}, position: {}, geometry: { parameters: { width: 1 } } },
    progressLeft: 0, keyFlashes: [{}, {}, {}, {}], lastTrackSecond: 0, lastTrackPercent: 0,
  });
  ui.panels = [ui.center, ui.details, ui.left, ui.right, ui.notice];
  ui.drawOrder = [ui.notice, ui.center, ui.details, ui.right, ui.left];
  const draws = [];
  ui.drawSongSelection = () => draws.push('songs');
  ui.drawSongDetails = () => draws.push('details');
  return { ui, draws };
}

test('曲の変更は2枚を表示したまま更新し、古い内容への入力を防ぐ', () => {
  const { ui, draws } = fixture();
  ui.songLibrary.selectedId = 'second';
  ui.songLibrary.selectedDifficultyId = 'hard';
  ui.update(100);
  assert.deepEqual(draws, ['songs']);
  assert.equal(ui.center.viewKey, 'songs:0:second');
  assert.equal(ui.panelInteractive(ui.details), false, '古い難易度ボタンは再描画まで操作できない');
  ui.update(116);
  assert.deepEqual(draws, ['songs', 'details']);
  assert.equal(ui.details.viewKey, 'details:second:hard:0');
  assert.equal(ui.panelInteractive(ui.details), true);
  ui.update(260);
  for (const panel of [ui.center, ui.details]) {
    assert.equal(panel.fadeTo, 1);
    assert.equal(panel.displayOpacity, 1);
    assert.equal(panel.mesh.visible, true);
  }
  assert.equal(ui.panelLayoutDirty, false);
  assert.equal(ui.screenPhase, 'stable');
});

test('難易度・一覧ページの変更でも再表示せず、更新を次フレームへ分散する', () => {
  const { ui, draws } = fixture();
  ui.songPage = 1;
  ui.difficultyPage = 1;
  ui.songLibrary.selectedDifficultyId = 'expert';
  for (const now of [100, 116, 260]) {
    ui.update(now);
    assert.equal(ui.center.displayOpacity, 1);
    assert.equal(ui.details.displayOpacity, 1);
  }
  assert.deepEqual(draws, ['songs', 'details']);
  assert.equal(ui.center.viewKey, 'songs:1:first');
  assert.equal(ui.details.viewKey, 'details:first:expert:1');
});

test('選曲から別の画面に移る場合は既存のフェードを維持する', () => {
  const { ui, draws } = fixture();
  ui.game.state = 'idle';
  ui.closeSongSelection();
  ui.update(100);
  assert.equal(ui.screenPhase, 'out');
  assert.equal(ui.center.fadeTo, 0);
  assert.equal(ui.details.fadeTo, 0);
  assert.deepEqual(draws, [], '消える前に別の画面を描き込まない');
});
