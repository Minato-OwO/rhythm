export async function loadSongCatalog(rootUrl = new URL('../', import.meta.url)) {
  const response = await fetch(new URL('songs/index.json', rootUrl), { cache: 'no-store' });
  if (!response.ok) throw new Error(`曲一覧を読み込めませんでした (${response.status})。`);
  const data = await response.json();
  if (!Array.isArray(data.songs)) throw new Error('曲一覧の形式が不正です。公開用ファイルを作り直してください。');
  return data.songs.map(entry => ({ ...entry, chartUrl: new URL(entry.chartUrl, rootUrl).href }));
}

export async function loadSongLibrary(rootUrl) {
  const entries = await loadSongCatalog(rootUrl);
  if (!entries.length) throw new Error('songs内の曲フォルダにchart_[難易度].jsonまたはchart.jsonを置いてください。');
  const groups = new Map();
  for (const entry of entries) {
    const id = entry.groupId ?? entry.id;
    let song = groups.get(id);
    if (!song) {
      song = { id, title: entry.songTitle ?? entry.title, artist: entry.artist, bpm: entry.bpm, difficulties: [] };
      groups.set(id, song);
    }
    song.difficulties.push({ ...entry, difficulty: entry.difficulty ?? 'Normal' });
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, 'ja'));
}
