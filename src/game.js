import { CONFIG, JUDGEMENTS, holdCompletionTime } from './config.js';
import { clearStatusForScore } from './clear-status.js';

const TIME_EPSILON = 1e-9;

// 描画・入力機器から独立した判定処理。すべての時刻は楽曲開始からの秒数。
export class RhythmGame extends EventTarget {
  constructor(chart, audio, settings) {
    super();
    this.chart = chart;
    this.audio = audio;
    this.settings = settings;
    this.state = 'idle';
    this.anchor = null;
    this.busy = false;
    this.reset();
  }

  get songTime() {
    return this.anchor === null ? -CONFIG.countInSeconds : this.audio.now - this.anchor;
  }

  get accuracy() {
    return this.judgedCount ? this.weightSum / this.judgedCount * 100 : 100;
  }

  get baseScore() { return this.notes.length ? Math.round(this.weightSum / this.notes.length * CONFIG.baseScore) : 0; }
  get bonusScore() { return this.counts.perfectPlus; }
  get score() { return this.baseScore + this.bonusScore; }
  get clearStatus() { return clearStatusForScore(this.score); }
  get bonusAccuracy() { return this.notes.length ? this.counts.perfectPlus / this.notes.length * 10 : 0; }

  get grade() {
    return this.accuracy >= 98 ? 'S' : this.accuracy >= 90 ? 'A' : this.accuracy >= 80 ? 'B' : this.accuracy >= 70 ? 'C' : 'D';
  }

  emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  reset() {
    // プレイ途中の設定変更で自動・手動が混ざらないよう、開始時の設定を保持する。
    this.autoplay = Boolean(this.settings.autoplay);
    this.autoCursor = 0;
    this.notes = this.chart.notes.map(note => ({ ...note, judged: false, started: false }));
    this.activeHolds = new Set();
    this.heldSources = new Map();
    this.lanes = Array.from({ length: 4 }, (_, lane) => this.notes.filter(note => note.lane === lane));
    this.laneCursors = new Uint32Array(4);
    this.missCursor = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.judgedCount = 0;
    this.weightSum = 0;
    this.counts = Object.fromEntries(Object.keys(JUDGEMENTS).map(rating => [rating, 0]));
    this.emit('stats');
  }

  setChart(chart) {
    if (this.busy || this.state === 'playing') throw new Error('曲を変える前に一時停止してください。');
    this.audio.stop(true);
    this.chart = chart;
    this.anchor = null;
    this.state = 'idle';
    this.reset();
    this.emit('chartchange');
    this.emit('statechange');
  }

