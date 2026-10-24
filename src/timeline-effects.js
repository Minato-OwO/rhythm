import { CONFIG, laneX } from './config.js';

function progress(time, start, duration) {
  return duration === 0 ? 1 : Math.max(0, Math.min(1, (time - start) / duration));
}

// 譜面イベントの経過時間は楽曲時刻だけで求める。一時停止・再開でタイマーを作らない。
export class TimelineEffects {
  constructor(scene, view, settings, chart) {
    this.scene = scene;
    this.view = view;
    this.settings = settings;
    const T = AFRAME.THREE;
    this.T = T;
    this.baseColors = CONFIG.colors.map(color => new T.Color(color));
    this.currentColors = this.baseColors.map(color => color.clone());
    this.root = new T.Group();
    view.laneRoot.add(this.root);
    this.pulses = CONFIG.colors.map((color, lane) => {
      const material = new T.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: T.DoubleSide, forceSinglePass: true });
      const mesh = new T.Mesh(view.effects.glowGeometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(laneX(lane), 0.039, CONFIG.hitZ - CONFIG.laneDepth / 2);
      this.root.add(mesh);
      return mesh;
    });
    // カメラに追従する3D面なので、KB・VRの両眼に同じ画面演出が出る。
    this.screen = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
    this.screen.position.z = -0.12;
    this.screen.renderOrder = 10000;
    this.screen.frustumCulled = false;
    this.attachCamera = () => scene.camera?.add(this.screen);
    this.attachCamera();
    scene.addEventListener('camera-set-active', this.attachCamera);
    this.setChart(chart);
  }

  setChart(chart) {
    this.chart = chart;
    this.colorTracks = Array.from({ length: 4 }, () => []);
    this.events = [];
    for (const event of chart.events ?? []) {
      if (event.type === 'noteSkin' || event.type.startsWith('background')) continue;
      const tint = event.color ? new this.T.Color(event.color) : null;
      if (event.type !== 'laneColor') { this.events.push({ ...event, tint }); continue; }
      for (const lane of event.lanes) {
        const track = this.colorTracks[lane];
        const previous = track.at(-1);
        const from = previous
          ? previous.from.clone().lerp(previous.to, progress(event.time, previous.time, previous.duration))
          : this.baseColors[lane].clone();
        track.push({ time: event.time, duration: event.duration, from, to: tint ?? this.baseColors[lane] });
      }
    }
    this.reset();
  }

  reset() {
    this.cursor = 0;
    this.active = [];
    this.lastTime = -Infinity;
    this.root.visible = false;
    this.screen.visible = false;
    for (const pulse of this.pulses) pulse.visible = false;
    for (let lane = 0; lane < 4; lane++) this.view.setLaneColor(lane, this.baseColors[lane]);
  }

  updateColors(time) {
    for (let lane = 0; lane < 4; lane++) {
      const track = this.colorTracks[lane];
      let low = 0;
      let high = track.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (track[middle].time <= time) low = middle + 1;
        else high = middle;
      }
      const current = track[low - 1];
      const color = this.currentColors[lane];
      if (current) color.copy(current.from).lerp(current.to, progress(time, current.time, current.duration));
      else color.copy(this.baseColors[lane]);
      if (!color.equals(this.view.materials[lane].color)) this.view.setLaneColor(lane, color);
    }
  }

  update(time, state) {
    if (state !== 'playing' && state !== 'paused') {
      if (this.lastTime !== -Infinity) this.reset();
      return;
    }
    if (time < this.lastTime) this.reset();
    this.lastTime = time;
    this.root.visible = true;
    this.updateColors(this.settings.laneEffects ? time : -Infinity);
    for (const pulse of this.pulses) { pulse.visible = false; pulse.material.opacity = 0; }
    // 画面外の過去イベントは保持しない。後戻り時だけ時刻0から再構成する。
    while (this.cursor < this.events.length && this.events[this.cursor].time <= time) {
      const event = this.events[this.cursor++];
      if (time < event.time + event.duration) this.active.push(event);
    }
    let kept = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    let alpha = 0;
    for (const event of this.active) {
      const elapsed = time - event.time;
      if (elapsed >= event.duration) continue;
      this.active[kept++] = event;
      if (event.type === 'lanePulse') {
        if (!this.settings.laneEffects) continue;
        const opacity = event.intensity * (1 - elapsed / event.duration) ** 2 * this.settings.laneEffectStrength / 100;
        for (const lane of event.lanes) {
          const pulse = this.pulses[lane];
          if (opacity <= pulse.material.opacity) continue;
          pulse.visible = true;
          pulse.material.opacity = opacity;
          pulse.material.color.copy(event.tint ?? this.currentColors[lane]);
        }
        continue;
      }
      const attack = event.fadeIn ? Math.min(1, elapsed / event.fadeIn) : 1;
      const release = event.fadeOut ? Math.min(1, (event.duration - elapsed) / event.fadeOut) : 1;
      const weight = event.intensity * Math.max(0, Math.min(attack, release));
      red = event.tint.r * weight + red * (1 - weight);
      green = event.tint.g * weight + green * (1 - weight);
      blue = event.tint.b * weight + blue * (1 - weight);
      alpha = weight + alpha * (1 - weight);
    }
    this.active.length = kept;
    // 一時停止メニューが暗転に隠れないようにする。再開すると同じ演出位置へ戻る。
    this.screen.visible = state === 'playing' && alpha > 0;
    this.screen.material.opacity = alpha;
    if (alpha > 0) this.screen.material.color.setRGB(red / alpha, green / alpha, blue / alpha);
  }

  dispose() {
    this.scene.removeEventListener('camera-set-active', this.attachCamera);
    this.root.removeFromParent();
    this.screen.removeFromParent();
    this.screen.geometry.dispose();
    this.screen.material.dispose();
    for (const pulse of this.pulses) pulse.material.dispose();
  }
}
