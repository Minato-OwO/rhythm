const timeKey = item => item.time;
export const SV_MULTIPLIER_LIMIT = 1_000_000;
export const scrollPositionKey = item => item.position;
export function upperBound(array, value, key = timeKey) {
  let low = 0, high = array.length;
  while (low < high) { const middle = (low + high) >>> 1; if (key(array[middle]) <= value) low = middle + 1; else high = middle; }
  return low;
}

function integratedDistance(point, elapsed) {
  if (point.duration === 0) return elapsed * point.endMultiplier;
  const moving = Math.min(elapsed, point.duration);
  const u = moving / point.duration;
  // 線形補間とsmoothstepを解析的に積分し、フレームごとの誤差を持ち込まない。
  const area = point.easing === 'smoothstep' ? u * u * u * (1 - u / 2) : u * u / 2;
  return point.multiplier * moving
    + (point.endMultiplier - point.multiplier) * point.duration * area
    + Math.max(0, elapsed - point.duration) * point.endMultiplier;
}

function heldEnd(point) {
  return {
    time: point.time + point.duration,
    multiplier: point.endMultiplier, endMultiplier: point.endMultiplier,
    duration: 0, easing: 'linear',
    position: point.position + integratedDistance(point, point.duration),
  };
}

function zeroCrossing(point) {
  const target = -point.multiplier / (point.endMultiplier - point.multiplier);
  if (point.easing !== 'smoothstep') return target;
  // 準備時だけ逆関数を求める。描画中は位置の式を評価するだけでよい。
  let low = 0, high = 1;
  for (let index = 0; index < 48; index++) {
    const middle = (low + high) / 2;
    if (middle * middle * (3 - 2 * middle) < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

// タイプごとに倍率区間を準備する。同じタイプの後続SVが範囲変化を上書きする。
// scrollは積分距離、speedは現在時刻の倍率だけを表示に使う。
export class ScrollTrack {
  constructor(points = [], type = 'scroll') {
    this.points = [];
    let previous = { time: 0, multiplier: 1, endMultiplier: 1, duration: 0, easing: 'linear', position: 0 };
    this.points.push(previous);
    for (const point of points) {
      if ((point.type ?? 'scroll') !== type) continue;
      // 範囲の終点で補間を完了し、次のSVまでは独立した固定倍率区間にする。
      // 次のSVの倍率・時刻を、終了済みの補間には使わない。
      if (previous.duration > 0 && previous.time + previous.duration < point.time) {
        previous = heldEnd(previous);
        this.points.push(previous);
      }
      const next = {
        time: point.time, multiplier: point.multiplier,
        endMultiplier: point.endMultiplier ?? point.multiplier,
        duration: point.duration ?? 0, easing: point.easing ?? 'linear',
        position: previous.position + integratedDistance(previous, point.time - previous.time),
      };
      if (point.time === previous.time) this.points[this.points.length - 1] = next;
      else this.points.push(next);
      previous = next;
    }
    if (previous.duration > 0) this.points.push(heldEnd(previous));
    this.monotonic = this.points.every(point => point.multiplier >= 0 && point.endMultiplier >= 0);
    this.extrema = [];
    for (let index = 0; index < this.points.length; index++) {
      const point = this.points[index];
      this.extrema.push({ time: point.time, position: point.position });
      if (point.duration <= 0 || point.multiplier * point.endMultiplier >= 0) continue;
      const time = point.time + point.duration * zeroCrossing(point);
      if (time >= (this.points[index + 1]?.time ?? Infinity)) continue;
      // 負→正、正→負の途中の折り返しもLNの表示範囲に含める。
      this.extrema.push({ time, position: point.position + integratedDistance(point, time - point.time) });
    }
    this.size = 1;
    while (this.size < this.extrema.length) this.size *= 2;
    this.minimum = new Float64Array(this.size * 2).fill(Infinity);
    this.maximum = new Float64Array(this.size * 2).fill(-Infinity);
    for (let index = 0; index < this.extrema.length; index++) this.minimum[this.size + index] = this.maximum[this.size + index] = this.extrema[index].position;
    for (let index = this.size - 1; index > 0; index--) {
      this.minimum[index] = Math.min(this.minimum[index * 2], this.minimum[index * 2 + 1]);
      this.maximum[index] = Math.max(this.maximum[index * 2], this.maximum[index * 2 + 1]);
    }
  }
  positionAt(time) {
    if (time < 0) return time;
    const point = this.points[upperBound(this.points, time) - 1];
    return point.position + integratedDistance(point, time - point.time);
  }
  multiplierAt(time) {
    if (time < 0) return 1;
    const point = this.points[upperBound(this.points, time) - 1];
    if (point.duration === 0) return point.endMultiplier;
    const u = Math.max(0, Math.min(1, (time - point.time) / point.duration));
    const weight = point.easing === 'smoothstep' ? u * u * (3 - 2 * u) : u;
    return point.multiplier + (point.endMultiplier - point.multiplier) * weight;
  }
  bounds(start, end, result) {
    const a = this.positionAt(start), b = this.positionAt(end);
    result.min = Math.min(a, b); result.max = Math.max(a, b);
    if (this.monotonic) return result;
    let left = this.size + upperBound(this.extrema, start);
    let right = this.size + upperBound(this.extrema, end);
    while (left < right) {
      if (left & 1) { result.min = Math.min(result.min, this.minimum[left]); result.max = Math.max(result.max, this.maximum[left++]); }
      if (right & 1) { --right; result.min = Math.min(result.min, this.minimum[right]); result.max = Math.max(result.max, this.maximum[right]); }
      left >>= 1; right >>= 1;
    }
    return result;
  }
}

// speedは積分距離に含めず、現在時刻の倍率をノーツ全体の表示間隔に掛ける。
// 固定・範囲変化と終了倍率の保持には、従来SVと同じ区間評価を使う。
export class SpeedTrack extends ScrollTrack {
  constructor(points = []) { super(points, 'speed'); }
}

// 表示区間の索引。LNの胴や個別SVも含め、表示外のノーツをまとめて除外する。
export class HoldIndex {
  constructor(items) {
    this.items = items.sort((a, b) => a.min - b.min);
    this.size = 1;
    while (this.size < items.length) this.size *= 2;
    this.ends = new Float64Array(this.size * 2).fill(-Infinity);
    for (let index = 0; index < items.length; index++) this.ends[this.size + index] = items[index].max;
    for (let index = this.size - 1; index > 0; index--) this.ends[index] = Math.max(this.ends[index * 2], this.ends[index * 2 + 1]);
  }
  visit(min, max, callback, node = 1, left = 0, right = this.size) {
    if (left >= this.items.length || this.items[left].min > max || this.ends[node] < min) return;
    if (right - left === 1) { callback(this.items[left]); return; }
    const middle = (left + right) >>> 1;
    this.visit(min, max, callback, node * 2, left, middle);
    this.visit(min, max, callback, node * 2 + 1, middle, right);
  }
}

// speedで表示範囲が毎フレーム変わっても、全ノーツの索引は作り直さない。
export class ScrollNoteIndex {
  constructor(entries, baseRate, depth, behind = 0.6) {
    this.baseRate = baseRate;
    this.depth = depth;
    this.behind = behind;
    const groups = new Map(), stationary = [], collapsed = [];
    const approachSeconds = depth / baseRate;
    for (const entry of entries) {
      const timed = { entry, min: entry.note.time - approachSeconds, max: (entry.note.endTime ?? entry.note.time) + 0.4 };
      collapsed.push(timed);
      const multiplier = entry.note.scrollMultiplier ?? 1;
      if (multiplier === 0) { stationary.push(timed); continue; }
      // 符号と2倍刻みの倍率で分け、個別SVが混在しても候補範囲を広げすぎない。
      const key = (multiplier < 0 ? '-' : '+') + Math.floor(Math.log2(Math.abs(multiplier)));
      let group = groups.get(key);
      if (!group) { group = { multiplier, items: [] }; groups.set(key, group); }
      if (Math.abs(multiplier) < Math.abs(group.multiplier)) group.multiplier = multiplier;
      group.items.push({ entry, min: entry.min, max: entry.max });
    }
    this.groups = [...groups.values()].map(group => ({ multiplier: group.multiplier, index: new HoldIndex(group.items) }));
    this.stationary = new HoldIndex(stationary);
    this.collapsed = new HoldIndex(collapsed);
  }

  visit(position, time, speed, callback) {
    if (speed === 0) {
      // 全ノーツが判定線上で重なる時は、通常の接近時間内と保持中のLNを表示する。
      this.collapsed.visit(time, time, callback);
      return;
    }
    for (const group of this.groups) {
      const rate = this.baseRate * speed * group.multiplier;
      const a = -this.behind / rate, b = this.depth / rate;
      group.index.visit(position + Math.min(a, b), position + Math.max(a, b), callback);
    }
    this.stationary.visit(time, time, callback);
  }
}
