import { CONFIG } from './config.js';

export const NOTE_SKIN_SLOTS = ['head', 'body'];
const IMAGE_TYPE = /^image\/(png|jpeg|webp|gif|avif)$/i;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function decodeSkinImage(dataUrl, environment = window) {
  return new Promise((resolve, reject) => {
    const image = new environment.Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) resolve(image);
      else reject(new Error('画像のサイズを読み取れませんでした。'));
    };
    image.onerror = () => reject(new Error('画像を読み込めませんでした。PNG・WebPなどの画像を選んでください。'));
    image.src = dataUrl;
  });
}

export async function readSkinFile(file, environment = window, maxTextureSize = 2048) {
  if (!IMAGE_TYPE.test(file.type)) throw new Error('PNG・WebP・JPEG・GIF・AVIFの画像を選んでください。');
  if (file.size > MAX_FILE_BYTES) throw new Error('スキン画像は20MB以下にしてください。');
  let dataUrl = await new Promise((resolve, reject) => {
    const reader = new environment.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('画像ファイルを読み取れませんでした。'));
    reader.readAsDataURL(file);
  });
  const image = await decodeSkinImage(dataUrl, environment);
  const limit = Math.max(1, Math.min(2048, maxTextureSize));
  const ratio = Math.min(1, limit / image.naturalWidth, limit / image.naturalHeight);
  if (ratio < 1) {
    const canvas = environment.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    dataUrl = canvas.toDataURL('image/png'); // アルファを保ったままGPUの上限に収める。
  }
  return { name: file.name, dataUrl };
}

// エディタの画像選択ボタンの呼び出し内で直接開く。
export function pickSkinFile(environment = window) {
  return new Promise((resolve, reject) => {
    const input = environment.document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/webp,image/jpeg,image/gif,image/avif';
    input.hidden = true;
    let finished = false, timer;
    const finish = (file, error = null) => {
      if (finished) return;
      finished = true;
      environment.clearTimeout(timer);
      environment.removeEventListener('focus', focus);
      input.remove();
      if (error) reject(error); else resolve(file);
    };
    const focus = () => { timer = environment.setTimeout(() => { if (!input.files?.length) finish(null); }, 500); };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    environment.addEventListener('focus', focus);
    environment.document.body.append(input);
    try {
      if (typeof input.showPicker === 'function') input.showPicker();
      else input.click();
    } catch { finish(null, new Error('画像選択を開けませんでした。')); }
  });
}

