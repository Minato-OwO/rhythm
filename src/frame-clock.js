const MAX_FRAME_GAP_MS = 250;
const MAX_CLOCK_DRIFT_SECONDS = 0.25;

// 通常再生中はフレーム時計を使い、音声中断やスリープの区切りでのみ同期する。
export class AudioFrameClock {
  constructor(source, now = () => performance.now()) {
    this.source = source;
    this.now = now;
    this.context = null;
    this.onStateChange = () => this.invalidate();
    this.synchronize();
  }

  watchContext() {
    const context = this.source.context();
    if (this.context === context) return;
    this.context?.removeEventListener('statechange', this.onStateChange);
    this.context = context;
    this.context?.addEventListener('statechange', this.onStateChange);
    this.invalidate();
  }

  invalidate() { this.needsSync = true; }

  synchronize() {
    this.watchContext();
    const before = this.now();
    this.songTime = this.source.time();
    this.performanceTime = (before + this.now()) / 2;
    this.anchor = this.source.anchor();
    this.running = this.isRunning();
    this.lastFrameTime = null;
    this.needsSync = false;
  }

  isRunning() {
    return this.source.playing() && this.context?.state === 'running';
  }

  sample(frameTime = this.now()) {
    this.watchContext();
    if (!Number.isFinite(frameTime)) frameTime = this.now();
    const gap = this.lastFrameTime !== null && (frameTime < this.lastFrameTime || frameTime - this.lastFrameTime > MAX_FRAME_GAP_MS);
    const predicted = this.songTime + Math.max(0, this.now() - this.performanceTime) / 1000;
    const drifted = this.running && Math.abs(predicted - this.source.time()) > MAX_CLOCK_DRIFT_SECONDS;
    // runningへ戻るまで一度も描画されなかった場合も、statechangeを記録して拾う。
    if (this.needsSync || gap || drifted || this.anchor !== this.source.anchor() || this.running !== this.isRunning()) this.synchronize();
    this.lastFrameTime = frameTime;
    if (!this.running) return this.source.time();
    // 音声時刻への毎フレームの追従補正は、スクロール速度の変動になるので行わない。
    // 開始・再開直後のフレーム時刻が同期時点より古い場合だけ、その同期位置で待つ。
    return this.songTime + Math.max(0, frameTime - this.performanceTime) / 1000;
  }

  dispose() {
    this.context?.removeEventListener('statechange', this.onStateChange);
    this.context = null;
  }
}

export class SongFrameClock extends AudioFrameClock {
  constructor(game, now) {
    super({
      time: () => game.songTime,
      playing: () => game.state === 'playing',
      context: () => game.audio.context,
      anchor: () => game.anchor,
    }, now);
  }
}
