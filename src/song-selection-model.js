import { DIFFICULTY_CODES } from './difficulties.js';

export function songSortValue(song, mode, personalBests) {
  if (mode === 'score') return Math.max(0, ...song.difficulties.map(chart => personalBests?.get(chart.id)?.score ?? 0));
  if (mode === 'difficulty') return Math.min(...song.difficulties.map(chart => {
    const rank = DIFFICULTY_CODES.indexOf(chart.difficulty);
    return (rank < 0 ? 4 : rank) * 1_000_000 + (Number.isFinite(chart.level) ? chart.level : 0);
  }));
  return song.title;
}
export function sortSongs(songs, mode = 'title', descending = false, personalBests) {
  const values = new Map(songs.map(song => [song, songSortValue(song, mode, personalBests)]));
  return [...songs].sort((a, b) => {
    const av = values.get(a), bv = values.get(b);
    const order = mode === 'title' ? av.localeCompare(bv, 'ja', { numeric: true }) : av - bv;
    return order * (descending ? -1 : 1) || a.title.localeCompare(b.title, 'ja', { numeric: true }) || a.id.localeCompare(b.id);
  });
}
