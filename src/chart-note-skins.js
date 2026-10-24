const SLOTS = ['head', 'body'];

export function skinSource(src, baseUrl) {
  if (src === null || src === undefined || src === '') return null;
  if (typeof src !== 'string' || !src.trim()) throw new Error('ノーツスキンには画像のパスを指定してください。');
  if (!/\.(png|jpe?g|webp|gif|avif)(?:[?#].*)?$/i.test(src) && !/^(?:data:image\/(?:png|jpeg|webp|gif|avif);base64,|blob:)/i.test(src)) {
    throw new Error('ノーツスキンにはPNG・WebP・JPEG・GIF・AVIFを指定してください。');
  }
  return baseUrl ? new URL(src, baseUrl).href : src;
}

export function chartSkins(source, baseUrl) {
  if (source !== undefined && (source === null || typeof source !== 'object' || Array.isArray(source))) throw new Error('noteSkinsはオブジェクトで指定してください。');
  if (source?.tint !== undefined && typeof source.tint !== 'boolean') throw new Error('noteSkins.tintはtrue/falseで指定してください。');
  return { head: skinSource(source?.head, baseUrl), body: skinSource(source?.body, baseUrl), tint: source?.tint ?? false };
}

export function skinSources(chart) {
  const sources = new Set([chart.noteSkins?.head, chart.noteSkins?.body].filter(Boolean));
  for (const event of chart.events ?? []) if (event.type === 'noteSkin' && event.src) sources.add(event.src);
  return sources;
}

// 本体とエディタで同じ時刻評価を使い、切替時には読込やデコードを行わない。
export class ChartNoteSkins {
  constructor(renderer) {
    this.renderer = renderer;
    this.tracks = { head: [], body: [] };
    this.current = { head: {}, body: {} };
  }
  async preload(chart) { await Promise.all([...skinSources(chart)].map(src => this.renderer.prepare(src))); }
  setChart(chart) {
    this.chart = chart;
    for (const slot of SLOTS) {
      this.tracks[slot] = (chart.events ?? []).filter(event => event.type === 'noteSkin' && (event.target === slot || event.target === 'all'))
        .sort((a, b) => a.time - b.time || a.id - b.id);
      this.current[slot] = {};
    }
    this.update(-Infinity);
    this.renderer.retain(skinSources(chart));
  }
  update(time) {
    const defaults = this.chart?.noteSkins;
    for (const slot of SLOTS) {
      const track = this.tracks[slot];
      let low = 0, high = track.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (track[middle].time <= time) low = middle + 1; else high = middle;
      }
      const event = track[low - 1];
      const src = event ? event.src : defaults?.[slot] ?? null;
      const tint = event ? event.tint : defaults?.tint ?? false;
      const current = this.current[slot];
      if (current.src === src && current.tint === tint) continue;
      this.renderer.applySource(slot, src, tint);
      current.src = src; current.tint = tint;
    }
  }
}
