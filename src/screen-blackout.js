import { ScreenFill } from './screen-fill.js';

export const BLACKOUT_TIMING = Object.freeze({ fadeOutMs: 180, holdMs: 150, fadeInMs: 240 });

// クリップ座標の黒い面で、VRの両眼も頭の向きによらず全面を覆う。
export class ScreenBlackout extends ScreenFill {
  constructor(scene) {
    super(scene);
    this.phase = 'idle';
  }

  get active() { return this.phase !== 'idle'; }

  begin(now, { onCovered = () => {}, onReveal = () => {} } = {}) {
    this.phase = 'out';
    this.startedAt = now;
    this.onCovered = onCovered;
    this.onReveal = onReveal;
    this.setOpacity(0);
  }

  update(now, ready = true) {
    const timing = BLACKOUT_TIMING;
    if (this.phase === 'out') {
      const p = Math.max(0, Math.min(1, (now - this.startedAt) / timing.fadeOutMs));
      this.setOpacity(p * p * (3 - 2 * p));
      if (p === 1) {
        this.phase = 'hold';
        this.startedAt = now;
        this.onCovered();
      }
    } else if (this.phase === 'hold') {
      if (ready && now - this.startedAt >= timing.holdMs) {
        this.phase = 'in';
        this.startedAt = now;
        this.onReveal();
      }
    } else if (this.phase === 'in') {
      const p = Math.max(0, Math.min(1, (now - this.startedAt) / timing.fadeInMs));
      this.setOpacity(1 - p * p * (3 - 2 * p));
      if (p === 1) this.cancel();
    }
  }

  cancel() {
    this.phase = 'idle';
    this.setOpacity(0);
    this.onCovered = this.onReveal = null;
  }

  dispose() {
    this.cancel();
    super.dispose();
  }
}
