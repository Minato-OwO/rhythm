import { ChartDocument, EFFECTS, isRangeSV } from './editor/ChartDocument.js';
import { ScrollTrack, SpeedTrack, SV_MULTIPLIER_LIMIT } from '../../src/scroll-track.js';
import { Timeline } from './editor/Timeline.js';
import { PreviewEngine } from './editor/PreviewEngine.js';
import { importOsuFiles } from './editor/OsuProject.js';
import { readDirectory, readFiles, droppedFiles, readServerSong, saveDirectory, downloadJSON, assetPath, assetURLPath } from './editor/ProjectFiles.js';

const $ = id => document.getElementById(id);
// 演出の定義と追加メニューを揃え、新しい種類の載せ忘れを防ぐ。
const effectType = $('effect-type');
const initialEffectType = effectType.value;
effectType.replaceChildren(...Object.entries(EFFECTS).map(([type, spec]) => new Option(spec.label, type)));
if (Object.hasOwn(EFFECTS, initialEffectType)) effectType.value = initialEffectType;
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const KEYS = ['D', 'F', 'J', 'K'];
let doc = new ChartDocument();
let selected = null;
let currentTime = 0;
let editorScrollTrack = new ScrollTrack();
let editorSpeedTrack = new SpeedTrack();
let project = { directory: null, audio: null, audioDirty: false, models: new Map(), label: '新規曲' };
let songs = [];
let busy = false;
let previewFrame = null;
const engine = new PreviewEngine($('preview-frame'));
const timeline = new Timeline({
  getDocument: () => doc,
  getStep: snapStep,
  getSnapMode: () => $('snap-mode').value,
  snapTime,
  onSeek: seconds => { engine.seekTo(seconds * 1000).catch(showError); },
  onSelect: select,
  onAdd: (kind, seconds, target) => addItem(kind, seconds, target, true),
  onChange: full => changed(full),
  onError: showError,
  onContext: (id, x, y) => {
    select(id);
    const menu = $('context-menu');
    menu.hidden = false;
    menu.style.left = Math.min(x, innerWidth - 160) + 'px';
    menu.style.top = Math.min(y, innerHeight - 95) + 'px';
  },
});
engine.onError = showError;
engine.onStateChange = playing => { $('btn-play').textContent = playing ? '一時停止' : '再生'; };
engine.onTimeUpdate = milliseconds => {
  currentTime = milliseconds / 1000;
  $('time-display').textContent = formatTime(currentTime);
  $('beat-display').textContent = doc.beat(currentTime).toFixed(3) + '拍';
  if (document.activeElement !== $('seek-time')) $('seek-time').value = currentTime.toFixed(3);
  timeline.setTime(currentTime, engine.isPlaying);
  updateSVReadout();
};

function updateSVReadout() {
  const text = 'SV ×' + Number(editorScrollTrack.multiplierAt(currentTime).toFixed(3)) + ' / SPEED ×' + Number(editorSpeedTrack.multiplierAt(currentTime).toFixed(3));
  if ($('sv-display').textContent !== text) $('sv-display').textContent = text;
}