export class NoteSkins {
  constructor(view, loadImage = decodeSkinImage) {
    this.view = view;
    this.T = view.THREE;
    this.loadImage = loadImage;
    this.images = { head: null, body: null };
    this.textures = { head: null, body: null };
    this.cache = new Map();
    this.tints = { head: false, body: false };
    const T = this.T;
    this.headGeometry = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.024, 0);
    this.bodyGeometry = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.5, 0);
    const materials = opacity => CONFIG.colors.map(() => new T.MeshBasicMaterial({
      color: '#ffffff', transparent: true, opacity, alphaTest: 1 / 255,
      depthWrite: false, side: T.DoubleSide, toneMapped: false, fog: false,
    }));
    this.headMaterials = materials(1);
    this.bodyMaterials = materials(0.92);
    this.activeBodyMaterials = materials(1);
    this.width = CONFIG.laneWidth - 0.025;
    this.depth = this.width;
    this.refreshColors();
  }

  prepare(src) {
    if (!src) return Promise.resolve(null);
    if (this.cache.has(src)) return this.cache.get(src).promise;
    const record = { disposed: false };
    record.promise = (async () => {
      const image = await this.loadImage(src);
      if (record.disposed || this.disposed) throw new Error('ノーツスキンの読み込みを中止しました。');
      const texture = new this.T.Texture(image);
      texture.colorSpace = this.T.SRGBColorSpace;
      texture.minFilter = this.T.LinearMipmapLinearFilter;
      texture.magFilter = this.T.LinearFilter;
      const capabilities = this.view.scene?.renderer?.capabilities;
      texture.anisotropy = Math.max(1, Math.min(8, capabilities?.getMaxAnisotropy?.() ?? 1));
      texture.needsUpdate = true;
      this.view.scene?.renderer?.initTexture?.(texture);
      Object.assign(record, { image, texture });
      return record;
    })().catch(error => { if (this.cache.get(src) === record) this.cache.delete(src); throw error; });
    this.cache.set(src, record);
    return record.promise;
  }

  applySource(slot, src, tint = false) {
    if (!NOTE_SKIN_SLOTS.includes(slot)) throw new Error('スキンの対象が不正です。');
    const resource = src ? this.cache.get(src) : null;
    if (src && !resource?.texture) throw new Error('ノーツスキンの準備が完了していません: ' + src);
    this.tints[slot] = tint;
    this.bind(slot, resource?.image ?? null, resource?.texture ?? null);
  }

  retain(sources) {
    for (const [src, resource] of this.cache) {
      if (sources.has(src)) continue;
      resource.disposed = true;
      resource.texture?.dispose();
      this.cache.delete(src);
    }
  }

  bind(slot, image, texture) {
    this.textures[slot] = texture;
    this.images[slot] = image;
    if (slot === 'head' && image) {
      const ratio = image.naturalWidth / image.naturalHeight;
      this.width = Math.min(CONFIG.laneWidth - 0.025, 0.32 * ratio);
      this.depth = this.width / ratio;
    }
    const materials = slot === 'head' ? this.headMaterials : [...this.bodyMaterials, ...this.activeBodyMaterials];
    for (const material of materials) {
      if (Boolean(material.map) !== Boolean(texture)) material.needsUpdate = true;
      material.map = texture;
    }
    this.refresh();
  }

  setLaneColor(lane, color) {
    for (const [slot, materials] of [['head', this.headMaterials], ['body', this.bodyMaterials], ['body', this.activeBodyMaterials]]) {
      if (this.tints[slot]) materials[lane].color.copy(color);
      else materials[lane].color.set('#ffffff');
    }
  }
  refreshColors() { for (let lane = 0; lane < 4; lane++) this.setLaneColor(lane, this.view.materials[lane].color); }
  refresh() {
    this.refreshColors();
    for (const group of this.view.noteMeshes.values()) this.applyTo(group, group.userData.lane);
    for (const group of this.view.pool) this.applyTo(group, group.userData.lane);
  }
  applyTo(group, lane) {
    group.userData.lane = lane;
    const customHead = Boolean(this.textures.head);
    const headGeometry = customHead ? this.headGeometry : this.view.noteGeometry;
    const headMaterial = customHead ? this.headMaterials[lane] : this.view.materials[lane];
    group.head.geometry = group.tail.geometry = headGeometry;
    group.head.material = group.tail.material = headMaterial;
    group.head.scale.set(customHead ? this.width : 1, 1, customHead ? this.depth : 1);
    group.tail.scale.set(customHead ? this.width : 1, 0.75, customHead ? this.depth : 1);
    group.head.renderOrder = group.tail.renderOrder = customHead ? 4 : 0;
    group.body.geometry = this.textures.body ? this.bodyGeometry : this.view.holdGeometry;
    group.body.material = this.holdMaterial(lane, Boolean(group.userData.holdActive));
    group.body.renderOrder = this.textures.body ? 3 : 0;
  }
  holdMaterial(lane, active) {
    const materials = this.textures.body
      ? active ? this.activeBodyMaterials : this.bodyMaterials
      : active ? this.view.activeHoldMaterials : this.view.holdMaterials;
    return materials[lane];
  }
  dispose() {
    this.disposed = true;
    const textures = new Set(Object.values(this.textures));
    for (const resource of this.cache.values()) { resource.disposed = true; textures.add(resource.texture); }
    for (const texture of textures) texture?.dispose();
    this.cache.clear();
    for (const material of [...this.headMaterials, ...this.bodyMaterials, ...this.activeBodyMaterials]) material.dispose();
    this.headGeometry.dispose(); this.bodyGeometry.dispose();
  }
}
