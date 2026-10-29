import { AudioFrameClock } from '../../../src/frame-clock.js';

export class AudioManager {
  constructor(now) {
    this.audioContext = null;
    this.audioBuffer = null;
    this.source = null;
    this.isPlaying = false;
    this.pauseTime = 0;
    this.duration = 60;
    this.operation = 0;
    this.frameClock = new AudioFrameClock({
      time: () => this.getAudioTime(),
      playing: () => this.isPlaying,
      context: () => this.audioContext,
      anchor: () => this.operation,
    }, now);
  }
  init() {
    if (this.audioContext) return;
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.frameClock.synchronize();
  }
  async loadFromBuffer(arrayBuffer) {
    this.init();
    const decoded = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
    this.pause();
    this.audioBuffer = decoded;
    this.pauseTime = 0;
  }
  clear() { this.pause(); this.audioBuffer = null; this.pauseTime = 0; }
  getDuration() { return this.duration; }
  getAudioTime() {
    return this.isPlaying ? this.audioContext.currentTime - this.startTime : this.pauseTime;
  }
  getCurrentTime(frameTime) {
    return Math.max(0, Math.min(this.duration, this.frameClock.sample(frameTime)));
  }
  async play() {
    if (this.isPlaying) return;
    this.init();
    const operation = ++this.operation;
    await this.audioContext.resume();
    if (operation !== this.operation) return;
    if (this.audioContext.state !== 'running') throw new Error('音声を開始できません。もう一度再生してください。');
    if (this.pauseTime >= this.duration) this.pauseTime = 0;
    const start = this.audioContext.currentTime;
    if (this.audioBuffer && this.pauseTime < this.audioBuffer.duration) {
      const source = this.audioContext.createBufferSource();
      source.buffer = this.audioBuffer;
      source.connect(this.audioContext.destination);
      source.onended = () => { source.disconnect(); if (this.source === source) this.source = null; };
      source.start(start, this.pauseTime);
      this.source = source;
    }
    this.startTime = start - this.pauseTime;
    this.isPlaying = true;
    this.frameClock.synchronize();
  }
  pause() {
    this.operation++;
    // スリープ中に進んだ表示時計を停止位置として保存しない。
    this.pauseTime = Math.max(0, Math.min(this.duration, this.getAudioTime()));
    this.isPlaying = false;
    this.frameClock.synchronize();
    if (this.source) { this.source.stop(); this.source.disconnect(); this.source = null; }
  }
  async seekTo(seconds) {
    const playing = this.isPlaying;
    this.pause();
    this.pauseTime = Math.max(0, Math.min(seconds, this.duration));
    if (playing) await this.play();
  }
  playMetronomeTick(strong, volume, time) {
    if (!this.audioContext || volume <= 0) return;
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    oscillator.frequency.value = strong ? 1760 : 880;
    gain.gain.setValueAtTime(volume * 0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    oscillator.connect(gain).connect(this.audioContext.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(time);
    oscillator.stop(time + 0.05);
  }
}
