import { normalizeChart, isRangeSV } from '../../../src/chart.js';
export { isRangeSV };

export const EFFECTS = {
  noteSkin: { label: 'ノーツスキン変更', color: '#77e8b0', defaults: { durationSeconds: 0, target: 'head', src: null, tint: false } },
  lanePulse: { label: 'レーン発光', color: '#43ddff', defaults: { durationSeconds: 0.4, intensity: 0.6 } },
  laneColor: { label: 'レーン色変更', color: '#c881ff', defaults: { durationSeconds: 0.4, color: '#c881ff' } },
  screenFlash: { label: '画面フラッシュ', color: '#ffca73', defaults: { durationSeconds: 0.4, intensity: 0.25, color: '#ffffff' } },
  screenFade: { label: '画面フェード', color: '#ff8cae', defaults: { durationSeconds: 2, intensity: 0.6, color: '#000000', fadeInSeconds: 0.25, fadeOutSeconds: 0.25 } },
  backgroundStage: { label: '標準ステージ', color: '#a9b6ff', defaults: { durationSeconds: 1, target: 'all', opacity: 0, easing: 'linear' } },
  backgroundColor: { label: '背景色変更', color: '#6b8cff', defaults: { durationSeconds: 1, color: '#090e19' } },
  backgroundPulse: { label: '背景パルス', color: '#ffaf66', defaults: { durationSeconds: 0.4, intensity: 0.6, color: '#43ddff' } },
  backgroundStars: { label: '星', color: '#c5eaff', defaults: { durationSeconds: 8, intensity: 0.6, color: '#ffffff', size: 0.045, rotationSpeed: [0, 3, 0], fadeInSeconds: 0.5, fadeOutSeconds: 0.5 } },
  backgroundGLB: { label: '背景GLB', color: '#99e7ad', defaults: { durationSeconds: 8, src: null, intensity: 1, color: '#ffffff', position: [0, 0, -15], rotation: [0, 0, 0], scale: [1, 1, 1], fitSize: 20, rotationSpeed: [0, 3, 0], fadeInSeconds: 0.5, fadeOutSeconds: 0.5, animation: 'auto', animationSpeed: 1, loop: true, hideDefault: true } },
  backgroundScene: { label: '背景シーン(JS)', color: '#83dbed', defaults: { durationSeconds: 8, src: null, intensity: 1, color: '#ffffff', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], rotationSpeed: [0, 0, 0], fadeInSeconds: 0.5, fadeOutSeconds: 0.5, animationSpeed: 1, hideDefault: true } },
};
const clone = value => JSON.parse(JSON.stringify(value));
const collection = kind => ({ note: 'notes', event: 'events', sv: 'svs' })[kind];

export function snapToGrid(seconds, step, origin = 0) {
  if (!Number.isFinite(seconds) || !Number.isFinite(step) || step <= 0 || !Number.isFinite(origin)) {
    throw new Error('スナップ間隔には正の数値、時刻と基準位置には有限の数値を指定してください。');
  }
  // 曲のオフセットを基準にする。0秒より前のグリッドへ丸めず、最初の有効な位置へ揃える。
  const firstIndex = Math.ceil(-origin / step - 1e-9);
  const index = Math.max(firstIndex, Math.round((seconds - origin) / step));
  const result = Math.max(0, origin + index * step);
  if (!Number.isFinite(result)) throw new Error('スナップ後の時刻が数値の範囲外です。');
  return result;
}

export class ChartDocument {
  constructor(source = { version: 1, title: 'New Song', artist: '', bpm: 120, audio: './audio.ogg', offsetSeconds: 0, durationSeconds: 60, notes: [], events: [] }) {
    normalizeChart(source, { allowEmptyNotes: true });
    this.metadata = clone(source);
    this.metadata.difficulty ??= 'N';
    delete this.metadata.notes;
    delete this.metadata.events;
    delete this.metadata.scrollVelocities;
    this.nextId = 1;
    this.notes = source.notes.map(data => ({ id: `item-${this.nextId++}`, kind: 'note', data: clone(data) }));
    this.events = (source.events ?? []).map(data => ({ id: `item-${this.nextId++}`, kind: 'event', data: clone(data) }));
    this.svs = (source.scrollVelocities ?? []).map(data => ({ id: `item-${this.nextId++}`, kind: 'sv', data: clone(data) }));
    this.past = [];
    this.future = [];
    this.pending = null;
    this.markSaved();
  }

