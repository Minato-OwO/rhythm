import test from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundScenes } from '../src/background-scene.js';

class Group {
  isObject3D = true;
  visible = true;
  renderOrder = 0;
  children = [];
  position = { fromArray() {} };
  rotation = { set() {} };
  scale = { fromArray() {} };
  add(child) { this.children.push(child); child.parent = this; }
  traverse(visit) { visit(this); for (const child of this.children) child.traverse(visit); }
  removeFromParent() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }
  clear() { this.children = []; }
}

let fixtureId = 0;
async function fixture(preserveMaterialState = true) {
  globalThis.AFRAME = { THREE: { Group } };
  const solid = { opacity: 1, transparent: false, depthWrite: true, fog: true };
  const ice = { opacity: 0.48, transparent: true, depthWrite: false, fog: true };
  const dial = { opacity: 1, transparent: false, depthWrite: true, forceSinglePass: true, alphaToCoverage: true };
  const group = new Group();
  for (const [material, order] of [[solid, 1], [ice, 2], [dial, 0]]) {
    const mesh = new Group();
    mesh.material = material; mesh.renderOrder = order; group.add(mesh);
  }
  let disposed = 0, updates = 0;
  const instance = {
    object3D: group, preserveMaterialState,
    update() { updates++; ice.opacity = 0.48; },
    dispose() { disposed++; },
  };
  const key = '__backgroundSceneTest' + ++fixtureId;
  globalThis[key] = instance;
  const source = 'data:text/javascript,' + encodeURIComponent('export function createBackground() { return globalThis[' + JSON.stringify(key) + ']; }');
  const compilations = [];
  const scene = { camera: {}, object3D: new Group(), renderer: {
    initTexture() {},
    async compileAsync() {
      compilations.push([solid, ice, dial].map(material => ({ transparent: material.transparent, depthWrite: material.depthWrite })));
    },
  } };
  const backgrounds = new BackgroundScenes(scene, scene.object3D);
  const chart = { events: [{ type: 'backgroundScene', src: source }] };
  backgrounds.setChart(chart);
  await backgrounds.preload();
  delete globalThis[key];
  const event = {
    src: source, time: 10, duration: 10, intensity: 1, fadeIn: 2, fadeOut: 2,
    position: [0, 0, 0], rotation: [0, 0, 0], rotationSpeed: [0, 0, 0], scale: [1, 1, 1], animationSpeed: 1,
  };
  return {
    backgrounds, solid, ice, dial, group, compilations,
    record: backgrounds.cache.get(source),
    show: time => backgrounds.show(event, time, {}, 0, 'playing'),
    updates: () => updates, disposed: () => disposed,
  };
}

test('不透明・半透明の設定を維持し、通常とフェードの両方を事前準備する', async () => {
  const f = await fixture();
  assert.deepEqual(f.compilations, [
    [{ transparent: true, depthWrite: true }, { transparent: true, depthWrite: false }, { transparent: true, depthWrite: true }],
    [{ transparent: false, depthWrite: true }, { transparent: true, depthWrite: false }, { transparent: false, depthWrite: true }],
  ]);
  assert.deepEqual(f.group.children.map(mesh => mesh.renderOrder), [-999, -998, -1000]);
  f.show(14);
  assert.equal(f.solid.transparent, false);
  assert.equal(f.solid.depthWrite, true);
  assert.equal(f.ice.opacity, 0.48);
  assert.equal(f.dial.forceSinglePass, true);
  assert.equal(f.dial.transparent, false);
  assert.equal(f.dial.alphaToCoverage, true);
  f.backgrounds.dispose();
  assert.equal(f.disposed(), 1);
});

test('フェード・シーク・再表示で透明度が累積せず、不透明描画に戻る', async () => {
  const f = await fixture();
  f.show(11);
  assert.equal(f.solid.opacity, 0.5);
  assert.equal(f.ice.opacity, 0.24);
  assert.equal(f.solid.transparent, true);
  assert.equal(f.dial.depthWrite, true);
  assert.equal(f.dial.alphaToCoverage, false);
  f.show(11);
  assert.equal(f.ice.opacity, 0.24);
  assert.equal(f.updates(), 1);
  f.show(14);
  assert.equal(f.solid.opacity, 1);
  assert.equal(f.solid.transparent, false);
  assert.equal(f.dial.depthWrite, true);
  assert.equal(f.dial.transparent, false);
  assert.equal(f.dial.alphaToCoverage, true);
  f.show(19);
  assert.equal(f.ice.opacity, 0.24);
  f.backgrounds.reset();
  assert.equal(f.record.object.visible, false);
  f.show(14);
  assert.equal(f.record.object.visible, true);
  assert.equal(f.solid.transparent, false);
  assert.equal(f.ice.opacity, 0.48);
  f.show(10);
  assert.equal(f.record.object.visible, false);
  f.backgrounds.dispose();
});

test('未対応の既存背景は従来の半透明描画を使う', async () => {
  const f = await fixture(false);
  assert.equal(f.compilations.length, 1);
  assert.deepEqual(f.group.children.map(mesh => mesh.renderOrder), [-1000, -1000, -1000]);
  f.show(14);
  assert.equal(f.solid.transparent, true);
  assert.equal(f.solid.depthWrite, false);
  f.backgrounds.setChart({ events: [] });
  assert.equal(f.disposed(), 1);
  f.backgrounds.dispose();
  assert.equal(f.disposed(), 1);
});

