// ゲームから読み込む入口。単独ページのUI・カメラ・A-Frame本体は起動しない。
import './clock-art.js';
import './stage.js';

export async function createBackground(context) {
  if (!window.FROZEN_HOURS) throw new Error('Frozen Hoursの背景シーンを読み込めませんでした。');
  return window.FROZEN_HOURS.createBackground(context);
}