  get items() { return [...this.notes, ...this.events, ...this.svs]; }
  get(id) { return this.notes.find(item => item.id === id) ?? this.events.find(item => item.id === id) ?? this.svs.find(item => item.id === id); }
  time(item) { return item.data.timeSeconds ?? item.data.beat * 60 / this.metadata.bpm + (this.metadata.offsetSeconds ?? 0); }
  beat(time) { return (time - (this.metadata.offsetSeconds ?? 0)) * this.metadata.bpm / 60; }
  seconds(beat) { return beat * 60 / this.metadata.bpm + (this.metadata.offsetSeconds ?? 0); }
  endTime(item) { return item.kind === 'sv' ? this.time(item) + this.duration(item) : item.data.endTimeSeconds ?? (item.data.endBeat !== undefined ? this.seconds(item.data.endBeat) : this.time(item)); }
  duration(item) { return item.kind === 'event' && item.data.type === 'noteSkin' ? 0 : item.kind === 'sv' ? isRangeSV(item.data) ? item.data.durationSeconds ?? (item.data.durationBeats ?? 0) * 60 / this.metadata.bpm : 0 : item.kind === 'note' ? this.endTime(item) - this.time(item) : item.data.durationSeconds ?? EFFECTS[item.data.type].defaults.durationSeconds; }
  setSVDuration(item, seconds) {
    item.data.mode = 'range';
    if (item.data.durationSeconds !== undefined) {
      item.data.durationSeconds = Number(seconds.toFixed(6));
      delete item.data.durationBeats;
    } else {
      item.data.durationBeats = Number((seconds * this.metadata.bpm / 60).toFixed(9));
      delete item.data.durationSeconds;
    }
  }
  setEndTime(item, seconds) {
    if (item.data.endTimeSeconds !== undefined || item.data.timeSeconds !== undefined) { item.data.endTimeSeconds = Number(seconds.toFixed(6)); delete item.data.endBeat; }
    else { item.data.endBeat = Number(this.beat(seconds).toFixed(9)); delete item.data.endTimeSeconds; }
  }
  setTime(item, seconds) {
    seconds = Math.max(0, seconds);
    const duration = item.kind === 'note' ? this.duration(item) : 0;
    if (item.data.timeSeconds !== undefined) item.data.timeSeconds = Number(seconds.toFixed(6));
    else item.data.beat = Number(this.beat(seconds).toFixed(9));
    if (duration > 0) this.setEndTime(item, seconds + duration);
  }

  requiredEnd() {
    let end = 1;
    for (const item of this.notes) end = Math.max(end, this.endTime(item) + 1);
    for (const item of this.events) end = Math.max(end, this.time(item) + this.duration(item));
    for (const item of this.svs) end = Math.max(end, this.endTime(item));
    return end;
  }

  toJSON() {
    return {
      ...clone(this.metadata), version: 1,
      notes: [...this.notes].sort((a, b) => this.time(a) - this.time(b) || a.data.lane - b.data.lane).map(item => clone(item.data)),
      events: [...this.events].sort((a, b) => this.time(a) - this.time(b)).map(item => clone(item.data)),
      scrollVelocities: [...this.svs].sort((a, b) => this.time(a) - this.time(b)).map(item => {
        const data = clone(item.data);
        data.type ??= 'scroll';
        data.mode = isRangeSV(data) ? 'range' : 'constant';
        if (data.mode === 'constant') {
          delete data.endMultiplier;
          delete data.durationBeats;
          delete data.durationSeconds;
          delete data.easing;
        }
        return data;
      }),
    };
  }
  normalized() { return normalizeChart(this.toJSON(), { allowEmptyNotes: true }); }
  export() { const source = this.toJSON(); normalizeChart(source); return source; }
  snapshot() { return JSON.stringify({ metadata: this.metadata, notes: this.notes, events: this.events, svs: this.svs, nextId: this.nextId }); }
  restore(snapshot) { Object.assign(this, JSON.parse(snapshot)); }
  markSaved() { this.saved = this.snapshot(); }
  get dirty() { return this.saved !== this.snapshot(); }
  remember(snapshot) { this.past.push(snapshot); if (this.past.length > 100) this.past.shift(); this.future.length = 0; }
  beginEdit() { this.pending = this.snapshot(); }
  endEdit() { if (this.pending && this.pending !== this.snapshot()) this.remember(this.pending); this.pending = null; }
  cancelEdit() { if (this.pending) this.restore(this.pending); this.pending = null; }

  change(edit, record = true) {
    const before = this.snapshot();
    try {
      edit(this);
      if (this.metadata.durationSeconds !== undefined) this.metadata.durationSeconds = Math.max(this.metadata.durationSeconds, Math.ceil(this.requiredEnd() * 1000) / 1000);
      this.normalized();
    } catch (error) { this.restore(before); throw error; }
    if (record && before !== this.snapshot()) this.remember(before);
  }

