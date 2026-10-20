import { DEFAULT_SETTINGS } from './config.js';

// 10秒の反復再生で測定したラウドネス差を補正。通常ヒット -26.55 LUFS / LN -13.05 LUFS。
export const HOLD_SOUND_GAIN_DB = -13.50;
// 素材自体の音量が低いため、SE共通の基準ゲインを上げる。保存済みの音量設定にも適用する。
export const HIT_SOUND_GAIN_DB = 12;
const HIT_SOUND_GAIN = 10 ** (HIT_SOUND_GAIN_DB / 20);

// Web AudioのcurrentTimeを音源再生・判定の時計にする。表示時計はframe-clock.jsで同期する。
export class AudioTransport {
  constructor() {
    this.context = null;
    this.nodes = new Set();
    this.volume = DEFAULT_SETTINGS.volume / 100;
    this.hitVolume = DEFAULT_SETTINGS.hitVolume / 100;
    this.hitNodes = new Set();
    this.hitBuffer = null;
    this.hitSoundPromise = null;
    this.holdBuffer = null;
    this.holdSoundPromise = null;
    this.holdSource = null;
    this.hitSoundGame = null;
    this.onHitEnded = event => {
      const source = event.target;
      this.hitNodes.delete(source);
      source.disconnect();
    };
    this.offsetSeconds = 0;
    this.chart = null;
    this.buffer = null;
    this.preparedUrl = null;
    this.active = false;
  }

  get now() {
    return this.context?.currentTime ?? 0;
  }