function status(message, error = false) {
  $('editor-status').textContent = message;
  $('editor-status').classList.toggle('error', error);
}
function showError(error) { if (error.name !== 'AbortError') status(error.message || String(error), true); }
async function run(action) {
  if (busy || timeline.dragging) return;
  busy = true;
  document.body.classList.add('is-busy');
  try { await action(); } catch (error) { showError(error); }
  finally { busy = false; document.body.classList.remove('is-busy'); }
}
function formatTime(seconds) {
  const milliseconds = Math.round(Math.max(0, seconds) * 1000);
  return String(Math.floor(milliseconds / 60000)).padStart(2, '0') + ':' + String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0') + '.' + String(milliseconds % 1000).padStart(3, '0');
}
function snapStep() {
  return $('snap-mode').value === 'beat' ? 60 / doc.metadata.bpm * Number($('snap-beat-div').value) : Math.max(1, Number($('snap-ms-val').value) || 100) / 1000;
}
function snapTime(seconds) {
  const origin = $('snap-mode').value === 'beat' ? doc.metadata.offsetSeconds ?? 0 : 0;
  return Math.max(0, origin + Math.round((seconds - origin) / snapStep()) * snapStep());
}
function syncPreview() {
  if (previewFrame) return;
  previewFrame = requestAnimationFrame(() => {
    previewFrame = null;
    try { flushPreview(); } catch (error) { engine.pause(); showError(error); }
  });
}
function flushPreview() {
  if (previewFrame) { cancelAnimationFrame(previewFrame); previewFrame = null; }
  engine.offsetSeconds = doc.metadata.offsetSeconds ?? 0;
  engine.setModelAssets(project.models);
  const chart = doc.normalized();
  engine.loadChart(chart);
  editorScrollTrack = new ScrollTrack(chart.scrollVelocities);
  editorSpeedTrack = new SpeedTrack(chart.scrollVelocities);
  updateSVReadout();
}
function changed(full = true) {
  if (selected && !doc.get(selected)) selected = null;
  $('dirty-indicator').textContent = doc.dirty || project.audioDirty || [...project.models.values()].some(asset => asset.dirty) ? '未保存' : '';
  $('btn-undo').disabled = !doc.past.length;
  $('btn-redo').disabled = !doc.future.length;
  $('bpm-display').textContent = 'BPM ' + doc.metadata.bpm;
  $('offset-display').textContent = 'OFFSET ' + (doc.metadata.offsetSeconds ?? 0) + 's';
  $('event-count').textContent = doc.events.length + '演出 / ' + doc.notes.length + 'ノーツ / ' + doc.svs.length + 'SV';
  timeline.selected = selected;
  if (full) { renderSong(); renderProperties(); renderEventList(); timeline.render(); }
  syncPreview();
}
function edit(action, full = true) {
  if (busy) return;
  try { doc.change(action); changed(full); status('編集中 / ' + doc.notes.length + 'ノーツ・' + doc.events.length + '演出'); }
  catch (error) { showError(error); renderProperties(); renderSong(); }
}
function select(id) {
  selected = id;
  timeline.selection(id);
  for (const row of $('event-list').children) row.classList.toggle('selected', row.dataset.id === id);
  renderProperties();
}
function addItem(kind, seconds, laneOrType, snapped = false) {
  if (busy) return;
  try {
    const firstModel = project.models.keys().next().value;
    const at = snapped ? seconds : snapTime(seconds);
    const overrides = kind === 'event' && laneOrType === 'backgroundGLB' && firstModel ? { src: assetURLPath(firstModel) }
      : kind === 'note' && $('note-kind').value === 'hold' ? { endBeat: Number((doc.beat(at) + 1).toFixed(9)) } : {};
    selected = doc.add(kind, at, laneOrType, overrides);
    $('drop-zone').classList.add('hidden'); changed(); status(kind === 'note' ? 'ノーツを追加しました。' : '演出を追加しました。');
  }
  catch (error) { showError(error); }
}
function removeSelection() {
  if (busy || !selected) return;
  try { doc.remove(selected); selected = null; changed(); } catch (error) { showError(error); }
}
function duplicateSelection() {
  if (busy || !selected) return;
  try { selected = doc.duplicate(selected, snapStep()); changed(); } catch (error) { showError(error); }
}

