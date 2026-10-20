import { CONFIG, DEFAULT_SETTINGS, laneX } from './config.js';
import { CLEAR_STATUS, clearStatusForScore } from './clear-status.js';

// レーンと同じ親に置く固定形状。更新は長さ・位置・色だけで、画像を生成しない。
export class LaneGauges {
  constructor(T, parent, atlas = null, settings = DEFAULT_SETTINGS) {
    this.T = T;
    this.settings = settings;
    this.root = new T.Group();
    this.root.name = 'Lane edge gauges';
    parent.add(this.root);
    // 箱同士の前面・底面の重なりをなくし、レーン面に沿う平面を共有する。
    this.geometry = new T.PlaneGeometry(1, 1);
    this.geometry.rotateX(-Math.PI / 2);
    this.materials = [];
    this.labels = [];
    // バーの内側をレーン本体の端に合わせ、左右の重なり・隙間をなくす。
    const laneEdge = laneX(CONFIG.keys.length - 1) + CONFIG.laneWidth / 2;
    const surfaceY = CONFIG.laneSurfaceY + CONFIG.laneSurfaceHeight / 2;
    const x = laneEdge + 0.032 / 2;
    const center = CONFIG.hitZ - CONFIG.laneDepth / 2;
    this.remaining = this.strip(-x, center, 0.032, CONFIG.laneDepth, '#43ddff', 1);
    this.norma = this.strip(x, center, 0.032, CONFIG.laneDepth, CLEAR_STATUS.failed.color, 1);
    this.remainingTip = this.strip(-(laneEdge + 0.075 / 2), CONFIG.hitZ - CONFIG.laneDepth, 0.075, 0.025, '#b7f5ff', 2);
    this.clearMark = this.strip(laneEdge + 0.095 / 2, CONFIG.hitZ - CONFIG.laneDepth * CONFIG.clearScore / CONFIG.baseScore, 0.095, 0.025, CLEAR_STATUS.clear.color, 2);
    this.highClearMark = this.strip(laneEdge + 0.095 / 2, CONFIG.hitZ - CONFIG.laneDepth * CONFIG.highClearScore / CONFIG.baseScore, 0.095, 0.025, CLEAR_STATUS.highClear.color, 2);
    if (atlas) {
      const label = (text, px, z, color, align, height = 0.06) => {
        const value = atlas.createText({ height, color, align, capacity: 16 });
        value.setText(text);
        value.mesh.position.set(px, surfaceY + 0.008, z);
        value.mesh.rotation.x = -Math.PI / 2;
        this.root.add(value.mesh);
        this.labels.push(value);
        return value;
      };
      label('TIME', -x - 0.065, CONFIG.hitZ - 0.12, '#43ddff', 'right');
      this.normaLabel = label('NORM', x + 0.065, CONFIG.hitZ - 0.12, CLEAR_STATUS.failed.color, 'left');
      this.clearLabel = label('600K', laneEdge + 0.155, this.clearMark.position.z, CLEAR_STATUS.clear.color, 'left', 0.11);
      this.highClearLabel = label('900K', laneEdge + 0.155, this.highClearMark.position.z, CLEAR_STATUS.highClear.color, 'left', 0.11);
    }
    this.applyLayout();
  }

  strip(x, z, width, depth, color, layer) {
    const material = new this.T.MeshBasicMaterial({
      color, fog: false, toneMapped: false, transparent: false,
      side: this.T.DoubleSide, depthTest: true, depthWrite: true,
      // 同一平面でも描画順と深度の優先度を分け、遠方や斜め視点で競合させない。
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -(layer + 1) * 2,
    });
    this.materials.push(material);
    const mesh = new this.T.Mesh(this.geometry, material);
    mesh.position.set(x, CONFIG.laneSurfaceY + CONFIG.laneSurfaceHeight / 2 + 0.001, z);
    mesh.scale.set(width, 1, depth);
    mesh.renderOrder = 10 + layer;
    this.root.add(mesh);
    return mesh;
  }

  applyLayout() {
    this.progressLength = this.settings.progressBarLength ?? DEFAULT_SETTINGS.progressBarLength;
    this.normaLength = this.settings.normaGaugeLength ?? DEFAULT_SETTINGS.normaGaugeLength;
    this.clearMark.position.z = CONFIG.hitZ - this.normaLength * CONFIG.clearScore / CONFIG.baseScore;
    this.highClearMark.position.z = CONFIG.hitZ - this.normaLength * CONFIG.highClearScore / CONFIG.baseScore;
    if (this.clearLabel) this.clearLabel.mesh.position.z = this.clearMark.position.z;
    if (this.highClearLabel) this.highClearLabel.mesh.position.z = this.highClearMark.position.z;
    // ポーズ中に調節した場合も、満タンに戻さず現在の残量・スコアを保つ。
    this.update(this.lastScore ?? 0, this.lastTime ?? 0, this.lastDuration ?? 1);
  }

  setLength(mesh, ratio, fullLength) {
    const length = fullLength * ratio;
    mesh.visible = length > 0;
    mesh.scale.z = length;
    // 手前の端を固定し、残量の先端が奥から手前へ近付く。
    mesh.position.z = CONFIG.hitZ - length / 2;
  }

  update(score, time, duration) {
    this.lastScore = score;
    this.lastTime = time;
    this.lastDuration = duration;
    const elapsed = Number.isFinite(time) ? Math.max(0, time) : 0;
    const remaining = Number.isFinite(duration) && duration > 0 ? Math.max(0, 1 - elapsed / duration) : 0;
    this.setLength(this.remaining, remaining, this.progressLength);
    this.remainingTip.visible = remaining > 0;
    this.remainingTip.position.z = CONFIG.hitZ - this.progressLength * remaining;
    const value = Number.isFinite(score) ? Math.max(0, score) : 0;
    this.setLength(this.norma, Math.min(1, value / CONFIG.baseScore), this.normaLength);
    const status = clearStatusForScore(value);
    if (status !== this.status) {
      this.status = status;
      this.norma.material.color.set(status.color);
      this.normaLabel?.setText(status.id === 'failed' ? 'NORM' : status.title);
      this.normaLabel?.setColor(status.color);
    }
  }

  dispose() {
    this.root.removeFromParent();
    for (const label of this.labels) label.dispose();
    for (const material of this.materials) material.dispose();
    this.geometry.dispose();
  }
}
