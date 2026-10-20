// ゲームから読み込む入口。単独ページのUI・カメラ・A-Frame本体は起動しない。
import './clock-art.js';
import './stage.js';

// 別の曲のモジュールが読み込まれても、この曲の実装を使う。
const frozenHours = window.FROZEN_HOURS;

export async function createBackground(context) {
  if (!frozenHours) throw new Error('Frozen Hoursの背景シーンを読み込めませんでした。');
  const background = await frozenHours.createBackground(context);
  return { ...background, preserveMaterialState: true };
}
