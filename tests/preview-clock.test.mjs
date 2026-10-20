import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChart } from '../src/chart.js';
import { ScrollTrack, SV_MULTIPLIER_LIMIT } from '../src/scroll-track.js';
import { AudioManager } from '../editor/src/editor/AudioManager.js';
import { createPreviewClock } from '../editor/src/editor/PreviewClock.js';

function fixture() {
  const chart = normalizeChart({
    bpm: 227, offsetSeconds: 0.025, durationSeconds: 100,
    notes: [{ beat: 262, lane: 0 }],
    scrollVelocities: [
      { beat: 256, mode: 'range', multiplier: -9, endMultiplier: 5, durationBeats: 3.875, easing: 'smoothstep' },
      { beat: 260, mode: 'constant', multiplier: 1 },
    ],
  });
  let frame = 0, revision = 1;
  const audio = new AudioManager(() => frame);
  audio.audioContext = Object.assign(new EventTarget(), { currentTime: 0, state: 'running' });
  audio.duration = chart.duration;
  audio.isPlaying = true;
  audio.startTime = 0;
  audio.frameClock.synchronize();
  const clock = createPreviewClock(audio, () => revision, () => frame);
  const time = beat => beat * 60 / chart.bpm + 0.025;
  return {
    chart, audio, clock, time, track: new ScrollTrack(chart.scrollVelocities),
    setTime: seconds => { frame = seconds * 1000; audio.audioContext.currentTime = seconds; },
    setRevision: value => { revision = value; },
  };
}

test('親画面とプレビューで同じ時刻のSVを使う', () => {
  const f = fixture();
  const currentTime = f.time(259.9);
  f.setTime(currentTime);
  // 旧式の時計換算に子画面の起点差250msが混ざると、固定SVを先に表示してしまう。
  assert.equal(f.track.multiplierAt(currentTime + 0.25), 1);
  assert.equal(f.track.multiplierAt(f.clock.sample().time), 5);
  assert.ok(Math.abs(f.clock.sample().time - currentTime) < 1e-12);
});

test('範囲の終了後は描画上も5を保持し、固定SV後は1で動く', () => {
  const f = fixture();
  const notePosition = f.track.positionAt(f.chart.notes[0].time);
  for (const [beat, expected] of [[259.9, 5], [259.99, 5], [260.01, 1], [261, 1]]) {
    f.setTime(f.time(beat));
    const a = f.clock.sample().time;
    const distanceA = notePosition - f.track.positionAt(a);
    f.setTime(a + 0.00001);
    const b = f.clock.sample().time;
    const distanceB = notePosition - f.track.positionAt(b);
    const velocity = (distanceA - distanceB) / (b - a);
    assert.ok(Math.abs(velocity - expected) < 0.00001, 'beat=' + beat + ', velocity=' + velocity);
    assert.equal(f.track.multiplierAt(a), expected);
  }
});

test('ポーズ・シーク・譜面変更を、古い時刻の外挿なしで反映する', () => {
  const f = fixture();
  f.audio.isPlaying = false;
  f.audio.pauseTime = f.time(261);
  f.setTime(90);
  assert.equal(f.clock.sample().time, f.audio.pauseTime);
  assert.equal(f.clock.sample().playing, false);
  f.audio.pauseTime = f.time(259.9);
  f.setRevision(2);
  const snapshot = f.clock.sample();
  assert.equal(snapshot.time, f.audio.pauseTime);
  assert.equal(snapshot.revision, 2);
  assert.equal(f.track.multiplierAt(snapshot.time), 5);
});

test('全体・個別・範囲SVが新しい正負の上限を受け付ける', () => {
  const source = {
    bpm: 120, durationSeconds: 10,
    notes: [{ timeSeconds: 5, lane: 0, scrollMultiplier: SV_MULTIPLIER_LIMIT }],
    scrollVelocities: [
      { timeSeconds: 0, mode: 'range', multiplier: -SV_MULTIPLIER_LIMIT, endMultiplier: SV_MULTIPLIER_LIMIT, durationBeats: 4 },
      { timeSeconds: 3, mode: 'constant', multiplier: -SV_MULTIPLIER_LIMIT },
    ],
  };
  const chart = normalizeChart(source);
  assert.equal(chart.notes[0].scrollMultiplier, 1_000_000);
  assert.equal(chart.scrollVelocities[0].multiplier, -1_000_000);
  assert.equal(chart.scrollVelocities[0].endMultiplier, 1_000_000);
  assert.equal(chart.scrollVelocities[1].multiplier, -1_000_000);
  const invalidNote = structuredClone(source);
  invalidNote.notes[0].scrollMultiplier = SV_MULTIPLIER_LIMIT + 1;
  assert.throws(() => normalizeChart(invalidNote), /個別SV/);
  const invalidEnd = structuredClone(source);
  invalidEnd.scrollVelocities[0].endMultiplier = -SV_MULTIPLIER_LIMIT - 1;
  assert.throws(() => normalizeChart(invalidEnd), /終了倍率/);
});
