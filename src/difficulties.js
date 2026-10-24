export const DIFFICULTIES = Object.freeze([
  { code: 'E', label: 'EASY', color: '#68e0bd' },
  { code: 'N', label: 'NORMAL', color: '#54cfff' },
  { code: 'H', label: 'HARD', color: '#ffad73' },
  { code: 'X', label: 'EXPERT', color: '#d69bff' },
]);
export const DIFFICULTY_CODES = Object.freeze(DIFFICULTIES.map(item => item.code));
export const isDifficulty = code => DIFFICULTY_CODES.includes(code);
export function difficultyFilename(code = 'N') {
  if (!isDifficulty(code)) throw new Error('難易度はE・N・H・Xのいずれかを指定してください。');
  return 'chart_' + code + '.json';
}
export function difficultyFromFilename(path) {
  return String(path).match(/(?:^|[/\\])chart_([ENHX])\.json(?:[?#].*)?$/i)?.[1].toUpperCase() ?? null;
}
export function chartFileSource(source, filename) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('譜面JSONの形式が不正です。');
  const code = difficultyFromFilename(filename);
  if (!code) throw new Error('chart_E.json・chart_N.json・chart_H.json・chart_X.jsonのみ読み込めます。');
  if (source.difficulty !== undefined && source.difficulty !== code) throw new Error('JSONのdifficultyをファイル名と同じ' + code + 'にしてください。');
  return { ...source, difficulty: code };
}
// OSUを取り込む際だけ旧称を変換する。ゲームのJSON読み込みは4コードに限定する。
export function importedDifficulty(name) {
  const value = String(name).trim().toUpperCase();
  if (isDifficulty(value)) return value;
  if (/^(EZ|EASY|BEGINNER)$/.test(value)) return 'E';
  if (/^(HD|HARD)$/.test(value)) return 'H';
  if (/^(EX|EXPERT|EXTRA|INSANE)$/.test(value)) return 'X';
  return 'N';
}
export function legacyChartIds(id) {
  if (typeof id !== 'string') return [];
  const match = id.match(/^(.*)\/chart_([ENHX])\.json$/);
  if (!match) return [];
  const [, folder, code] = match;
  const aliases = { E: ['EZ', 'Easy'], N: ['NM', 'Normal'], H: ['HD', 'Hard'], X: ['EX', 'Expert'] }[code];
  return [...aliases.map(alias => folder + '/chart_' + alias + '.json'), ...(code === 'N' ? [folder] : [])];
}
