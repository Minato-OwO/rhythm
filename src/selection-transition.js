import { OverlayAnchor } from './overlay-viewport.js';

export const SELECTION_TRANSITION_TIMING = Object.freeze({ enterMs: 420, loadingMs: 2800, letterMs: 55, completeMs: 700, exitMs: 650 });
const FONT = '"Segoe UI", "Yu Gothic UI", sans-serif';
const COMPLETE_TEXT = 'Completed';
const STATUS_WIDTH = 640;
const STATUS_ROW_HEIGHT = 144;
const STATUS_ROWS = COMPLETE_TEXT.length + 1;
const DISTANCE = 0.85;
const clamp = value => Math.max(0, Math.min(1, value));
const outCubic = value => 1 - (1 - value) ** 3;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// 参考動画の左下の三角形を下から満たす。文字の全状態も事前描画し、演出中のCanvas転送を避ける。
export class SelectionTransition {
  constructor(scene, { loadingImage, onActive = () => {}, onCovered = () => {}, onReveal = () => {}, canReveal = () => true, now = () => performance.now() } = {}) {
    if (!loadingImage) throw new Error('ローディング文字画像を先に読み込んでください。');
    Object.assign(this, { scene, onActive, onCovered, onReveal, canReveal, now, phase: 'idle', disposed: false });
    this.resources = new Set();
    const T = AFRAME.THREE;
    this.root = new T.Group();
    this.root.position.z = -DISTANCE;
    this.root.visible = false;
    const artwork = document.createElement('canvas');
    artwork.width = 1920; artwork.height = 1080;
    const ctx = artwork.getContext('2d');
    const colors = ['#43ddff', '#5c96ff', '#ef8bc6', '#ff9478'];
    ctx.lineWidth = 2;
    for (let index = 0; index < 4; index++) {
      ctx.strokeStyle = colors[index];
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.moveTo(940 + index * 120, -80);
      ctx.lineTo(450 + index * 120, 1160);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors[index];
      ctx.fillRect(1000 + index * 52, 325, 35, 5);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#edf5ff'; ctx.font = '700 138px ' + FONT;
    ctx.fillText('FOUR FLOW', 1230, 475);
    ctx.fillStyle = '#43ddff'; ctx.font = '600 28px ' + FONT;
    ctx.fillText('SONG SELECT', 1230, 610);
    ctx.fillStyle = '#8da3bd'; ctx.font = '400 21px ' + FONT;
    ctx.fillText('FIND YOUR NEXT FLOW', 1230, 665);
    const artworkTexture = this.texture(artwork, T);
    this.statusTexture = this.texture(loadingImage, T, T.Texture);
    this.uniforms = {
      uArtwork: { value: artworkTexture }, uStatus: { value: this.statusTexture },
      uCover: { value: 0 }, uProgress: { value: 0 }, uStatusStep: { value: 0 }, uLoading: { value: 1 },
      uViewportScale: { value: new T.Vector2(1, 1) },
      uArtworkUvScale: { value: new T.Vector2(1, 1) },
      uLabelSize: { value: new T.Vector2(1, 1) },
      uTop: { value: new T.Color('#14283e') }, uBottom: { value: new T.Color('#0a1424') },
      uFill: { value: new T.Color('#e6f5fb') }, uInk: { value: new T.Color('#112337') },
    };
    const material = this.resource(new T.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: T.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D uArtwork, uStatus;
        uniform float uCover, uProgress, uStatusStep, uLoading;
        uniform vec2 uViewportScale, uArtworkUvScale, uLabelSize;
        uniform vec3 uTop, uBottom, uFill, uInk;
        void main() {
          vec2 uv = (vUv - 0.5) * uViewportScale + 0.5;
          float triangle = uv.x / 0.33 + uv.y / 0.72;
          // 三角枠と同じ斜線の式を平行移動し、ワイプの角度も一致させる。
          float boundary = triangle * 0.33 - (1.0 + 0.33 / 0.72 + 0.01) * (1.0 - uCover);
          // ピクセル上の変化量で境界の被覆率を計算する。面内部の輪郭にもAAをかけ、MSAAの有無に依存させない。
          // 微分はdiscard前に評価し、ワイプの端でも隣接フラグメントを参照できるようにする。
          float triangleAA = max(fwidth(triangle) * 0.5, 0.000001);
          float boundaryAA = max(fwidth(boundary) * 0.5, 0.000001);
          float fillAA = max(fwidth(uv.y) * 0.5, 0.000001);
          float coverage = smoothstep(-boundaryAA, boundaryAA, boundary);
          if (uCover <= 0.0 || coverage <= 0.0) discard;
          vec3 color = mix(uBottom, uTop, clamp(uv.y, 0.0, 1.0));
          float triangleCoverage = 1.0 - smoothstep(1.0 - triangleAA, 1.0 + triangleAA, triangle);
          float fillCoverage = 1.0 - smoothstep(0.72 * uProgress - fillAA, 0.72 * uProgress + fillAA, uv.y);
          color = mix(color, mix(uBottom * 0.35, uFill, fillCoverage), triangleCoverage * uLoading);
          // 文字を伸縮せず、右側の同じ中心を基準に画像の縦横比を維持する。
          vec2 artUv = (uv - vec2(0.64, 0.56)) * uArtworkUvScale + vec2(0.64, 0.56);
          if (uLoading > 0.5 && artUv.x >= 0.0 && artUv.x <= 1.0 && artUv.y >= 0.0 && artUv.y <= 1.0) {
            vec4 art = texture2D(uArtwork, artUv);
            float artCoverage = smoothstep(1.015 - triangleAA, 1.015 + triangleAA, triangle);
            color = mix(color, art.rgb, art.a * artCoverage);
          }
          vec2 labelUv = (uv - vec2(0.035, 0.18 - uLabelSize.y * 0.5)) / uLabelSize;
          if (uLoading > 0.5 && labelUv.x >= 0.0 && labelUv.x <= 1.0 && labelUv.y >= 0.0 && labelUv.y <= 1.0) {
            vec2 atlasUv = vec2(labelUv.x, (labelUv.y + ${STATUS_ROWS - 1}.0 - uStatusStep) / ${STATUS_ROWS}.0);
            float alpha = texture2D(uStatus, atlasUv).a;
            color = mix(color, uv.y <= 0.72 * uProgress ? uInk : uFill, alpha);
          }
          // 装飾を合成した後に枠を描き、色付きの線を枠に重ねない。
          float triangleRim = 1.0 - smoothstep(0.006 - triangleAA, 0.006 + triangleAA, abs(triangle - 1.0));
          float wipeRim = 1.0 - smoothstep(0.004 - boundaryAA, 0.004 + boundaryAA, boundary);
          color = mix(color, uFill, max(triangleRim * uLoading, wipeRim));
          gl_FragColor = vec4(color, coverage);
          #include <colorspace_fragment>
        }
      `,
    }));
    this.mesh = new T.Mesh(this.resource(new T.PlaneGeometry(1, 1)), material);
    this.mesh.renderOrder = 21000;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.anchor = new OverlayAnchor(scene, this.root);
  }

  get active() { return this.phase !== 'idle'; }
  resource(value) { this.resources.add(value); return value; }
  texture(source, T, TextureClass = T.CanvasTexture) {
    const texture = this.resource(new TextureClass(source));
    texture.colorSpace = T.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = texture.magFilter = T.LinearFilter;
    texture.needsUpdate = true;
    this.scene.renderer?.initTexture?.(texture);
    return texture;
  }

  async run(changeScreen, { loading = true } = {}) {
    if (this.disposed) throw new Error('選曲トランジションは終了しています。');
    if (this.active) throw new Error('選曲画面を準備しています。');
    this.entry = deferred(); this.finished = deferred();
    this.phase = 'enter'; this.startedAt = this.now(); this.ready = false;
    this.showLoading = loading;
    this.uniforms.uLoading.value = loading ? 1 : 0;
    this.uniforms.uProgress.value = this.uniforms.uStatusStep.value = 0;
    this.anchor.capture();
    this.root.visible = true;
    this.onActive(true);
    this.update(this.startedAt);
    try {
      if (!await this.entry.promise || this.disposed) throw new Error('選曲画面への移動を中断しました。');
      await changeScreen();
      this.ready = true;
      if (!await this.finished.promise || this.disposed) throw new Error('選曲画面への移動を中断しました。');
    } catch (error) {
      this.cancel();
      throw error;
    }
  }

  update(now) {
    if (!this.active || this.disposed) return;
    const timing = SELECTION_TRANSITION_TIMING;
    if (this.phase === 'enter') {
      const progress = clamp((now - this.startedAt) / timing.enterMs);
      this.uniforms.uCover.value = outCubic(progress);
      if (progress === 1) {
        this.phase = this.showLoading ? 'loading' : 'covered'; this.startedAt = now;
        this.onCovered();
        this.entry.resolve(true);
      }
    } else if (this.phase === 'covered') {
      if (this.ready && this.canReveal()) this.reveal(now);
    } else if (this.phase === 'loading') {
      const progress = clamp((now - this.startedAt) / timing.loadingMs);
      this.uniforms.uProgress.value = Math.min(0.98, progress);
      if (progress === 1 && this.ready && this.canReveal()) {
        this.uniforms.uProgress.value = 1;
        this.phase = 'complete'; this.startedAt = now;
      }
    } else if (this.phase === 'complete') {
      const elapsed = now - this.startedAt;
      this.uniforms.uStatusStep.value = Math.min(COMPLETE_TEXT.length, Math.floor(elapsed / timing.letterMs));
      if (elapsed >= COMPLETE_TEXT.length * timing.letterMs + timing.completeMs && this.canReveal()) {
        this.reveal(now);
      }
    } else if (this.phase === 'exit') {
      const progress = clamp((now - this.startedAt) / timing.exitMs);
      this.uniforms.uCover.value = 1 - outCubic(progress);
      if (progress === 1) {
        this.phase = 'idle'; this.root.visible = false;
        this.onActive(false);
        this.finished.resolve(true);
      }
    }
    this.anchor.measure(DISTANCE, this);
    this.mesh.scale.set(this.width, this.height, 1);
    this.uniforms.uViewportScale.value.set(this.width / this.viewWidth, this.height / this.viewHeight);
    const aspect = this.viewWidth / this.viewHeight;
    const artworkAspect = 1920 / 1080;
    this.uniforms.uArtworkUvScale.value.set(Math.max(1, aspect / artworkAspect), Math.max(1, artworkAspect / aspect));
    // 画像のピクセル比と実際に貼る領域の比を一致させる。狭い画面でも三角形の内側へ収める。
    const labelHeight = Math.min(0.065, 0.19 * aspect / (STATUS_WIDTH / STATUS_ROW_HEIGHT));
    this.uniforms.uLabelSize.value.set(labelHeight * STATUS_WIDTH / STATUS_ROW_HEIGHT / aspect, labelHeight);
  }

  reveal(now) {
    this.phase = 'exit'; this.startedAt = now;
    // 不透明な面で覆っているうちに次のUIを戻し、斜めのワイプで少しずつ見せる。
    this.onReveal();
  }

  cancel() {
    this.entry?.resolve(false); this.finished?.resolve(false);
    const wasActive = this.active;
    this.phase = 'idle'; this.root.visible = false;
    if (wasActive) this.onActive(false);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.anchor.dispose();
    this.root.removeFromParent();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
  }
}
