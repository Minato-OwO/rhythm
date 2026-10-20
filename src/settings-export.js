import { DEFAULT_SETTINGS } from './config.js';

// 保存領域ではなく現在の設定をコピーし、保存不可の環境でも最新の変更を含める。
export function createSettingsExport(settings, now = new Date()) {
  const values = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) values[key] = settings[key] ?? DEFAULT_SETTINGS[key];
  return {
    format: 'fourflow-settings',
    version: 1,
    exportedAt: now.toISOString(),
    settings: values,
  };
}

// キーボード・VRともボタン操作の呼び出し内でダウンロードを開始する。
export function downloadSettings(settings, environment = window, now = new Date()) {
  const data = createSettingsExport(settings, now);
  const filename = `four-flow-settings-${data.exportedAt.replace(/[:.]/g, '-')}.json`;
  const blob = new environment.Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
  const link = environment.document.createElement('a');
  const url = environment.URL.createObjectURL(blob);
  try {
    link.href = url;
    link.download = filename;
    link.hidden = true;
    environment.document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // ダウンロード側がURLを受け取るまで残し、書き出し後に解放する。
    environment.setTimeout(() => environment.URL.revokeObjectURL(url), 1000);
  }
  return filename;
}
