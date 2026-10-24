import { CONFIG } from './config.js';

export const SONGS_PER_PAGE = 5;
export const SONG_CARD_LAYOUT = Object.freeze({ y: 190, width: 650, height: 96, step: 120 });
export const SONG_LIST_OUTLINE = Object.freeze([[310, 0], [1100, 0], [790, 968], [0, 968]]);
export const START_OUTLINE = Object.freeze([[35, 25], [195, 125], [35, 225]]);

export function containsPolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i], [bx, by] = points[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
export function songAccent(id = '') {
  let hash = 0;
  for (const character of String(id)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return CONFIG.colors[hash % CONFIG.colors.length];
}
export function placeSongCard(center, card, depth) {
  const layout = SONG_CARD_LAYOUT;
  const rowY = layout.y + layout.step * card.songSlot + layout.height / 2;
  const rowX = 310 * (1 - rowY / 968) + 70 + layout.width / 2;
  const x = (rowX / center.canvas.width - 0.5) * center.width;
  const y = (0.5 - rowY / center.canvas.height) * center.height;
  const yaw = center.mesh.rotation.y;
  card.mesh.position.set(center.mesh.position.x + x * Math.cos(yaw) + depth * Math.sin(yaw),
    center.mesh.position.y + y, center.mesh.position.z - x * Math.sin(yaw) + depth * Math.cos(yaw));
  card.mesh.rotation.set(0, yaw, 0);
}

// 斜めの一覧と三角ボタンにも厚みを付ける。形状は生成時に一度だけ作る。
export class SongSelectionStage {
  constructor(T, center, details, cards, difficultyPanel, startPanel) {
    this.T = T;
    this.center = center;
    this.cards = cards;
    this.resources = new Set();
    this.groups = [];
    this.listShell = this.shell(center, '#43ddff', SONG_LIST_OUTLINE);
    this.shell(details, '#7085ac');
    if (difficultyPanel) this.shell(difficultyPanel, '#7085ac');
    if (startPanel) this.shell(startPanel, '#43ddff', START_OUTLINE);
    for (const card of cards) card.selectionShell = this.shell(card, '#345169');
    this.lastTime = null;
  }
  resource(value) { this.resources.add(value); return value; }
  shell(panel, accent, outline) {
    const T = this.T;
    const group = new T.Group();
    panel.mesh.add(group);
    this.groups.push(group);
    let geometry;
    if (outline) {
      const shape = new T.Shape();
      outline.forEach(([x, y], index) => shape[index ? 'lineTo' : 'moveTo']((x / panel.canvas.width - 0.5) * panel.width, (0.5 - y / panel.canvas.height) * panel.height));
      shape.closePath();
      geometry = new T.ExtrudeGeometry(shape, { depth: 0.032, bevelEnabled: false, steps: 1 });
    } else geometry = new T.BoxGeometry(panel.width + 0.008, panel.height + 0.008, 0.032);
    this.resource(geometry);
    const bodyMaterial = this.resource(new T.MeshBasicMaterial({ color: '#071322', transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false }));
    const body = new T.Mesh(geometry, bodyMaterial);
    body.position.z = outline ? -0.035 : -0.019;
    group.add(body);
    const edgeMaterial = this.resource(new T.LineBasicMaterial({ color: accent, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false }));
    const edge = new T.LineSegments(this.resource(new T.EdgesGeometry(geometry)), edgeMaterial);
    edge.position.z = body.position.z;
    group.add(edge);
    const edgeFade = { material: edgeMaterial, opacity: 0.5 };
    panel.fadeMaterials.push({ material: bodyMaterial, opacity: 1 }, edgeFade);
    panel.mesh.material.fog = false;
    return { group, edgeMaterial, edgeFade };
  }
  update(ui, now) {
    const shown = ui.center.mesh.visible && ui.center.viewKey?.startsWith('songs:');
    this.listShell.group.visible = Boolean(shown);
    if (!shown && !this.cards.some(card => card.mesh.visible)) { this.lastTime = null; return; }
    const delta = this.lastTime === null ? 1 : Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    const songs = ui.selectionSongs();
    for (const card of this.cards) {
      const song = songs[ui.songPage * SONGS_PER_PAGE + card.songSlot];
      const selected = Boolean(song && song.id === ui.songLibrary.selectedId);
      const hovered = Boolean(song && ui.isHovered(card, 'song-' + song.id));
      const target = selected ? 0.035 : hovered ? 0.022 : 0.009;
      card.selectionDepth = !card.mesh.visible || card.selectionDepth === undefined ? target
        : card.selectionDepth + (target - card.selectionDepth) * (1 - Math.exp(-delta * 18));
      placeSongCard(this.center, card, card.selectionDepth);
      const shell = card.selectionShell;
      const state = selected ? 'selected' : hovered ? 'hovered' : 'idle';
      if (shell.state !== state) {
        shell.state = state;
        shell.edgeMaterial.color.set(selected ? '#43ddff' : hovered ? '#86b6d5' : '#345169');
      }
      shell.edgeFade.opacity = selected ? 0.95 : hovered ? 0.7 : 0.35;
      shell.edgeMaterial.opacity = shell.edgeFade.opacity * card.displayOpacity;
    }
  }
  dispose() {
    for (const group of this.groups) group.removeFromParent();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
  }
}
