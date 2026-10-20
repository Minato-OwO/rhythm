const MAX_ENTRY = 256 * 1024 * 1024;
const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  crcTable[index] = value;
}
function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 255] ^ value >>> 8;
  return (value ^ 0xffffffff) >>> 0;
}
function pathName(name) {
  const path = name.replaceAll('\\', '/');
  if (path.startsWith('/') || path.split('/').some(part => part === '..' || /[:\0]/.test(part))) throw new Error('OSZ内のファイルパスが不正です。');
  return path.split('/').filter(part => part && part !== '.').join('/');
}

// ZIPの中央ディレクトリを読み、必要な.osu・音声だけを展開する。
export class OszArchive {
  constructor(buffer, inflateRaw) {
    this.bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.inflateRaw = inflateRaw;
    this.entries = [];
    const view = this.view, length = view.byteLength;
    let end = -1;
    for (let offset = length - 22; offset >= Math.max(0, length - 65557); offset--) {
      if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === length) { end = offset; break; }
    }
    if (end < 0) throw new Error('OSZ/ZIP形式を読み込めません。');
    const count = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true);
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count === 65535 || start === 0xffffffff) throw new Error('分割ZIP・ZIP64には対応していません。通常のOSZを使用してください。');
    let offset = start, total = 0;
    const paths = new Set();
    for (let index = 0; index < count; index++) {
      if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('OSZのファイル一覧が壊れています。');
      const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
      const next = offset + 46 + nameLength + extraLength + commentLength;
      if (next > end) throw new Error('OSZ内のファイル情報が不正です。');
      const nameBytes = this.bytes.subarray(offset + 46, offset + 46 + nameLength);
      let name = null;
      for (let extra = offset + 46 + nameLength; extra + 4 <= next - commentLength;) {
        const tag = view.getUint16(extra, true), extraSize = view.getUint16(extra + 2, true);
        if (extra + 4 + extraSize > next - commentLength) throw new Error('OSZの拡張情報が不正です。');
        if (tag === 0x7075 && extraSize >= 5 && view.getUint8(extra + 4) === 1 && view.getUint32(extra + 5, true) === crc32(nameBytes)) name = new TextDecoder().decode(this.bytes.subarray(extra + 9, extra + 4 + extraSize));
        extra += 4 + extraSize;
      }
      if (!name) {
        try { name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes); }
        catch { throw new Error('OSZ内のファイル名を読めません。展開済みフォルダから読み込んでください。'); }
      }
      if (!name.endsWith('/')) {
        name = pathName(name);
        const pathKey = name.toLowerCase();
        if (paths.has(pathKey)) throw new Error('OSZ内でファイル名が重複しています: ' + name);
        paths.add(pathKey);
        total += size;
        if (size > MAX_ENTRY || total > 1024 * 1024 * 1024) throw new Error('OSZの展開サイズが上限を超えています。');
        this.entries.push({ name, flags, method, compressedSize, size, crc: view.getUint32(offset + 16, true), offset: view.getUint32(offset + 42, true) });
      }
      offset = next;
    }
  }
  async read(entry) {
    if (typeof entry === 'string') entry = this.entries.find(item => item.name.toLowerCase() === entry.toLowerCase());
    if (!entry) throw new Error('OSZ内のファイルが見つかりません。');
    const view = this.view, start = entry.offset;
    if (entry.flags & 1) throw new Error('暗号化されたOSZには対応していません。');
    if (start + 30 > view.byteLength || view.getUint32(start, true) !== 0x04034b50) throw new Error('OSZのファイルデータが不正です。');
    const dataStart = start + 30 + view.getUint16(start + 26, true) + view.getUint16(start + 28, true);
    if (dataStart + entry.compressedSize > view.byteLength) throw new Error('OSZのファイルデータが途中で切れています。');
    const compressed = this.bytes.subarray(dataStart, dataStart + entry.compressedSize);
    let data;
    if (entry.method === 0) data = compressed;
    else if (entry.method === 8) data = await this.inflateRaw(compressed, entry.size);
    else throw new Error('未対応のZIP圧縮形式です: ' + entry.method);
    if (data.length !== entry.size || crc32(data) !== entry.crc) throw new Error('OSZ内のファイルが壊れています: ' + entry.name);
    return data;
  }
}

export async function browserInflateRaw(bytes, size) {
  let decompressor;
  try { decompressor = new DecompressionStream('deflate-raw'); }
  catch { throw new Error('このブラウザーではOSZを展開できません。展開済みフォルダから読み込むか、変換コマンドを使用してください。'); }
  const reader = new Blob([bytes]).stream().pipeThrough(decompressor).getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > size || length > MAX_ENTRY) { await reader.cancel(); throw new Error('OSZの展開サイズが不正です。'); }
    chunks.push(value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
