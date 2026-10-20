import { OszArchive, browserInflateRaw } from '../../../src/osz-archive.js';
import { parseOsu, convertOsu } from '../../../src/osu-import.js';

export async function importOsuFiles(records, chooseDifficulty) {
  let entries, read;
  const archives = records.filter(record => /\.osz$/i.test(record.file.name));
  if (archives.length > 1) throw new Error('OSZは1つずつ読み込んでください。');
  const archiveFile = archives[0];
  if (archiveFile) {
    const archive = new OszArchive(await archiveFile.file.arrayBuffer(), browserInflateRaw);
    entries = archive.entries.map(entry => entry.name);
    read = async path => archive.entries.some(entry => entry.name.toLowerCase() === path.toLowerCase()) ? new File([await archive.read(path)], path.split('/').at(-1)) : null;
  } else {
    entries = records.map(record => record.path.replaceAll('\\', '/'));
    const files = new Map(records.map(record => [record.path.replaceAll('\\', '/').toLowerCase(), record.file]));
    read = async path => files.get(path.toLowerCase()) ?? null;
  }
  const maps = [];
  for (const path of entries.filter(path => /\.osu$/i.test(path)).sort()) {
    const map = parseOsu(await (await read(path)).text(), path);
    if (map.mode === 3 && map.keys === 4) maps.push(map);
  }
  if (!maps.length) throw new Error('osu!maniaの4K譜面が見つかりません。');
  const map = maps.length === 1 ? maps[0] : await chooseDifficulty(maps);
  const result = convertOsu(map);
  const prefix = map.filename.includes('/') ? map.filename.slice(0, map.filename.lastIndexOf('/') + 1) : '';
  const audio = await read(prefix + result.audioPath);
  const warning = [...result.warnings, !audio ? '音声が見つかりません。「音声を選ぶ」で指定してください。' : ''].filter(Boolean).join(' / ');
  return { source: result.source, audio, models: new Map(), directory: null, imported: true, label: map.version, warning };
}
