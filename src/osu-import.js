import { normalizeChart } from './chart.js';

export function safeAssetPath(value) {
  const path = String(value ?? '').trim().replace(/^"|"$/g, '').replaceAll('\\', '/');
  const parts = path.split('/').filter(part => part && part !== '.');
  if (!parts.length || path.startsWith('/') || parts.some(part => part === '..' || /[:\0]/.test(part))) throw new Error('曲フォルダ内のファイルを指定してください: ' + path);
  return parts.join('/');
}
export const relativeAssetURL = path => './' + safeAssetPath(path).split('/').map(encodeURIComponent).join('/');

export function parseOsu(text, filename = 'beatmap.osu') {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const format = Number(lines[0].match(/^osu file format v(\d+)/)?.[1]);
  if (!Number.isInteger(format)) throw new Error('osu!形式の譜面ではありません: ' + filename);
  const sections = {};
  let section = '';
  for (const original of lines.slice(1)) {
    const line = original.trim();
    if (!line || line.startsWith('//')) continue;
    if (/^\[.+\]$/.test(line)) { section = line.slice(1, -1); sections[section] ??= []; }
    else if (section) sections[section].push(line);
  }
  const pairs = name => Object.fromEntries((sections[name] ?? []).map(line => {
    const colon = line.indexOf(':');
    return colon < 0 ? null : [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }).filter(Boolean));
  const general = pairs('General'), metadata = pairs('Metadata'), difficulty = pairs('Difficulty');
  return { filename, format, general, metadata, difficulty, sections, mode: Number(general.Mode ?? 0), keys: Number(difficulty.CircleSize), version: metadata.Version ?? filename };
}

export function convertOsu(map) {
  if (map.mode !== 3 || map.keys !== 4) throw new Error('osu!maniaの4K譜面を選んでください: ' + map.filename);
  const legacyOffset = map.format < 5 ? 24 : 0;
  const notes = [];
  const seen = new Map();
  let duplicates = 0;
  for (const line of map.sections.HitObjects ?? []) {
    const columns = line.split(',');
    const x = Number(columns[0]), milliseconds = Number(columns[2]) + legacyOffset, type = Number(columns[3]);
    if (!Number.isFinite(x) || !Number.isFinite(milliseconds) || milliseconds < 0 || !Number.isInteger(type)) throw new Error('ノーツの形式が不正です: ' + line);
    const lane = Math.max(0, Math.min(3, Math.floor(x * 4 / 512)));
    const note = { timeSeconds: milliseconds / 1000, lane };
    if (type & 128) {
      const end = Number(columns[5]?.split(':')[0]) + legacyOffset;
      if (!Number.isFinite(end) || end < milliseconds) throw new Error('LNの終点が不正です: ' + line);
      if (end > milliseconds) note.endTimeSeconds = end / 1000;
    } else if (!(type & 1)) throw new Error('4Kのタップ・LN以外のノーツがあります: ' + line);
    const key = lane + ':' + milliseconds;
    if (seen.has(key)) {
      if (seen.get(key).endTimeSeconds !== note.endTimeSeconds) throw new Error('同じ始点に異なる長さのノーツが重なっています: ' + line);
      duplicates++; continue;
    }
    seen.set(key, note);
    notes.push(note);
  }
  notes.sort((a, b) => a.timeSeconds - b.timeSeconds || a.lane - b.lane);
  if (!notes.length) throw new Error('譜面にノーツがありません: ' + map.filename);
  const end = notes.reduce((last, note) => Math.max(last, note.endTimeSeconds ?? note.timeSeconds), 0);
  const timing = (map.sections.TimingPoints ?? []).map((line, index) => {
    const values = line.split(',');
    const time = Number(values[0]) + legacyOffset, beatLength = Number(values[1]);
    const uninherited = values[6] === undefined || values[6].trim() === '1';
    if (!Number.isFinite(time) || !Number.isFinite(beatLength) || uninherited && beatLength <= 0) throw new Error('タイミングポイントが不正です: ' + line);
    return { time, beatLength, uninherited, meter: Number(values[2]) || 4, index };
  }).sort((a, b) => a.time - b.time || Number(b.uninherited) - Number(a.uninherited) || a.index - b.index);
  const red = timing.filter(point => point.uninherited);
  if (!red.length) throw new Error('BPMのタイミングポイントがありません: ' + map.filename);
  // 最も長い時間使われるBPMを表示速度1倍の基準にする。
  const durations = new Map();
  for (let index = 0; index < red.length; index++) {
    const point = red[index];
    const duration = Math.max(0, Math.min(end * 1000, red[index + 1]?.time ?? end * 1000) - Math.max(0, index ? point.time : 0));
    durations.set(point.beatLength, (durations.get(point.beatLength) ?? 0) + duration);
  }
  const baseLength = [...durations].sort((a, b) => b[1] - a[1])[0]?.[0] ?? red[0].beatLength;
  let beatLength = red[0].beatLength, inherited = 1;
  const scrollVelocities = [{ timeSeconds: 0, multiplier: baseLength / beatLength }];
  for (const point of timing) {
    if (point.uninherited) { beatLength = point.beatLength; inherited = 1; }
    else inherited = point.beatLength < 0 ? Math.max(0.01, Math.min(10, -100 / point.beatLength)) : 1;
    const next = { timeSeconds: Math.max(0, point.time / 1000), multiplier: inherited * baseLength / beatLength };
    const previous = scrollVelocities.at(-1);
    if (previous.timeSeconds === next.timeSeconds) scrollVelocities[scrollVelocities.length - 1] = next;
    else if (Math.abs(previous.multiplier - next.multiplier) > 1e-12) scrollVelocities.push(next);
  }
  const title = map.metadata.TitleUnicode || map.metadata.Title || 'Untitled';
  const audioPath = safeAssetPath(map.general.AudioFilename);
  if (!/\.(mp3|ogg|wav|m4a|flac|aac|opus|webm)$/i.test(audioPath)) throw new Error('対応する音声ファイルを指定してください: ' + audioPath);
  const source = {
    version: 1, title: title + ' [' + map.version + ']', artist: map.metadata.ArtistUnicode || map.metadata.Artist || '',
    bpm: 60000 / baseLength, audio: relativeAssetURL(audioPath), offsetSeconds: red[0].time / 1000,
    durationSeconds: Math.ceil(Math.max(end + 2, scrollVelocities.at(-1).timeSeconds + 0.1) * 1000) / 1000,
    notes, scrollVelocities, events: [],
    osu: {
      title, creator: map.metadata.Creator ?? '', difficulty: map.version,
      beatmapId: map.metadata.BeatmapID ?? '', beatmapSetId: map.metadata.BeatmapSetID ?? '',
      sourceFile: map.filename, format: map.format,
      timingPoints: timing.map(({ time, beatLength, uninherited, meter }) => ({ timeSeconds: time / 1000, beatLength, uninherited, meter })),
    },
  };
  normalizeChart(source);
  const warnings = [];
  if (duplicates) warnings.push('同じレーン・時刻の重複ノーツを' + duplicates + '個まとめました。');
  return { source, audioPath, warnings };
}

export function suggestedSongFolder(map) {
  const clean = value => String(value).normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 42);
  const id = /^\d+$/.test(map.metadata.BeatmapID ?? '') ? map.metadata.BeatmapID : '';
  let hash = 2166136261;
  for (const char of map.filename) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return 'osu-' + (id || hash.toString(16)) + '-' + (clean(map.version) || '4K');
}
