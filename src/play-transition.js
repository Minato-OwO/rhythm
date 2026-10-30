import { DIFFICULTIES } from './difficulties.js';
import { OverlayAnchor } from './overlay-viewport.js';
import { ScreenBlackout } from './screen-blackout.js';

export const PLAY_TRANSITION_TIMING = Object.freeze({ enterMs: 520, minimumHoldMs: 5000, exitMs: 420 });
const FONT = '"Segoe UI", "Yu Gothic UI", sans-serif';
const DISTANCE = 0.85;
const CONTENT_SCALE = 0.84;
const easeOutCubic = value => 1 - (1 - value) ** 3;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// 視点の前に3D面を表示する。VRでは表示位置を固定し、音声再生前に読込を完了する。
export class PlayTransition {
  constructor(scene, { loadingImage, onActive = () => {}, onCovered = () => {}, onReveal = () => {}, canReveal = () => true, now = () => performance.now() } = {}) {
    this.scene = scene;
    this.loadingImage = loadingImage;
    this.now = now;
    this.onActive = onActive;
    this.onCovered = onCovered;
    this.onReveal = onReveal;
    this.canReveal = canReveal;
    this.phase = 'idle';
    this.disposed = false;
    this.slide = -1;
    this.resources = new Set();
    const T = AFRAME.THREE;
    this.T = T;
    this.root = new T.Group();
    this.root.visible = false;
    this.root.position.z = -DISTANCE;

    const backgroundCanvas = document.createElement('canvas');
    backgroundCanvas.width = 32; backgroundCanvas.height = 256;
    const ctx = backgroundCanvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 32, 256);
    gradient.addColorStop(0, '#102136');
    gradient.addColorStop(0.5, '#0b1627');
    gradient.addColorStop(1, '#070f1b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 256);
    this.background = this.mesh(this.resource(new T.PlaneGeometry(1, 1)), this.material({ map: this.texture(backgroundCanvas) }), 20000);
    this.root.add(this.background);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1600; this.canvas.height = 1000;
    this.ctx = this.canvas.getContext('2d');
    this.contentTexture = this.texture(this.canvas);
    this.content = this.mesh(this.resource(new T.PlaneGeometry(1.6, 1)), this.material({ map: this.contentTexture }), 20001);
    this.content.position.z = 0.002;
    this.root.add(this.content);
    const dotGeometry = this.resource(new T.PlaneGeometry(0.016, 0.006));
    this.dots = Array.from({ length: 3 }, (_, index) => {
      const dot = this.mesh(dotGeometry, this.material({ color: '#43ddff' }), 20002);
      dot.position.set((index - 1) * 0.035, -0.35, 0.002);
      this.content.add(dot);
      return dot;
    });
    this.anchor = new OverlayAnchor(scene, this.root);
    this.blackout = new ScreenBlackout(scene);
  }

  get active() { return this.phase !== 'idle'; }
  resource(value) { this.resources.add(value); return value; }

  texture(canvas) {
    const T = this.T;
    const texture = this.resource(new T.CanvasTexture(canvas));
    texture.colorSpace = T.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = texture.magFilter = T.LinearFilter;
    this.scene.renderer?.initTexture?.(texture);
    return texture;
  }

  material(options) {
    return this.resource(new this.T.MeshBasicMaterial({ ...options, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false, side: this.T.DoubleSide, dithering: true }));
  }

  mesh(geometry, material, renderOrder) {
    const mesh = new this.T.Mesh(geometry, material);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    return mesh;
  }