function field(label, key, value, { type = 'number', step = '0.001', min, max, readonly = false } = {}) {
  return '<label class="editor-field"><span>' + escape(label) + '</span><input data-key="' + key + '" type="' + type + '" value="' + escape(value) + '" step="' + step + '"' + (min !== undefined ? ' min="' + min + '"' : '') + (max !== undefined ? ' max="' + max + '"' : '') + (readonly ? ' readonly' : '') + ' /></label>';
}
function vectorField(label, key, data, fallback, options = {}) {
  const values = data[key] ?? fallback;
  return '<fieldset class="vector-field"><legend>' + escape(label) + '</legend>' + ['X', 'Y', 'Z'].map((axis, index) => field(axis, key + '.' + index, values[index], options)).join('') + '</fieldset>';
}
function checkField(label, key, checked) {
  return '<label class="editor-check"><input type="checkbox" data-key="' + key + '"' + (checked ? ' checked' : '') + ' />' + escape(label) + '</label>';
}
function renderSong() {
  $('song-properties').innerHTML =
    field('曲名', 'title', doc.metadata.title, { type: 'text' }) +
    field('作曲者', 'artist', doc.metadata.artist, { type: 'text' }) +
    field('BPM', 'bpm', doc.metadata.bpm, { min: 1, step: '0.001' }) +
    field('オフセット（秒）', 'offsetSeconds', doc.metadata.offsetSeconds ?? 0) +
    field('終了時刻（秒）', 'durationSeconds', doc.metadata.durationSeconds ?? doc.normalized().duration, { min: 1 }) +
    field('音声', 'audio', doc.metadata.audio ?? doc.metadata.audioUrl ?? '', { type: 'text', readonly: true }) +
    checkField('選曲画面に「点滅注意」を表示', 'flashWarning', doc.metadata.flashWarning === true) +
    field('点滅注意の補足（任意）', 'flashWarningText', doc.metadata.flashWarningText ?? '', { type: 'text' });
  for (const input of $('song-properties').querySelectorAll('input:not([readonly])')) input.addEventListener('change', () => {
    const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? input.value === '' ? NaN : Number(input.value) : input.value;
    if (input.type === 'number' && !Number.isFinite(value)) return showError(new Error('数値を入力してください。'));
    edit(() => { doc.metadata[input.dataset.key] = value; });
  });
}
function renderEventList() {
  const list = $('event-list');
  list.replaceChildren();
  for (const item of [...doc.events].sort((a, b) => doc.time(a) - doc.time(b))) {
    const li = document.createElement('li');
    li.dataset.id = item.id;
    li.classList.toggle('selected', item.id === selected);
    const dot = document.createElement('span');
    dot.className = 'event-dot';
    dot.style.background = EFFECTS[item.data.type].color;
    const text = document.createElement('span');
    text.textContent = EFFECTS[item.data.type].label + ' / ' + doc.time(item).toFixed(3) + 's';
    li.append(dot, text);
    li.addEventListener('click', () => select(item.id));
    li.addEventListener('dblclick', () => { engine.seekTo(doc.time(item) * 1000).catch(showError); });
    list.append(li);
  }
}
function renderProperties() {
  const item = doc.get(selected);
  if (!item) {
    $('properties-content').innerHTML = '<div class="no-selection">ノーツ・演出を選択してください。</div><p class="editor-help">タイムラインをダブルクリックして追加できます。D / F / J / Kでも再生位置にノーツを置けます。</p>';
    return;
  }
  const data = item.data;
  const seconds = data.timeSeconds !== undefined;
  const name = item.kind === 'sv' ? '全体SV / 速度変更' : item.kind === 'note' ? 'ノーツ / ' + KEYS[data.lane] : EFFECTS[data.type].label;
  let html = '<h3 class="property-title">' + escape(name) + '</h3><label class="editor-field"><span>時刻の単位</span><select data-key="unit"><option value="beat"' + (!seconds ? ' selected' : '') + '>拍（0始まり）</option><option value="seconds"' + (seconds ? ' selected' : '') + '>秒</option></select></label>';
  html += field(seconds ? '開始時刻（秒）' : '開始拍', 'stamp', seconds ? data.timeSeconds : data.beat, { step: seconds ? '0.001' : '0.125' });
  html += '<p class="editor-help">楽曲時刻 ' + doc.time(item).toFixed(3) + '秒 / ' + doc.beat(doc.time(item)).toFixed(3) + '拍</p>';
  if (item.kind === 'sv') {
    const range = isRangeSV(data);
    const speed = data.type === 'speed';
    html += '<label class="editor-field"><span>SVタイプ</span><select data-key="type"><option value="scroll"' + (!speed ? ' selected' : '') + '>scroll（従来のSV）</option><option value="speed"' + (speed ? ' selected' : '') + '>speed（全ノーツの間隔を変更）</option></select></label>';
    html += '<label class="editor-field"><span>倍率の変化</span><select data-key="svMode"><option value="constant"' + (!range ? ' selected' : '') + '>固定倍率</option><option value="range"' + (range ? ' selected' : '') + '>範囲で変化</option></select></label>';
    html += field(range ? '開始倍率' : '速度倍率', 'multiplier', data.multiplier, { min: -SV_MULTIPLIER_LIMIT, max: SV_MULTIPLIER_LIMIT, step: '0.01' });
    if (range) {
      const seconds = data.durationSeconds !== undefined;
      html += field('終了倍率', 'endMultiplier', data.endMultiplier ?? data.multiplier, { min: -SV_MULTIPLIER_LIMIT, max: SV_MULTIPLIER_LIMIT, step: '0.01' });
      html += '<label class="editor-field"><span>長さの単位</span><select data-key="svDurationUnit"><option value="beats"' + (!seconds ? ' selected' : '') + '>拍数</option><option value="seconds"' + (seconds ? ' selected' : '') + '>秒数</option></select></label>';
      html += field(seconds ? '変化の長さ（秒）' : '変化の長さ（拍）', 'svDuration', seconds ? data.durationSeconds : data.durationBeats ?? 0, { min: 0, step: seconds ? '0.001' : '0.125' });
      html += '<label class="editor-field"><span>変化の仕方</span><select data-key="easing"><option value="linear"' + ((data.easing ?? 'linear') === 'linear' ? ' selected' : '') + '>一定の割合で変化</option><option value="smoothstep"' + (data.easing === 'smoothstep' ? ' selected' : '') + '>なめらか</option></select></label>';
      html += '<p class="editor-help">例：開始−9、終了1、長さ4拍、なめらか。開始時刻で開始倍率になり、指定した長さで終了倍率まで変化します。</p>';
      html += '<p class="editor-help">長さ ' + doc.duration(item).toFixed(3) + '秒。終了後は終了倍率を保持し、次の同じタイプのSVで切り替えます。範囲外は補間せず、途中で同じタイプのSVが始まるとそちらを優先します。</p>';
    }
    html += speed
      ? '<p class="editor-help">指定時刻の倍率で、表示中のTAP・LN全体の間隔を判定線を基準に一斉に拡大・縮小します。×2で間隔2倍、0で判定線上に集まり、負数で前後が反転します。未来のspeed設定は現在の間隔に影響しません。</p>'
      : '<p class="editor-help">従来のSVです。倍率を区間ごとに積分した距離で配置し、切替時もノーツ位置を連続させます。0で停止、負数で逆走します。</p>';
    html += '<p class="editor-help">scrollとspeedは別々に保持して併用できます。音源・判定時刻は変わりません。</p>';
  } else if (item.kind === 'note') {
    html += '<label class="editor-field"><span>レーン</span><select data-key="lane">' + KEYS.map((key, lane) => '<option value="' + lane + '"' + (lane === data.lane ? ' selected' : '') + '>' + lane + ' / ' + key + '</option>').join('') + '</select></label>';
    html += field('個別SV倍率', 'scrollMultiplier', data.scrollMultiplier ?? 1, { min: -SV_MULTIPLIER_LIMIT, max: SV_MULTIPLIER_LIMIT, step: '0.01' });
    html += '<p class="editor-help">全体SVにこのノーツの倍率を掛けます。1で全体SVと同じ、0.5で半速、2で倍速。0は通常の接近時間から判定線上に固定、負数は移動方向を反転します。音源・判定時刻は変わりません。</p>';
    const hold = doc.duration(item) > 0;
    html += '<label class="editor-field"><span>種類</span><select data-key="noteType"><option value="tap"' + (!hold ? ' selected' : '') + '>タップ</option><option value="hold"' + (hold ? ' selected' : '') + '>LN</option></select></label>';
    if (hold) {
      const endSeconds = data.endTimeSeconds !== undefined;
      html += field(endSeconds ? '終点（秒）' : '終点（拍）', 'endStamp', endSeconds ? data.endTimeSeconds : data.endBeat, { step: endSeconds ? '0.001' : '0.125' });
      html += '<p class="editor-help">長さ ' + doc.duration(item).toFixed(3) + '秒。タイムラインの両端でも調整できます。</p>';
      html += '<p class="editor-help">個別SVはLNの始点・胴・終点すべてに適用します。</p>';
    }
  } else {
    html += field(data.type === 'backgroundStage' ? '変化にかける時間（秒）' : '長さ（秒）', 'durationSeconds', doc.duration(item), { min: ['laneColor', 'backgroundColor', 'backgroundStage'].includes(data.type) ? 0 : 0.01 });
    if (data.type === 'backgroundStage') {
      html += '<label class="editor-field"><span>対象</span><select data-key="target">' + [['all', '床・アーチ全部'], ['grid', '床グリッド'], ['arches', 'アーチ']].map(([value, label]) => '<option value="' + value + '"' + ((data.target ?? 'all') === value ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label>';
      html += field('変更後の不透明度（0〜1）', 'opacity', data.opacity ?? 0, { min: 0, max: 1, step: '0.05' });
      html += '<label class="editor-field"><span>変化の仕方</span><select data-key="easing">' + [['linear', '一定の速さ'], ['smoothstep', 'なめらか']].map(([value, label]) => '<option value="' + value + '"' + ((data.easing ?? 'linear') === value ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label>';
      html += '<p class="editor-help">0でフェードアウト、1で再表示します。変化後の状態を保持し、次の標準ステージ演出まで続きます。時間0で即時切替できます。</p>';
      html += '<p class="editor-help">色は元のデザインへの着色です。指定した対象は背景GLB・JSの自動非表示より優先されます。</p>';
    }
    if (data.type.startsWith('lane')) {
      const lanes = data.lanes ?? (data.lane !== undefined ? [data.lane] : [0, 1, 2, 3]);
      html += '<fieldset class="lane-choices"><legend>対象レーン</legend>' + KEYS.map((key, lane) => '<label><input data-lane="' + lane + '" type="checkbox"' + (lanes.includes(lane) ? ' checked' : '') + ' />' + key + '</label>').join('') + '</fieldset>';
    }
    if (!['laneColor', 'backgroundColor', 'backgroundStage'].includes(data.type)) html += field('強さ（0〜1）', 'intensity', data.intensity ?? EFFECTS[data.type].defaults.intensity ?? 0.6, { min: 0, max: 1, step: '0.05' });
    if (['lanePulse', 'backgroundStage'].includes(data.type)) html += checkField(data.type === 'backgroundStage' ? '元の色を使用する' : 'レーンの色を使用する', 'inheritColor', !data.color);
    if (!['lanePulse', 'backgroundStage'].includes(data.type) || data.color) html += field('色', 'color', data.color ?? EFFECTS[data.type].defaults.color ?? '#43ddff', { type: 'color' });
    if (['screenFade', 'backgroundStars', 'backgroundGLB', 'backgroundScene'].includes(data.type)) {
      const fade = Math.min(data.type === 'screenFade' ? 0.25 : 0.5, doc.duration(item) / 2);
      html += field('フェードイン（秒）', 'fadeInSeconds', data.fadeInSeconds ?? fade, { min: 0 });
      html += field('フェードアウト（秒）', 'fadeOutSeconds', data.fadeOutSeconds ?? fade, { min: 0 });
    }
    if (data.type === 'backgroundStars') {
      html += field('星の大きさ（m）', 'size', data.size ?? 0.045, { min: 0.001 });
      html += vectorField('回転速度（度 / 秒）', 'rotationSpeed', data, [0, 3, 0]);
    }
    if (data.type === 'backgroundScene') {
      html += field('背景モジュール（JSの相対パス）', 'src', data.src ?? '', { type: 'text' });
      html += '<p class="editor-help">例：./dist/background.js。「ゲームの曲」から開くと、曲フォルダのJSを読み込みます。背景スクリプトは曲フォルダ内に置いてください。</p>';
      html += vectorField('位置（m）', 'position', data, [0, 0, 0]);
      html += vectorField('向き（度）', 'rotation', data, [0, 0, 0], { step: '1' });
      html += vectorField('倍率', 'scale', data, [1, 1, 1], { min: 0.001, step: '0.01' });
      html += vectorField('回転速度（度 / 秒）', 'rotationSpeed', data, [0, 0, 0]);
      html += field('アニメーション速度', 'animationSpeed', data.animationSpeed ?? 1, { min: 0, step: '0.05' });
      html += '<label class="editor-check"><input type="checkbox" data-key="hideDefault"' + ((data.hideDefault ?? true) ? ' checked' : '') + ' />標準の床・アーチを隠す</label>';
    }
    if (data.type === 'backgroundGLB') {
      const paths = new Set(project.models.keys());
      if (data.src) paths.add(assetPath(data.src));
      html += '<label class="editor-field"><span>GLB</span><select data-key="src"><option value=""' + (!data.src ? ' selected' : '') + '>非表示</option>' + [...paths].sort().map(path => '<option value="' + escape(assetURLPath(path)) + '"' + (data.src && assetPath(data.src) === path ? ' selected' : '') + '>' + escape(path) + '</option>').join('') + '</select></label>';
      html += '<p class="editor-help">素材は「GLBを追加」または曲フォルダから読み込めます。非表示を選ぶと、この区間はGLBを表示しません。</p>';
      html += vectorField('位置（m）', 'position', data, [0, 0, -15]);
      html += vectorField('向き（度）', 'rotation', data, [0, 0, 0], { step: '1' });
      html += vectorField('倍率', 'scale', data, [1, 1, 1], { min: 0.001, step: '0.01' });
      html += field('基準サイズ（m）', 'fitSize', data.fitSize ?? 20, { min: 0, step: '0.1' });
      html += '<p class="editor-help">位置はレーン中央の床を基準にします。基準サイズはモデルの最長辺です。0で元の寸法を使用します。</p>';
      html += vectorField('回転速度（度 / 秒）', 'rotationSpeed', data, [0, 3, 0]);
      html += field('アニメーション', 'animation', data.animation ?? 'auto', { type: 'text' });
      html += '<p class="editor-help">autoで最初の動作、noneで停止。名前を入力すると指定した動作を再生します。</p>';
      html += field('動作速度', 'animationSpeed', data.animationSpeed ?? 1, { min: 0, step: '0.1' });
      html += checkField('動作をループ', 'loop', data.loop ?? true);
      html += checkField('標準の床・アーチを隠す', 'hideDefault', data.hideDefault ?? true);
    }
  }
  html += '<div class="property-actions"><button id="btn-prop-duplicate">複製</button><button id="btn-prop-delete" class="btn-danger">削除</button></div>';
  $('properties-content').innerHTML = html;
  for (const input of $('properties-content').querySelectorAll('[data-key]')) input.addEventListener('change', () => {
    const key = input.dataset.key;
    let value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? input.value === '' ? NaN : Number(input.value) : input.value;
    if (input.type === 'number' && !Number.isFinite(value)) return showError(new Error('数値を入力してください。'));
    edit(() => {
      const current = doc.get(selected);
      if (key === 'svMode') {
        current.data.mode = value;
        if (value === 'range') {
          current.data.endMultiplier = 1;
          current.data.durationBeats = 4;
          current.data.easing = 'smoothstep';
          delete current.data.durationSeconds;
        } else {
          delete current.data.endMultiplier;
          delete current.data.durationBeats;
          delete current.data.durationSeconds;
          delete current.data.easing;
        }
      } else if (key === 'svDurationUnit') {
        const duration = doc.duration(current);
        if (value === 'seconds') {
          current.data.durationSeconds = Number(duration.toFixed(6));
          delete current.data.durationBeats;
        } else {
          current.data.durationBeats = Number((duration * doc.metadata.bpm / 60).toFixed(9));
          delete current.data.durationSeconds;
        }
      } else if (key === 'svDuration') {
        if (current.data.durationSeconds !== undefined) current.data.durationSeconds = value;
        else current.data.durationBeats = value;
      } else if (key === 'unit') {
        const time = doc.time(current);
        const end = current.kind === 'note' && doc.duration(current) > 0 ? doc.endTime(current) : null;
        delete current.data.beat;
        delete current.data.timeSeconds;
        if (value === 'seconds') current.data.timeSeconds = Number(time.toFixed(6));
        else current.data.beat = Number(doc.beat(time).toFixed(9));
        if (end !== null) {
          delete current.data.endTimeSeconds; delete current.data.endBeat;
          doc.setEndTime(current, end);
        }
      } else if (key === 'noteType') {
        if (value === 'hold') doc.setEndTime(current, doc.time(current) + 60 / doc.metadata.bpm);
        else { delete current.data.endTimeSeconds; delete current.data.endBeat; }
      } else if (key === 'endStamp') {
        if (current.data.endTimeSeconds !== undefined) current.data.endTimeSeconds = value;
        else current.data.endBeat = value;
      } else if (key === 'stamp') {
        if (current.data.timeSeconds !== undefined) current.data.timeSeconds = value;
        else current.data.beat = value;
      } else if (key === 'inheritColor') {
        if (value) delete current.data.color; else current.data.color = current.data.type === 'backgroundStage' ? '#ffffff' : '#43ddff';
      } else if (key.includes('.')) {
        const [vector, axis] = key.split('.');
        current.data[vector] = [...(current.data[vector] ?? EFFECTS[current.data.type].defaults[vector])];
        current.data[vector][Number(axis)] = value;
      } else {
        current.data[key] = key === 'lane' ? Number(value) : key === 'src' ? value || null : value;
        if (key === 'durationSeconds') doc.fitFade(current);
      }
    });
  });
  for (const checkbox of $('properties-content').querySelectorAll('[data-lane]')) checkbox.addEventListener('change', () => {
    const lanes = [...$('properties-content').querySelectorAll('[data-lane]:checked')].map(input => Number(input.dataset.lane));
    edit(() => { const current = doc.get(selected); delete current.data.lane; current.data.lanes = lanes; });
  });
  $('btn-prop-duplicate').onclick = duplicateSelection;
  $('btn-prop-delete').onclick = removeSelection;
}

async function loadProject(next) {
  if (next.osuFiles) next = await importOsuFiles(next.osuFiles, chooseOsuDifficulty);
  const candidate = new ChartDocument(next.source);
  engine.pause();
  if (next.audio) await engine.loadAudioFromBuffer(await next.audio.arrayBuffer());
  else engine.audioManager.clear();
  if (next.imported) {
    candidate.metadata.durationSeconds = Math.max(candidate.metadata.durationSeconds, engine.audioManager.audioBuffer?.duration ?? 0);
    candidate.saved = '';
  }
  doc = candidate;
  selected = null;
  project = { ...next, models: next.models ?? new Map(), audioDirty: false };
  engine.setSceneBaseURL(project.baseUrl ?? null);
  engine.stop();
  $('drop-zone').classList.add('hidden');
  timeline.container.scrollLeft = 0;
  changed();
  status(next.warning || next.label + ' を開きました。');
}
function chooseOsuDifficulty(maps) {
  const dialog = $('osu-difficulty-dialog');
  const select = $('osu-difficulty');
  select.replaceChildren(...maps.map((map, index) => new Option(map.version + ' / ' + (map.sections.HitObjects?.length ?? 0) + 'ノーツ', String(index))));
  return new Promise((resolve, reject) => {
    dialog.addEventListener('close', () => {
      if (dialog.returnValue === 'open') resolve(maps[Number(select.value)]);
      else reject(new DOMException('読み込みを取り消しました。', 'AbortError'));
    }, { once: true });
    dialog.returnValue = '';
    dialog.showModal();
  });
}
async function refreshSongs() {
  const response = await fetch('/api/songs', { cache: 'no-store' });
  if (!response.ok) throw new Error('ゲームのサーバーを起動すると曲一覧を取得できます。フォルダからも開けます。');
  const data = await response.json();
  songs = data.songs ?? [];
  const selectElement = $('server-song');
  const selectedId = selectElement.value;
  selectElement.replaceChildren(new Option('ゲームの曲', ''));
  for (const song of songs) selectElement.add(new Option(song.title, song.id));
  selectElement.value = selectedId;
}
async function saveProject() {
  const source = doc.export();
  let directory = project.directory;
  if (!directory) {
    if (!window.showDirectoryPicker) throw new Error('このブラウザーではフォルダへ直接保存できません。「JSON保存」を使ってください。');
    directory = await window.showDirectoryPicker({ mode: 'readwrite' });
  }
  const same = project.directory && await directory.isSameEntry(project.directory);
  status('保存しています…');
  const saved = await saveDirectory(directory, source, project.audio, !same || project.audioDirty, project.models, !same);
  project.directory = directory;
  project.audio = saved.audio;
  project.models = saved.models;
  project.audioDirty = false;
  doc.markSaved();
  changed();
  status(directory.name + '/chart.json を保存しました。ゲーム側の選曲画面で選び直すと反映します。');
}

$('btn-new').onclick = () => {
  if (busy) return;
  engine.stop(); engine.audioManager.clear();
  doc = new ChartDocument(); selected = null;
  project = { directory: null, audio: null, audioDirty: false, models: new Map(), label: '新規曲' };
  engine.setSceneBaseURL(null);
  $('drop-zone').classList.add('hidden');
  timeline.container.scrollLeft = 0;
  changed(); status('新規曲 / 音声を選び、タイムラインにノーツを配置してください。');
};
$('btn-load-folder').onclick = () => run(async () => {
  if (window.showDirectoryPicker) await loadProject(await readDirectory(await window.showDirectoryPicker({ mode: 'read' })));
  else $('file-folder-input').click();
});
$('file-folder-input').onchange = event => {
  const files = [...event.target.files];
  event.target.value = '';
  if (files.length) run(async () => { await loadProject(await readFiles(files)); });
};
$('btn-audio').onclick = () => { if (!busy) $('audio-input').click(); };
$('btn-osu-import').onclick = () => { if (!busy) $('osu-input').click(); };
$('osu-input').onchange = event => {
  const files = [...event.target.files];
  event.target.value = '';
  if (files.length) run(async () => { await loadProject({ osuFiles: files.map(file => ({ file, path: file.name })) }); });
};
$('btn-model').onclick = () => { if (!busy) $('model-input').click(); };
$('model-input').onchange = event => {
  const files = [...event.target.files];
  event.target.value = '';
  if (!files.length) return;
  run(async () => {
    if (files.some(file => !/\.glb$/i.test(file.name))) throw new Error('GLB形式のファイルを選んでください。');
    const current = doc.get(selected);
    let firstPath = null;
    for (const file of files) {
      let path = file.name;
      if (files.length === 1 && current?.data.type === 'backgroundGLB' && current.data.src) {
        const target = assetPath(current.data.src);
        if (target.split('/').at(-1) === file.name) path = target;
      }
      firstPath ??= path;
      project.models.set(path, { file, dirty: true });
    }
    if (current?.data.type === 'backgroundGLB') doc.change(() => { doc.get(selected).data.src = assetURLPath(firstPath); });
    changed();
    status(files.length + '件のGLBを読み込みました。「背景GLB」演出で使用できます。フォルダ保存で一緒に保存します。');
  });
};
$('audio-input').onchange = event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  run(async () => {
    await engine.loadAudioFromBuffer(await file.arrayBuffer());
    doc.change(() => {
      doc.metadata.audio = assetURLPath(file.name);
      delete doc.metadata.audioUrl;
      doc.metadata.durationSeconds = Math.max(engine.audioManager.audioBuffer.duration, doc.requiredEnd());
    });
    project.audio = file;
    project.audioDirty = true;
    $('drop-zone').classList.add('hidden');
    changed(); status('音声を読み込みました。フォルダ保存時に一緒に保存します。');
  });
};
for (const element of [$('drop-zone'), $('viewport-container')]) {
  element.addEventListener('dragover', event => { event.preventDefault(); $('drop-zone').classList.add('dragging'); });
  element.addEventListener('dragleave', () => $('drop-zone').classList.remove('dragging'));
}
$('viewport-container').addEventListener('drop', event => {
  event.preventDefault(); $('drop-zone').classList.remove('dragging');
  const files = droppedFiles(event.dataTransfer);
  run(async () => { await loadProject(await readFiles(await files)); });
});
$('btn-refresh').onclick = () => run(async () => { await refreshSongs(); status('曲一覧を更新しました。'); });
$('btn-server-open').onclick = () => run(async () => {
  const song = songs.find(song => song.id === $('server-song').value);
  if (!song) throw new Error('開く曲を選んでください。');
  await loadProject(await readServerSong(song));
});
$('btn-save').onclick = () => run(saveProject);
$('btn-export').onclick = () => {
  if (busy) return;
  try { downloadJSON(doc.export()); status('chart.jsonをダウンロードしました。音声と同じ曲フォルダに配置してください。'); }
  catch (error) { showError(error); }
};
$('btn-add-note').onclick = () => addItem('note', currentTime, Number($('note-lane').value));
$('btn-add-sv').onclick = () => addItem('sv', currentTime);
$('btn-add-effect').onclick = () => addItem('event', currentTime, $('effect-type').value);
$('btn-play').onclick = () => run(async () => {
  if (engine.isPlaying) engine.pause();
  else { flushPreview(); status('背景を準備しています…'); await engine.play(); status('再生中'); }
});
$('btn-stop').onclick = () => engine.stop();
$('seek-time').onchange = event => { if (!busy) engine.seekTo(Number(event.target.value) * 1000).catch(showError); };
$('btn-undo').onclick = () => { if (!busy) { doc.undo(); changed(); } };
$('btn-redo').onclick = () => { if (!busy) { doc.redo(); changed(); } };
$('btn-zoom-in').onclick = () => timeline.zoom(1.5);
$('btn-zoom-out').onclick = () => timeline.zoom(1 / 1.5);
function snapChanged() {
  const beat = $('snap-mode').value === 'beat';
  $('snap-beat-div').hidden = !beat;
  $('snap-ms-val').hidden = beat;
  timeline.render();
}
$('snap-mode').onchange = snapChanged;
$('snap-beat-div').onchange = snapChanged;
$('snap-ms-val').onchange = snapChanged;
$('metronome-toggle').onchange = event => { engine.metronomeEnabled = event.target.checked; engine.lastScheduledBeat = null; };
$('metronome-vol').oninput = event => { engine.metronomeVolume = Number(event.target.value); };
$('menu-dup-event').onclick = () => { duplicateSelection(); $('context-menu').hidden = true; };
$('menu-del-event').onclick = () => { removeSelection(); $('context-menu').hidden = true; };
window.addEventListener('pointerdown', event => { if (!event.target.closest('#context-menu')) $('context-menu').hidden = true; });

// マウスで操作した選択肢やボタンは、完了後に編集ショートカットへ戻す。
// Tabで移動したコントロールは、キーボードでの選択操作を継続できる。
let pointerControl = null;
document.addEventListener('pointerdown', event => {
  pointerControl = event.target.closest('button,select,input') ?? event.target.closest('label')?.control ?? null;
}, true);
document.addEventListener('change', event => {
  const target = event.target;
  if (target !== pointerControl || target.closest('dialog')) return;
  if (target.matches('select,input[type=checkbox],input[type=radio],input[type=range],input[type=color]')) {
    target.blur();
    pointerControl = null;
  }
});
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button && button === pointerControl && !button.closest('dialog')) {
    button.blur();
    pointerControl = null;
  }
});
document.addEventListener('keydown', event => {
  if (event.code === 'Tab') pointerControl = null;
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  const input = event.target.closest('input,select,textarea,[contenteditable]');
  if (!input || input.closest('dialog')) return;
  if (event.code === 'Escape' || event.code === 'Enter' && !input.matches('textarea,[contenteditable]')) {
    event.preventDefault();
    input.blur();
    pointerControl = null;
  }
}, true);

