const BACKSLASH = String.fromCharCode(92);
const SKIN_FILE = /\.(png|jpe?g|webp|gif|avif)$/i;
export const embeddedSkin = src => typeof src === 'string' && src.startsWith('data:image/');

export function skinReferences(source) {
  return new Set([source.noteSkins?.head, source.noteSkins?.body,
    ...(source.events ?? []).filter(event => event.type === 'noteSkin').map(event => event.src)]
    .filter(src => src && !embeddedSkin(src)).map(assetPath));
}

export function assetPath(path) {
  if (typeof path !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('/') || path.startsWith(BACKSLASH)) throw new Error('音声・GLBは曲フォルダ内の相対パスで指定してください。');
  const parts = path.replaceAll(BACKSLASH, '/').split(/[?#]/)[0].split('/').filter(part => part && part !== '.').map(part => decodeURIComponent(part));
  if (!parts.length || parts.some(part => part === '..' || part.includes('/') || part.includes(BACKSLASH) || part.includes(':') || part.includes('\0'))) throw new Error('音声・GLBは曲フォルダ内に置いてください。');
  return parts.join('/');
}
export const assetURLPath = path => './' + path.split('/').map(part => encodeURIComponent(part)).join('/');
function audioPath(source) { const path = source.audio ?? source.audioUrl; return path ? assetPath(path).split('/') : null; }
function modelReferences(source) {
  return new Set((source.events ?? []).filter(event => event.type === 'backgroundGLB' && event.src).map(event => assetPath(event.src)));
}
async function fileAt(directory, parts, create = false) {
  let parent = directory;
  for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create });
  return parent.getFileHandle(parts.at(-1), { create });
}
async function scanModels(directory, models, skins, prefix = '') {
  for await (const [name, handle] of directory.entries()) {
    if (name.startsWith('.')) continue;
    const path = prefix + name;
    if (handle.kind === 'directory') await scanModels(handle, models, skins, path + '/');
    else if (/\.glb$/i.test(name)) models.set(path, { file: await handle.getFile(), dirty: false });
    else if (SKIN_FILE.test(name)) skins.set(path, { file: await handle.getFile(), dirty: false });
  }
}
function missingModels(source, models) {
  const missing = [...modelReferences(source)].filter(path => !models.has(path));
  return missing.length ? '背景GLBがありません: ' + missing.join(', ') : '';
}
function missingSkins(source, skins) {
  const missing = [...skinReferences(source)].filter(path => !skins.has(path));
  return missing.length ? 'ノーツスキン画像がありません: ' + missing.join(', ') : '';
}

export async function readDirectory(directory, chooseChart) {
  let chartFile;
  const names = [];
  for await (const [name, handle] of directory.entries()) if (handle.kind === 'file' && difficultyFromFilename(name)) names.push(name);
  const filename = names.length > 1 && chooseChart ? await chooseChart(names) : names.find(name => difficultyFromFilename(name) === 'N') ?? names.sort()[0];
  try {
    if (!filename || !names.includes(filename)) throw Object.assign(new Error('譜面がありません。'), { name: 'NotFoundError' });
    chartFile = await (await directory.getFileHandle(filename)).getFile();
  }
  catch (error) {
    if (error.name !== 'NotFoundError') throw error;
    const osuFiles = [];
    async function scan(parent, prefix = '') {
      for await (const [name, handle] of parent.entries()) {
        if (name.startsWith('.')) continue;
        if (handle.kind === 'directory') await scan(handle, prefix + name + '/');
        else osuFiles.push({ path: prefix + name, file: await handle.getFile() });
      }
    }
    await scan(directory);
    if (!osuFiles.some(record => /\.(osu|osz)$/i.test(record.path))) throw new Error('chart_E.json・chart_N.json・chart_H.json・chart_X.jsonが入った曲フォルダを選んでください。');
    return { osuFiles, label: directory.name };
  }
  const source = chartFileSource(JSON.parse(await chartFile.text()), filename);
  const parts = audioPath(source);
  let audio = null;
  let warning = '';
  if (parts) {
    try { audio = await (await fileAt(directory, parts)).getFile(); }
    catch (error) { if (error.name !== 'NotFoundError') throw error; warning = '指定の音声がありません。譜面のみ開きました。'; }
  }
  const models = new Map();
  const skins = new Map();
  await scanModels(directory, models, skins);
  warning = [warning, missingModels(source, models), missingSkins(source, skins)].filter(Boolean).join(' / ');
  return { source, audio, models, skins, directory, label: directory.name, warning };
}

export async function readFiles(records, chooseChart) {
  const files = records.map(record => record.file ? { ...record, path: record.path.replaceAll(BACKSLASH, '/') } : { file: record, path: (record.webkitRelativePath || record.name).replaceAll(BACKSLASH, '/') });
  const charts = files.filter(record => difficultyFromFilename(record.file.name));
  if (!charts.length && files.some(record => /\.(osu|osz)$/i.test(record.path))) return { osuFiles: files, label: 'osu!譜面' };
  if (!charts.length) throw new Error('chart_E.json・chart_N.json・chart_H.json・chart_X.jsonが入った曲フォルダを選んでください。');
  const selectedName = charts.length > 1 && chooseChart ? await chooseChart(charts.map(record => record.path)) : null;
  const entry = selectedName ? charts.find(record => record.path === selectedName) : charts.find(record => difficultyFromFilename(record.path) === 'N') ?? charts[0];
  if (!entry) throw new Error('選んだ譜面がありません。');
  const source = chartFileSource(JSON.parse(await entry.file.text()), entry.file.name);
  const prefix = entry.path.slice(0, -entry.file.name.length);
  const parts = audioPath(source);
  const target = parts ? prefix + parts.join('/') : null;
  const audio = files.find(record => record.path === target)?.file ?? null;
  const models = new Map();
  const skins = new Map();
  for (const record of files) {
    if (record.path.startsWith(prefix) && /\.glb$/i.test(record.path)) models.set(record.path.slice(prefix.length), { file: record.file, dirty: false });
    if (record.path.startsWith(prefix) && SKIN_FILE.test(record.path)) skins.set(record.path.slice(prefix.length), { file: record.file, dirty: false });
  }
  const warning = [parts && !audio ? '指定の音声がありません。譜面のみ開きました。' : '', missingModels(source, models), missingSkins(source, skins)].filter(Boolean).join(' / ');
  return { source, audio, models, skins, directory: null, label: prefix || '曲フォルダ', warning };
}

