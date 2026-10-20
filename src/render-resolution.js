// 画面の実ピクセル密度に合わせる。VRの描画サイズはWebXRに任せる。
export class RenderResolution {
  constructor(scene, environment = window) {
    this.scene = scene;
    this.environment = environment;
    this.dirty = true;
    this.invalidate = () => { this.dirty = true; };
    for (const event of ['resize', 'focus', 'pageshow']) environment.addEventListener(event, this.invalidate);
    for (const event of ['fullscreenchange', 'visibilitychange']) environment.document.addEventListener(event, this.invalidate);
    scene.addEventListener('exit-vr', this.invalidate);
    scene.canvas.addEventListener('webglcontextrestored', this.invalidate);
    if (environment.ResizeObserver) {
      this.observer = new environment.ResizeObserver(this.invalidate);
      this.observer.observe(scene);
    }
    this.update();
  }

  update() {
    const { scene, environment } = this;
    const renderer = scene.renderer;
    if (!renderer || !scene.camera) return false;
    if (renderer.xr?.isPresenting) {
      this.dirty = true;
      return false;
    }
    const ratio = Number.isFinite(environment.devicePixelRatio) && environment.devicePixelRatio > 0 ? environment.devicePixelRatio : 1;
    const ratioChanged = renderer.getPixelRatio() !== ratio;
    // 通常フレームではサイズを測り直したり、描画バッファを再確保したりしない。
    if (!this.dirty && !ratioChanged && scene.canvas.width === this.pixelWidth && scene.canvas.height === this.pixelHeight) return false;
    this.dirty = false;
    if (ratioChanged) renderer.setPixelRatio(ratio);
    scene.resize();
    this.pixelWidth = scene.canvas.width;
    this.pixelHeight = scene.canvas.height;
    return true;
  }

  dispose() {
    for (const event of ['resize', 'focus', 'pageshow']) this.environment.removeEventListener(event, this.invalidate);
    for (const event of ['fullscreenchange', 'visibilitychange']) this.environment.document.removeEventListener(event, this.invalidate);
    this.scene.removeEventListener('exit-vr', this.invalidate);
    this.scene.canvas.removeEventListener('webglcontextrestored', this.invalidate);
    this.observer?.disconnect();
  }
}
