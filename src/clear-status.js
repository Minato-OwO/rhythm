import { CONFIG } from './config.js';

export const CLEAR_STATUS = Object.freeze({
  failed: Object.freeze({ id: 'failed', title: 'NOT CLEARED', label: '未クリア', color: '#ff8c9d' }),
  clear: Object.freeze({ id: 'clear', title: 'CLEAR', label: 'クリア', color: '#9df5ca' }),
  highClear: Object.freeze({ id: 'highClear', title: 'HIGH CLEAR', label: '上位クリア', color: '#ffd76f' }),
});

// PERFECT+の追加点を含む表示スコアで判定し、現在の精度からは推定しない。
export function clearStatusForScore(score) {
  if (score >= CONFIG.highClearScore) return CLEAR_STATUS.highClear;
  if (score >= CONFIG.clearScore) return CLEAR_STATUS.clear;
  return CLEAR_STATUS.failed;
}
