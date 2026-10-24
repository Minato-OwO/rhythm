import { EFFECTS, isRangeSV } from './ChartDocument.js';

const LANE_COLORS = ['#43ddff', '#5c96ff', '#ef8bc6', '#ff9478'];
const KEYS = ['D', 'F', 'J', 'K'];
const BEAT_GRID_COLORS = {
  1: '#ffffff',
  2: '#ff657a',
  3: '#be8cff',
  4: '#5c96ff',
  8: '#ffd47b',
};

function beatGridColor(index, divisions) {
  // 分数を約分して、上位の区切りの色を優先する（4/8は1/2の赤）。
  let a = index, b = divisions;
  while (b) { const remainder = a % b; a = b; b = remainder; }
  return BEAT_GRID_COLORS[divisions / a] ?? '#72dce6';
}

// 元のレイヤー式タイムラインを4レーンと本体共通の演出へ合わせる。
export class Timeline {
  constructor(options) {
    Object.assign(this, options);
    this.scale = 100;
    this.time = 0;
    this.selected = null;
    this.selectedIds = new Set();
    this.itemBounds = [];
    this.dragging = false;
    this.labels = document.getElementById('timeline-layers');
    this.container = document.getElementById('timeline-tracks-container');
    this.container.tabIndex = 0;
    this.tracks = document.getElementById('timeline-tracks');
    this.ruler = document.getElementById('timeline-ruler');
    this.rulerContent = document.getElementById('timeline-ruler-content');
    this.playhead = document.getElementById('timeline-playhead');
    this.container.addEventListener('scroll', () => {
      this.labels.scrollTop = this.container.scrollTop;
      if (!this.dragging && !this.scrollFrame) this.scrollFrame = requestAnimationFrame(() => { this.scrollFrame = null; this.render(); });
    });
    this.labels.addEventListener('wheel', event => { this.container.scrollTop += event.deltaY; event.preventDefault(); }, { passive: false });
    this.ruler.addEventListener('pointerdown', event => this.seekPointer(event));
    this.tracks.addEventListener('pointerdown', event => {
      if (event.button === 0 && !event.target.closest('.timeline-block')) {
        if (event.ctrlKey || event.metaKey) this.rangeSelect(event);
        else this.seekPointer(event);
      }
    });
  }

  px(seconds) { return seconds * this.scale; }
  snap(seconds, bypass = false) { return Math.max(0, bypass ? seconds : this.snapTime(seconds)); }
  selection(ids, primary = null) {
    this.selectedIds = new Set(typeof ids === 'string' ? [ids] : ids ?? []);
    this.selected = primary ?? [...this.selectedIds].at(-1) ?? null;
    for (const block of this.tracks.querySelectorAll('.timeline-block')) block.classList.toggle('selected', this.selectedIds.has(block.dataset.id));
  }

  // 共通のドラッグ監視。画面端ではスクロールし、Escape・中断で取り消す。
  watchPointer(event, update, finish) {
    let pointer = event, frame = null, done = false, moved = false;
    this.tracks.setPointerCapture?.(event.pointerId);
    const move = next => {
      if (next.pointerId !== event.pointerId) return;
      pointer = next;
      moved ||= Math.abs(next.clientX - event.clientX) >= 3 || Math.abs(next.clientY - event.clientY) >= 3;
      update(next);
    };
    const stop = cancelled => {
      if (done) return;
      done = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true);
      if (this.tracks.hasPointerCapture?.(event.pointerId)) this.tracks.releasePointerCapture(event.pointerId);
      finish(cancelled);
    };
    const up = next => { if (next.pointerId === event.pointerId) { move(next); stop(false); } };
    const cancel = next => { if (next.type !== 'pointercancel' || next.pointerId === event.pointerId) stop(true); };
    const key = next => { if (next.code === 'Escape') { next.preventDefault(); next.stopPropagation(); stop(true); } };
    const scroll = () => {
      if (done) return;
      const rect = this.container.getBoundingClientRect();
      const speed = (position, min, max) => position < min + 28 ? -Math.min(18, (min + 28 - position) / 3)
        : position > max - 28 ? Math.min(18, (position - max + 28) / 3) : 0;
      const left = this.container.scrollLeft, top = this.container.scrollTop;
      if (moved) {
        this.container.scrollLeft += speed(pointer.clientX, rect.left, rect.right);
        this.container.scrollTop += speed(pointer.clientY, rect.top + 24, rect.bottom);
      }
      this.labels.scrollTop = this.container.scrollTop;
      if (left !== this.container.scrollLeft || top !== this.container.scrollTop) update(pointer);
      frame = requestAnimationFrame(scroll);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
    frame = requestAnimationFrame(scroll);
  }

