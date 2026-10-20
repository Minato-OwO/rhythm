import { BackgroundScenes } from './background-scene.js';
import { DefaultStageEffects } from './default-stage-effects.js';

const clamp = value => Math.max(0, Math.min(1, value));
const progress = (time, start, duration) => duration === 0 ? 1 : clamp((time - start) / duration);
function envelope(event, elapsed) {
  const attack = event.fadeIn ? clamp(elapsed / event.fadeIn) : 1;
  const release = event.fadeOut ? clamp((event.duration - elapsed) / event.fadeOut) : 1;
  return Math.min(attack, release) * event.intensity;
}

// ゲームとエディタで共用する、楽曲時刻に追従する背景。GLBは再生前に読み込む。
export class BackgroundEffects {
  constructor(scene, view, chart) {
    const T = AFRAME.THREE;
    this.T = T;
    this.scene = scene;
    this.view = view;
    this.cache = new Map();
    this.baseBackground = scene.object3D.background;
    this.baseColor = this.baseBackground?.isColor ? this.baseBackground.clone() : new T.Color('#090e19');
    this.color = this.baseColor.clone();
    this.pulseColor = new T.Color();
    this.baseFog = scene.object3D.fog?.color.clone();
    this.environmentVisible = view.environment.visible;
    this.defaultStage = new DefaultStageEffects(view);
    this.el = document.createElement('a-entity');
    scene.appendChild(this.el);
    this.root = this.el.object3D;
    this.scenes = new BackgroundScenes(scene, this.root);
    const positions = new Float32Array(384 * 3);
    // 固定シードでシークのたびに星の配置が変わらないようにする。
    let seed = 21731;
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
    for (let index = 0; index < positions.length; index += 3) {
      const azimuth = random() * Math.PI * 2;
      const height = random() * 1.6 - 0.6;
      const radius = 18 + random() * 25;
      const horizontal = Math.sqrt(1 - height * height);
      positions[index] = Math.cos(azimuth) * horizontal * radius;
      positions[index + 1] = height * radius + 2;
      positions[index + 2] = Math.sin(azimuth) * horizontal * radius;
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    this.stars = new T.Points(geometry, new T.PointsMaterial({ size: 0.045, color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false, blending: T.AdditiveBlending }));
    this.stars.frustumCulled = false;
    this.root.add(this.stars);
    this.setChart(chart);
  }

  setChart(chart) {
    this.chart = chart;
    this.scenes.setChart(chart);
    this.defaultStage.setChart(chart);
    this.events = [];
    this.colors = [];
    for (const event of chart.events ?? []) {
      if (!event.type.startsWith('background')) continue;
      if (event.type === 'backgroundStage') continue;
      const tint = new this.T.Color(event.color);
      if (event.type !== 'backgroundColor') { this.events.push({ ...event, tint }); continue; }
      const previous = this.colors.at(-1);
      const from = previous ? previous.from.clone().lerp(previous.to, progress(event.time, previous.time, previous.duration)) : this.baseColor.clone();
      this.colors.push({ time: event.time, duration: event.duration, from, to: tint });
    }
    const needed = new Set(this.events.filter(event => event.type === 'backgroundGLB' && event.src).map(event => event.src));
    for (const [src, record] of this.cache) {
      if (needed.has(src)) continue;
      this.cache.delete(src);
      this.release(record);
    }
    this.reset();
  }

  async preload(chart = this.chart) {
    const events = (chart.events ?? []).filter(event => event.type === 'backgroundGLB' && event.src);
    try {
      const [records] = await Promise.all([
        Promise.all([...new Set(events.map(event => event.src))].map(src => this.load(src))),
        this.scenes.preload(chart),
      ]);
      for (const event of events) {
        const record = records.find(item => item.src === event.src);
        if (!['auto', 'none'].includes(event.animation) && !record.clips.some(clip => clip.name === event.animation)) throw new Error(`GLBのアニメーションが見つかりません: ${event.animation}`);
      }
    } catch (error) {
      const keep = new Set((this.chart.events ?? []).filter(event => event.type === 'backgroundGLB' && event.src).map(event => event.src));
      for (const [src, record] of this.cache) {
        if (keep.has(src)) continue;
        this.cache.delete(src);
        this.release(record);
      }
      throw error;
    }
  }

  load(src) {
    const cached = this.cache.get(src);
    if (cached) return cached.promise;
    const T = this.T;
    const el = document.createElement('a-entity');
    el.setAttribute('visible', false);
    const record = { src, el, disposed: false, loaded: false, materials: [], textures: new Set(), geometries: new Set() };
    this.cache.set(src, record);
    record.promise = new Promise((resolve, reject) => {
      const fail = error => {
        if (this.cache.get(src) === record) this.cache.delete(src);
        this.release(record);
        el.remove();
        reject(new Error(`背景GLBを読み込めませんでした: ${src}\n${error?.message ?? ''}`));
      };
      el.addEventListener('model-error', event => fail(event.detail), { once: true });
      el.addEventListener('model-loaded', async event => {
        try {
          const model = event.detail.model;
          record.model = model;
          record.loaded = true;
          // 親の位置・回転を含めずに、モデル本来の寸法を測る。
          el.removeObject3D('mesh');
          model.updateMatrixWorld(true);
          const bounds = new T.Box3().setFromObject(model);
          record.center = bounds.isEmpty() ? new T.Vector3() : bounds.getCenter(new T.Vector3());
          const size = bounds.getSize(new T.Vector3());
          record.extent = Math.max(size.x, size.y, size.z) || 1;
          record.fit = new T.Group();
          record.fit.add(model);
          el.setObject3D('mesh', record.fit);
          const replacements = new Map();
          model.traverse(object => {
            if (object.geometry) record.geometries.add(object.geometry);
            if (!object.material) return;
            const convert = source => {
              if (replacements.has(source)) return replacements.get(source);
              for (const value of Object.values(source)) if (value?.isTexture) record.textures.add(value);
              const emissive = Boolean(source.emissiveMap);
              const color = (emissive ? source.emissive : source.color)?.clone() ?? new T.Color('#ffffff');
              if (emissive && color.r + color.g + color.b === 0) color.set('#ffffff');
              const material = new T.MeshBasicMaterial({ color, map: source.emissiveMap ?? source.map ?? null, alphaMap: source.alphaMap ?? null, opacity: source.opacity, alphaTest: source.alphaTest, vertexColors: source.vertexColors, side: T.DoubleSide, transparent: true, depthWrite: false, fog: false, toneMapped: false, forceSinglePass: true });
              replacements.set(source, material);
              record.materials.push({ material, color: color.clone(), opacity: source.opacity });
              source.dispose();
              return material;
            };
            object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
            object.renderOrder = -1000;
          });
          record.clips = model.animations ?? [];
          record.mixer = new T.AnimationMixer(model);
          record.actions = record.clips.map(clip => record.mixer.clipAction(clip));
          if (record.disposed) { this.release(record); reject(new Error('背景の読み込みを中止しました。')); return; }
          // 大きいテクスチャの転送やシェーダー準備を演出の開始フレームに持ち越さない。
          for (const texture of record.textures) this.scene.renderer.initTexture(texture);
          if (this.scene.renderer.compileAsync) await this.scene.renderer.compileAsync(model, this.scene.camera, this.scene.object3D);
          else this.scene.renderer.compile(model, this.scene.camera, this.scene.object3D);
          if (record.disposed) { this.release(record); reject(new Error('背景の読み込みを中止しました。')); return; }
          record.ready = true;
          resolve(record);
        } catch (error) { fail(error); }
      }, { once: true });
      this.el.appendChild(el);
      el.setAttribute('gltf-model', src);
    });
    return record.promise;
  }

  release(record) {
    record.disposed = true;
    if (!record.loaded || record.released) return;
    record.released = true;
    record.mixer?.stopAllAction();
    if (record.model) record.mixer?.uncacheRoot(record.model);
    for (const entry of record.materials) entry.material.dispose();
    for (const texture of record.textures) texture.dispose();
    for (const geometry of record.geometries) geometry.dispose();
    record.el.remove();
  }

  reset() {
    this.scenes.reset();
    this.cursor = 0;
    this.active = [];
    this.lastTime = -Infinity;
    this.stars.visible = false;
    for (const record of this.cache.values()) record.el.object3D.visible = false;
    this.currentModel = null;
    this.currentEvent = null;
    this.scene.object3D.background = this.baseBackground;
    if (this.baseFog && this.scene.object3D.fog) this.scene.object3D.fog.color.copy(this.baseFog);
    this.defaultStage.reset();
  }

  showModel(event, time, pulse, amount) {
    const record = event?.src ? this.cache.get(event.src) : null;
    if (this.currentModel !== record) {
      if (this.currentModel) this.currentModel.el.object3D.visible = false;
      this.currentModel = record;
    }
    if (!record?.ready || record.disposed) { this.currentEvent = null; return; }
    const T = this.T;
    const elapsed = time - event.time;
    const object = record.el.object3D;
    object.visible = true;
    object.position.fromArray(event.position);
    object.rotation.set(T.MathUtils.degToRad(event.rotation[0] + event.rotationSpeed[0] * elapsed), T.MathUtils.degToRad(event.rotation[1] + event.rotationSpeed[1] * elapsed), T.MathUtils.degToRad(event.rotation[2] + event.rotationSpeed[2] * elapsed));
    object.scale.fromArray(event.scale);
    const factor = event.fitSize > 0 ? event.fitSize / record.extent : 1;
    record.fit.scale.setScalar(factor);
    record.fit.position.copy(record.center).multiplyScalar(-factor);
    const opacity = envelope(event, elapsed);
    for (const entry of record.materials) {
      entry.material.opacity = entry.opacity * opacity;
      entry.material.color.copy(entry.color).multiply(event.tint).lerp(pulse, amount * 0.6);
    }
    if (this.currentEvent !== event) {
      record.mixer.stopAllAction();
      const index = event.animation === 'none' ? -1 : event.animation === 'auto' ? 0 : record.clips.findIndex(clip => clip.name === event.animation);
      const action = record.actions[index];
      record.activeAction = action;
      if (action) {
        action.reset().setLoop(event.loop ? T.LoopRepeat : T.LoopOnce, event.loop ? Infinity : 1);
        action.clampWhenFinished = !event.loop;
        action.play();
      }
      this.currentEvent = event;
    }
    // 絶対時刻を使い、一時停止と任意位置へのシークを同じ結果にする。
    if (record.activeAction) { record.activeAction.paused = false; record.activeAction.enabled = true; }
    record.mixer.setTime(elapsed * event.animationSpeed);
    this.view.environment.visible = !event.hideDefault && this.environmentVisible;
  }

  update(time, state) {
    if (state !== 'playing' && state !== 'paused') { if (this.lastTime !== -Infinity) this.reset(); return; }
    if (time < this.lastTime) this.reset();
    this.lastTime = time;
    this.root.position.set(this.view.root.position.x, 0, this.view.root.position.z);
    this.root.rotation.y = this.view.root.rotation.y;
    this.color.copy(this.baseColor);
    let low = 0;
    let high = this.colors.length;
    while (low < high) { const middle = (low + high) >>> 1; if (this.colors[middle].time <= time) low = middle + 1; else high = middle; }
    const transition = this.colors[low - 1];
    if (transition) this.color.copy(transition.from).lerp(transition.to, progress(time, transition.time, transition.duration));
    while (this.cursor < this.events.length && this.events[this.cursor].time <= time) {
      const event = this.events[this.cursor++];
      if (time < event.time + event.duration) this.active.push(event);
    }
    this.stars.visible = false;
    this.pulseColor.setRGB(0, 0, 0);
    let strength = 0;
    let kept = 0;
    let modelEvent = null;
    let sceneEvent = null;
    for (const event of this.active) {
      const elapsed = time - event.time;
      if (elapsed >= event.duration) continue;
      this.active[kept++] = event;
      if (event.type === 'backgroundPulse') {
        const amount = event.intensity * (1 - elapsed / event.duration) ** 2;
        this.pulseColor.r += event.tint.r * amount;
        this.pulseColor.g += event.tint.g * amount;
        this.pulseColor.b += event.tint.b * amount;
        strength += amount;
      } else if (event.type === 'backgroundStars') {
        this.stars.visible = true;
        this.stars.material.color.copy(event.tint);
        this.stars.material.opacity = envelope(event, elapsed);
        this.stars.material.size = event.size;
        const speed = event.rotationSpeed;
        this.stars.rotation.set(this.T.MathUtils.degToRad(speed[0] * elapsed), this.T.MathUtils.degToRad(speed[1] * elapsed), this.T.MathUtils.degToRad(speed[2] * elapsed));
      } else if (event.type === 'backgroundGLB') modelEvent = event;
      else if (event.type === 'backgroundScene') sceneEvent = event;
    }
    this.active.length = kept;
    if (strength > 0) this.pulseColor.multiplyScalar(1 / strength);
    const amount = clamp(strength);
    this.color.lerp(this.pulseColor, amount * 0.35);
    this.scene.object3D.background = this.color;
    this.scene.object3D.fog?.color.copy(this.color);
    this.view.environment.visible = this.environmentVisible;
    // GLBと背景モジュールが重なる場合は、後から始まった背景を表示する。
    if (sceneEvent && modelEvent) {
      if (sceneEvent.time >= modelEvent.time) modelEvent = null;
      else sceneEvent = null;
    }
    this.showModel(modelEvent, time, this.pulseColor, amount);
    if (this.scenes.show(sceneEvent, time, this.pulseColor, amount, state) && sceneEvent.hideDefault) this.view.environment.visible = false;
    // 明示した標準ステージ演出は、対象パーツの自動非表示より優先する。
    this.defaultStage.update(time, this.pulseColor, amount, this.view.environment.visible);
  }

  dispose() {
    this.reset();
    this.defaultStage.dispose();
    this.scenes.dispose();
    for (const record of this.cache.values()) this.release(record);
    this.cache.clear();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.el.remove();
  }
}