  add(kind, seconds, laneOrType, overrides = {}) {
    let id;
    this.change(() => {
      id = `item-${this.nextId++}`;
      const stamp = { beat: Number(this.beat(Math.max(0, seconds)).toFixed(9)) };
      const data = kind === 'note' ? { ...stamp, lane: laneOrType, ...clone(overrides) } : kind === 'sv' ? { ...stamp, type: 'scroll', multiplier: 1, ...clone(overrides) } : { ...stamp, type: laneOrType, ...clone(EFFECTS[laneOrType].defaults), ...clone(overrides) };
      this[collection(kind)].push({ id, kind, data });
    });
    return id;
  }

  movementOrigins(ids) {
    const items = new Map(this.items.map(item => [item.id, item]));
    return [...new Set(ids)].map(id => items.get(id)).filter(Boolean).map(item => ({ id: item.id, time: this.time(item), lane: item.kind === 'note' ? item.data.lane : null }));
  }
  moveItems(origins, seconds, lanes = 0, record = true) {
    if (!Number.isFinite(seconds) || !Number.isInteger(lanes)) throw new Error('移動量には有限の数値を指定してください。');
    const items = new Map(this.items.map(item => [item.id, item]));
    const existing = origins.filter(origin => items.has(origin.id));
    if (!existing.length) return;
    let earliest = Infinity, minLane = 3, maxLane = 0, hasNotes = false;
    for (const origin of existing) {
      earliest = Math.min(earliest, origin.time);
      if (origin.lane !== null) { hasNotes = true; minLane = Math.min(minLane, origin.lane); maxLane = Math.max(maxLane, origin.lane); }
    }
    // 先頭や外側のレーンでグループ全体を止め、相対位置を崩さない。
    seconds = Math.max(-earliest, seconds);
    lanes = hasNotes ? Math.max(-minLane, Math.min(3 - maxLane, lanes)) : 0;
    this.change(() => {
      for (const origin of existing) {
        const item = items.get(origin.id);
        this.setTime(item, origin.time + seconds);
        if (origin.lane !== null) item.data.lane = origin.lane + lanes;
      }
    }, record);
  }
  moveMany(ids, seconds, lanes = 0) { this.moveItems(this.movementOrigins(ids), seconds, lanes); }
  snapNotes(ids, step, origin = 0) {
    snapToGrid(0, step, origin);
    const selected = ids == null ? null : new Set(ids);
    const notes = this.notes.filter(item => !selected || selected.has(item.id));
    if (!notes.length) return 0;
    this.change(() => {
      for (const item of notes) {
        const start = snapToGrid(this.time(item), step, origin);
        const hold = item.data.endTimeSeconds !== undefined || item.data.endBeat !== undefined;
        const end = hold ? Math.max(start + step, snapToGrid(this.endTime(item), step, origin)) : null;
        this.setTime(item, start);
        if (hold) this.setEndTime(item, end);
      }
    });
    return notes.length;
  }
  removeMany(ids) {
    const selected = new Set(ids);
    this.change(() => {
      this.notes = this.notes.filter(item => !selected.has(item.id));
      this.events = this.events.filter(item => !selected.has(item.id));
      this.svs = this.svs.filter(item => !selected.has(item.id));
    });
  }
  remove(id) { this.removeMany([id]); }
  duplicateMany(ids, step) {
    if (!Number.isFinite(step)) throw new Error('複製の移動量には有限の数値を指定してください。');
    const items = new Map(this.items.map(item => [item.id, item]));
    const originals = [...new Set(ids)].map(id => items.get(id)).filter(Boolean);
    if (!originals.length) return [];
    const result = [];
    this.change(() => {
      for (const original of originals) {
        const copy = clone(original);
        copy.id = `item-${this.nextId++}`;
        this.setTime(copy, this.time(original) + step);
        this[collection(copy.kind)].push(copy);
        result.push(copy.id);
      }
    });
    return result;
  }
  duplicate(id, step) { return this.duplicateMany([id], step)[0] ?? null; }
  undo() { if (!this.past.length) return; this.future.push(this.snapshot()); this.restore(this.past.pop()); }
  redo() { if (!this.future.length) return; this.past.push(this.snapshot()); this.restore(this.future.pop()); }

  fitFade(item) {
    if (item.kind !== 'event' || item.data.type === 'noteSkin') return;
    const duration = this.duration(item);
    const soft = ['screenFade', 'backgroundStars', 'backgroundGLB', 'backgroundScene'].includes(item.data.type);
    const defaults = soft ? Math.min(item.data.type === 'screenFade' ? 0.25 : 0.5, duration / 2) : 0;
    const fadeIn = item.data.fadeInSeconds ?? defaults;
    const fadeOut = item.data.fadeOutSeconds ?? (soft ? defaults : duration);
    if (fadeIn + fadeOut > duration) {
      const ratio = duration / (fadeIn + fadeOut);
      item.data.fadeInSeconds = fadeIn * ratio;
      item.data.fadeOutSeconds = Math.max(0, duration - item.data.fadeInSeconds);
    }
  }
}
