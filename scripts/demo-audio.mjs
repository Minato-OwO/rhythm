import { readFile, stat, writeFile } from 'node:fs/promises';
import { normalizeChart } from '../src/chart.js';

// 初回起動時だけデモのWAVを曲フォルダへ保存する。既存ファイルは上書きしない。
export async function ensureDemoAudio() {
  const audioUrl = new URL('../songs/neon-circuit/audio.wav', import.meta.url);
  try { await stat(audioUrl); return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let contents;
  try { contents = await readFile(new URL('../songs/neon-circuit/chart.json', import.meta.url), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  let chart;
  try {
    const source = JSON.parse(contents);
    if (!['audio.wav', './audio.wav'].includes(source.audio)) return;
    chart = normalizeChart(source);
  } catch { return; } // デモを削除・編集中でも、ほかの曲を配信できるようにする。
  const rate = 22050;
  const samples = new Float32Array(Math.ceil(chart.duration * rate));
  const tone = (time, frequency, duration, level, endFrequency = null) => {
    const start = Math.round(time * rate);
    const length = Math.min(Math.ceil(duration * rate), samples.length - start);
    let phase = 0;
    for (let index = 0; index < length; index++) {
      const elapsed = index / rate;
      const pitch = endFrequency ? frequency * (endFrequency / frequency) ** (elapsed / duration) : frequency;
      phase += Math.PI * 2 * pitch / rate;
      const envelope = Math.min(1, elapsed / 0.005) * Math.exp(-elapsed / duration * 6);
      samples[start + index] += (Math.sin(phase) + (endFrequency ? 0 : Math.sin(phase * 3) * 0.08)) * envelope * level;
    }
  };
  let randomState = 123456789;
  const noise = (time, duration, level) => {
    const start = Math.round(time * rate);
    const length = Math.min(Math.ceil(duration * rate), samples.length - start);
    let previous = 0;
    for (let index = 0; index < length; index++) {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      const current = randomState / 2147483648 - 1;
      samples[start + index] += (current - previous) * Math.exp(-index / length * 6) * level;
      previous = current;
    }
  };
  const stepDuration = 30 / chart.bpm;
  for (let step = 0; step * stepDuration < chart.duration - 1; step++) {
    const time = step * stepDuration;
    noise(time, 0.035, step % 2 ? 0.025 : 0.045);
    if (step % 2 === 0) tone(time, 145, 0.16, 0.4, 42);
    if (step % 4 === 2) noise(time, 0.13, 0.12);
    if (step % 4 === 0) tone(time, [65.406, 55, 73.416, 49][Math.floor(step / 8) % 4], stepDuration * 1.8, 0.14);
  }
  for (const note of chart.notes) tone(note.time, [261.626, 329.628, 391.995, 523.251][note.lane], 0.17, 0.14);
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index++) wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[index])) * 32767), 44 + index * 2);
  try { await writeFile(audioUrl, wav, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
