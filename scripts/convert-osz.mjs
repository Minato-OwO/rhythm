import { readFile, readdir, stat, lstat, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, dirname, basename, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { OszArchive } from '../src/osz-archive.js';
import { parseOsu, convertOsu, safeAssetPath, relativeAssetURL, suggestedSongFolder } from '../src/osu-import.js';

const usage = [
  'npm run convert:osz -- "<file.osz | file.osu | 展開済みフォルダ>"',
  '  --difficulty "<難易度名>"   1譜面を選択（省略時は全4K譜面）',
  '  --output "<保存先>"        曲フォルダの作成先（既定: songs）',
  '  --list                     譜面一覧だけ表示',
  '  --force                    既存の変換先を上書き',
].join('\n');

async function walk(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await walk(resolve(directory, entry.name), name + '/'));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}
function inside(root, path) {
  const rel = relative(root, path);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('入力フォルダ外のファイルは使えません。');
  return path;
}
async function localRead(root, name) {
  const parts = safeAssetPath(name).split('/');
  let path = root;
  for (const part of parts) {
    path = inside(root, resolve(path, part));
    if ((await lstat(path)).isSymbolicLink()) throw new Error('素材にシンボリックリンクは使用できません: ' + name);
  }
  return readFile(path);
}
async function atomicWrite(path, data) {
  const temporary = path + '.tmp-' + process.pid;
  let created = false;
  try { await writeFile(temporary, data, { flag: 'wx' }); created = true; await rename(temporary, path); }
  finally { if (created) await rm(temporary, { force: true }); }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) { console.log(usage); return; }
  let input, output = fileURLToPath(new URL('../songs/', import.meta.url)), difficulty = null, list = false, force = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--list') list = true;
    else if (arg === '--force') force = true;
    else if (arg === '--difficulty' || arg === '--output') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(arg + 'の値を指定してください。');
      if (arg === '--difficulty') difficulty = value; else output = resolve(value);
    } else if (arg.startsWith('--') || input) throw new Error('不明な引数: ' + arg + '\n' + usage);
    else input = resolve(arg);
  }
  if (!input) throw new Error(usage);
  const info = await stat(input);
  let names, read;
  if (info.isFile() && /\.osz$/i.test(input)) {
    const archive = new OszArchive(await readFile(input), (bytes, size) => new Uint8Array(inflateRawSync(bytes, { maxOutputLength: Math.max(1, size) })));
    names = archive.entries.map(entry => entry.name);
    read = name => archive.read(name);
  } else if (info.isDirectory() || info.isFile() && /\.osu$/i.test(input)) {
    const root = info.isDirectory() ? input : dirname(input);
    names = info.isDirectory() ? await walk(root) : [basename(input)];
    read = name => localRead(root, name);
  } else throw new Error('OSZ・OSU・展開済みフォルダを指定してください。');
  const maps = [];
  for (const name of names.filter(name => /\.osu$/i.test(name)).sort()) {
    const map = parseOsu(new TextDecoder().decode(await read(name)), name);
    if (map.mode === 3 && map.keys === 4) maps.push(map);
    else console.log('対象外: ' + name + '（Mode ' + map.mode + ' / ' + map.keys + 'K）');
  }
  if (!maps.length) throw new Error('osu!mania 4K譜面が見つかりません。');
  if (list) { for (const map of maps) console.log(map.version + ' — ' + map.filename); return; }
  let selected = maps;
  if (difficulty) {
    selected = maps.filter(map => map.version === difficulty || map.filename === difficulty || basename(map.filename) === difficulty);
    if (!selected.length) selected = maps.filter(map => map.version.toLowerCase().includes(difficulty.toLowerCase()));
    if (selected.length !== 1) throw new Error('難易度名を1譜面に絞って指定してください。\n' + maps.map(map => map.version).join('\n'));
  }
  // 全譜面を変換・検証してから、出力を始める。
  const plans = [];
  const targets = new Set();
  for (const map of selected) {
    const result = convertOsu(map);
    const parent = map.filename.includes('/') ? map.filename.slice(0, map.filename.lastIndexOf('/') + 1) : '';
    const audio = await read(parent + result.audioPath);
    const audioName = result.audioPath.split('/').at(-1);
    result.source.audio = relativeAssetURL(audioName);
    const target = inside(output, resolve(output, suggestedSongFolder(map)));
    if (targets.has(target.toLowerCase())) throw new Error('出力先が同じになる譜面があります。--difficultyで1譜面ずつ選んでください。');
    targets.add(target.toLowerCase());
    try {
      const existing = await lstat(target);
      if (!force || !existing.isDirectory() || existing.isSymbolicLink()) throw new Error('変換先が既にあります: ' + target + '\n上書きする場合は--forceを指定してください。');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    plans.push({ ...result, audio, audioName, target });
  }
  await mkdir(output, { recursive: true });
  for (const plan of plans) {
    await mkdir(plan.target, { recursive: true });
    await atomicWrite(resolve(plan.target, plan.audioName), plan.audio);
    await atomicWrite(resolve(plan.target, 'chart.json'), JSON.stringify(plan.source, null, 2) + '\n');
    console.log('保存: ' + plan.target);
    console.log(plan.source.notes.length + ' notes / ' + plan.source.notes.filter(note => note.endTimeSeconds !== undefined).length + ' LN / ' + plan.source.scrollVelocities.length + ' SV');
    for (const warning of plan.warnings) console.log('注意: ' + warning);
  }
}
main().catch(error => { console.error(error.message ?? error); process.exitCode = 1; });
