export async function loadSongCatalog(rootUrl = new URL('../', import.meta.url)) {
  const response = await fetch(new URL('songs/index.json', rootUrl), { cache: 'no-store' });
  if (!response.ok) throw new Error(`曲一覧を読み込めませんでした (${response.status})。`);
  const data = await response.json();
  if (!Array.isArray(data.songs)) throw new Error('曲一覧の形式が不正です。公開用ファイルを作り直してください。');
  return data.songs.filter(entry => {
    const code = difficultyFromFilename(entry.chartUrl);
    return code && (entry.difficulty === undefined || entry.difficulty === code);
  }).map(entry => ({ ...entry, difficulty: difficultyFromFilename(entry.chartUrl), chartUrl: new URL(entry.chartUrl, rootUrl).href }));
}

export async function loadSongLibrary(rootUrl) {
  const entries = await loadSongCatalog(rootUrl);
  if (!entries.length) throw new Error('曲フォルダにchart_E.json・chart_N.json・chart_H.json・chart_X.jsonを置いてください。');
  const groups = new Map();
  for (const entry of entries) {
    const id = entry.groupId ?? entry.id;
    let song = groups.get(id);
    if (!song) {
      song = { id, title: entry.songTitle ?? entry.title, artist: entry.artist, bpm: entry.bpm, difficulties: [] };
      groups.set(id, song);
    }
    if (!song.difficulties.some(chart => chart.difficulty === entry.difficulty)) song.difficulties.push({ ...entry });
  }
  for (const song of groups.values()) song.difficulties.sort((a, b) => DIFFICULTY_CODES.indexOf(a.difficulty) - DIFFICULTY_CODES.indexOf(b.difficulty));
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, 'ja'));
}
import { difficultyFromFilename, DIFFICULTY_CODES } from './difficulties.js';

