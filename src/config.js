export const JUDGEMENTS = Object.freeze({
  perfectPlus: { label: 'PERFECT+', color: '#fff2a6' },
  perfect: { label: 'PERFECT', color: '#9aeeff' },
  great: { label: 'GREAT', color: '#9df5ca' },
  good: { label: 'GOOD', color: '#ffdda1' },
  miss: { label: 'MISS', color: '#ff8c9d' },
});

export const CONFIG = Object.freeze({
  keys: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
  colors: ['#43ddff', '#5c96ff', '#ef8bc6', '#ff9478'],
  laneSpacing: 0.32,
  laneWidth: 0.29,
  laneSurfaceY: -0.018,
  laneSurfaceHeight: 0.014,
  hitZ: -0.65,
  hitPlaneY: 0.07,
  // 距離と表示時間を同じ倍率で延ばし、流れる速さを保って奥から見せる。
  laneDepth: 15,
  travelSeconds: 4.8,
  countInSeconds: 3,
  vrEyeHeight: 1.65,
  vrBackOffset: 0.3,
  minTrackedEyeHeight: 0.5,
  baseScore: 1_000_000,
  clearScore: 600_000,
  highClearScore: 900_000,
  hold: { endToleranceSeconds: 0.1, trackingGraceSeconds: 0.12, resumeGraceSeconds: 0.4, abovePlane: 0.16, belowPlane: 0.30 },
  windows: { perfectPlus: 0.020, perfect: 0.045, great: 0.09, good: 0.15 },
  weights: { perfectPlus: 1, perfect: 1, great: 0.7, good: 0.4, miss: 0 },
  swing: {
    tipOffset: [0, 0, -0.14],
    rearmHeight: 0.12,
    depthTolerance: 0.23,
    cooldownSeconds: 0.1,
    maxSampleGapSeconds: 0.1,
    maxSampleDistance: 0.65,
  },
});

export const DEFAULT_SETTINGS = Object.freeze({
  autoplay: 0,
  speed: 1,
  volume: 60,
  hitVolume: 60,
  offset: 0,
  audioOffset: 0,
  height: 0.95,
  laneOffsetZ: 0,
  lanePitch: 0,
  laneCoverTransparency: 0,
  progressBarLength: CONFIG.laneDepth,
  normaGaugeLength: CONFIG.laneDepth,
  swing: 0.65,
  laneEffects: 1,
  laneGlow: 1,
  laneRipple: 1,
  laneSparks: 1,
  laneEffectStrength: 60,
  laneEffectDuration: 280,
  panelLeftX: -1.14,
  panelLeftY: 1.51,
  panelLeftDistance: 1.35,
  panelLeftYaw: 55,
  panelRightX: 1.14,
  panelRightY: 1.51,
  panelRightDistance: 1.35,
  panelRightYaw: -55,
  panelCenterX: 0,
  panelCenterY: 1.57,
  panelCenterDistance: 2.10,
  panelCenterYaw: 0,
  panelOffsetX: 0,
  panelOffsetY: 0,
  panelOffsetZ: 1.24,
});

export const PLAY_SETTING_DEFINITIONS = Object.freeze([
  { key: 'autoplay', label: 'オートプレイ（自己ベスト保存なし）', type: 'toggle', min: 0, max: 1, step: 1 },
  { key: 'speed', label: 'ノーツ速度', min: 0.6, max: 10, step: 0.1, unit: '×', digits: 1 },
  { key: 'volume', label: '曲の音量', min: 0, max: 100, step: 1, unit: '%', digits: 0 },
  { key: 'hitVolume', label: 'ヒットSEの音量', min: 0, max: 100, step: 1, unit: '%', digits: 0 },
  { key: 'audioOffset', label: '音声オフセット', min: -500, max: 500, step: 5, unit: ' ms', digits: 0 },
  { key: 'offset', label: '入力オフセット', min: -200, max: 200, step: 5, unit: ' ms', digits: 0 },
  { key: 'swing', label: '最低振り下ろし速度', min: 0.2, max: 2, step: 0.05, unit: ' m/s', digits: 2 },
]);

export const LANE_SETTING_DEFINITIONS = Object.freeze([
  { key: 'laneOffsetZ', label: 'レーンの前後位置（−奥 / ＋手前）', min: -3, max: 3, step: 0.01, unit: ' m', digits: 2 },
  { key: 'lanePitch', label: 'レーンの傾き（＋で奥を上げる）', min: -30, max: 75, step: 1, unit: '°', digits: 0 },
  { key: 'height', label: '判定面の高さ', min: 0.55, max: 1.4, step: 0.01, unit: ' m', digits: 2 },
  { key: 'laneCoverTransparency', label: '黒い下地の透明度', min: 0, max: 100, step: 1, unit: '%', digits: 0 },
]);

