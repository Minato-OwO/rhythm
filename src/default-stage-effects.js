import { upperBound } from './scroll-track.js';

function progress(point, time) {
  const value = point.duration === 0 ? 1 : Math.max(0, Math.min(1, (time - point.time) / point.duration));
  return point.easing === 'smoothstep' ? value * value * (3 - 2 * value) : value;
}

// 最初の手動演出は、その直前の背景の自動表示状態から移行する。
function automaticOpacityBefore(chart, time) {
  let latest = null;
  for (const event of chart.events ?? []) {
    if (event.time >= time) break;
    if (!['backgroundGLB', 'backgroundScene'].includes(event.type) || event.time + event.duration < time) continue;
    if (!latest || event.time > latest.time || event.time === latest.time && event.type === 'backgroundScene') latest = event;
  }
  return latest?.src && latest.hideDefault ? 0 : 1;
}

// 床とアーチの表示状態を楽曲時刻から直接求める。シーク・リトライでも同じ結果になる。
export class DefaultStageEffects {
  constructor(view) {
    this.view = view;
    this.T = view.THREE;
    this.visible = view.environment.visible;
    this.parts = Object.entries(view.environmentParts).map(([id, object]) => {
      const materials = new Map();
      object.traverse(child => {
        for (const material of child.material ? [].concat(child.material) : []) {
          if (materials.has(material)) continue;
          materials.set(material, {
            material, color: material.color?.clone(), opacity: material.opacity,
            transparent: material.transparent, depthWrite: material.depthWrite,
          });
          // フェード中のシェーダー切替を避け、透明な線で背景の深度を塞がない。
          if (!material.transparent) { material.transparent = true; material.needsUpdate = true; }
          material.depthWrite = false;
        }
      });
      return { id, object, visible: object.visible, materials: [...materials.values()], track: [], tint: new this.T.Color('#ffffff') };
    });
  }

  setChart(chart) {
    for (const part of this.parts) part.track = [];
    for (const event of chart.events ?? []) {
      if (event.type !== 'backgroundStage') continue;
      for (const part of this.parts) {
        if (event.target !== 'all' && event.target !== part.id) continue;
        const previous = part.track.at(-1);
        const weight = previous ? progress(previous, event.time) : 0;
        const fromOpacity = previous
          ? previous.fromOpacity + (previous.opacity - previous.fromOpacity) * weight
          : automaticOpacityBefore(chart, event.time);
        const fromTint = previous
          ? previous.fromTint.clone().lerp(previous.toTint, weight)
          : new this.T.Color('#ffffff');
        part.track.push({
          time: event.time, duration: event.duration, easing: event.easing,
          fromOpacity, opacity: event.opacity, fromTint,
          toTint: new this.T.Color(event.color ?? '#ffffff'),
        });
      }
    }
    this.reset();
  }

  update(time, pulse, pulseAmount, automaticVisible) {
    let visible = false;
    for (const part of this.parts) {
      const point = part.track[upperBound(part.track, time) - 1];
      let opacity = automaticVisible ? 1 : 0;
      part.tint.set('#ffffff');
      if (point) {
        const weight = progress(point, time);
        opacity = point.fromOpacity + (point.opacity - point.fromOpacity) * weight;
        part.tint.copy(point.fromTint).lerp(point.toTint, weight);
      }
      part.object.visible = part.visible && opacity > 0;
      visible ||= part.object.visible;
      for (const entry of part.materials) {
        entry.material.opacity = entry.opacity * opacity;
        if (entry.color) entry.material.color.copy(entry.color).lerp(pulse, pulseAmount).multiply(part.tint);
      }
    }
    this.view.environment.visible = this.visible && visible;
  }

  reset() {
    this.view.environment.visible = this.visible;
    for (const part of this.parts) {
      part.object.visible = part.visible;
      for (const entry of part.materials) {
        entry.material.opacity = entry.opacity;
        if (entry.color) entry.material.color.copy(entry.color);
      }
    }
  }

  dispose() {
    this.reset();
    for (const part of this.parts) {
      for (const entry of part.materials) {
        if (entry.material.transparent !== entry.transparent) {
          entry.material.transparent = entry.transparent;
          entry.material.needsUpdate = true;
        }
        entry.material.depthWrite = entry.depthWrite;
      }
    }
  }
}