  ensureContext() {
    if (this.context) return;
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) throw new Error('このブラウザーはWeb Audioに対応していません。');
    this.context = new Context({ latencyHint: 'interactive' });
    this.master = this.context.createGain();
    this.master.gain.value = this.volume;
    const limiter = this.context.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 8;
    limiter.ratio.value = 12;
    this.master.connect(limiter).connect(this.context.destination);
    // 曲の音量とは独立した経路。ヒットごとのGainNode生成は不要。
    this.hitGain = this.context.createGain();
    this.hitGain.gain.value = this.hitVolume * HIT_SOUND_GAIN;
    this.hitGain.connect(limiter);
    this.holdGain = this.context.createGain();
    this.holdGain.gain.value = 10 ** (HOLD_SOUND_GAIN_DB / 20);
    this.holdGain.connect(this.hitGain);
    this.noiseBuffer = this.context.createBuffer(1, this.context.sampleRate * 0.25, this.context.sampleRate);
    const noise = this.noiseBuffer.getChannelData(0);
    for (let index = 0; index < noise.length; index++) noise[index] = Math.random() * 2 - 1;
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.now, 0.02);
  }

  setHitVolume(value) {
    if (!Number.isFinite(value)) return;
    this.hitVolume = Math.max(0, Math.min(1, value));
    if (this.hitGain) this.hitGain.gain.setTargetAtTime(this.hitVolume * HIT_SOUND_GAIN, this.now, 0.02);
    this.syncHoldSound();
  }

  prepareHitSound() {
    return this.prepareEffect('hit_se.mp3', 'hitBuffer', 'hitSoundPromise', 'ヒットSE');
  }

  prepareHoldSound() {
    return this.prepareEffect('LNLN.mp3', 'holdBuffer', 'holdSoundPromise', 'LNの音');
  }

  async prepareEffect(filename, bufferKey, promiseKey, label) {
    this.ensureContext();
    if (this[bufferKey]) return;
    if (!this[promiseKey]) {
      this[promiseKey] = (async () => {
        const response = await fetch(new URL('../assets/' + filename, import.meta.url));
        if (!response.ok) throw new Error(`${label}を読み込めませんでした (${response.status})。`);
        this[bufferKey] = await this.context.decodeAudioData(await response.arrayBuffer());
      })().catch(error => {
        this[promiseKey] = null;
        throw error;
      });
    }
    await this[promiseKey];
  }

  playHitSound() {
    if (!this.hitBuffer || this.hitVolume === 0 || this.context?.state !== 'running') return;
    // AudioBufferSourceNodeは1回限り。音源のデコード・音量ノード・終了処理は共有する。
    const source = this.context.createBufferSource();
    source.buffer = this.hitBuffer;
    source.connect(this.hitGain);
    source.onended = this.onHitEnded;
    this.hitNodes.add(source);
    source.start();
  }

  syncHoldSound(game = this.hitSoundGame) {
    let held = false;
    if (this.holdBuffer && this.hitVolume > 0 && this.context?.state === 'running' && game?.state === 'playing') {
      for (const note of game.activeHolds) {
        if (note.holdSource === 'autoplay' || game.heldSources.get(note.holdSource)?.held[note.lane]) {
          held = true;
          break;
        }
      }
    }
    if (!held) { this.stopHoldSound(); return; }
    // 複数LNを同時に保持してもループは1本。二重再生による音量増加や毎フレームの生成を防ぐ。
    if (this.holdSource) return;
    const source = this.context.createBufferSource();
    source.buffer = this.holdBuffer;
    source.loop = true;
    source.connect(this.holdGain);
    this.holdSource = source;
    source.start();
  }

  stopHoldSound() {
    const source = this.holdSource;
    if (!source) return;
    this.holdSource = null;
    try { source.stop(); } catch { /* 終了済みでも解放する。 */ }
    source.disconnect();
  }

  stopHitSounds() {
    this.stopHoldSound();
    for (const source of this.hitNodes) {
      source.onended = null;
      try { source.stop(); } catch { /* 終了済みでも解放する。 */ }
      source.disconnect();
    }
    this.hitNodes.clear();
  }

  attachHitSounds(game) {
    this.hitSoundGame = game;
    const hit = ({ detail }) => {
      // LNはholdstartで鳴らし、終点での成功判定では重ねて鳴らさない。
      if (detail.rating !== 'miss' && detail.note.endTime == null) this.playHitSound();
      this.syncHoldSound(game);
    };
    const hold = () => { this.playHitSound(); this.syncHoldSound(game); };
    const state = () => this.syncHoldSound(game);
    game.addEventListener('judgement', hit);
    game.addEventListener('holdstart', hold);
    game.addEventListener('statechange', state);
    game.addEventListener('holdinput', state);
    return () => {
      game.removeEventListener('judgement', hit);
      game.removeEventListener('holdstart', hold);
      game.removeEventListener('statechange', state);
      game.removeEventListener('holdinput', state);
      if (this.hitSoundGame === game) {
        this.hitSoundGame = null;
        this.stopHoldSound();
      }
    };
  }

  setAudioOffset(milliseconds) {
    if (!Number.isFinite(milliseconds)) return;
    const seconds = milliseconds / 1000;
    if (seconds === this.offsetSeconds) return;
    this.offsetSeconds = seconds;
    if (!this.active) return;
    // 一時停止中の変更も、譜面の時計と停止状態を維持して音源だけを置き直す。
    const chart = this.chart;
    const chartAnchor = this.chartAnchor;
    this.stop();
    this.play(chart, chartAnchor);
  }

  async prepare(chart) {
    this.ensureContext();
    // 最初のresumeをクリックの呼び出し経路で行う。
    await this.resume();
    await Promise.all([this.prepareHitSound(), this.prepareHoldSound()]);
    if (!chart.audioUrl) {
      this.buffer = null;
      this.preparedUrl = null;
      return;
    }
    const url = new URL(chart.audioUrl, document.baseURI).href;
    if (url === this.preparedUrl && this.buffer) return;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`音源を読み込めませんでした (${response.status}): ${new URL(url).pathname}`);
    this.buffer = await this.context.decodeAudioData(await response.arrayBuffer());
    this.preparedUrl = url;
  }

  async resume() {
    this.ensureContext();
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('音声を開始できません。もう一度スタートを押してください。');
  }

  async pause() {
    // 一時停止したSEの残響を、再開時に持ち越さない。
    this.stopHitSounds();
    // デバイス中断中も明示的に停止し、復帰時に音源だけが勝手に再開しないようにする。
    if (this.context && !['suspended', 'closed'].includes(this.context.state)) await this.context.suspend();
  }

  keep(node, cleanup = () => {}) {
    this.nodes.add(node);
    node.onended = () => {
      this.nodes.delete(node);
      node.disconnect();
      cleanup();
    };
    return node;
  }

  play(chart, anchor) {
    this.chart = chart;
    this.chartAnchor = anchor;
    // 正の値で音声を遅らせる。判定・表示に使うゲーム側のanchorは変更しない。
    this.anchor = anchor + this.offsetSeconds;
    const now = this.now;
    const elapsed = Math.max(0, now - this.anchor);
    this.step = Math.max(0, Math.ceil(elapsed / (30 / chart.bpm)));
    let low = 0;
    let high = chart.notes.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (chart.notes[middle].time < elapsed) low = middle + 1;
      else high = middle;
    }
    this.noteCursor = low;
    this.active = true;
    if (this.buffer) {
      if (elapsed >= this.buffer.duration) return;
      const source = this.keep(this.context.createBufferSource());
      source.buffer = this.buffer;
      source.connect(this.master);
      source.start(Math.max(now, this.anchor), elapsed);
    }
  }

  stop(clearBuffer = false) {
    this.active = false;
    this.stopHitSounds();
    for (const node of this.nodes) {
      try { node.stop(); } catch { /* 終了済みのAudioScheduledSourceNode。 */ }
    }
    this.nodes.clear();
    if (clearBuffer) { this.buffer = null; this.preparedUrl = null; }
  }

  tone(frequency, time, duration, level, type = 'sine', endFrequency = null) {
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    this.keep(oscillator, () => envelope.disconnect());
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, time + duration);
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.linearRampToValueAtTime(level, time + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(envelope).connect(this.master);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.01);
  }

  noise(time, duration, level, highpass) {
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    this.keep(source, () => { filter.disconnect(); envelope.disconnect(); });
    source.buffer = this.noiseBuffer;
    filter.type = 'highpass';
    filter.frequency.value = highpass;
    envelope.gain.setValueAtTime(level, time);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter).connect(envelope).connect(this.master);
    source.start(time);
    source.stop(time + duration);
  }

  update() {
    // VRで保持の猶予が残っていても、コントローラーを離したフレームから音は止める。
    this.syncHoldSound();
    if (!this.active || this.buffer || this.context.state !== 'running') return;
    const horizon = this.now + 0.16;
    const stepDuration = 30 / this.chart.bpm;
    while (this.anchor + this.step * stepDuration < horizon) {
      const songTime = this.step * stepDuration;
      const scheduled = this.anchor + songTime;
      if (songTime >= this.chart.duration - 1) break;
      if (scheduled >= this.now - 0.025) {
        const time = Math.max(this.now, scheduled);
        this.noise(time, 0.035, this.step % 2 ? 0.025 : 0.045, 6500);
        if (this.step % 2 === 0) this.tone(145, time, 0.16, 0.32, 'sine', 42);
        if (this.step % 4 === 2) this.noise(time, 0.13, 0.1, 1300);
        if (this.step % 4 === 0) {
          const bass = [65.406, 55, 73.416, 49][Math.floor(this.step / 8) % 4];
          this.tone(bass, time, stepDuration * 1.8, 0.09, 'triangle');
        }
      }
      this.step++;
    }
    while (this.noteCursor < this.chart.notes.length) {
      const note = this.chart.notes[this.noteCursor];
      const scheduled = this.anchor + note.time;
      if (scheduled >= horizon) break;
      if (scheduled >= this.now - 0.025) {
        this.tone([261.626, 329.628, 391.995, 523.251][note.lane], Math.max(this.now, scheduled), 0.17, 0.065, 'triangle');
      }
      this.noteCursor++;
    }
  }
}