export async function droppedFiles(dataTransfer) {
  const entries = [...dataTransfer.items].map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files].map(file => ({ file, path: file.name }));
  const files = [];
  async function walk(entry, prefix = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      files.push({ file, path: prefix + entry.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child, prefix + entry.name + '/');
      }
    }
  }
  for (const entry of entries) await walk(entry);
  return files;
}

export async function readServerSong(song) {
  const chartUrl = new URL(song.chartUrl, new URL('../', document.baseURI));
  const response = await fetch(chartUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error('譜面を読み込めませんでした。曲一覧を更新してください。');
  const source = chartFileSource(await response.json(), chartUrl.pathname);
  const parts = audioPath(source);
  let audio = null;
  let warning = '';
  if (parts) {
    const music = await fetch(new URL(assetURLPath(parts.join('/')), chartUrl), { cache: 'no-store' });
    if (music.ok) audio = new File([await music.blob()], parts.at(-1));
    else warning = '音声を読み込めません。譜面のみ開きました。';
  }
  const models = new Map();
  for (const path of new Set([...(song.models ?? []), ...modelReferences(source)])) {
    const key = assetPath(assetURLPath(path));
    models.set(key, { url: new URL(assetURLPath(key), chartUrl).href, dirty: false });
  }
  const skins = new Map([...skinReferences(source)].map(path => [path, { url: new URL(assetURLPath(path), chartUrl).href, dirty: false }]));
  return { source, audio, models, skins, directory: null, label: song.id, warning, baseUrl: chartUrl.href };
}

async function writeFile(handle, data) {
  const writer = await handle.createWritable();
  try { await writer.write(data); await writer.close(); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
}

export async function saveDirectory(directory, source, audio, copyAudio = false, models = new Map(), copyModels = false, skins = new Map()) {
  const filename = difficultyFilename(source.difficulty);
  if (directory.queryPermission && await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    if (await directory.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('保存先フォルダへの書き込みが許可されませんでした。');
  }
  const missing = [missingModels(source, models), missingSkins(source, skins)].filter(Boolean).join(' / ');
  if (missing) throw new Error(missing + '。素材を追加してから保存してください。');
  // 取得できない素材があれば、JSONを書き換える前に止める。
  const copies = [];
  for (const [kind, assets] of [['model', models], ['skin', skins]]) for (const [path, asset] of assets) {
    if (!copyModels && !asset.dirty) continue;
    let file = asset.file;
    if (!file && asset.url) {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error('素材を保存できません: ' + path);
      const blob = await response.blob();
      file = new File([blob], path.split('/').at(-1), { type: kind === 'model' ? 'model/gltf-binary' : blob.type });
    }
    if (!file) throw new Error('素材を選び直してください: ' + path);
    copies.push({ kind, path, file });
  }
  const parts = audioPath(source);
  if (audio && parts && copyAudio) await writeFile(await fileAt(directory, parts, true), audio);
  const savedModels = new Map(models);
  const savedSkins = new Map(skins);
  for (const { kind, path, file } of copies) {
    const handle = await fileAt(directory, assetPath(assetURLPath(path)).split('/'), true);
    await writeFile(handle, file);
    // 同じ保存先から読み込んだFileは上書き後に無効になるため取得し直す。
    (kind === 'model' ? savedModels : savedSkins).set(path, { file: await handle.getFile(), dirty: false });
  }
  await writeFile(await directory.getFileHandle(filename, { create: true }), JSON.stringify({ ...source, difficulty: source.difficulty ?? 'N' }, null, 2) + '\n');
  return { audio: audio && parts && copyAudio ? await (await fileAt(directory, parts)).getFile() : audio, models: savedModels, skins: savedSkins };
}

// JSON保存は画像も埋め込み、JSONだけを移動しても同じスキンを再現する。
export async function embedSkinImages(source, skins) {
  const result = JSON.parse(JSON.stringify(source));
  const embedded = new Map();
  for (const path of skinReferences(source)) {
    const asset = skins.get(path);
    let file = asset?.file;
    if (!file && asset?.url) {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error('スキン画像を読み込めません: ' + path);
      file = await response.blob();
    }
    if (!file) throw new Error('スキン画像がありません: ' + path);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    const extension = path.split('.').at(-1).toLowerCase();
    const mime = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif', avif: 'avif' }[extension];
    embedded.set(path, 'data:image/' + mime + ';base64,' + btoa(chunks.join('')));
  }
  const replace = src => src && !embeddedSkin(src) ? embedded.get(assetPath(src)) : src;
  if (result.noteSkins) {
    result.noteSkins.head = replace(result.noteSkins.head) ?? null;
    result.noteSkins.body = replace(result.noteSkins.body) ?? null;
  }
  for (const event of result.events ?? []) if (event.type === 'noteSkin') event.src = replace(event.src) ?? null;
  return result;
}

export function downloadJSON(source) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(source, null, 2) + '\n'], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = difficultyFilename(source.difficulty);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
import { difficultyFromFilename, difficultyFilename, chartFileSource } from '../../../src/difficulties.js';

