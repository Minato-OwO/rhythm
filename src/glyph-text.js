// 数字・英字は最初に1枚だけ描画し、以降は小さい頂点/UVバッファだけを更新する。
export class GlyphAtlas {
  constructor(T) {
    this.T = T;
    this.cellSize = 64;
    this.fontSize = 52;
    this.columns = 8;
    this.characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ%./:+- ?';
    this.indices = new Map();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = this.cellSize * this.columns;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${this.fontSize}px Consolas, "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let index = 0; index < this.characters.length; index++) {
      this.indices.set(this.characters[index], index);
      ctx.fillText(this.characters[index], (index % this.columns + 0.5) * this.cellSize, (Math.floor(index / this.columns) + 0.5) * this.cellSize);
    }
    this.texture = new T.CanvasTexture(canvas);
    this.texture.colorSpace = T.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = this.texture.magFilter = T.LinearFilter;
  }

  createText(options) { return new GlyphText(this, options); }
  dispose() { this.texture.dispose(); }
}

class GlyphText {
  constructor(atlas, { height, color = '#edf5ff', align = 'left', capacity = 24, horizontalScale = 1 }) {
    const T = atlas.T;
    this.atlas = atlas;
    this.capacity = capacity;
    this.align = align;
    this.value = null;
    this.height = height * atlas.cellSize / atlas.fontSize;
    this.width = this.height * horizontalScale;
    this.advance = height * 0.6 * horizontalScale;
    const geometry = new T.BufferGeometry();
    this.positions = new T.BufferAttribute(new Float32Array(capacity * 12), 3).setUsage(T.DynamicDrawUsage);
    this.uvs = new T.BufferAttribute(new Float32Array(capacity * 8), 2).setUsage(T.DynamicDrawUsage);
    const indices = new Uint16Array(capacity * 6);
    for (let index = 0; index < capacity; index++) {
      const base = index * 4;
      const start = index * 6;
      indices[start] = base; indices[start + 1] = base + 1; indices[start + 2] = base + 2;
      indices[start + 3] = base; indices[start + 4] = base + 2; indices[start + 5] = base + 3;
    }
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('uv', this.uvs);
    geometry.setIndex(new T.BufferAttribute(indices, 1));
    geometry.setDrawRange(0, 0);
    geometry.boundingSphere = new T.Sphere(new T.Vector3(), capacity * this.advance + this.height);
    this.mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({ map: atlas.texture, color, transparent: true, depthWrite: false, toneMapped: false, side: T.DoubleSide }));
    this.mesh.renderOrder = 2;
  }

  setText(value) {
    const text = String(value).toUpperCase().slice(0, this.capacity);
    if (text === this.value) return;
    this.value = text;
    const offset = this.align === 'center' ? -text.length * this.advance / 2 : this.align === 'right' ? -text.length * this.advance : 0;
    const p = this.positions.array;
    const uv = this.uvs.array;
    for (let index = 0; index < text.length; index++) {
      const glyph = this.atlas.indices.get(text[index]) ?? this.atlas.indices.get('?');
      const x = offset + (index + 0.5) * this.advance;
      const left = x - this.width / 2;
      const right = x + this.width / 2;
      const bottom = -this.height / 2;
      const top = this.height / 2;
      const start = index * 12;
      p[start] = left; p[start + 1] = bottom; p[start + 2] = 0;
      p[start + 3] = right; p[start + 4] = bottom; p[start + 5] = 0;
      p[start + 6] = right; p[start + 7] = top; p[start + 8] = 0;
      p[start + 9] = left; p[start + 10] = top; p[start + 11] = 0;
      const u0 = (glyph % this.atlas.columns) / this.atlas.columns;
      const u1 = u0 + 1 / this.atlas.columns;
      const v1 = 1 - Math.floor(glyph / this.atlas.columns) / this.atlas.columns;
      const v0 = v1 - 1 / this.atlas.columns;
      const t = index * 8;
      uv[t] = u0; uv[t + 1] = v0; uv[t + 2] = u1; uv[t + 3] = v0;
      uv[t + 4] = u1; uv[t + 5] = v1; uv[t + 6] = u0; uv[t + 7] = v1;
    }
    this.positions.needsUpdate = true;
    this.uvs.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, text.length * 6);
  }

  setColor(color) { this.mesh.material.color.set(color); }
  setOpacity(opacity) { this.mesh.material.opacity = opacity; }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