export const GAUGE_SETTING_DEFINITIONS = Object.freeze([
  { key: 'progressBarLength', label: '左：残り時間バーの長さ', min: 0.1, max: 50, step: 0.1, unit: ' m', digits: 1 },
  { key: 'normaGaugeLength', label: '右：ノルマゲージの長さ', min: 0.1, max: 50, step: 0.1, unit: ' m', digits: 1 },
]);

export const EFFECT_SETTING_DEFINITIONS = Object.freeze([
  { key: 'laneEffects', label: 'レーンエフェクト', type: 'toggle', min: 0, max: 1, step: 1 },
  { key: 'laneGlow', label: '入力時のレーン発光', type: 'toggle', min: 0, max: 1, step: 1 },
  { key: 'laneRipple', label: 'ヒット時の波紋', type: 'toggle', min: 0, max: 1, step: 1 },
  { key: 'laneSparks', label: 'ヒット時の火花', type: 'toggle', min: 0, max: 1, step: 1 },
  { key: 'laneEffectStrength', label: 'エフェクトの強さ', min: 0, max: 100, step: 5, unit: '%', digits: 0 },
  { key: 'laneEffectDuration', label: 'エフェクトの表示時間', min: 100, max: 800, step: 20, unit: ' ms', digits: 0 },
]);

export const PANEL_GROUPS = Object.freeze([
  { id: 'track', label: '左：曲情報', prefix: 'panelLeft', xMin: -2.4, xMax: -0.65 },
  { id: 'stats', label: '右：成績', prefix: 'panelRight', xMin: 0.65, xMax: 2.4 },
  { id: 'menu', label: '中央：メニュー', prefix: 'panelCenter', xMin: -0.8, xMax: 0.8 },
]);

export const PANEL_SETTING_DEFINITIONS = Object.freeze(PANEL_GROUPS.flatMap(group => [
  { key: `${group.prefix}X`, label: '左右位置（−左 / ＋右）', min: group.xMin, max: group.xMax, step: 0.01, unit: ' m', digits: 2 },
  { key: `${group.prefix}Y`, label: '高さ', min: 0.65, max: 2.4, step: 0.01, unit: ' m', digits: 2 },
  { key: `${group.prefix}Distance`, label: '前後の距離（小さいほど手前）', min: group.id === 'menu' ? 1.1 : 0.85, max: 3, step: 0.01, unit: ' m', digits: 2 },
  { key: `${group.prefix}Yaw`, label: '向き（左右の角度）', min: -85, max: 85, step: 1, unit: '°', digits: 0 },
]));

export const PANEL_OFFSET_DEFINITIONS = Object.freeze([
  { key: 'panelOffsetX', label: '全体の左右移動（−左 / ＋右）', min: -0.8, max: 0.8, step: 0.01, unit: ' m', digits: 2 },
  { key: 'panelOffsetY', label: '全体の上下移動（−下 / ＋上）', min: -0.5, max: 0.75, step: 0.01, unit: ' m', digits: 2 },
  { key: 'panelOffsetZ', label: '全体の前後移動（−奥 / ＋手前）', min: -3, max: 3, step: 0.01, unit: ' m', digits: 2 },
]);

// 左右の個別角度から値を表示し、操作したときに左右を対称へ揃えるUI項目。
export const PAIRED_PANEL_ANGLE_SETTING = Object.freeze({
  key: 'pairedPanelAngle', label: '左右の角度（＋内向き / −外向き）', min: -85, max: 85, step: 1, unit: '°', digits: 0,
});

export const SETTING_DEFINITIONS = Object.freeze([...PLAY_SETTING_DEFINITIONS, ...LANE_SETTING_DEFINITIONS, ...GAUGE_SETTING_DEFINITIONS, ...EFFECT_SETTING_DEFINITIONS, ...PANEL_SETTING_DEFINITIONS, ...PANEL_OFFSET_DEFINITIONS]);

export function clampSetting(definition, value) {
  const clamped = Math.max(definition.min, Math.min(definition.max, value));
  return Number((definition.min + Math.round((clamped - definition.min) / definition.step) * definition.step).toFixed(3));
}

// 短いLNも始点より前には完了させない。
export function holdCompletionTime(note) {
  return Math.max(note.time, note.endTime - CONFIG.hold.endToleranceSeconds);
}

export function laneX(lane) {
  return (lane - 1.5) * CONFIG.laneSpacing;
}

export function laneAt(x) {
  const lane = Math.round(x / CONFIG.laneSpacing + 1.5);
  if (lane < 0 || lane > 3) return -1;
  return Math.abs(x - laneX(lane)) <= CONFIG.laneWidth / 2 ? lane : -1;
}
