// 選曲時だけ集計する。LNは始点を1ノーツとして数え、終点は密度に含めない。
export function analyzeChart(chart, audioDuration = null) {
  const hasAudioDuration = Number.isFinite(audioDuration) && audioDuration > 0;
  const duration = hasAudioDuration ? audioDuration : Math.max(0.001, chart.duration);
  const lanes = Array.from({ length: 4 }, () => ({ taps: 0, longNotes: 0, total: 0 }));
  let taps = 0;
  let longNotes = 0;
  let timelineDuration = duration;
  for (const note of chart.notes) {
    const hold = note.endTime !== null && note.endTime !== undefined;
    const lane = lanes[note.lane];
    if (hold) { lane.longNotes++; longNotes++; }
    else { lane.taps++; taps++; }
    lane.total++;
    timelineDuration = Math.max(timelineDuration, note.endTime ?? note.time);
  }
  // 長時間の譜面でも集計用メモリーを一定量に抑える。
  const binSeconds = Math.max(1, Math.ceil(timelineDuration / 1200));
  const bins = Array.from({ length: Math.max(1, Math.ceil(timelineDuration / binSeconds)) }, () => ({ taps: 0, longNotes: 0 }));
  for (const note of chart.notes) {
    const bin = bins[Math.min(bins.length - 1, Math.floor(note.time / binSeconds))];
    if (note.endTime !== null && note.endTime !== undefined) bin.longNotes++;
    else bin.taps++;
  }
  let peakDensity = 0;
  for (const bin of bins) peakDensity = Math.max(peakDensity, (bin.taps + bin.longNotes) / binSeconds);
  return {
    duration, durationSource: hasAudioDuration ? 'audio' : 'chart', timelineDuration,
    taps, longNotes, total: taps + longNotes, lanes, bins, binSeconds,
    averageDensity: (taps + longNotes) / duration, peakDensity,
  };
}

const durationCache = new Map();

// 再生・デコードせず、音声メタデータから長さだけを取得する。
export async function readAudioDuration(url, signal) {
  if (!url || signal?.aborted) return null;
  if (durationCache.has(url)) return durationCache.get(url);
  return new Promise(resolve => {
    const audio = document.createElement('audio');
    let settled = false;
    let timer = null;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeEventListener('loadedmetadata', loaded);
      audio.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
      audio.removeAttribute('src');
      audio.load();
      if (Number.isFinite(value) && value > 0) durationCache.set(url, value);
      resolve(value);
    };
    const loaded = () => finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    const failed = () => finish(null);
    const aborted = () => finish(null);
    audio.addEventListener('loadedmetadata', loaded);
    audio.addEventListener('error', failed);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) { finish(null); return; }
    timer = setTimeout(failed, 8000);
    audio.preload = 'metadata';
    audio.src = url;
    audio.load();
  });
}
