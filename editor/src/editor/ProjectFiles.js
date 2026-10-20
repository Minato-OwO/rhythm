const BACKSLASH = String.fromCharCode(92);

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
async function scanModels(directory, models, prefix = '') {
  for await (const [name, handle] of directory.entries()) {
    if (name.startsWith('.')) continue;
    const path = prefix + name;
    if (handle.kind === 'directory') await scanModels(handle, models, path + '/');
    else if (/\.glb$/i.test(name)) models.set(path, { file: await handle.getFile(), dirty: false });
  }
}
function missingModels(source, models) {
  const missing = [...modelReferences(source)].filter(path => !models.has(path));
  return missing.length ? '背景GLBがありません: ' + missing.join(', ') : '';
}

export async function readDirectory(directory) {
  let chartFile;
  try { chartFile = await (await directory.getFileHandle('chart.json')).getFile(); }
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
    return { osuFiles, label: directory.name };
  }
  const source = JSON.parse(await chartFile.text());
  const parts = audioPath(source);
  let audio = null;
  let warning = '';
  if (parts) {
    try { audio = await (await fileAt(directory, parts)).getFile(); }
    catch (error) { if (error.name !== 'NotFoundError') throw error; warning = '指定の音声がありません。譜面のみ開きました。'; }
  }
  const models = new Map();
  await scanModels(directory, models);
  warning = [warning, missingModels(source, models)].filter(Boolean).join(' / ');
  return { source, audio, models, directory, label: directory.name, warning };
}

export async function readFiles(records) {
  const files = records.map(record => record.file ? { ...record, path: record.path.replaceAll(BACKSLASH, '/') } : { file: record, path: (record.webkitRelativePath || record.name).replaceAll(BACKSLASH, '/') });
  const charts = files.filter(record => record.file.name === 'chart.json');
  if (!charts.length && files.some(record => /\.(osu|osz)$/i.test(record.path))) return { osuFiles: files, label: 'osu!譜面' };
  if (charts.length !== 1) throw new Error('chart.jsonが1つ入った曲フォルダを選んでください。');
  const entry = charts[0];
  const source = JSON.parse(await entry.file.text());
  const prefix = entry.path.slice(0, -'chart.json'.length);
  const parts = audioPath(source);
  const target = parts ? prefix + parts.join('/') : null;
  const audio = files.find(record => record.path === target)?.file ?? null;
  const models = new Map();
  for (const record of files) {
    if (record.path.startsWith(prefix) && /\.glb$/i.test(record.path)) models.set(record.path.slice(prefix.length), { file: record.file, dirty: false });
  }
  const warning = [parts && !audio ? '指定の音声がありません。譜面のみ開きました。' : '', missingModels(source, models)].filter(Boolean).join(' / ');
  return { source, audio, models, directory: null, label: prefix || '曲フォルダ', warning };
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
  const chartUrl = new URL(song.chartUrl, location.origin + '/');
  const response = await fetch(chartUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error('譜面を読み込めませんでした。曲一覧を更新してください。');
  const source = await response.json();
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
  return { source, audio, models, directory: null, label: song.id, warning, baseUrl: chartUrl.href };
}

async function writeFile(handle, data) {
  const writer = await handle.createWritable();
  try { await writer.write(data); await writer.close(); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
}

export async function saveDirectory(directory, source, audio, copyAudio = false, models = new Map(), copyModels = false) {
  if (directory.queryPermission && await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    if (await directory.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('保存先フォルダへの書き込みが許可されませんでした。');
  }
  const missing = missingModels(source, models);
  if (missing) throw new Error(missing + '。「GLBを追加」から読み込んでください。');
  // 取得できない素材があれば、JSONを書き換える前に止める。
  const copies = [];
  for (const [path, asset] of models) {
    if (!copyModels && !asset.dirty) continue;
    let file = asset.file;
    if (!file && asset.url) {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error('GLBを保存できません: ' + path);
      file = new File([await response.blob()], path.split('/').at(-1), { type: 'model/gltf-binary' });
    }
    if (!file) throw new Error('GLBを選び直してください: ' + path);
    copies.push({ path, file });
  }
  const parts = audioPath(source);
  if (audio && parts && copyAudio) await writeFile(await fileAt(directory, parts, true), audio);
  const savedModels = new Map(models);
  for (const { path, file } of copies) {
    const handle = await fileAt(directory, assetPath(assetURLPath(path)).split('/'), true);
    await writeFile(handle, file);
    // 同じ保存先から読み込んだFileは上書き後に無効になるため取得し直す。
    savedModels.set(path, { file: await handle.getFile(), dirty: false });
  }
  await writeFile(await directory.getFileHandle('chart.json', { create: true }), JSON.stringify(source, null, 2) + '\n');
  return { audio: audio && parts && copyAudio ? await (await fileAt(directory, parts)).getFile() : audio, models: savedModels };
}

export function downloadJSON(source) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(source, null, 2) + '\n'], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'chart.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
