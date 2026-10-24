export const UI_SOUND_FILES = Object.freeze({ start: 'start.mp3', change_diff: 'change_diff.mp3', press: 'press.mp3', back: 'back.mp3' });

export function controlSound(id, gameState = 'idle') {
  if (id === 'songs-play') return 'start';
  if (/^difficulty-[ENHX]$/.test(id)) return 'change_diff';
  if (['songs-close', 'pause-leave', 'close'].includes(id)) return 'back';
  if (id === 'songs' && gameState !== 'idle') return 'back';
  return 'press';
}

export function shortcutSound(code, { settingsOpen = false, songSelectionOpen = false, gameState = 'idle' } = {}) {
  if (code === 'Space') return settingsOpen ? null : songSelectionOpen ? 'start' : 'press';
  if (code === 'KeyO') return settingsOpen ? 'back' : 'press';
  if (code === 'KeyS') return songSelectionOpen || gameState !== 'idle' ? 'back' : 'press';
  if (code === 'Escape') return settingsOpen || songSelectionOpen ? 'back' : ['playing', 'paused'].includes(gameState) ? 'press' : null;
  if (['KeyR', 'KeyC', 'KeyP', 'KeyV'].includes(code)) return 'press';
  return null;
}

// 操作音は専用の時計を使う。曲のポーズ・停止で切らず、音を鳴らすために曲を再開しない。
export class UISounds {
  constructor(volume = 1) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.context = null;
    this.buffers = new Map();
    this.pending = new Map();
    this.sources = new Set();
    this.disposed = false;
    this.onEnded = event => {
      const source = event.target;
      this.sources.delete(source);
      source.disconnect();
    };
  }

  ensureContext() {
    if (this.disposed) return;
    if (this.context && this.context.state !== 'closed') return;
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) throw new Error('操作SEを再生できません。');
    this.context = new Context({ latencyHint: 'interactive' });
    this.gain = this.context.createGain();
    this.gain.gain.value = this.volume;
    const limiter = this.context.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 3;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    this.gain.connect(limiter).connect(this.context.destination);
  }

  setVolume(volume) {
    if (!Number.isFinite(volume)) return;
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gain && this.context?.state !== 'closed') this.gain.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.02);
  }

  async load(name) {
    if (!Object.hasOwn(UI_SOUND_FILES, name)) throw new Error('不明な操作SE: ' + name);
    if (this.disposed) return null;
    this.ensureContext();
    if (this.buffers.has(name)) return this.buffers.get(name);
    if (!this.pending.has(name)) {
      const context = this.context;
      const promise = (async () => {
        const response = await fetch(new URL('../assets/' + UI_SOUND_FILES[name], import.meta.url));
        if (!response.ok) throw new Error('操作SEを読み込めません: ' + UI_SOUND_FILES[name]);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (this.disposed) return null;
        this.buffers.set(name, buffer);
        return buffer;
      })().catch(error => {
        this.pending.delete(name);
        throw error;
      });
      this.pending.set(name, promise);
    }
    return this.pending.get(name);
  }

  async preload() {
    if (this.disposed) return;
    await Promise.all(Object.keys(UI_SOUND_FILES).map(name => this.load(name)));
  }

  async play(name) {
    if (this.disposed || !Object.hasOwn(UI_SOUND_FILES, name) || this.volume === 0) return false;
    this.ensureContext();
    // 最初のresumeはマウス・キー・VRトリガーの呼び出しから直接行う。
    const resumed = this.context.state === 'running' ? Promise.resolve() : this.context.resume();
    const [, buffer] = await Promise.all([resumed, this.load(name)]);
    if (this.disposed || !buffer || this.volume === 0 || this.context.state !== 'running') return false;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.onended = this.onEnded;
    this.sources.add(source);
    source.start();
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* 終了済み。 */ }
      source.disconnect();
    }
    this.sources.clear();
    this.buffers.clear();
    this.pending.clear();
    this.gain?.disconnect();
    this.context?.close().catch(() => {});
  }
}
