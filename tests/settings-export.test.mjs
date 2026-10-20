import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, SETTING_DEFINITIONS } from '../src/config.js';
import { createSettingsExport, downloadSettings } from '../src/settings-export.js';
import { SpatialUI } from '../src/spatial-ui.js';

const date = new Date('2026-10-21T14:23:45.678Z');

test('全設定を現在値で書き出し、書き出し後の変更と切り離して保持する', () => {
  const current = { ...DEFAULT_SETTINGS,
    autoplay: 1, speed: 4.8, volume: 42, hitVolume: 76, offset: -35, audioOffset: 125,
    height: 1.2, laneOffsetZ: -0.3, lanePitch: 16, laneCoverTransparency: 25,
    progressBarLength: 12, normaGaugeLength: 8, swing: 1.2,
    laneEffects: 1, laneGlow: 0, laneRipple: 0, laneSparks: 1, laneEffectStrength: 90, laneEffectDuration: 420,
    panelLeftX: -1.3, panelLeftY: 1.7, panelLeftDistance: 1.5, panelLeftYaw: 60,
    panelRightX: 1.4, panelRightY: 1.6, panelRightDistance: 1.4, panelRightYaw: -50,
    panelCenterX: 0.1, panelCenterY: 1.8, panelCenterDistance: 2.2, panelCenterYaw: 5,
    panelOffsetX: 0.2, panelOffsetY: -0.1, panelOffsetZ: 1.4,
  };
  const expected = { ...current };
  const exported = createSettingsExport(current, date);
  assert.equal(exported.format, 'fourflow-settings');
  assert.equal(exported.version, 1);
  assert.equal(exported.exportedAt, date.toISOString());
  assert.deepEqual(exported.settings, expected);
  assert.deepEqual(Object.keys(exported.settings).sort(), SETTING_DEFINITIONS.map(item => item.key).sort(), '調整できる項目をすべて含める');
  current.hitVolume = 0;
  current.panelLeftYaw = 20;
  assert.deepEqual(exported.settings, expected);
  assert.deepEqual(createSettingsExport({ speed: 2 }, date).settings, { ...DEFAULT_SETTINGS, speed: 2 }, '省略項目も初期値で補う');
});

function downloadFixture(clickError = null) {
  const events = [], timers = [];
  let downloadedBlob, link;
  const environment = {
    Blob,
    URL: {
      createObjectURL(blob) { downloadedBlob = blob; events.push('url'); return 'blob:settings'; },
      revokeObjectURL(url) { assert.equal(url, 'blob:settings'); events.push('revoke'); },
    },
    document: {
      createElement(tag) {
        assert.equal(tag, 'a');
        link = {
          click() { events.push('click'); if (clickError) throw clickError; },
          remove() { events.push('remove'); },
        };
        return link;
      },
      body: { append(value) { assert.equal(value, link); events.push('append'); } },
    },
    setTimeout(callback, delay) { assert.ok(delay > 0); timers.push(callback); },
  };
  return { environment, events, timers, blob: () => downloadedBlob, link: () => link };
}

test('日時付きJSONのダウンロードを開始し、URLと一時リンクを解放する', async () => {
  const f = downloadFixture();
  const current = { ...DEFAULT_SETTINGS, speed: 3.2, hitVolume: 85 };
  const filename = downloadSettings(current, f.environment, date);
  assert.equal(filename, 'four-flow-settings-2026-10-21T14-23-45-678Z.json');
  assert.equal(f.link().download, filename);
  assert.equal(f.link().href, 'blob:settings');
  assert.equal(f.link().hidden, true);
  assert.ok(f.blob().type.startsWith('application/json'));
  assert.deepEqual(JSON.parse(await f.blob().text()), createSettingsExport(current, date));
  assert.deepEqual(f.events, ['url', 'append', 'click', 'remove'], 'クリック前にURLを解放しない');
  for (const callback of f.timers) callback();
  assert.equal(f.events.at(-1), 'revoke');
});

test('ダウンロード開始に失敗しても一時データを解放し、呼び出し元へエラーを渡す', () => {
  const error = new Error('Download unavailable');
  const f = downloadFixture(error);
  assert.throws(() => downloadSettings(DEFAULT_SETTINGS, f.environment, date), error);
  assert.equal(f.events.at(-1), 'remove');
  for (const callback of f.timers) callback();
  assert.equal(f.events.at(-1), 'revoke');
});

test('全設定タブでエクスポートを実行でき、戻るボタンや他の項目と重ならない', () => {
  for (const tab of ['play', 'lanes', 'gauges', 'effects', 'panels']) {
    const buttons = [];
    let exports = 0;
    const ui = Object.create(SpatialUI.prototype);
    Object.assign(ui, {
      center: { texture: {} }, settingsTab: tab, panelTarget: 'all', settings: { ...DEFAULT_SETTINGS },
      actions: { exportSettings: () => { exports++; } },
      background() {}, text() {}, settingRow() {},
      button(panel, id, label, x, y, width, height, activate) { buttons.push({ id, x, y, width, height, activate }); },
    });
    ui.drawSettings();
    const button = buttons.find(item => item.id === 'export-settings');
    const close = buttons.find(item => item.id === 'close');
    assert.ok(button, tab);
    button.activate();
    assert.equal(exports, 1);
    assert.equal(ui.settingsTab, tab, '書き出しても開いているタブを変えない');
    assert.ok(button.x + button.width <= close.x);
    assert.ok(button.y + button.height <= 968);
    for (const item of buttons) {
      if (item === button || item === close) continue;
      assert.ok(item.y + item.height <= button.y, `既存ボタン ${item.id} と重ならない`);
    }
  }
});