  drawContent({ title, artist, difficulty, level }) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 1600, 1000);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const text = (value, y, size, color = '#edf5ff', weight = 400) => {
      ctx.font = weight + ' ' + size + 'px ' + FONT;
      ctx.fillStyle = color;
      ctx.fillText(value, 800, y);
    };
    text('FOUR FLOW / NOW LOADING', 95, 23, '#8da3bd', 600);
    // 長い曲名も2行以内に収め、難易度やLoadingと重ねない。
    let size = 78, lines;
    do {
      ctx.font = '600 ' + size + 'px ' + FONT;
      lines = [''];
      for (const character of String(title || 'Untitled')) {
        const last = lines.length - 1;
        if (character === '\n' || ctx.measureText(lines[last] + character).width > 1400) lines.push(character === '\n' ? '' : character);
        else lines[last] += character;
      }
      if (lines.length <= 2) break;
      size -= 4;
    } while (size >= 42);
    lines.slice(0, 2).forEach((line, index) => {
      const value = index === 1 && lines.length > 2 ? line.slice(0, -1) + '…' : line;
      text(value, lines.length === 1 ? 300 : 260 + index * 100, size, '#edf5ff', 600);
    });
    ctx.font = '400 30px ' + FONT;
    let artistText = String(artist || '');
    while (artistText.length && ctx.measureText(artistText).width > 1360) artistText = artistText.slice(0, -1);
    text(artistText, 432, 30, '#8da3bd');
    const definition = DIFFICULTIES.find(item => item.code === difficulty);
    ctx.fillStyle = '#132538';
    ctx.fillRect(560, 520, 480, 104);
    ctx.strokeStyle = definition?.color ?? '#43ddff';
    ctx.lineWidth = 2;
    ctx.strokeRect(560, 520, 480, 104);
    text(definition ? definition.code + ' / ' + definition.label : '4 KEY', 571, 44, definition?.color ?? '#43ddff', 600);
    if (Number.isFinite(level)) text('Lv. ' + level, 669, 27, '#a4b9cd');
    if (this.loadingImage) {
      const width = this.loadingImage.width * 30 / 64;
      const height = this.loadingImage.height * 30 / 64;
      ctx.drawImage(this.loadingImage, 800 - width / 2, 790 - height / 2, width, height);
    } else text('Loading', 790, 30, '#cad8e9');
    this.contentTexture.needsUpdate = true;
  }

  begin(info) {
    if (this.disposed) throw new Error('開始画面はすでに終了しています。');
    if (this.active) throw new Error('プレイの準備中です。');
    this.entry = deferred();
    this.hold = deferred();
    this.coveredAt = null;
    this.startedAt = this.now();
    this.phase = 'enter';
    this.slide = -1;
    this.drawContent(info);
    this.content.material.opacity = 0;
    this.background.material.opacity = 1;
    this.anchor.capture();
    this.root.visible = true;
    this.onActive(true);
    this.update(this.startedAt);
    return this.entry.promise;
  }

  async run(info, { unlock = () => {}, prepare, start }) {
    const entered = this.begin(info);
    try {
      // Web Audioの許可取得はクリックから直接行い、重い準備は全面を覆ってから始める。
      const ready = Promise.resolve(unlock()).then(async () => {
        if (!await entered || this.disposed) throw new Error('プレイの開始を中断しました。');
        await prepare();
      });
      await Promise.all([entered, ready]);
      if (!await this.hold.promise || this.disposed || this.phase !== 'loading') throw new Error('プレイの開始を中断しました。');
      await start();
      // 音声が動き始めた後は画面の終了を待たず、フォーカス喪失時のポーズを許可する。
      this.exit();
    } catch (error) {
      this.exit(true);
      throw error;
    }
  }

  exit(failed = false) {
    if (this.disposed || !this.active) return;
    this.entry.resolve(false);
    this.hold.resolve(false);
    if (!failed) {
      this.phase = 'blackout';
      this.blackout.begin(this.now(), {
        onCovered: () => { this.root.visible = false; },
        onReveal: this.onReveal,
      });
      return;
    }
    this.exitFrom = this.slide;
    this.exitTarget = -1;
    this.startedAt = this.now();
    this.exitStarted = this.coveredAt === null || this.canReveal();
    this.phase = 'exit';
  }

  layout() {
    this.anchor.measure(DISTANCE, this);
    const { width, height } = this;
    this.background.scale.set(width, height, 1);
    const contentHeight = CONTENT_SCALE * Math.min(height * 0.78, width * 0.76 / 1.6);
    this.content.scale.set(contentHeight, contentHeight, 1);
    this.root.position.set(this.slide * width, 0, -DISTANCE);
  }

  update(now) {
    if (!this.active || this.disposed) return;
    if (this.phase === 'blackout') {
      this.blackout.update(now, this.canReveal());
      if (!this.blackout.active) {
        this.phase = 'idle';
        this.onActive(false);
      }
      return;
    }
    const timing = PLAY_TRANSITION_TIMING;
    if (this.phase === 'enter') {
      const p = Math.max(0, Math.min(1, (now - this.startedAt) / timing.enterMs));
      this.slide = -1 + easeOutCubic(p);
      if (p === 1) {
        this.phase = 'loading';
        this.coveredAt = now;
        // 全面を覆ってから背後のメニューを隠し、退出時に古い選曲UIを見せない。
        this.onCovered();
        this.entry.resolve(true);
      }
    } else if (this.phase === 'exit') {
      if (!this.exitStarted && (this.coveredAt === null || this.canReveal())) {
        this.exitStarted = true;
        this.startedAt = now;
      }
      const p = this.exitStarted ? Math.max(0, Math.min(1, (now - this.startedAt) / timing.exitMs)) : 0;
      this.slide = this.exitFrom + (this.exitTarget - this.exitFrom) * easeOutCubic(p);
      if (p === 1 && (this.coveredAt === null || this.canReveal())) {
        this.phase = 'idle';
        this.root.visible = false;
        this.onActive(false);
        return;
      }
    }
    if (this.phase === 'loading' && now - this.coveredAt >= timing.minimumHoldMs) this.hold.resolve(true);
    const opacity = this.coveredAt === null ? 0 : easeOutCubic(Math.max(0, Math.min(1, (now - this.coveredAt) / 150)));
    this.content.material.opacity = opacity;
    for (let index = 0; index < this.dots.length; index++) this.dots[index].material.opacity = opacity * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now * 0.006 - index * 1.2)));
    this.layout();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.entry?.resolve(false);
    this.hold?.resolve(false);
    if (this.active) this.onActive(false);
    this.phase = 'idle';
    this.root.visible = false;
    this.blackout.dispose();
    this.anchor.dispose();
    this.root.removeFromParent();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
  }
}
