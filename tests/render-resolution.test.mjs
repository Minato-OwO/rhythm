import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderResolution } from '../src/render-resolution.js';

function fixture({ width = 1920, height = 1080, density = 1, initialDensity = 0.5 } = {}) {
  const environment = Object.assign(new EventTarget(), {
    devicePixelRatio: density, document: new EventTarget(),
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
  });
  const scene = Object.assign(new EventTarget(), {
    canvas: Object.assign(new EventTarget(), { width: width * initialDensity, height: height * initialDensity }),
    camera: {}, width, height, resizeCount: 0,
    resize() {
      this.resizeCount++;
      this.camera.aspect = this.width / this.height;
      this.canvas.width = Math.floor(this.width * this.renderer.ratio);
      this.canvas.height = Math.floor(this.height * this.renderer.ratio);
    },
  });
  scene.renderer = {
    ratio: initialDensity, ratioChanges: 0, xr: { isPresenting: false },
    getPixelRatio() { return this.ratio; },
    setPixelRatio(value) { this.ratio = value; this.ratioChanges++; },
  };
  const resolution = new RenderResolution(scene, environment);
  return { scene, environment, resolution, size: () => [scene.canvas.width, scene.canvas.height] };
}

test('フルHD・4Kの描画領域を実ピクセル数で描画する', () => {
  for (const [width, height] of [[1920, 1080], [3840, 2160]]) {
    const f = fixture({ width, height });
    assert.deepEqual(f.size(), [width, height]);
    assert.equal(f.scene.camera.aspect, 16 / 9);
    f.resolution.dispose();
  }
});

test('Windows等の125%表示でもフルHD相当を維持し、モニターの密度変更にも追従する', () => {
  const f = fixture({ width: 1536, height: 864, density: 1.25 });
  assert.deepEqual(f.size(), [1920, 1080]);
  f.environment.devicePixelRatio = 2;
  f.resolution.update();
  assert.deepEqual(f.size(), [3072, 1728]);
  f.resolution.dispose();
});

test('外部の処理で描画バッファが低解像度になっても元に戻す', () => {
  const f = fixture();
  f.scene.canvas.width = 960; f.scene.canvas.height = 540;
  f.resolution.update();
  assert.deepEqual(f.size(), [1920, 1080]);
  f.scene.renderer.ratio = 0.75;
  f.resolution.update();
  assert.equal(f.scene.renderer.ratio, 1);
  assert.deepEqual(f.size(), [1920, 1080]);
  f.resolution.dispose();
});

test('通常フレームではサイズ更新を繰り返さない', () => {
  const f = fixture(), changes = f.scene.renderer.ratioChanges, resizes = f.scene.resizeCount;
  for (let frame = 0; frame < 1000; frame++) assert.equal(f.resolution.update(), false);
  assert.equal(f.scene.resizeCount, resizes);
  assert.equal(f.scene.renderer.ratioChanges, changes);
  f.resolution.dispose();
  f.environment.dispatchEvent(new Event('focus'));
  assert.equal(f.resolution.dirty, false);
  assert.equal(f.resolution.observer.disconnected, true);
});

test('VRの描画サイズには干渉せず、終了時に通常画面の解像度へ戻す', () => {
  const f = fixture();
  f.scene.renderer.xr.isPresenting = true;
  f.scene.canvas.width = 3200; f.scene.canvas.height = 1600;
  f.environment.devicePixelRatio = 2;
  const changes = f.scene.renderer.ratioChanges, resizes = f.scene.resizeCount;
  assert.equal(f.resolution.update(), false);
  assert.deepEqual(f.size(), [3200, 1600]);
  assert.equal(f.scene.resizeCount, resizes);
  assert.equal(f.scene.renderer.ratioChanges, changes);
  f.scene.renderer.xr.isPresenting = false;
  f.scene.dispatchEvent(new Event('exit-vr'));
  f.resolution.update();
  assert.deepEqual(f.size(), [3840, 2160]);
  f.resolution.dispose();
});

test('埋め込みプレビューの大きさ変更やフォーカス復帰を反映する', () => {
  const f = fixture();
  f.scene.width = 1280; f.scene.height = 720;
  f.resolution.observer.callback();
  f.resolution.update();
  assert.deepEqual(f.size(), [1280, 720]);
  f.scene.width = 1920; f.scene.height = 1080;
  f.environment.dispatchEvent(new Event('focus'));
  f.resolution.update();
  assert.deepEqual(f.size(), [1920, 1080]);
  f.resolution.dispose();
});