  async start() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.audio.prepare(this.chart);
      await this.audio.resume();
      this.audio.stop();
      this.reset();
      this.anchor = this.audio.now + CONFIG.countInSeconds;
      this.audio.play(this.chart, this.anchor);
      this.state = 'playing';
      this.emit('statechange');
    } finally {
      this.busy = false;
    }
  }

  async pause() {
    if (this.busy || this.state !== 'playing') return;
    this.busy = true;
    try {
      await this.audio.pause();
      this.state = 'paused';
      this.emit('statechange');
    } finally {
      this.busy = false;
    }
  }

  async resume() {
    if (this.busy || this.state !== 'paused') return;
    this.busy = true;
    try {
      await this.audio.resume();
      const time = this.songTime - this.settings.offset / 1000;
      for (const note of this.activeHolds) {
        if (note.holdSource === 'autoplay') continue;
        note.holdGraceUntil = time + CONFIG.hold.resumeGraceSeconds;
        note.releaseTime = time;
        note.awaitingResume = true;
      }
      this.state = 'playing';
      this.emit('statechange');
    } finally {
      this.busy = false;
    }
  }

  async exit() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.audio.pause();
      this.audio.stop();
      this.anchor = null;
      this.state = 'idle';
      this.reset();
      this.emit('statechange');
    } finally {
      this.busy = false;
    }
  }

  async toggle() {
    if (this.state === 'playing') return this.pause();
    if (this.state === 'paused') return this.resume();
    return this.start();
  }

  hit(lane, rawTime = this.songTime, source = 'keyboard') {
    if (this.state !== 'playing' || this.busy || this.autoplay || !this.lanes[lane]) return null;
    // 正のオフセットは入力時刻を過去に補正する。
    const time = rawTime - this.settings.offset / 1000;
    let candidate = null;
    let distance = Infinity;
    const notes = this.lanes[lane];
    // 終了済みの始点を毎入力走査し直さず、長い曲の後半でも同じ範囲だけ調べる。
    let cursor = this.laneCursors[lane];
    while (cursor < notes.length && (notes[cursor].judged || notes[cursor].started)) cursor++;
    this.laneCursors[lane] = cursor;
    for (let index = cursor; index < notes.length; index++) {
      const note = notes[index];
      if (note.judged || note.started) continue;
      if (note.time > time + CONFIG.windows.good + TIME_EPSILON) break;
      const difference = Math.abs(time - note.time);
      if (difference <= CONFIG.windows.good + TIME_EPSILON && difference < distance) {
        candidate = note;
        distance = difference;
      }
    }
    if (!candidate) return null;
    const rating = distance <= CONFIG.windows.perfectPlus + TIME_EPSILON ? 'perfectPlus'
      : distance <= CONFIG.windows.perfect + TIME_EPSILON ? 'perfect'
        : distance <= CONFIG.windows.great + TIME_EPSILON ? 'great' : 'good';
    this.startNote(candidate, rating, (time - candidate.time) * 1000, source, time);
    return rating;
  }

  startNote(note, rating, deltaMs, source, time) {
    if (note.endTime !== null && note.endTime !== undefined) {
      note.started = true;
      note.headRating = rating;
      note.headDelta = deltaMs;
      note.holdSource = source;
      note.holdStartTime = time;
      note.releaseTime = null;
      note.holdGraceUntil = time + (source === 'keyboard' ? 0 : CONFIG.hold.trackingGraceSeconds);
      this.activeHolds.add(note);
      this.emit('holdstart', { note, rating, deltaMs, source });
    } else this.judge(note, rating, deltaMs, source);
  }

  updateAutoplay(time) {
    // 跨いだ全ノーツを譜面の正確な時刻で処理し、フレーム落ちで判定を遅らせない。
    while (this.autoCursor < this.notes.length && this.notes[this.autoCursor].time <= time) {
      const note = this.notes[this.autoCursor++];
      if (!note.judged && !note.started) this.startNote(note, 'perfectPlus', 0, 'autoplay', note.time);
    }
  }

  setHeld(lane, held, source = 'keyboard', rawTime = this.songTime) {
    if (this.autoplay) return;
    let input = this.heldSources.get(source);
    if (!input) {
      input = { held: new Uint8Array(4), released: new Float64Array(4).fill(-Infinity) };
      this.heldSources.set(source, input);
    }
    const changed = Boolean(input.held[lane]) !== Boolean(held);
    const released = input.held[lane] && !held;
    if (released) input.released[lane] = rawTime - this.settings.offset / 1000;
    input.held[lane] = Number(held);
    // キーを離してすぐ押し直しても、フレームの間でLNの切断が消えないようにする。
    if (released && source === 'keyboard' && this.state === 'playing' && !this.busy) this.updateHolds(input.released[lane]);
    if (changed) this.emit('holdinput');
  }

  releaseSource(source) { for (let lane = 0; lane < 4; lane++) this.setHeld(lane, false, source); }
  held(lane) {
    if (this.autoplay) {
      for (const note of this.activeHolds) if (note.lane === lane) return true;
    } else {
      for (const input of this.heldSources.values()) if (input.held[lane]) return true;
    }
    return false;
  }

  updateHolds(time) {
    for (const note of this.activeHolds) {
      const completeTime = holdCompletionTime(note);
      if (note.holdSource === 'autoplay') {
        if (time >= completeTime) this.judge(note, note.headRating, note.headDelta, 'autoplay');
        continue;
      }
      const input = this.heldSources.get(note.holdSource);
      if (input?.held[note.lane]) {
        note.releaseTime = null;
        note.awaitingResume = false;
        // 終点100ms前まで維持できれば完了。離す時刻による精度判定はしない。
        if (time >= completeTime) this.judge(note, note.headRating, note.headDelta, note.holdSource);
        continue;
      }
      note.releaseTime ??= Math.max(note.holdStartTime, input?.released[note.lane] ?? time);
      // 復帰猶予中は再び押すまで待ち、停止時刻だけで成功にしない。
      if (note.awaitingResume) {
        if (time >= note.holdGraceUntil) this.judge(note, 'miss');
        continue;
      }
      // フレーム間で離した場合も、実際の入力時刻が完了時刻を過ぎていれば成功。
      if (note.releaseTime >= completeTime) {
        this.judge(note, note.headRating, note.headDelta, note.holdSource);
        continue;
      }
      if (time < note.holdGraceUntil) continue;
      if (note.holdSource === 'keyboard' || time - note.releaseTime >= CONFIG.hold.trackingGraceSeconds) {
        this.judge(note, 'miss');
      }
    }
  }

  judge(note, rating, deltaMs = null, source = 'timeout') {
    if (note.judged) return;
    note.judged = true;
    this.activeHolds.delete(note);
    this.counts[rating]++;
    this.judgedCount++;
    this.weightSum += CONFIG.weights[rating];
    this.combo = rating === 'miss' ? 0 : this.combo + 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.emit('judgement', { note, rating, deltaMs, source });
    this.emit('stats');
  }

  update() {
    if (this.state !== 'playing' || this.busy) return;
    this.audio.update();
    const time = this.songTime;
    if (this.autoplay) this.updateAutoplay(time);
    this.updateHolds(this.autoplay ? time : time - this.settings.offset / 1000);
    // 正オフセット分だけMISS確定も遅らせ、補正済み入力の猶予を残す。
    const deadline = time - CONFIG.windows.good - Math.max(0, this.settings.offset / 1000);
    while (this.missCursor < this.notes.length && this.notes[this.missCursor].time < deadline) {
      const note = this.notes[this.missCursor++];
      if (!note.judged && !note.started) this.judge(note, 'miss');
    }
    // 音声を遅らせた分の末尾まで再生してからリザルトに移る。
    const finishTime = this.chart.duration + Math.max(0, (this.settings.audioOffset ?? 0) / 1000);
    if (time >= finishTime) {
      for (const note of this.notes) if (!note.judged) this.judge(note, 'miss');
      this.audio.stop();
      this.state = 'finished';
      this.emit('statechange');
    }
  }
}
