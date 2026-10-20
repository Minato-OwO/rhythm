export async function loadSongLibrary() {
  const response = await fetch('./api/songs', { cache: 'no-store' });
  if (!response.ok) throw new Error(`曲一覧を読み込めませんでした (${response.status})。`);
  const data = await response.json();
  if (!Array.isArray(data.songs) || !data.songs.length) throw new Error('songs内の曲フォルダにchart_[難易度].jsonまたはchart.jsonを置いてください。');
  const groups = new Map();
  for (const entry of data.songs) {
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
