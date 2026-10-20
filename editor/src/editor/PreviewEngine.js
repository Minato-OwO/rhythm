import { AudioManager } from './AudioManager.js';
import { assetPath } from './ProjectFiles.js';
import { createPreviewClock } from './PreviewClock.js';

export class PreviewEngine {
  constructor(iframe) {
    this.iframe = iframe;
    this.audioManager = new AudioManager();
    this.chart = null;
    this.ready = false;
    this.revision = 0;
    this.clock = createPreviewClock(this.audioManager, () => this.revision);
    this.frameState = {};
    iframe.fourFlowClock = this.clock;
    this.playRequest = 0;
    this.prepared = Promise.resolve();
    this.modelAssets = new Map();
    this.modelURLs = new Map();
    this.metronomeEnabled = false;
    this.metronomeVolume = 0.5;
    this.lastScheduledBeat = null;
    this.onTimeUpdate = () => {};
    this.onStateChange = () => {};
    this.onError = () => {};
    this.onKey = () => {};
    this.message = event => {
      if (event.origin !== location.origin || event.source !== iframe.contentWindow || event.data?.channel !== 'four-flow-preview') return;
      const data = event.data;
      if (data.type === 'ready') { this.previewError = null; this.ready = true; this.syncChart(); this.transport(); }
      if (data.type === 'prepared' && data.revision === this.revision) this.pending?.resolve();
      if (data.type === 'error') {
        if (data.revision !== undefined && data.revision !== this.revision) return;
        const error = new Error(data.message);
        if (data.revision === undefined) this.previewError = error;
        this.pending?.reject(error);
        this.onError(error);
      }
      if (data.type === 'key') this.onKey(data);
    };
    window.addEventListener('message', this.message);
    this.frame = () => {
      if (this.isPlaying && this.audioManager.audioContext.state !== 'running') this.pause();
      const time = this.clock.sample(this.frameState).time;
      this.onTimeUpdate(time * 1000);
      if (this.isPlaying) {
        this.scheduleMetronome(time);
        if (time >= this.audioManager.duration) this.pause();
      }
      this.frameId = requestAnimationFrame(this.frame);
    };
    this.frameId = requestAnimationFrame(this.frame);
    iframe.src = new URL('./preview.html', document.baseURI).href;
  }
  get isPlaying() { return this.audioManager.isPlaying; }
  send(type, detail = {}) { if (this.ready) this.iframe.contentWindow.postMessage({ channel: 'four-flow-preview', type, ...detail }, location.origin); }
  setModelAssets(assets = new Map()) {
    this.modelAssets = assets;
    for (const [path, record] of this.modelURLs) {
      if (assets.get(path)?.file === record.file) continue;
      URL.revokeObjectURL(record.url);
      this.modelURLs.delete(path);
    }
  }
  modelURL(src) {
    const path = assetPath(src);
    const asset = this.modelAssets.get(path);
    if (!asset) throw new Error('背景GLBがありません: ' + path + '。「GLBを追加」から読み込んでください。');
    if (!asset.file) return asset.url;
    let record = this.modelURLs.get(path);
    if (!record) { record = { file: asset.file, url: URL.createObjectURL(asset.file) }; this.modelURLs.set(path, record); }
    return record.url;
  }
  loadChart(chart) {
    // プレビューだけURLへ変換する。保存するJSONには相対ファイル名を残す。
    const events = chart.events.map(event => {
      if (event.type === 'backgroundGLB' && event.src) return { ...event, src: this.modelURL(event.src) };
      if (event.type === 'backgroundScene' && event.src) {
        if (!this.sceneBaseURL && !/^(?:https?:)?\/\//i.test(event.src) && !event.src.startsWith('/')) throw new Error('背景JSをプレビューするには「ゲームの曲」から曲を開いてください。');
        return { ...event, src: new URL(event.src, this.sceneBaseURL ?? document.baseURI).href };
      }
      return event;
    });
    this.chart = { ...chart, events };
    this.audioManager.duration = chart.duration;
    if (this.audioManager.pauseTime > chart.duration) this.audioManager.pauseTime = chart.duration;
    this.pending?.resolve();
    this.revision++;
    this.prepared = new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
    // 再生ボタンを押す前の読込失敗はonErrorで通知し、未処理の拒否にしない。
    this.prepared.catch(() => {});
    this.syncChart();
  }
  syncChart() { if (this.chart) this.send('chart', { chart: this.chart, revision: this.revision }); }
  setSceneBaseURL(url) { this.sceneBaseURL = url; }
  transport() {
    this.lastScheduledBeat = null;
    // 時刻の外挿は子画面へ渡さず、同じ時計を直接参照させる。
    this.send('transport');
    this.onStateChange(this.isPlaying);
  }
  async loadAudioFromBuffer(buffer) { await this.audioManager.loadFromBuffer(buffer); this.transport(); }
  async play() {
    if (this.previewError) throw this.previewError;
    const request = ++this.playRequest;
    this.audioManager.init();
    if (this.audioManager.audioContext.state === 'suspended') await this.audioManager.audioContext.resume();
    for (;;) {
      const prepared = this.prepared;
      await prepared;
      if (prepared === this.prepared) break;
    }
    if (request !== this.playRequest) return;
    await this.audioManager.play();
    if (request !== this.playRequest) this.audioManager.pause();
    this.transport();
  }
  pause() { this.playRequest++; this.audioManager.pause(); this.transport(); }
  stop() { this.playRequest++; this.audioManager.pause(); this.audioManager.pauseTime = 0; this.transport(); }
  async seekTo(milliseconds) { this.playRequest++; await this.audioManager.seekTo(milliseconds / 1000); this.transport(); }
  getCurrentTimeMs() { return this.audioManager.getCurrentTime() * 1000; }
  scheduleMetronome(time) {
    if (!this.metronomeEnabled || !this.chart) return;
    const bpm = this.chart.bpm;
    const offset = this.offsetSeconds ?? 0;
    const beat = (time - offset) * bpm / 60;
    if (this.lastScheduledBeat === null) this.lastScheduledBeat = Math.ceil(beat - 0.001) - 1;
    while (offset + (this.lastScheduledBeat + 1) * 60 / bpm <= time + 0.1) {
      const index = ++this.lastScheduledBeat;
      const scheduled = offset + index * 60 / bpm;
      if (scheduled >= time - 0.01 && scheduled >= 0) this.audioManager.playMetronomeTick(index % 4 === 0, this.metronomeVolume, this.audioManager.audioContext.currentTime + Math.max(0, scheduled - time));
    }
  }
  dispose() {
    this.playRequest++;
    this.pending?.resolve();
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('message', this.message);
    if (this.iframe.fourFlowClock === this.clock) delete this.iframe.fourFlowClock;
    for (const record of this.modelURLs.values()) URL.revokeObjectURL(record.url);
    this.audioManager.pause();
    this.audioManager.frameClock.dispose();
    this.audioManager.audioContext?.close();
  }
}
