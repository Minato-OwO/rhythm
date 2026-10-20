import { SV_MULTIPLIER_LIMIT } from './scroll-track.js';

const EVENT_TYPES = new Set(['lanePulse', 'laneColor', 'screenFlash', 'screenFade', 'backgroundStage', 'backgroundColor', 'backgroundPulse', 'backgroundStars', 'backgroundGLB', 'backgroundScene']);

function eventTime(item, bpm, offset) {
  return item.timeSeconds ?? (item.beat * 60 / bpm + offset);
}

export function isRangeSV(point) {
  return point.mode === 'range' || point.mode === undefined
    && (point.endMultiplier !== undefined || point.durationBeats !== undefined || point.durationSeconds !== undefined);
}

function normalizeEvent(event, index, bpm, offset, baseUrl) {
  const invalid = message => { throw new Error(`events[${index}]: ${message}`); };
  if (!event || typeof event !== 'object' || !EVENT_TYPES.has(event.type)) invalid('typeが不正です。');
  const time = eventTime(event, bpm, offset);
  if (!Number.isFinite(time) || time < 0) invalid('beatまたはtimeSecondsを指定してください。');
  const defaults = { screenFade: 2, backgroundStage: 1, backgroundColor: 1, backgroundStars: 8, backgroundGLB: 8, backgroundScene: 8 };
  const duration = event.durationSeconds ?? defaults[event.type] ?? 0.4;
  if (!Number.isFinite(duration) || duration < 0 || duration === 0 && !['laneColor', 'backgroundColor', 'backgroundStage'].includes(event.type)) invalid('durationSecondsが不正です。');
  const intensity = event.intensity ?? (event.type === 'screenFlash' ? 0.25 : ['backgroundGLB', 'backgroundScene'].includes(event.type) ? 1 : 0.6);
  if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) invalid('intensityは0〜1で指定してください。');
  const color = event.color ?? (['lanePulse', 'backgroundStage'].includes(event.type) ? null : event.type === 'screenFade' ? '#000000' : event.type === 'backgroundColor' ? '#090e19' : '#ffffff');
  if (color !== null && (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) invalid('colorは#rrggbbで指定してください。');
  if (event.type === 'laneColor' && typeof event.color !== 'string') invalid('laneColorにはcolorが必要です。');
  const lanes = event.lanes ?? (event.lane !== undefined ? [event.lane] : [0, 1, 2, 3]);
  if (!Array.isArray(lanes) || !lanes.length || lanes.some(lane => !Number.isInteger(lane) || lane < 0 || lane > 3)) invalid('lanesは0〜3の配列で指定してください。');
  const soft = ['screenFade', 'backgroundStars', 'backgroundGLB', 'backgroundScene'].includes(event.type);
  const fadeDefault = Math.min(event.type === 'screenFade' ? 0.25 : 0.5, duration / 2);
  const fadeIn = event.fadeInSeconds ?? (soft ? fadeDefault : 0);
  const fadeOut = event.fadeOutSeconds ?? (soft ? fadeDefault : duration);
  if (!Number.isFinite(fadeIn) || !Number.isFinite(fadeOut) || fadeIn < 0 || fadeOut < 0 || fadeIn + fadeOut > duration) invalid('フェード時間の合計はdurationSeconds以下にしてください。');
  const result = { id: index, type: event.type, time, duration, intensity, color, lanes: [...new Set(lanes)], fadeIn, fadeOut };
  if (event.type === 'backgroundStage') {
    result.target = event.target ?? 'all';
    result.opacity = event.opacity ?? 0;
    result.easing = event.easing ?? 'linear';
    if (!['all', 'grid', 'arches'].includes(result.target)) invalid('targetはall・grid・archesで指定してください。');
    if (!Number.isFinite(result.opacity) || result.opacity < 0 || result.opacity > 1) invalid('opacityは0〜1で指定してください。');
    if (!['linear', 'smoothstep'].includes(result.easing)) invalid('easingはlinearまたはsmoothstepで指定してください。');
  }
  const vector = (key, fallback, positive = false) => {
    const value = event[key] ?? fallback;
    if (!Array.isArray(value) || value.length !== 3 || value.some(number => !Number.isFinite(number) || positive && number <= 0)) invalid(`${key}は3つの数値で指定してください。`);
    return [...value];
  };
  if (['backgroundStars', 'backgroundGLB', 'backgroundScene'].includes(event.type)) result.rotationSpeed = vector('rotationSpeed', event.type === 'backgroundScene' ? [0, 0, 0] : [0, 3, 0]);
  if (event.type === 'backgroundStars') {
    result.size = event.size ?? 0.045;
    if (!Number.isFinite(result.size) || result.size <= 0) invalid('sizeは正の数で指定してください。');
  }
  if (event.type === 'backgroundGLB') {
    const src = event.src ?? null;
    if (src !== null && (typeof src !== 'string' || !/\.glb(?:[?#].*)?$/i.test(src))) invalid('srcにGLBファイル名を指定してください。非表示はnullです。');
    result.src = src && baseUrl ? new URL(src, baseUrl).href : src;
    result.position = vector('position', [0, 0, -15]);
    result.rotation = vector('rotation', [0, 0, 0]);
    result.scale = vector('scale', [1, 1, 1], true);
    result.fitSize = event.fitSize ?? 20;
    result.animationSpeed = event.animationSpeed ?? 1;
    if (!Number.isFinite(result.fitSize) || result.fitSize < 0 || !Number.isFinite(result.animationSpeed) || result.animationSpeed < 0) invalid('fitSizeとanimationSpeedは0以上の数値で指定してください。');
    result.animation = event.animation ?? 'auto';
    if (typeof result.animation !== 'string') invalid('animationはauto・none・アニメーション名で指定してください。');
    result.loop = event.loop ?? true;
    result.hideDefault = event.hideDefault ?? true;
    if (typeof result.loop !== 'boolean' || typeof result.hideDefault !== 'boolean') invalid('loopとhideDefaultはtrue/falseで指定してください。');
  }
  if (event.type === 'backgroundScene') {
    const src = event.src ?? null;
    if (src !== null && (typeof src !== 'string' || !/\.(?:m?js)(?:[?#].*)?$/i.test(src))) invalid('srcに背景モジュールのJSファイルを指定してください。');
    result.src = src && baseUrl ? new URL(src, baseUrl).href : src;
    result.position = vector('position', [0, 0, 0]);
    result.rotation = vector('rotation', [0, 0, 0]);
    result.scale = vector('scale', [1, 1, 1], true);
    result.animationSpeed = event.animationSpeed ?? 1;
    result.hideDefault = event.hideDefault ?? true;
    if (!Number.isFinite(result.animationSpeed) || result.animationSpeed < 0) invalid('animationSpeedは0以上の数値で指定してください。');
    if (typeof result.hideDefault !== 'boolean') invalid('hideDefaultはtrue/falseで指定してください。');
  }
  return result;
}

export function normalizeChart(source, { baseUrl, allowEmptyNotes = false } = {}) {
  if (!source || typeof source !== 'object') throw new Error('譜面JSONの形式が不正です。');
  if (source.version !== undefined && source.version !== 1) throw new Error('譜面のversionは1を指定してください。');
  if (!Number.isFinite(source.bpm) || source.bpm <= 0) throw new Error('譜面のbpmは正の数で指定してください。');
  if (!Array.isArray(source.notes) || !allowEmptyNotes && source.notes.length === 0) throw new Error('譜面にnotesがありません。');
  const offset = source.offsetSeconds ?? 0;
  if (!Number.isFinite(offset)) throw new Error('offsetSecondsは数値で指定してください。');
  const duplicates = new Set();
  const notes = source.notes.map((note, index) => {
    if (!note || typeof note !== 'object') throw new Error(`notes[${index}]の形式が不正です。`);
    const time = eventTime(note, source.bpm, offset);
    if (!Number.isFinite(time) || time < 0 || !Number.isInteger(note.lane) || note.lane < 0 || note.lane > 3) {
      throw new Error(`notes[${index}]の時刻またはレーンが不正です。`);
    }
    const key = `${note.lane}:${time}`;
    if (duplicates.has(key)) throw new Error(`notes[${index}]が同じレーン・時刻と重複しています。`);
    duplicates.add(key);
    const endTime = note.endTimeSeconds ?? (note.endBeat !== undefined ? note.endBeat * 60 / source.bpm + offset : null);
    if (endTime !== null && (!Number.isFinite(endTime) || endTime <= time)) throw new Error('LNの終点は始点より後にしてください。notes[' + index + ']');
    const scrollMultiplier = note.scrollMultiplier === undefined ? 1 : note.scrollMultiplier;
    if (!Number.isFinite(scrollMultiplier) || Math.abs(scrollMultiplier) > SV_MULTIPLIER_LIMIT) throw new Error('個別SVのscrollMultiplierは-' + SV_MULTIPLIER_LIMIT + '〜' + SV_MULTIPLIER_LIMIT + 'の数値で指定してください。notes[' + index + ']');
    return { id: index, lane: note.lane, time, endTime, scrollMultiplier };
  }).sort((a, b) => a.time - b.time || a.lane - b.lane);
  const laneEnds = [-Infinity, -Infinity, -Infinity, -Infinity];
  for (const note of notes) {
    if (note.time < laneEnds[note.lane] - 0.000001) throw new Error('同じレーンのLNに別のノーツが重なっています。notes[' + note.id + ']');
    laneEnds[note.lane] = note.endTime ?? note.time;
  }
  if (source.scrollVelocities !== undefined && !Array.isArray(source.scrollVelocities)) throw new Error('scrollVelocitiesは配列で指定してください。');
  const scrollVelocities = (source.scrollVelocities ?? []).map((point, index) => {
    if (!point || typeof point !== 'object') throw new Error('SVの形式が不正です。scrollVelocities[' + index + ']');
    const time = eventTime(point, source.bpm, offset);
    if (!Number.isFinite(time) || time < 0 || !Number.isFinite(point.multiplier) || Math.abs(point.multiplier) > SV_MULTIPLIER_LIMIT) throw new Error('SVの時刻または倍率が不正です。scrollVelocities[' + index + ']');
    const type = point.type ?? 'scroll';
    if (point.type !== undefined && !['scroll', 'speed'].includes(point.type)) throw new Error('SVのtypeはscrollまたはspeedで指定してください。scrollVelocities[' + index + ']');
    if (point.mode !== undefined && !['constant', 'range'].includes(point.mode)) throw new Error('SVのmodeはconstantまたはrangeで指定してください。scrollVelocities[' + index + ']');
    // 固定倍率を明示したデータは、古い範囲フィールドが残っていても即時切替する。
    if (!isRangeSV(point)) return { time, type, multiplier: point.multiplier, endMultiplier: point.multiplier, duration: 0, easing: 'linear', mode: 'constant', index };
    if (point.durationSeconds !== undefined && point.durationBeats !== undefined) throw new Error('SVの長さはdurationSecondsかdurationBeatsのどちらかで指定してください。scrollVelocities[' + index + ']');
    for (const key of ['durationSeconds', 'durationBeats']) {
      if (point[key] !== undefined && (!Number.isFinite(point[key]) || point[key] < 0)) throw new Error('SVの長さは0以上の数値で指定してください。scrollVelocities[' + index + ']');
    }
    const duration = point.durationSeconds ?? (point.durationBeats ?? 0) * 60 / source.bpm;
    const endMultiplier = point.endMultiplier === undefined ? point.multiplier : point.endMultiplier;
    const easing = point.easing ?? 'linear';
    if (!Number.isFinite(duration) || !Number.isFinite(time + duration)) throw new Error('SVの長さが不正です。scrollVelocities[' + index + ']');
    if (!Number.isFinite(endMultiplier) || Math.abs(endMultiplier) > SV_MULTIPLIER_LIMIT) throw new Error('SVの終了倍率は-' + SV_MULTIPLIER_LIMIT + '〜' + SV_MULTIPLIER_LIMIT + 'で指定してください。scrollVelocities[' + index + ']');
    if (!['linear', 'smoothstep'].includes(easing)) throw new Error('SVのeasingはlinearまたはsmoothstepで指定してください。scrollVelocities[' + index + ']');
    return { time, type, multiplier: point.multiplier, endMultiplier, duration, easing, mode: 'range', index };
  }).sort((a, b) => a.time - b.time || a.index - b.index);
  if (source.events !== undefined && !Array.isArray(source.events)) throw new Error('eventsは配列で指定してください。');
  const events = (source.events ?? []).map((event, index) => normalizeEvent(event, index, source.bpm, offset, baseUrl)).sort((a, b) => a.time - b.time || a.id - b.id);
  let minimumDuration = 0;
  for (const note of notes) minimumDuration = Math.max(minimumDuration, (note.endTime ?? note.time) + 1);
  for (const point of scrollVelocities) minimumDuration = Math.max(minimumDuration, point.time + point.duration);
  for (const event of events) minimumDuration = Math.max(minimumDuration, event.time + event.duration);
  if (source.durationSeconds !== undefined && (!Number.isFinite(source.durationSeconds) || source.durationSeconds < minimumDuration)) {
    throw new Error('durationSecondsは最後のノーツから1秒以上後、かつ最後のSV・演出の終了以降にしてください。');
  }
  const audio = source.audio ?? source.audioUrl ?? null;
  if (audio !== null && (typeof audio !== 'string' || !audio.trim())) throw new Error('audioには音声ファイル名を指定してください。');
  if (source.title !== undefined && typeof source.title !== 'string') throw new Error('titleは文字列で指定してください。');
  if (source.artist !== undefined && typeof source.artist !== 'string') throw new Error('artistは文字列で指定してください。');
  if (source.flashWarning !== undefined && typeof source.flashWarning !== 'boolean') throw new Error('flashWarningはtrue/falseで指定してください。');
  if (source.flashWarningText !== undefined && typeof source.flashWarningText !== 'string') throw new Error('flashWarningTextは文字列で指定してください。');
  return {
    title: source.title ?? 'Untitled',
    artist: source.artist ?? '',
    flashWarning: source.flashWarning ?? false,
    flashWarningText: source.flashWarningText?.trim() ?? '',
    bpm: source.bpm,
    // 音声パスはページではなく譜面JSONを基準にする。
    audioUrl: audio && baseUrl ? new URL(audio, baseUrl).href : audio,
    duration: source.durationSeconds ?? minimumDuration + 1,
    notes, events, scrollVelocities,
  };
}

export async function loadChart(url) {
  const chartUrl = new URL(url, document.baseURI);
  const response = await fetch(chartUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`譜面を読み込めませんでした (${response.status}): ${chartUrl.pathname}`);
  let source;
  try { source = await response.json(); }
  catch { throw new Error(`JSONの書式が不正です: ${chartUrl.pathname}`); }
  return normalizeChart(source, { baseUrl: chartUrl.href });
}