function handleShortcut(event) {
  if (busy || timeline.dragging || event.isComposing) return;
  const control = event.ctrlKey || event.metaKey;
  const input = event.target.closest('input,select,textarea,[contenteditable]');
  if (input && !(control && event.code === 'KeyS')) return;
  if (control && event.code === 'KeyS') {
    event.preventDefault();
    input?.blur();
    if (event.shiftKey) $('btn-export').click(); else $('btn-save').click();
  } else if (control && event.code === 'KeyZ') {
    event.preventDefault(); (event.shiftKey ? $('btn-redo') : $('btn-undo')).click();
  } else if (control && event.code === 'KeyY') { event.preventDefault(); $('btn-redo').click(); }
  else if (control && event.code === 'KeyD') { event.preventDefault(); duplicateSelection(); }
  else if (event.code === 'Delete' || event.code === 'Backspace') { event.preventDefault(); removeSelection(); }
  else if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) $('btn-play').click(); }
  else if (!control && !event.altKey && ['KeyD', 'KeyF', 'KeyJ', 'KeyK'].includes(event.code)) {
    event.preventDefault(); if (!event.repeat) addItem('note', currentTime, ['KeyD', 'KeyF', 'KeyJ', 'KeyK'].indexOf(event.code));
  } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
    event.preventDefault(); engine.seekTo(Math.max(0, currentTime + (event.code === 'ArrowRight' ? 1 : -1) * snapStep()) * 1000).catch(showError);
  }
}
window.addEventListener('keydown', handleShortcut);
engine.onKey = data => handleShortcut({ ...data, target: $('preview-frame'), preventDefault() {} });
$('timeline-resizer').addEventListener('pointerdown', event => {
  event.preventDefault();
  const resize = pointer => { $('timeline-panel').style.height = Math.max(150, Math.min(innerHeight - 240, innerHeight - pointer.clientY - 28)) + 'px'; };
  const finish = () => { window.removeEventListener('pointermove', resize); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); };
  window.addEventListener('pointermove', resize);
  window.addEventListener('pointerup', finish, { once: true });
  window.addEventListener('pointercancel', finish, { once: true });
});
new ResizeObserver(() => { if (!timeline.dragging) timeline.render(); }).observe(timeline.container);
window.addEventListener('pagehide', () => engine.dispose(), { once: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) engine.pause(); });
const invalidateAudioClock = () => engine.audioManager.frameClock.invalidate();
window.addEventListener('focus', invalidateAudioClock);
window.addEventListener('pageshow', invalidateAudioClock);
document.addEventListener('freeze', () => engine.pause());
document.addEventListener('resume', invalidateAudioClock);
snapChanged();
changed();
refreshSongs().catch(() => {});
