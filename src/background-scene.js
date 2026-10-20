// 曲フォルダの背景モジュールを、ゲームと同じThree.jsシーンに組み込む。
export class BackgroundScenes {
  constructor(scene, parent) {
    this.scene = scene;
    this.parent = parent;
    this.T = AFRAME.THREE;
    this.cache = new Map();
    this.current = null;
  }

  setChart(chart) {
    this.chart = chart;
    const needed = new Set((chart.events ?? []).filter(event => event.type === 'backgroundScene' && event.src).map(event => event.src));
    for (const [src, record] of this.cache) {
      if (needed.has(src)) continue;
      this.cache.delete(src);
      this.release(record);
    }
    this.reset();
  }

  async preload(chart = this.chart) {
    const sources = new Set((chart.events ?? []).filter(event => event.type === 'backgroundScene' && event.src).map(event => event.src));
    try { await Promise.all([...sources].map(src => this.load(src))); }
    catch (error) { this.setChart(this.chart); throw error; }
  }

  load(src) {
    if (this.cache.has(src)) return this.cache.get(src).promise;
    const object = new this.T.Group();
    object.visible = false;
    this.parent.add(object);
    const record = { src, object, materials: [], context: {}, disposed: false, released: false };
    this.cache.set(src, record);
    record.promise = (async () => {
      const module = await import(/* @vite-ignore */ src);
      if (record.disposed) throw new Error('背景の読み込みを中止しました。');
      if (typeof module.createBackground !== 'function') throw new Error('createBackground関数がありません。');
      record.instance = await module.createBackground({ THREE: this.T, scene: this.scene, renderer: this.scene.renderer });
      if (record.disposed) throw new Error('背景の読み込みを中止しました。');
      if (!record.instance?.object3D?.isObject3D) throw new Error('背景のobject3Dがありません。');
      object.add(record.instance.object3D);
      // 対応モジュールでは元の不透明・深度設定を保ち、フェード中だけ切り替える。
      record.preserveMaterialState = record.instance.preserveMaterialState === true;
      const materials = new Set();
      const textures = new Set();
      object.traverse(item => {
        if (!item.material) return;
        item.renderOrder = -1000 + (record.preserveMaterialState ? item.renderOrder : 0);
        for (const material of Array.isArray(item.material) ? item.material : [item.material]) materials.add(material);
      });
      for (const material of materials) {
        record.materials.push({
          material, opacity: material.opacity, color: material.color?.clone(),
          transparent: material.transparent, depthWrite: material.depthWrite, alphaToCoverage: material.alphaToCoverage,
        });
        if (!record.preserveMaterialState) {
          material.transparent = true;
          material.depthWrite = false;
        }
        material.fog = false;
        for (const value of Object.values(material)) if (value?.isTexture && !value.isRenderTargetTexture) textures.add(value);
      }
      for (const texture of textures) this.scene.renderer.initTexture(texture);
      const compile = () => this.scene.renderer.compileAsync
        ? this.scene.renderer.compileAsync(record.instance.object3D, this.scene.camera, this.scene.object3D)
        : this.scene.renderer.compile(record.instance.object3D, this.scene.camera, this.scene.object3D);
      if (record.preserveMaterialState) {
        // 通常描画とフェード描画を事前準備し、演出中の初回コンパイルを避ける。
        this.setMaterialFade(record, true);
        await compile();
        this.setMaterialFade(record, false);
      }
      await compile();
      if (record.disposed) throw new Error('背景の読み込みを中止しました。');
      record.ready = true;
      return record;
    })().catch(error => {
      if (this.cache.get(src) === record) this.cache.delete(src);
      this.release(record);
      throw new Error('背景シーンを読み込めませんでした: ' + src + '\n' + (error?.message ?? error));
    });
    return record.promise;
  }

  setMaterialFade(record, faded) {
    if (!record.preserveMaterialState || record.faded === faded) return;
    record.faded = faded;
    for (const entry of record.materials) {
      const material = entry.material;
      const transparent = entry.transparent || faded;
      // カバレッジのアルファテストでフェード量が二値化されないようにする。
      const alphaToCoverage = Boolean(entry.alphaToCoverage) && !faded;
      if (material.transparent !== transparent || material.alphaToCoverage !== alphaToCoverage) {
        material.transparent = transparent;
        material.alphaToCoverage = alphaToCoverage;
        material.needsUpdate = true;
      }
      // フェード中も元の遮蔽を維持し、背面や床が手前の結晶に重なるのを防ぐ。
      material.depthWrite = entry.depthWrite;
    }
  }

  show(event, time, pulse, pulseAmount, state) {
    const record = event?.src ? this.cache.get(event.src) : null;
    if (this.current !== record) {
      if (this.current) this.current.object.visible = false;
      this.current = record;
    }
    if (!record?.ready || record.disposed) return false;
    const elapsed = time - event.time;
    const animationTime = elapsed * event.animationSpeed;
    const object = record.object;
    object.visible = true;
    object.position.fromArray(event.position);
    const rotation = event.rotation;
    const speed = event.rotationSpeed;
    const radians = Math.PI / 180;
    object.rotation.set((rotation[0] + speed[0] * elapsed) * radians, (rotation[1] + speed[1] * elapsed) * radians, (rotation[2] + speed[2] * elapsed) * radians);
    object.scale.fromArray(event.scale);
    if (record.lastTime !== animationTime || record.lastEvent !== event) {
      // 前フレームのフェードを戻してから、モジュール固有のアニメーションを更新する。
      for (const entry of record.materials) {
        entry.material.opacity = entry.opacity;
        if (entry.color) entry.material.color.copy(entry.color);
      }
      record.context.state = state;
      record.context.elapsed = elapsed;
      record.context.duration = event.duration;
      record.instance.update?.(animationTime, record.context);
      for (const entry of record.materials) {
        entry.opacity = entry.material.opacity;
        if (entry.color) entry.color.copy(entry.material.color);
      }
      record.lastTime = animationTime;
      record.lastEvent = event;
    }
    const attack = event.fadeIn ? Math.min(1, elapsed / event.fadeIn) : 1;
    const release = event.fadeOut ? Math.min(1, (event.duration - elapsed) / event.fadeOut) : 1;
    const opacity = Math.max(0, Math.min(attack, release)) * event.intensity;
    this.setMaterialFade(record, opacity < 1);
    object.visible = opacity > 0;
    for (const entry of record.materials) {
      entry.material.opacity = entry.opacity * opacity;
      if (entry.color) entry.material.color.copy(entry.color).multiply(event.tint).lerp(pulse, pulseAmount * 0.6);
    }
    return true;
  }

  reset() {
    for (const record of this.cache.values()) record.object.visible = false;
    this.current = null;
  }

  release(record) {
    record.disposed = true;
    record.object.visible = false;
    record.object.removeFromParent();
    if (!record.instance || record.released) return;
    record.released = true;
    try { record.instance.dispose?.(); }
    finally { record.object.clear(); }
  }

  dispose() {
    for (const record of this.cache.values()) this.release(record);
    this.cache.clear();
    this.current = null;
  }
}
