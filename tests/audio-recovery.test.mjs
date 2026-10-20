import test from 'node:test';
import assert from 'node:assert/strict';
import { SongFrameClock } from '../src/frame-clock.js';
import { AudioTransport } from '../src/audio.js';
import { AudioManager } from '../editor/src/editor/AudioManager.js';

class Context extends EventTarget {
  state = 'running';
  currentTime = 20;
  suspends = 0;
  setState(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
  async suspend() { this.suspends++; this.setState('suspended'); }
  async resume() { this.setState('running'); }
}

function fixture() {
  let now = 0;
  const context = new Context();
  const game = { audio: { context }, state: 'playing', anchor: 20, get songTime() { return this.audio.context.currentTime - this.anchor; } };
  const clock = new SongFrameClock(game, () => now);
  return { context, game, clock, now: () => now, set(frame, audio) { now = frame; context.currentTime = 20 + audio; } };
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, actual + ' != ' + expected);

test('スリープで音声だけ止まり、runningのまま戻っても再同期する', () => {
  const f = fixture();
  f.set(1000, 1); close(f.clock.sample(1000), 1);
  f.set(601000, 1.02); close(f.clock.sample(601000), 1.02);
  f.set(601016, 1.036); close(f.clock.sample(601016), 1.036);
  f.clock.dispose();
});

test('描画フレーム間に中断と復帰が完了しても、statechangeを取りこぼさない', () => {
  const f = fixture();
  f.set(100, 0.1); close(f.clock.sample(100), 0.1);
  f.context.setState('interrupted');
  f.set(220, 0.1); f.context.setState('running');
  f.set(236, 0.116); close(f.clock.sample(236), 0.116);
  f.clock.dispose();
});

test('フォーカス復帰の再同期後、古いフレーム時刻で巻き戻さない', () => {
  const f = fixture();
  f.set(100, 0.1); f.clock.sample(100);
  f.set(140, 0.12); f.clock.invalidate();
  close(f.clock.sample(132), 0.12);
  f.set(156, 0.136); close(f.clock.sample(156), 0.136);
  f.clock.dispose();
});

test('イベントが欠けた大きい時計差も、次のフレームで補正する', () => {
  const f = fixture();
  f.set(100, 0.1); f.clock.sample(100);
  f.set(116, 3.116); close(f.clock.sample(116), 3.116);
  f.clock.dispose();
});

test('通常再生では音声時計の量子化をノーツの速度に混ぜない', () => {
  const f = fixture();
  for (let frame = 1; frame <= 1800; frame++) {
    const time = frame * 1000 / 60;
    f.set(time, Math.floor(time / 3) * 0.003);
    close(f.clock.sample(time), time / 1000);
  }
  f.clock.dispose();
});

test('ゲームのポーズ中は止まり、再開後の音声時刻に追従する', () => {
  const f = fixture();
  f.set(500, 0.5); f.clock.sample(500);
  f.game.state = 'paused'; f.context.setState('suspended');
  f.set(90000, 0.5); close(f.clock.sample(90000), 0.5);
  f.game.state = 'playing'; f.context.setState('running');
  f.set(90016, 0.516); close(f.clock.sample(90016), 0.516);
  f.clock.dispose();
});

test('音声デバイス中断中もゲームの音源を明示的に停止する', async () => {
  const audio = new AudioTransport();
  const context = new Context();
  audio.context = context;
  context.setState('interrupted');
  await audio.pause();
  assert.equal(context.suspends, 1);
  assert.equal(context.state, 'suspended');
  await audio.pause();
  assert.equal(context.suspends, 1);
});

test('エディタはスリープ前の音声位置でポーズし、同じ位置から再開する', async () => {
  const f = fixture();
  const audio = new AudioManager(f.now);
  audio.audioContext = f.context;
  audio.duration = 100;
  audio.startTime = 20;
  audio.isPlaying = true;
  audio.frameClock.synchronize();
  f.set(1000, 0.1);
  audio.pause();
  close(audio.pauseTime, 0.1);
  close(audio.getCurrentTime(), 0.1);
  await audio.play();
  f.set(1016, 0.116); close(audio.getCurrentTime(1016), 0.116);
  audio.frameClock.dispose(); f.clock.dispose();
});

test('エディタもフレーム間の音声中断と復帰を再同期する', () => {
  const f = fixture();
  const audio = new AudioManager(f.now);
  audio.audioContext = f.context; audio.startTime = 20; audio.isPlaying = true;
  audio.frameClock.synchronize();
  f.set(100, 0.1); close(audio.getCurrentTime(100), 0.1);
  f.context.setState('interrupted');
  f.set(220, 0.1); f.context.setState('running');
  f.set(236, 0.116); close(audio.getCurrentTime(236), 0.116);
  audio.frameClock.dispose(); f.clock.dispose();
});