  rangeIds(rect, base = []) {
    const ids = new Set(base);
    for (const item of this.itemBounds) {
      if (item.left <= rect.right && item.right >= rect.left && item.top <= rect.bottom && item.bottom >= rect.top) ids.add(item.id);
    }
    return [...ids];
  }

  rangeSelect(event) {
    if (this.dragging || event.button !== 0) return;
    event.preventDefault();
    this.container.focus({ preventScroll: true });
    const base = [...this.selectedIds];
    const point = pointer => {
      const rect = this.tracks.getBoundingClientRect();
      return { x: Math.max(0, Math.min(this.tracks.scrollWidth, pointer.clientX - rect.left)), y: Math.max(0, Math.min(this.tracks.scrollHeight, pointer.clientY - rect.top)) };
    };
    const start = point(event);
    const box = document.createElement('div');
    box.className = 'timeline-selection-box';
    box.setAttribute('aria-hidden', 'true');
    this.tracks.append(box);
    this.dragging = true;
    const update = pointer => {
      const end = point(pointer);
      const rect = { left: Math.min(start.x, end.x), right: Math.max(start.x, end.x), top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y) };
      Object.assign(box.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.right - rect.left + 'px', height: rect.bottom - rect.top + 'px' });
      const ids = this.rangeIds(rect, base);
      if (ids.length !== this.selectedIds.size || ids.some(id => !this.selectedIds.has(id))) this.onSelectMany(ids);
    };
    this.watchPointer(event, update, cancelled => {
      box.remove();
      if (cancelled) this.onSelectMany(base);
      this.dragging = false;
      this.render();
    });
  }
  setTime(seconds, follow = false) {
    this.time = seconds;
    this.playhead.style.left = this.px(seconds) + 'px';
    this.playhead.style.top = (24 + this.container.scrollTop) + 'px';
    if (follow && !this.dragging && (this.px(seconds) < this.container.scrollLeft || this.px(seconds) > this.container.scrollLeft + this.container.clientWidth - 70)) this.container.scrollLeft = Math.max(0, this.px(seconds) - 100);
  }
  zoom(multiplier) {
    const position = this.px(this.time) - this.container.scrollLeft;
    this.scale = Math.max(15, Math.min(1500, this.scale * multiplier));
    this.render();
    this.container.scrollLeft = Math.max(0, this.px(this.time) - position);
  }

  seekPointer(event) {
    if (event.button !== 0 || this.dragging) return;
    event.preventDefault();
    this.container.focus({ preventScroll: true });
    const move = pointer => {
      const rect = this.container.getBoundingClientRect();
      const time = this.snap((pointer.clientX - rect.left + this.container.scrollLeft) / this.scale, pointer.shiftKey || pointer.altKey);
      this.onSeek(time);
    };
    move(event);
    const finish = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  }

  renderGrid(doc, visibleStart, visibleEnd) {
    const beatMode = this.getSnapMode() === 'beat';
    const step = this.getStep();
    const beatSeconds = 60 / doc.metadata.bpm;
    let period = beatMode ? Math.max(step, beatSeconds) : step;
    let divisions = beatMode && step < beatSeconds ? Math.max(1, Math.round(beatSeconds / step)) : 1;
    // 縮小時も拍に揃えたまま間引き、密集した線で画面を埋めない。
    while (divisions > 1 && period * this.scale / divisions < 4) divisions = divisions % 2 === 0 ? divisions / 2 : 1;
    if (period * this.scale < 4) period *= Math.ceil(4 / (period * this.scale));
    const interval = period / divisions;
    const origin = beatMode ? doc.metadata.offsetSeconds ?? 0 : 0;
    const first = Math.ceil((visibleStart - origin) / interval - 1e-7);
    const last = Math.floor((visibleEnd - origin) / interval + 1e-7);
    const grid = document.createElement('div');
    grid.className = 'timeline-grid';
    grid.setAttribute('aria-hidden', 'true');
    const ticks = document.createDocumentFragment();
    for (let index = first; index <= last; index++) {
      const time = origin + index * interval;
      if (time < 0) continue;
      const subdivision = ((index % divisions) + divisions) % divisions;
      const major = beatMode && subdivision === 0;
      const color = beatMode ? beatGridColor(subdivision, divisions) : '#8da3bd';
      const line = document.createElement('span');
      line.className = 'timeline-grid-line' + (major ? ' major' : '');
      // 端数幅の背景タイルを繰り返さず、各拍の絶対位置で描画する。
      line.style.left = this.px(time) + 'px';
      line.style.backgroundColor = color;
      grid.append(line);
      const tick = line.cloneNode();
      tick.className = 'timeline-grid-tick' + (major ? ' major' : '');
      tick.setAttribute('aria-hidden', 'true');
      ticks.append(tick);
    }
    this.tracks.append(grid);
    this.rulerContent.append(ticks);
  }

  render() {
    if (this.dragging) return;
    const doc = this.getDocument();
    const normalized = doc.normalized();
    const width = Math.ceil(Math.max(60, normalized.duration + 3) * this.scale);
    this.labels.replaceChildren();
    this.tracks.replaceChildren();
    this.rulerContent.replaceChildren();
    this.itemBounds = [];
    this.ruler.style.width = width + 'px';
    this.rulerContent.style.width = width + 'px';
    this.tracks.style.width = width + 'px';
    const visibleStart = Math.max(0, (this.container.scrollLeft - 200) / this.scale);
    const visibleEnd = Math.min(width / this.scale, (this.container.scrollLeft + this.container.clientWidth + 200) / this.scale);
    this.renderGrid(doc, visibleStart, visibleEnd);
    const beatStep = Math.max(1, 2 ** Math.ceil(Math.log2(55 / (60 / doc.metadata.bpm * this.scale))));
    const firstBeat = Math.floor(doc.beat(visibleStart) / beatStep) * beatStep;
    for (let beat = firstBeat; doc.seconds(beat) <= visibleEnd; beat += beatStep) {
      const seconds = doc.seconds(beat);
      if (seconds < 0) continue;
      const label = document.createElement('span');
      label.className = 'ruler-label';
      label.style.left = this.px(seconds) + 'px';
      label.textContent = beat + '拍';
      this.rulerContent.append(label);
    }
    const groups = [
      ...KEYS.map((key, lane) => ({ kind: 'note', lane, label: key + ' / レーン ' + lane, color: LANE_COLORS[lane], items: doc.notes.filter(item => item.data.lane === lane) })),
      { kind: 'sv', label: '全体SV / 速度変更', color: '#ffd47b', items: doc.svs },
      ...Object.entries(EFFECTS).map(([type, spec]) => ({ kind: 'event', type, label: spec.label, color: spec.color, items: doc.events.filter(item => item.data.type === type) })),
    ];
    let groupTop = 0;
    for (const group of groups) {
      const sorted = [...group.items].sort((a, b) => doc.time(a) - doc.time(b));
      const rowEnds = [];
      const rows = new Map();
      for (const item of sorted) {
        const start = doc.time(item);
        let row = rowEnds.findIndex(end => end <= start);
        if (row < 0) row = rowEnds.length;
        rowEnds[row] = start + Math.max(12 / this.scale, doc.duration(item));
        rows.set(item.id, row);
      }
      const height = Math.max(1, rowEnds.length) * 30 + 8;
      const layer = document.createElement('div');
      layer.className = 'timeline-layer';
      layer.style.height = height + 'px';
      layer.style.color = group.color;
      layer.textContent = group.label;
      this.labels.append(layer);
      const track = document.createElement('div');
      track.className = 'timeline-track';
      track.style.height = height + 'px';
      track.dataset.lane = group.lane ?? '';
      track.addEventListener('dblclick', event => {
        if (event.ctrlKey || event.metaKey || event.target.closest('.timeline-block')) return;
        const seconds = this.snap((event.clientX - track.getBoundingClientRect().left) / this.scale, event.shiftKey);
        this.onAdd(group.kind, seconds, group.kind === 'note' ? group.lane : group.type);
      });
      for (const item of sorted) {
        const start = doc.time(item);
        const duration = doc.duration(item);
        const blockWidth = Math.max(item.kind === 'note' ? 14 : 18, this.px(duration));
        const blockTop = 4 + rows.get(item.id) * 30;
        // 画面外の項目も範囲選択に含める。DOMの仮想化とは独立した座標を使う。
        this.itemBounds.push({ id: item.id, left: this.px(start), right: this.px(start) + blockWidth, top: groupTop + blockTop, bottom: groupTop + blockTop + 22 });
        if (start + duration < visibleStart || start > visibleEnd) continue;
        const block = document.createElement('div');
        block.className = 'timeline-block' + (item.kind === 'note' ? ' note-block' : '') + (this.selectedIds.has(item.id) ? ' selected' : '');
        block.dataset.id = item.id;
        block.style.left = this.px(start) + 'px';
        block.style.width = blockWidth + 'px';
        block.style.top = blockTop + 'px';
        block.style.background = group.color;
        const rangeSV = item.kind === 'sv' && isRangeSV(item.data);
        const speedSV = item.kind === 'sv' && item.data.type === 'speed';
        const svLabel = (speedSV ? 'SPEED ×' : 'SV ×') + item.data.multiplier + (rangeSV ? ' → ×' + (item.data.endMultiplier ?? item.data.multiplier) : '');
        block.textContent = item.kind === 'sv' ? svLabel : item.kind === 'note' ? KEYS[item.data.lane] + (duration > 0 ? ' / LN' : '') : group.label;
        block.title = group.label + ' / ' + start.toFixed(3) + '秒';
        if (item.kind === 'sv') {
          if (speedSV) block.style.background = '#ffa6de';
          block.title += ' / ' + svLabel;
          if (rangeSV) block.title += ' / ' + (item.data.durationBeats !== undefined ? item.data.durationBeats + '拍' : duration.toFixed(3) + '秒') + ' / ' + (item.data.easing === 'smoothstep' ? 'なめらか' : '一定の割合');
        }
        if (item.kind === 'note') {
          if (item.data.fake) {
            block.classList.add('fake-note');
            block.textContent += ' / FAKE';
            block.title += ' / フェイク（判定なし）';
          }
          const multiplier = item.data.scrollMultiplier ?? 1;
          block.title += ' / 個別SV ×' + multiplier;
          if (multiplier !== 1) {
            block.classList.add('individual-sv');
            block.textContent += ' / ×' + multiplier;
          }
        }
        if (item.kind === 'event' && item.data.type !== 'noteSkin' || item.kind === 'note' && duration > 0 || rangeSV) {
          for (const side of ['left', 'right']) {
            const handle = document.createElement('div');
            handle.className = 'timeline-handle ' + side;
            handle.dataset.side = side;
            block.append(handle);
          }
        }
        block.addEventListener('contextmenu', event => { event.preventDefault(); this.onContext(item.id, event.clientX, event.clientY); });
        block.addEventListener('pointerdown', event => this.drag(event, item.id, block));
        track.append(block);
      }
      this.tracks.append(track);
      groupTop += height;
    }
    this.setTime(this.time);
  }

  drag(event, id, block) {
    if (event.button !== 0 || this.dragging) return;
    event.preventDefault();
    event.stopPropagation();
    this.container.focus({ preventScroll: true });
    if (event.ctrlKey || event.metaKey) { this.onSelect(id, { toggle: true }); return; }
    const side = event.target.dataset.side;
    this.onSelect(id, { preserve: !side });
    const doc = this.getDocument();
    const original = doc.get(id);
    const originalLane = original.data.lane;
    const start = doc.time(original);
    const duration = doc.duration(original);
    const origins = doc.movementOrigins(this.selectedIds);
    const blocks = [...this.tracks.querySelectorAll('.timeline-block')].filter(element => this.selectedIds.has(element.dataset.id))
      .map(element => ({ element, parent: element.parentElement, top: element.style.top }));
    const startX = event.clientX;
    const scrollStart = this.container.scrollLeft;
    this.dragging = true;
    doc.beginEdit();
    let moved = false;
    const move = pointer => {
      const delta = (pointer.clientX - startX + this.container.scrollLeft - scrollStart) / this.scale;
      if (!moved && Math.abs(pointer.clientX - startX) < 3 && Math.abs(delta * this.scale) < 3 && Math.abs(pointer.clientY - event.clientY) < 3) return;
      moved = true;
      try {
        if (!side) {
          const target = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest('.timeline-track');
          const laneDelta = original.kind === 'note' && target?.dataset.lane !== undefined && target.dataset.lane !== '' ? Number(target.dataset.lane) - originalLane : 0;
          doc.moveItems(origins, this.snap(start + delta, pointer.shiftKey || pointer.altKey) - start, laneDelta, false);
        } else {
          doc.change(() => {
            const item = doc.get(id);
            const minimum = ['laneColor', 'backgroundColor', 'backgroundStage'].includes(item.data.type) ? 0 : 0.01;
            if (item.kind === 'sv' && side === 'right') {
              doc.setSVDuration(item, Math.max(0, this.snap(start + duration + delta, pointer.shiftKey || pointer.altKey) - start));
            } else if (item.kind === 'sv' && side === 'left') {
              const newStart = Math.min(start + duration, this.snap(start + delta, pointer.shiftKey || pointer.altKey));
              doc.setTime(item, newStart);
              doc.setSVDuration(item, Math.max(0, start + duration - newStart));
            } else if (item.kind === 'note' && side === 'right') {
              doc.setEndTime(item, Math.max(start + 0.001, this.snap(start + duration + delta, pointer.shiftKey || pointer.altKey)));
            } else if (item.kind === 'note' && side === 'left') {
              doc.setTime(item, Math.min(start + duration - 0.001, this.snap(start + delta, pointer.shiftKey || pointer.altKey)));
              doc.setEndTime(item, start + duration);
            } else if (side === 'right') {
              const end = this.snap(start + duration + delta, pointer.shiftKey || pointer.altKey);
              item.data.durationSeconds = Math.max(minimum, end - start);
            } else if (side === 'left') {
              const newStart = Math.min(start + duration - minimum, this.snap(start + delta, pointer.shiftKey || pointer.altKey));
              doc.setTime(item, newStart);
              item.data.durationSeconds = Math.max(minimum, start + duration - newStart);
            }
            doc.fitFade(item);
          }, false);
        }
        const items = new Map(doc.items.map(item => [item.id, item]));
        for (const { element, parent, top } of blocks) {
          const item = items.get(element.dataset.id);
          element.style.left = this.px(doc.time(item)) + 'px';
          element.style.width = Math.max(item.kind === 'note' ? 14 : 18, this.px(doc.duration(item))) + 'px';
          if (item.kind === 'note') {
            const track = this.tracks.querySelector('.timeline-track[data-lane="' + item.data.lane + '"]');
            if (track) track.append(element);
            element.style.top = track === parent ? top : '4px';
          }
        }
        this.onChange(false);
      } catch (error) { this.onError(error); }
    };
    const finish = cancelled => {
      this.dragging = false;
      if (cancelled) doc.cancelEdit(); else doc.endEdit();
      this.onChange(true);
    };
    this.watchPointer(event, move, finish);
  }
}
