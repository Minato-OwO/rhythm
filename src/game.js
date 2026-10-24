import { CONFIG, JUDGEMENTS, holdAssistTime, holdCompletionTime } from './config.js';
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
    return this.anchor === null ? -CONFIG.countInSeconds + this.audioOffsetSeconds : this.audio.now - this.anchor;
  }

  get audioOffsetSeconds() { return this.audio.offsetSeconds ?? (this.settings.audioOffset ?? 0) / 1000; }
  get duration() { return this.finishTime; }

  countdownRemainingAt(time = this.songTime) {
    if (this.countdownPending) return CONFIG.countInSeconds;
    const remaining = this.audioOffsetSeconds - time;
    return remaining > TIME_EPSILON ? remaining : 0;
  }

  get accuracy() {
    return this.judgedCount ? this.weightSum / this.judgedCount * 100 : 100;
  }

  get totalNotes() { return this.playableNotes.length; }
  get baseScore() { return this.totalNotes ? Math.round(this.weightSum / this.totalNotes * CONFIG.baseScore) : 0; }
  get bonusScore() { return this.counts.perfectPlus; }
  get score() { return this.baseScore + this.bonusScore; }
  get clearStatus() { return clearStatusForScore(this.score); }
  get bonusAccuracy() { return this.totalNotes ? this.counts.perfectPlus / this.totalNotes * 10 : 0; }

  get grade() {
    return this.accuracy >= 98 ? 'S' : this.accuracy >= 90 ? 'A' : this.accuracy >= 80 ? 'B' : this.accuracy >= 70 ? 'C' : 'D';
  }

  emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  reset() {
    this.countdownPending = false;
    this.countdownDeferred = false;
    // プレイ途中の設定変更で自動・手動が混ざらないよう、開始時の設定を保持する。
    this.autoplay = Boolean(this.settings.autoplay);
    this.autoCursor = 0;
    this.notes = this.chart.notes.map(note => ({ ...note, judged: false, started: false, autoHeld: false }));
    // フェイクも描画用配列に残す。判定・オート・MISS走査は実ノーツだけを参照する。
    this.playableNotes = this.notes.filter(note => !note.fake);
    let lastNoteEnd = null;
    for (const note of this.playableNotes) lastNoteEnd = Math.max(lastNoteEnd ?? 0, note.endTime ?? note.time);
    this.finishTime = lastNoteEnd !== null && Number.isFinite(this.chart.bpm) && this.chart.bpm > 0
      ? lastNoteEnd + CONFIG.resultDelayBeats * 60 / this.chart.bpm : this.chart.duration;
    this.activeHolds = new Set();
    this.heldSources = new Map();
    this.lanes = Array.from({ length: 4 }, (_, lane) => this.playableNotes.filter(note => note.lane === lane));
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

  async start({ deferCountdown = false } = {}) {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.audio.prepare(this.chart);
      await this.audio.resume();
      this.audio.stop();
      this.reset();
      this.anchor = null;
      this.countdownPending = true;
      this.countdownDeferred = deferCountdown;
      this.state = 'playing';
      if (!deferCountdown) this.beginCountdown();
      this.emit('statechange');
    } finally {
      this.busy = false;
    }
  }

  beginCountdown() {
    if (!this.countdownPending) return false;
    this.countdownDeferred = false;
    if (this.state !== 'playing') return false;
    this.countdownPending = false;
    // 3秒後を音源の0秒にする。先頭ノーツや譜面オフセットで音源をシークしない。
    this.anchor = this.audio.now + CONFIG.countInSeconds - this.audioOffsetSeconds;
    this.audio.play(this.chart, this.anchor);
    this.emit('countdownstart');
    return true;
  }

  async pause() {
    if (this.busy || this.state !== 'playing') return;
    this.busy = true;
    try {
      const time = this.songTime - (this.autoplay ? 0 : this.settings.offset / 1000);
      for (const note of this.activeHolds) {
        if (this.heldSources.get(note.holdSource)?.held[note.lane] && time + TIME_EPSILON >= holdAssistTime(note)) note.autoHeld = true;
      }
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
        if (note.holdSource === 'autoplay' || note.autoHeld) continue;
        note.holdGraceUntil = time + CONFIG.hold.resumeGraceSeconds;
        note.releaseTime = time;
        note.awaitingResume = true;
      }
      this.state = 'playing';
      if (this.countdownPending && !this.countdownDeferred) this.beginCountdown();
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
    if (this.state !== 'playing' || this.busy || this.countdownPending || this.autoplay || !this.lanes[lane]) return null;
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
    if (note.fake) return;
    if (note.endTime !== null && note.endTime !== undefined) {
      note.started = true;
      note.headRating = rating;
      note.headDelta = deltaMs;
      note.holdSource = source;
      note.holdStartTime = time;
      note.autoHeld = source === 'autoplay' || time + TIME_EPSILON >= holdAssistTime(note);
      note.awaitingResume = false;
      note.releaseTime = null;
      note.holdGraceUntil = time + (source === 'keyboard' ? 0 : CONFIG.hold.trackingGraceSeconds);
      this.activeHolds.add(note);
      this.emit('holdstart', { note, rating, deltaMs, source });
    } else this.judge(note, rating, deltaMs, source);
  }

  updateAutoplay(time) {
    // 跨いだ全ノーツを譜面の正確な時刻で処理し、フレーム落ちで判定を遅らせない。
    while (this.autoCursor < this.playableNotes.length && this.playableNotes[this.autoCursor].time <= time) {
      const note = this.playableNotes[this.autoCursor++];
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
    if (released && this.state === 'playing' && !this.busy) this.updateHolds(input.released[lane], rawTime);
    if (changed) this.emit('holdinput');
  }

  releaseSource(source) { for (let lane = 0; lane < 4; lane++) this.setHeld(lane, false, source); }
  held(lane) {
    for (const note of this.activeHolds) if (note.lane === lane && (note.autoHeld || this.autoplay)) return true;
    if (!this.autoplay) {
      for (const input of this.heldSources.values()) if (input.held[lane]) return true;
    }
    return false;
  }

  updateHolds(time, songTime = time) {
    for (const note of this.activeHolds) {
      const completeTime = holdCompletionTime(note);
      const assistTime = holdAssistTime(note);
      if (note.autoHeld || note.holdSource === 'autoplay') {
        // 成功条件を満たしても、表示・保持音・加点は譜面の実際の終点まで維持する。
        if (songTime >= completeTime) this.judge(note, note.headRating, note.headDelta, note.holdSource);
        continue;
      }
      const input = this.heldSources.get(note.holdSource);
      if (input?.held[note.lane]) {
        note.releaseTime = null;
        note.awaitingResume = false;
        if (time + TIME_EPSILON >= assistTime || songTime >= completeTime) note.autoHeld = true;
        // 入力オフセットを、表示と保持音が終了する譜面時刻には加えない。
        if (songTime >= completeTime) this.judge(note, note.headRating, note.headDelta, note.holdSource);
        continue;
      }
      note.releaseTime ??= Math.max(note.holdStartTime, input?.released[note.lane] ?? time);
      // 復帰猶予中は再び押すまで待ち、停止時刻だけで成功にしない。
      if (note.awaitingResume) {
        if (time >= note.holdGraceUntil) this.judge(note, 'miss');
        continue;
      }
      // フレーム間で100ms前を跨いで離しても、入力時刻から自動保持へ移行する。
      if (note.releaseTime + TIME_EPSILON >= assistTime) {
        note.autoHeld = true;
        if (songTime >= completeTime) this.judge(note, note.headRating, note.headDelta, note.holdSource);
        continue;
      }
      if (time < note.holdGraceUntil) continue;
      if (note.holdSource === 'keyboard' || time - note.releaseTime >= CONFIG.hold.trackingGraceSeconds) {
        this.judge(note, 'miss');
      }
    }
  }

  judge(note, rating, deltaMs = null, source = 'timeout') {
    if (note.fake || note.judged) return;
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
    if (this.state !== 'playing' || this.busy || this.countdownPending) return;
    this.audio.update();
    const time = this.songTime;
    if (this.autoplay) this.updateAutoplay(time);
    this.updateHolds(this.autoplay ? time : time - this.settings.offset / 1000, time);
    // 正オフセット分だけMISS確定も遅らせ、補正済み入力の猶予を残す。
    const deadline = time - CONFIG.windows.good - Math.max(0, this.settings.offset / 1000);
    while (this.missCursor < this.playableNotes.length && this.playableNotes[this.missCursor].time < deadline) {
      const note = this.playableNotes[this.missCursor++];
      if (!note.judged && !note.started) this.judge(note, 'miss');
    }
    // 最後の判定対象ノーツ（LNは終点）の譜面時刻から6拍後に終了する。
    if (time + TIME_EPSILON >= this.finishTime) {
      for (const note of this.playableNotes) if (!note.judged) this.judge(note, 'miss');
      this.audio.stop();
      this.state = 'finished';
      this.emit('statechange');
    }
  }
}
