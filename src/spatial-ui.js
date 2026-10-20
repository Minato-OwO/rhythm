import { CONFIG, JUDGEMENTS, PLAY_SETTING_DEFINITIONS, LANE_SETTING_DEFINITIONS, GAUGE_SETTING_DEFINITIONS, EFFECT_SETTING_DEFINITIONS, PANEL_GROUPS, PANEL_SETTING_DEFINITIONS, PANEL_OFFSET_DEFINITIONS, PAIRED_PANEL_ANGLE_SETTING } from './config.js';
import { clearStatusForScore } from './clear-status.js';
import { intersectPanel } from './panel-hit.js';

const INK = '#edf5ff';
const MUTED = '#8da3bd';
const CYAN = '#43ddff';
const WARNING = '#ffcf7a';
const COUNT_START_Y = 620;
const COUNT_ROW_HEIGHT = 44;
const FONT = '"Segoe UI", "Yu Gothic UI", sans-serif';
const FADE_OUT_MS = 90;
const FADE_IN_MS = 140;
const PANEL_FOCUS_HOLD_MS = 220;
const PANEL_FOCUS_FADE_OUT_MS = 240;
const SELECTION_PANEL_GAP = 0.08;

function formatTime(time) {
  const value = Math.max(0, Math.floor(time));
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}

function formatAccuracy(accuracy, bonusAccuracy) {
  return `${accuracy.toFixed(2)}% + ${bonusAccuracy.toFixed(2)}%`;
}

// メニューも設定もCanvasTextureを貼った3D平面。HTMLオーバーレイは使わない。
export class SpatialUI {
  constructor(scene, view, game, settings, actions, songLibrary) {
    this.scene = scene;
    this.view = view;
    this.game = game;
    this.settings = settings;
    this.actions = actions;
    this.songLibrary = songLibrary;
    this.songSelectionOpen = false;
    this.songPage = 0;
    this.difficultyPage = 0;
    this.T = AFRAME.THREE;
    const T = this.T;
    this.root = new T.Group();
    scene.object3D.add(this.root);
    this.panels = [];
    this.settingsOpen = false;
    this.settingsReturnToSongs = false;
    this.settingsTab = 'play';
    this.panelTarget = 'all';
    this.panelLayoutDirty = true;
    this.screenKey = null;
    this.pendingScreenKey = null;
    this.screenPhase = 'stable';
    this.settingsCenterPosition = new T.Vector3();
    this.settingsCenterYaw = 0;
    this.menuAnchorPosition = new T.Vector3();
    this.menuAnchorYaw = 0;
    this.busy = false;
    this.message = '';
    this.lastTrackSecond = -1;
    this.lastTrackPercent = -1;
    this.anchorDirty = true;
    this.pointerFrame = 0;
    this.gazeHit = this.makePickResult();
    this.mouseHit = this.makePickResult();
    this.hover = new Map();
    this.focusedPanels = new Set();
    this.mousePresent = false;
    this.xrPointers = new Map();
    this.raycaster = new T.Raycaster();
    this.mouse = new T.Vector2();
    this.rayOrigin = new T.Vector3();
    this.rayDirection = new T.Vector3();
    this.pointerEndpoint = new T.Vector3();
    this.quaternion = new T.Quaternion();
    this.rig = scene.querySelector('#rig').object3D;
    this.left = this.makePanel('track', 0.8, 1.03, 768, 990, settings.panelLeftX, settings.panelLeftY, -settings.panelLeftDistance, settings.panelLeftYaw * Math.PI / 180);
    this.right = this.makePanel('stats', 0.8, 1.03, 768, 990, settings.panelRightX, settings.panelRightY, -settings.panelRightDistance, settings.panelRightYaw * Math.PI / 180);
    this.sidePanels = [this.left, this.right];
    this.center = this.makePanel('menu', 1.42, 1.25, 1100, 968, settings.panelCenterX, settings.panelCenterY, -settings.panelCenterDistance);
    this.details = this.makePanel('details', 1.12, 1.4, 1000, 1250, 0, settings.panelCenterY, -settings.panelCenterDistance);
    this.details.mesh.visible = false;
    this.notice = this.makePanel('notice', 1.55, 0.18, 1240, 144, settings.panelCenterX, settings.panelCenterY + 0.8, -settings.panelCenterDistance - 0.05);
    this.drawOrder = [this.notice, this.center, this.details, this.right, this.left];
    this.progressFill = this.makeOverlay(this.left, 48, 530, 672, 12, CYAN);
    this.progressLeft = this.progressFill.position.x - this.progressFill.geometry.parameters.width / 2;
    this.keyFlashes = CONFIG.colors.map((color, lane) => this.makeOverlay(this.left, 48 + lane * 172, 637, 156, 76, color, true));
    this.elapsedText = this.makeDynamicText(this.left, 48, 491, 36);
    this.percentText = this.makeDynamicText(this.left, 720, 579, 24, MUTED, 'right');
    this.scoreText = this.makeDynamicText(this.right, 48, 188, 72);
    this.accuracyText = this.makeDynamicText(this.right, 48, 365, 64, CYAN);
    this.comboText = this.makeDynamicText(this.right, 48, 535, 66);
    this.maxComboText = this.makeDynamicText(this.right, 400, 535, 66);
    this.countTexts = {};
    Object.entries(JUDGEMENTS).forEach(([rating, { color }], index) => {
      this.countTexts[rating] = this.makeDynamicText(this.right, index % 2 ? 720 : 350, COUNT_START_Y + Math.floor(index / 2) * COUNT_ROW_HEIGHT, 23, color, 'right');
    });
    this.statsDirty = true;
    this.durationText = formatTime(game.chart.duration);
    this.bindMouse();
    this.update(performance.now());
  }

  makePanel(id, width, height, pixelWidth, pixelHeight, x, y, z, yaw = 0) {
    const T = this.T;
    const canvas = document.createElement('canvas');
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    // 頻繁に変わるUI画像では、アップロードのたびの縮小画像生成を避ける。
    texture.generateMipmaps = false;
    texture.minFilter = T.LinearFilter;
    texture.magFilter = T.LinearFilter;
    const material = new T.MeshBasicMaterial({ map: texture, toneMapped: false, side: T.DoubleSide, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new T.Mesh(new T.PlaneGeometry(width, height), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.visible = false;
    const panel = {
      id, mesh, canvas, texture, width, height, ctx: canvas.getContext('2d'), regions: [], dirty: true, lastDraw: -Infinity,
      targetVisible: false, viewKey: null, desiredViewKey: null, opacity: 0,
      fadeFrom: 0, fadeTo: 0, fadeStarted: 0, fadeDuration: 0,
      focusOpacity: 1, focusFrom: 1, focusTo: 1, focusStarted: 0, focusDuration: 0, lastFocused: -Infinity,
      displayOpacity: 0,
      fadeMaterials: [{ material, opacity: 1 }],
    };
    mesh.userData.panel = panel;
    this.panels.push(panel);
    this.root.add(mesh);
    return panel;
  }

  makeOverlay(panel, x, y, width, height, color, additive = false) {
    const T = this.T;
    const mesh = new T.Mesh(
      new T.PlaneGeometry(width / panel.canvas.width * panel.width, height / panel.canvas.height * panel.height),
      new T.MeshBasicMaterial({ color, transparent: true, opacity: additive ? 0.45 : 1, blending: additive ? T.AdditiveBlending : T.NormalBlending, depthWrite: false, toneMapped: false }),
    );
    mesh.position.set(((x + width / 2) / panel.canvas.width - 0.5) * panel.width, (0.5 - (y + height / 2) / panel.canvas.height) * panel.height, 0.002);
    mesh.renderOrder = 1;
    panel.fadeMaterials.push({ material: mesh.material, opacity: mesh.material.opacity });
    mesh.material.opacity *= panel.opacity;
    panel.mesh.add(mesh);
    return mesh;
  }

  makeDynamicText(panel, x, y, fontSize, color = INK, align = 'left') {
    const text = this.view.glyphAtlas.createText({
      height: fontSize / panel.canvas.height * panel.height,
      horizontalScale: (panel.width / panel.canvas.width) / (panel.height / panel.canvas.height),
      color, align,
    });
    text.mesh.position.set((x / panel.canvas.width - 0.5) * panel.width, (0.5 - y / panel.canvas.height) * panel.height, 0.004);
    panel.mesh.add(text.mesh);
    panel.fadeMaterials.push({ material: text.mesh.material, opacity: 1 });
    text.mesh.material.opacity = panel.opacity;
    return text;
  }

  markStatsDirty() { this.statsDirty = true; }

  chartChanged() {
    this.durationText = formatTime(this.game.chart.duration);
    this.lastTrackSecond = -1;
    this.lastTrackPercent = -1;
    this.statsDirty = true;
    this.invalidate();
  }

  selectedSong() { return this.songLibrary.songs.find(song => song.id === this.songLibrary.selectedId); }

  canPlaySelection() {
    return Boolean(this.selectedSong()?.difficulties.some(difficulty => difficulty.id === this.songLibrary.selectedDifficultyId));
  }

  selectionChanged() {
    const index = this.songLibrary.songs.findIndex(song => song.id === this.songLibrary.selectedId);
    this.songPage = Math.floor(Math.max(0, index) / 5);
    const difficultyIndex = this.selectedSong()?.difficulties.findIndex(difficulty => difficulty.id === this.songLibrary.selectedDifficultyId) ?? 0;
    this.difficultyPage = Math.floor(Math.max(0, difficultyIndex) / 4);
    this.invalidate('menu');
    this.invalidate('details');
    this.invalidate('stats');
  }

  updateStatsText() {
    this.scoreText.setText(this.game.score.toString().padStart(7, '0'));
    this.accuracyText.setText(formatAccuracy(this.game.accuracy, this.game.bonusAccuracy));
    this.comboText.setText(this.game.combo);
    this.maxComboText.setText(this.game.maxCombo);
    for (const rating in this.countTexts) this.countTexts[rating].setText(this.game.counts[rating]);
    this.statsDirty = false;
  }

  setBusy(value) { if (value !== this.busy) { this.busy = value; this.invalidate(); } }
  setMessage(value) { if (value !== this.message) { this.message = value; this.notice.dirty = true; } }
  showSettings() {
    if (this.settingsOpen) return;
    this.settingsReturnToSongs = this.songSelectionOpen;
    this.closeSongSelection();
    this.settingsCenterPosition.copy(this.menuAnchorPosition);
    this.settingsCenterYaw = this.menuAnchorYaw;
    this.settingsOpen = true;
    this.center.dirty = true;
    this.invalidate('stats');
  }
  closeSettings(restoreSongSelection = true) {
    if (!this.settingsOpen) return;
    this.settingsOpen = false;
    if (restoreSongSelection && this.settingsReturnToSongs) this.songSelectionOpen = true;
    this.settingsReturnToSongs = false;
    this.center.dirty = true;
    this.panelLayoutDirty = true;
    this.invalidate('stats');
  }
  showSongSelection() {
    this.closeSettings(false);
    this.songSelectionOpen = true;
    this.panelLayoutDirty = true;
    this.center.dirty = true;
    this.details.dirty = true;
    this.invalidate('stats');
  }
  closeSongSelection() {
    if (!this.songSelectionOpen) return;
    this.songSelectionOpen = false;
    this.panelLayoutDirty = true;
    this.center.dirty = true;
    this.invalidate('stats');
  }
  layoutChanged() { this.panelLayoutDirty = true; }
  applyPanelLayout() {
    for (const group of PANEL_GROUPS) {
      const panel = group.id === 'track' ? this.left : group.id === 'stats' ? this.right : this.center;
      if (group.id === 'menu' && this.settingsOpen) {
        panel.mesh.position.copy(this.settingsCenterPosition);
        panel.mesh.rotation.y = this.settingsCenterYaw;
      } else {
        panel.mesh.position.set(
          this.settings[`${group.prefix}X`] + this.settings.panelOffsetX,
          this.settings[`${group.prefix}Y`] + this.settings.panelOffsetY,
          -this.settings[`${group.prefix}Distance`] + this.settings.panelOffsetZ,
        );
        panel.mesh.rotation.y = this.settings[`${group.prefix}Yaw`] * Math.PI / 180;
      }
    }
    const menuYaw = this.center.mesh.rotation.y;
    const cosine = Math.cos(menuYaw);
    const sine = Math.sin(menuYaw);
    this.menuAnchorPosition.copy(this.center.mesh.position);
    this.menuAnchorYaw = menuYaw;
    const selectionLayout = this.songSelectionOpen && !this.settingsOpen;
    // 中央の設定位置を2枚全体の中心とする。前後方向の追加補正は入れない。
    const listOffset = selectionLayout ? -(this.details.width + SELECTION_PANEL_GAP) / 2 : 0;
    const detailsOffset = selectionLayout
      ? (this.center.width + SELECTION_PANEL_GAP) / 2
      : (this.center.width + this.details.width) / 2 + SELECTION_PANEL_GAP;
    this.center.mesh.position.x += listOffset * cosine;
    this.center.mesh.position.z -= listOffset * sine;
    this.details.mesh.position.copy(this.menuAnchorPosition);
    this.details.mesh.position.x += detailsOffset * cosine;
    this.details.mesh.position.z -= detailsOffset * sine;
    this.details.mesh.rotation.set(0, menuYaw, 0);
    this.notice.mesh.position.copy(this.menuAnchorPosition);
    this.notice.mesh.position.y += 0.8;
    this.notice.mesh.position.z -= 0.05;
    this.panelLayoutDirty = false;
    this.anchorDirty = true;
  }
  invalidate(id) { for (const panel of this.panels) if (!id || panel.id === id) panel.dirty = true; }

  setPanelVisible(panel, visible) {
    if (panel.targetVisible === visible) return;
    panel.targetVisible = visible;
    if (visible) panel.dirty = true;
  }

  screenViewKey() {
    if (this.settingsOpen) return 'settings';
    if (this.songSelectionOpen) return 'songs';
    return this.game.state;
  }

  prepareScreenTransition(now) {
    for (const panel of this.panels) this.samplePanelFade(panel, now);
    const key = this.screenViewKey();
    if (this.pendingScreenKey !== key) {
      this.pendingScreenKey = key;
      // 読み替え準備中の再操作は、見えていないまま最新の行き先へ差し替える。
      this.screenPhase = this.screenKey === null || this.screenPhase === 'prepare' ? 'prepare' : 'out';
      if (this.screenPhase === 'prepare') {
        this.panelLayoutDirty = true;
        this.invalidate();
      }
    }
    if (this.screenPhase === 'out' && this.panels.every(panel => panel.opacity === 0)) {
      this.screenPhase = 'prepare';
      this.panelLayoutDirty = true;
      this.invalidate();
    }
    // 表示中のパネルを移動しない。全て消えてから新しい配置を適用する。
    if (this.panelLayoutDirty && this.screenPhase !== 'out') this.applyPanelLayout();
  }

  finishScreenTransition(now) {
    if (this.screenPhase !== 'prepare') return;
    const prepared = this.panels.every(panel => !panel.targetVisible || !panel.dirty && panel.viewKey === panel.desiredViewKey);
    if (!prepared) return;
    this.screenKey = this.pendingScreenKey;
    this.screenPhase = 'stable';
    // 画像の準備が揃うまで透明を維持し、2枚を同じ時刻からフェードインする。
    for (const panel of this.panels) if (panel.targetVisible) this.startPanelFade(panel, 1, now);
  }

  panelViewKey(panel) {
    if (panel === this.center) {
      if (this.settingsOpen) return 'settings:' + this.settingsTab + (this.settingsTab === 'panels' ? ':' + this.panelTarget : '');
      if (this.songSelectionOpen) return 'songs:' + this.songPage + ':' + this.songLibrary.selectedId;
      return this.game.state;
    }
    if (panel === this.details) return 'details:' + this.songLibrary.selectedId + ':' + this.songLibrary.selectedDifficultyId + ':' + this.difficultyPage;
    if (panel === this.notice) return this.message;
    return panel.id;
  }

  startPanelFade(panel, target, now) {
    if (panel.fadeTo === target) return;
    panel.fadeFrom = panel.opacity;
    panel.fadeTo = target;
    panel.fadeStarted = now;
    panel.fadeDuration = target ? FADE_IN_MS : FADE_OUT_MS;
  }

  samplePanelFade(panel, now) {
    const progress = panel.fadeDuration ? Math.max(0, Math.min(1, (now - panel.fadeStarted) / panel.fadeDuration)) : 1;
    const eased = progress * progress * (3 - 2 * progress);
    const opacity = progress === 1 ? panel.fadeTo : panel.fadeFrom + (panel.fadeTo - panel.fadeFrom) * eased;
    if (opacity === panel.opacity) return;
    panel.opacity = opacity;
    this.applyPanelOpacity(panel);
  }

  applyPanelOpacity(panel) {
    const opacity = panel.opacity * panel.focusOpacity;
    if (opacity === panel.displayOpacity) return;
    panel.displayOpacity = opacity;
    for (const entry of panel.fadeMaterials) entry.material.opacity = entry.opacity * opacity;
    panel.mesh.material.depthWrite = opacity === 1;
  }

  autoHideSidePanels() {
    return this.game.state === 'playing' && !this.settingsOpen && !this.songSelectionOpen;
  }

  panelFocusable(panel) {
    return this.autoHideSidePanels() && panel.targetVisible && (panel === this.left || panel === this.right);
  }

  updateSidePanelFocus(now) {
    const autoHide = this.autoHideSidePanels();
    const inVR = this.scene.is('vr-mode');
    this.focusedPanels.clear();
    if (autoHide) {
      // 透明になったパネルも判定対象にし、見つめるだけで再表示できるようにする。
      this.scene.camera.getWorldPosition(this.rayOrigin);
      this.scene.camera.getWorldDirection(this.rayDirection);
      const gaze = this.pick(this.rayOrigin, this.rayDirection, this.gazeHit);
      if (gaze) this.focusedPanels.add(gaze.panel);
      if (!inVR && this.mousePresent) {
        // 見回し中は、マウスが静止していても現在の視点で判定し直す。
        this.raycaster.setFromCamera(this.mouse, this.scene.camera);
        const hit = this.pick(this.raycaster.ray.origin, this.raycaster.ray.direction);
        this.setHover('mouse', hit);
        this.canvas.style.cursor = hit?.region && !hit.region.disabled ? 'pointer' : '';
      }
      for (const [id, hit] of this.hover) {
        if (inVR ? id !== 'mouse' : id === 'mouse' && this.mousePresent) this.focusedPanels.add(hit.panel);
      }
      if (!inVR && this.pointerDown) this.focusedPanels.add(this.pointerDown.hit.panel);
    }
    for (const panel of this.sidePanels) {
      const progress = panel.focusDuration ? Math.max(0, Math.min(1, (now - panel.focusStarted) / panel.focusDuration)) : 1;
      const eased = progress * progress * (3 - 2 * progress);
      panel.focusOpacity = progress === 1 ? panel.focusTo : panel.focusFrom + (panel.focusTo - panel.focusFrom) * eased;
      if (autoHide && this.focusedPanels.has(panel)) panel.lastFocused = now;
      const target = !autoHide || this.focusedPanels.has(panel) || now - panel.lastFocused < PANEL_FOCUS_HOLD_MS ? 1 : 0;
      if (target !== panel.focusTo) {
        panel.focusFrom = panel.focusOpacity;
        panel.focusTo = target;
        panel.focusStarted = now;
        panel.focusDuration = target ? FADE_IN_MS : PANEL_FOCUS_FADE_OUT_MS;
      }
      // 画面切替で既に消えている間は直接揃え、プレイ開始時の一瞬の表示を防ぐ。
      if (panel.opacity === 0) {
        panel.focusOpacity = panel.focusFrom = target;
        panel.focusDuration = 0;
      }
      if (!autoHide) panel.lastFocused = -Infinity;
      this.applyPanelOpacity(panel);
    }
  }

  canUpdatePanelInPlace(panel) {
    if (this.screenPhase !== 'stable' || !this.songSelectionOpen || this.settingsOpen) return false;
    const prefix = panel === this.center ? 'songs:' : panel === this.details ? 'details:' : null;
    return Boolean(prefix && panel.viewKey?.startsWith(prefix) && panel.desiredViewKey?.startsWith(prefix));
  }

  updatePanelTransition(panel, now) {
    const key = this.panelViewKey(panel);
    if (panel.desiredViewKey !== key) {
      panel.desiredViewKey = key;
      panel.dirty = true;
    }
    const ready = panel.viewKey === panel.desiredViewKey;
    this.startPanelFade(panel, panel.targetVisible && (ready || this.canUpdatePanelInPlace(panel)) && this.screenPhase === 'stable' ? 1 : 0, now);
    panel.mesh.visible = panel.targetVisible && panel.focusOpacity > 0 || panel.displayOpacity > 0;
  }

  panelInteractive(panel) {
    return panel.targetVisible && panel.viewKey === panel.desiredViewKey && panel.displayOpacity >= 0.95 && panel.fadeTo === 1;
  }

  text(panel, value, x, y, size = 28, color = INK, align = 'left', weight = 400) {
    const ctx = panel.ctx;
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), x, y);
  }

  wrap(panel, value, x, y, maxWidth, size = 28, lineHeight = 40, maxLines = 3, color = INK) {
    const ctx = panel.ctx;
    ctx.font = `400 ${size}px ${FONT}`;
    const lines = [];
    let current = '';
    for (const character of String(value)) {
      if (character === '\n' || ctx.measureText(current + character).width > maxWidth) {
        lines.push(current);
        current = character === '\n' ? '' : character;
      } else current += character;
    }
    if (current) lines.push(current);
    lines.slice(0, maxLines).forEach((line, index) => {
      this.text(panel, index === maxLines - 1 && lines.length > maxLines ? line.slice(0, -1) + '…' : line, x, y + index * lineHeight, size, color);
    });
  }

  background(panel, title, accent = CYAN) {
    const { ctx, canvas } = panel;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    panel.regions = [];
    ctx.fillStyle = '#0b1525';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#30465f';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, canvas.width, 5);
    this.text(panel, title, 48, 53, 24, accent, 'left', 600);
  }

  isHovered(panel, id) {
    for (const hit of this.hover.values()) if (hit?.panel === panel && hit.region?.id === id) return true;
    return false;
  }

  button(panel, id, label, x, y, width, height, activate, { primary = false, disabled = false } = {}) {
    disabled ||= this.busy;
    const { ctx } = panel;
    const hovered = !disabled && this.isHovered(panel, id);
    ctx.fillStyle = disabled ? '#162131' : primary ? hovered ? '#a0efff' : CYAN : hovered ? '#29415e' : '#17283e';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = hovered ? CYAN : '#38516e';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
    this.text(panel, label, x + width / 2, y + height / 2, 28, disabled ? '#64748a' : primary ? '#07141f' : INK, 'center', 600);
    panel.regions.push({ id, x, y, width, height, disabled, activate });
  }

  drawTrack(now) {
    const panel = this.left;
    const ctx = panel.ctx;
    const { chart } = this.game;
    this.background(panel, 'FOUR FLOW / TRACK');
    this.text(panel, this.game.autoplay ? 'AUTO PLAY / 4 LANES' : this.scene.is('vr-mode') ? 'VR SWING / 4 LANES' : 'KEYBOARD / 4 KEYS', 48, 109, 23, this.game.autoplay ? CYAN : MUTED);
    this.wrap(panel, chart.title, 48, 180, 670, 51, 63, 3);
    this.text(panel, `${chart.bpm} BPM   /   ${chart.notes.length} NOTES`, 48, 371, 25, MUTED);
    this.text(panel, 'PROGRESS', 48, 444, 22, CYAN);
    ctx.fillStyle = '#24374e';
    ctx.fillRect(48, 530, 672, 12);
    ['D', 'F', 'J', 'K'].forEach((key, lane) => {
      ctx.fillStyle = '#182a40';
      ctx.fillRect(48 + lane * 172, 637, 156, 76);
      ctx.fillStyle = CONFIG.colors[lane];
      ctx.fillRect(48 + lane * 172, 710, 156, 3);
      this.text(panel, key, 126 + lane * 172, 675, 34, INK, 'center', 600);
    });
    this.text(panel, this.scene.is('vr-mode') ? 'レーン上の判定面へ振り下ろす' : '背景をドラッグして見回せます', 48, 767, 24, MUTED);
    this.button(panel, 'recenter', '位置合わせ', 48, 831, 324, 78, this.actions.recenter);
    this.button(panel, 'retry', 'リトライ', 396, 831, 324, 78, this.actions.restart, { disabled: this.game.state === 'idle' });
    this.text(panel, 'SPACE 選曲・開始・一時停止 / O 設定', 48, 949, 20, MUTED);
    panel.texture.needsUpdate = true;
  }

  drawStats() {
    const panel = this.right;
    const game = this.game;
    this.background(panel, game.autoplay ? 'PERFORMANCE / AUTO PLAY' : 'PERFORMANCE', '#ff9478');
    this.text(panel, 'SCORE', 48, 118, 24, MUTED);
    this.text(panel, 'ACCURACY', 48, 298, 24, MUTED);
    this.text(panel, 'COMBO', 48, 471, 24, MUTED);
    this.text(panel, 'MAX COMBO', 400, 471, 24, MUTED);
    Object.keys(game.counts).forEach((rating, index) => {
      const x = index % 2 ? 400 : 48;
      const y = COUNT_START_Y + Math.floor(index / 2) * COUNT_ROW_HEIGHT;
      this.text(panel, JUDGEMENTS[rating].label, x, y, 23, JUDGEMENTS[rating].color);
    });
    const label = this.songSelectionOpen ? 'この曲をプレイ' : game.state === 'playing' ? '一時停止' : game.state === 'paused' ? '再開する' : game.state === 'finished' ? 'もう一度プレイ' : 'プレイする';
    const playable = this.canPlaySelection();
    this.button(panel, 'toggle', label, 48, 756, 672, 78, this.songSelectionOpen ? this.actions.startSelected : this.actions.toggle, { primary: true, disabled: this.settingsOpen || this.songSelectionOpen && !playable });
    this.button(panel, 'songs', '選曲', 48, 858, 208, 78, this.actions.songs);
    this.button(panel, 'settings', '設定', 280, 858, 208, 78, this.actions.settings);
    this.button(panel, 'vr', this.scene.is('vr-mode') ? 'VRを終了' : 'VRでプレイ', 512, 858, 208, 78, this.actions.switchVR);
    panel.texture.needsUpdate = true;
  }

  drawPause() {
    const panel = this.center;
    const game = this.game;
    this.background(panel, game.autoplay ? 'PAUSE / AUTO PLAY' : 'PAUSE / 一時停止');
    this.text(panel, 'PAUSED', 550, 170, 90, CYAN, 'center', 600);
    this.wrap(panel, game.chart.title, 70, 275, 960, 36, 46, 2);
    this.text(panel, `${formatTime(game.songTime)} / ${this.durationText}`, 550, 375, 27, MUTED, 'center');
    this.button(panel, 'pause-resume', '再開', 70, 440, 960, 85, this.actions.resume, { primary: true });
    this.button(panel, 'pause-retry', 'リトライ', 70, 552, 960, 85, this.actions.restart);
    this.button(panel, 'pause-leave', '退出', 70, 664, 960, 85, this.actions.leave);
    this.text(panel, '退出すると演奏を終了し、選曲画面に戻ります', 550, 803, 25, MUTED, 'center');
    this.text(panel, this.scene.is('vr-mode') ? 'グリップ：再開 / トリガー：ボタンを選択' : 'SPACE / ESC：再開　R：リトライ', 550, 861, 24, MUTED, 'center');
    panel.texture.needsUpdate = true;
  }

  drawMenu() {
    const panel = this.center;
    const game = this.game;
    const inVR = this.scene.is('vr-mode');
    this.background(panel, game.state === 'finished' ? 'TRACK COMPLETE / RESULT' : 'WELCOME TO FOUR FLOW');
    if (game.state === 'finished') {
      const status = clearStatusForScore(game.score);
      const highClear = status.id === 'highClear';
      this.text(panel, `${status.title} / ${status.label}`, 550, 105, 24, status.color, 'center', 600);
      this.text(panel, `RANK ${game.grade}`, 550, 197, 110, highClear ? status.color : CYAN, 'center', 600);
      this.text(panel, game.score.toLocaleString(), 550, 328, 75, highClear ? status.color : INK, 'center', 300);
      this.text(panel, 'SCORE', 550, 391, 22, MUTED, 'center');
      this.text(panel, `BASE ${game.baseScore.toLocaleString()} + PERFECT+ ${game.bonusScore.toLocaleString()}`, 550, 425, 22, MUTED, 'center');
      this.text(panel, `${formatAccuracy(game.accuracy, game.bonusAccuracy)} ACCURACY`, 550, 460, 35, CYAN, 'center');
      this.text(panel, `${game.maxCombo} MAX COMBO`, 550, 514, 31, INK, 'center');
      const results = Object.entries(game.counts);
      results.forEach(([rating, count], index) => {
        const x = 70 + (index + 0.5) * 960 / results.length;
        this.text(panel, JUDGEMENTS[rating].label, x, 602, 24, JUDGEMENTS[rating].color, 'center');
        this.text(panel, count, x, 650, 42, INK, 'center');
      });
      if (game.autoplay) this.text(panel, 'AUTO PLAY / 自己ベストには保存されません', 550, 699, 24, WARNING, 'center');
    } else {
      this.text(panel, 'Four keys.', 550, 220, 102, INK, 'center', 500);
      this.text(panel, 'One flow.', 550, 334, 88, CYAN, 'center', 300);
      this.text(panel, inVR ? 'レーンに合わせてコントローラーを振り下ろす' : 'ノーツがラインに届いたら D / F / J / K', 550, 471, 31, INK, 'center');
      this.text(panel, inVR ? 'ボタンをレーザーで指し、トリガーで選択' : '3Dパネルはマウスでクリックできます', 550, 535, 27, MUTED, 'center');
      this.text(panel, '「プレイする」で選曲画面へ進みます', 550, 594, 27, MUTED, 'center');
    }
    const label = game.state === 'finished' ? this.settings.autoplay ? 'オートプレイで再生' : 'もう一度プレイ' : 'プレイする';
    this.button(panel, 'play', this.busy ? '準備中…' : label, 70, 737, 960, 85, this.actions.toggle, { primary: true });
    if (game.state === 'finished') {
      this.button(panel, 'songs', '曲を選ぶ', 70, 848, 300, 72, this.actions.songs);
      this.button(panel, 'settings', '設定', 400, 848, 300, 72, this.actions.settings);
      this.button(panel, 'vr', inVR ? 'VRを終了' : 'VRでプレイ', 730, 848, 300, 72, this.actions.switchVR);
    } else {
      this.button(panel, 'settings', '設定', 70, 848, 465, 72, this.actions.settings);
      this.button(panel, 'vr', inVR ? 'VRを終了' : 'VRでプレイ', 565, 848, 465, 72, this.actions.switchVR);
    }
    panel.texture.needsUpdate = true;
  }

  drawSongSelection() {
    const panel = this.center;
    const songs = this.songLibrary.songs;
    const perPage = 5;
    const pageCount = Math.max(1, Math.ceil(songs.length / perPage));
    this.songPage = Math.max(0, Math.min(this.songPage, pageCount - 1));
    this.background(panel, 'SONG SELECT / 選曲');
    this.text(panel, '曲と右パネルの難易度を選択 / S・ESCでタイトルへ', 70, 133, 27, MUTED);
    const first = this.songPage * perPage;
    for (let index = 0; index < perPage && first + index < songs.length; index++) {
      const song = songs[first + index];
      const y = 205 + index * 112;
      const selected = song.id === this.songLibrary.selectedId;
      this.button(panel, `song-${song.id}`, '', 70, y, 960, 92, () => this.actions.chooseSong(song.id), { primary: selected });
      this.wrap(panel, song.title, 95, y + 28, 745, 30, 36, 1, selected ? '#07141f' : INK);
      this.wrap(panel, `${song.artist || song.title} / ${song.difficulties.length} 難易度${song.bpm ? ` / ${song.bpm.toFixed(1).replace(/\.0$/, '')} BPM` : ''}`, 95, y + 65, 875, 21, 28, 1, selected ? '#193b4c' : MUTED);
      if (selected) this.text(panel, '選択中', 1005, y + 28, 21, '#193b4c', 'right');
    }
    this.button(panel, 'songs-prev', '前へ', 70, 777, 200, 60, () => { this.songPage--; panel.dirty = true; }, { disabled: this.songPage === 0 });
    this.text(panel, `${this.songPage + 1} / ${pageCount}`, 380, 807, 26, MUTED, 'center');
    this.button(panel, 'songs-next', '次へ', 490, 777, 200, 60, () => { this.songPage++; panel.dirty = true; }, { disabled: this.songPage >= pageCount - 1 });
    this.button(panel, 'songs-refresh', '一覧を更新', 720, 777, 310, 60, this.actions.refreshSongs);
    if (this.game.chart.flashWarning) {
      const message = this.game.chart.flashWarningText || '点滅演出が含まれます。';
      this.wrap(panel, '点滅注意：' + message, 70, 855, 960, 21, 27, 1, WARNING);
    }
    const playable = this.canPlaySelection();
    this.button(panel, 'songs-close', 'タイトルに戻る', 70, 875, 300, 63, this.actions.title);
    this.button(panel, 'songs-play', this.busy ? '準備中…' : this.settings.autoplay ? 'オートプレイで再生' : 'この曲をプレイ', 400, 875, 630, 63, this.actions.startSelected, { primary: true, disabled: !playable });
    panel.texture.needsUpdate = true;
  }

  drawSongDetails() {
    const panel = this.details;
    const song = this.selectedSong();
    const analysis = this.songLibrary.analysis;
    this.background(panel, 'CHART DETAILS / 譜面詳細', '#ef8bc6');
    if (!song || !analysis) {
      this.text(panel, '曲を選択してください', 48, 150, 32, MUTED);
      panel.texture.needsUpdate = true;
      return;
    }
    this.wrap(panel, song.title, 48, 114, 904, 32, 42, 2);
    this.text(panel, 'DIFFICULTY / 難易度', 48, 206, 23, MUTED);
    if (this.game.chart.flashWarning) {
      panel.ctx.fillStyle = '#49341b';
      panel.ctx.fillRect(732, 188, 220, 36);
      this.text(panel, '点滅注意', 842, 206, 24, WARNING, 'center', 600);
    }
    const perPage = 4;
    const pages = Math.max(1, Math.ceil(song.difficulties.length / perPage));
    this.difficultyPage = Math.max(0, Math.min(this.difficultyPage, pages - 1));
    for (let index = 0; index < perPage; index++) {
      const difficulty = song.difficulties[this.difficultyPage * perPage + index];
      if (!difficulty) break;
      const x = index % 2 ? 512 : 48;
      const y = 244 + Math.floor(index / 2) * 73;
      const selected = difficulty.id === this.songLibrary.selectedDifficultyId;
      const flashWarning = selected ? this.game.chart.flashWarning : difficulty.flashWarning;
      this.button(panel, 'difficulty-' + difficulty.id, '', x, y, 440, 58, () => this.actions.chooseDifficulty(difficulty.id), { primary: selected });
      const label = (difficulty.level !== null && difficulty.level !== undefined ? 'Lv.' + difficulty.level + '  ' : '') + difficulty.difficulty;
      this.wrap(panel, label, x + 15, y + 29, flashWarning ? 310 : 410, 23, 29, 1, selected ? '#07141f' : INK);
      if (flashWarning) this.text(panel, '点滅注意', x + 425, y + 29, 18, selected ? '#4e3009' : WARNING, 'right', 600);
    }
    this.button(panel, 'difficulty-prev', '前へ', 48, 390, 180, 44, () => { this.difficultyPage--; panel.dirty = true; }, { disabled: this.difficultyPage === 0 });
    this.text(panel, `${this.difficultyPage + 1} / ${pages}`, 500, 412, 23, MUTED, 'center');
    this.button(panel, 'difficulty-next', '次へ', 772, 390, 180, 44, () => { this.difficultyPage++; panel.dirty = true; }, { disabled: this.difficultyPage >= pages - 1 });
    this.text(panel, analysis.durationSource === 'audio' ? '曲の長さ' : '曲の長さ（譜面長）', 48, 477, 22, MUTED);
    this.text(panel, formatTime(analysis.duration), 48, 518, 36);
    this.text(panel, '平均密度 (NPS)', 380, 477, 22, MUTED);
    this.text(panel, analysis.averageDensity.toFixed(2), 380, 518, 36, CYAN);
    this.text(panel, 'ピーク密度', 700, 477, 22, MUTED);
    this.text(panel, analysis.peakDensity.toFixed(2), 700, 518, 36, '#ef8bc6');
    this.text(panel, '密度の推移（' + analysis.binSeconds + '秒集計）', 48, 562, 22, MUTED);
    this.text(panel, '■ TAP', 730, 562, 20, CYAN);
    this.text(panel, '■ LN', 860, 562, 20, '#ef8bc6');
    this.drawDensityGraph(panel, analysis, 94, 600, 850, 125);
    this.text(panel, '総ノーツ（TAP＋LN）', 48, 798, 23, MUTED);
    this.text(panel, analysis.total.toLocaleString(), 48, 839, 38, CYAN);
    this.text(panel, '総LN', 540, 798, 23, MUTED);
    this.text(panel, analysis.longNotes.toLocaleString(), 540, 839, 38, '#ef8bc6');
    this.text(panel, 'LANE', 48, 889, 22, MUTED);
    this.text(panel, 'TAP', 430, 889, 22, MUTED, 'right');
    this.text(panel, 'LN', 660, 889, 22, MUTED, 'right');
    this.text(panel, 'TOTAL', 952, 889, 22, MUTED, 'right');
    analysis.lanes.forEach((lane, index) => {
      const y = 935 + index * 40;
      this.text(panel, `${index + 1}  /  ${CONFIG.keys[index].slice(3)}`, 48, y, 26, CONFIG.colors[index]);
      this.text(panel, lane.taps.toLocaleString(), 430, y, 26, INK, 'right');
      this.text(panel, lane.longNotes.toLocaleString(), 660, y, 26, '#ef8bc6', 'right');
      this.text(panel, lane.total.toLocaleString(), 952, y, 26, CYAN, 'right');
    });
    const best = this.songLibrary.personalBests.get(this.songLibrary.selectedDifficultyId);
    panel.ctx.fillStyle = '#101d30';
    panel.ctx.fillRect(32, 1085, 936, 120);
    this.text(panel, 'PERSONAL BEST / 自己ベスト', 48, 1107, 22, '#ef8bc6');
    if (!best) this.text(panel, '未プレイ', 952, 1107, 20, MUTED, 'right');
    this.text(panel, 'スコア', 48, 1143, 20, MUTED);
    const bestStatus = best && clearStatusForScore(best.score);
    this.text(panel, best ? best.score.toLocaleString() : '—', 48, 1180, 32, bestStatus?.id === 'highClear' ? bestStatus.color : CYAN);
    this.text(panel, '精度', 380, 1143, 20, MUTED);
    this.text(panel, best ? formatAccuracy(best.accuracy, best.bonusAccuracy) : '—', 380, 1180, 26, INK);
    this.text(panel, '最大コンボ', 700, 1143, 20, MUTED);
    this.text(panel, best ? best.maxCombo.toLocaleString() : '—', 700, 1180, 32, '#ef8bc6');
    this.text(panel, '密度はTAP＋LN始点の数 / 秒。LN終点は数えません。', 48, 1225, 18, MUTED);
    panel.texture.needsUpdate = true;
  }

  drawDensityGraph(panel, analysis, x, y, width, height) {
    const ctx = panel.ctx;
    const ceiling = Math.max(1, Math.ceil(analysis.peakDensity));
    ctx.fillStyle = '#101d30';
    ctx.fillRect(x, y, width, height);
    for (let line = 0; line <= 2; line++) {
      const top = y + height * line / 2;
      ctx.fillStyle = '#30465f';
      ctx.fillRect(x, top, width, 1);
      this.text(panel, Number((ceiling * (1 - line / 2)).toFixed(1)), x - 12, top, 18, MUTED, 'right');
    }
    const columns = Math.min(analysis.bins.length, Math.floor(width / 3));
    const columnWidth = width / columns;
    const scale = height / ceiling;
    for (let column = 0; column < columns; column++) {
      const first = Math.floor(column * analysis.bins.length / columns);
      const end = Math.floor((column + 1) * analysis.bins.length / columns);
      let bin = analysis.bins[first];
      // 縮小時は各表示列の最大値を使い、局所的なピークを残す。
      for (let index = first + 1; index < end; index++) {
        const candidate = analysis.bins[index];
        if (candidate.taps + candidate.longNotes > bin.taps + bin.longNotes) bin = candidate;
      }
      const tapsHeight = bin.taps / analysis.binSeconds * scale;
      const lnHeight = bin.longNotes / analysis.binSeconds * scale;
      const left = x + column * columnWidth;
      const barWidth = Math.max(0.5, columnWidth - 0.8);
      ctx.fillStyle = CYAN;
      ctx.fillRect(left, y + height - tapsHeight, barWidth, tapsHeight);
      ctx.fillStyle = '#ef8bc6';
      ctx.fillRect(left, y + height - tapsHeight - lnHeight, barWidth, lnHeight);
    }
    const graphDuration = analysis.bins.length * analysis.binSeconds;
    this.text(panel, '0:00', x, y + height + 30, 20, MUTED);
    this.text(panel, formatTime(graphDuration / 2), x + width / 2, y + height + 30, 20, MUTED, 'center');
    this.text(panel, formatTime(graphDuration), x + width, y + height + 30, 20, MUTED, 'right');
  }

  drawSettings() {
    const panel = this.center;
    this.background(panel, 'PLAY SETTINGS / 設定');
    const tabs = [['play', 'プレイ設定'], ['lanes', 'レーン配置'], ['gauges', 'ゲージ'], ['effects', 'レーン演出'], ['panels', 'パネル配置']];
    tabs.forEach(([id, label], index) => {
      this.button(panel, 'tab-' + id, label, 70 + index * 196, 96, 176, 62, () => { this.settingsTab = id; panel.dirty = true; }, { primary: this.settingsTab === id });
    });
    if (this.settingsTab === 'play') {
      this.text(panel, '自動保存 / オート変更は次の開始・リトライから', 70, 180, 23, MUTED);
      PLAY_SETTING_DEFINITIONS.forEach((definition, index) => this.settingRow(panel, definition, 218 + index * 90, true));
      this.text(panel, '音声 ＋：遅く / −：早く　入力 ＋：過去へ補正', 70, 851, 21, MUTED);
    } else if (this.settingsTab === 'lanes') {
      this.text(panel, '判定ラインを基準に位置・傾きを調整します', 70, 204, 24, MUTED);
      LANE_SETTING_DEFINITIONS.forEach((definition, index) => this.settingRow(panel, definition, 250 + index * 108));
      this.text(panel, '前後の＋：手前へ移動 / 傾きの＋：奥を上げる', 70, 672, 24, MUTED);
      this.text(panel, '下地の透明度：0% 不透明 / 100% 透明（自動保存）', 70, 721, 24, MUTED);
      this.button(panel, 'reset-lanes', 'レーン配置をリセット', 70, 782, 960, 63, this.actions.resetLaneLayout);
    } else if (this.settingsTab === 'gauges') {
      this.text(panel, '左右のバーの長さを個別に調整（自動保存）', 70, 204, 24, MUTED);
      GAUGE_SETTING_DEFINITIONS.forEach((definition, index) => this.settingRow(panel, definition, 280 + index * 140));
      this.text(panel, '手前の端を固定し、奥方向の長さを変えます', 70, 600, 25, MUTED);
      this.text(panel, '600k・900kの目印も長さに合わせて移動します', 70, 655, 24, MUTED);
      this.button(panel, 'reset-gauges', 'ゲージの長さをリセット', 70, 782, 960, 63, this.actions.resetGaugeLengths);
    } else if (this.settingsTab === 'effects') {
      this.text(panel, '好きな演出を組み合わせる / 変更は自動保存', 70, 204, 24, MUTED);
      this.button(panel, 'preview-effects', '演出を試す', 830, 180, 200, 48, this.actions.previewLaneEffects, { disabled: !this.settings.laneEffects || this.settings.laneEffectStrength <= 0 });
      EFFECT_SETTING_DEFINITIONS.forEach((definition, index) => this.settingRow(panel, definition, 260 + index * 96));
      this.text(panel, '発光は入力に反応 / 波紋と火花はヒット時に表示', 70, 848, 22, MUTED);
    } else {
      this.text(panel, '位置はレーンを基準に調整します / 変更は自動保存', 70, 194, 24, MUTED);
      const targets = [{ id: 'all', label: '全部まとめて' }, ...PANEL_GROUPS];
      targets.forEach((group, index) => {
        this.button(panel, `target-${group.id}`, group.label, 70 + index * 245, 235, 225, 65, () => { this.panelTarget = group.id; panel.dirty = true; }, { primary: group.id === this.panelTarget });
      });
      const all = this.panelTarget === 'all';
      const group = PANEL_GROUPS.find(item => item.id === this.panelTarget);
      const definitions = all ? [...PANEL_OFFSET_DEFINITIONS, PAIRED_PANEL_ANGLE_SETTING] : PANEL_SETTING_DEFINITIONS.filter(item => item.key.startsWith(group.prefix));
      definitions.forEach((definition, index) => this.settingRow(panel, definition, 330 + index * 104));
      this.text(panel, all ? '左右の角度は同時反映 / 中央の移動は「戻る」で反映' : group.id === 'menu' ? '中央の位置・角度は「戻る」で反映します' : '左右パネルの位置・角度はすぐに反映します', 70, 755, 25, MUTED);
      this.button(panel, 'reset-target', all ? '全体の調整をリセット' : 'このパネルをリセット', 70, 782, 465, 63, () => this.actions.resetPanelLayout(this.panelTarget));
      this.button(panel, 'reset-all', 'すべてリセット', 565, 782, 465, 63, () => this.actions.resetPanelLayout());
    }
    this.button(panel, 'export-settings', '全設定をエクスポート', 70, 875, 465, 63, this.actions.exportSettings);
    this.button(panel, 'close', '戻る', 565, 875, 465, 63, () => this.closeSettings(), { primary: true });
    panel.texture.needsUpdate = true;
  }

  settingRow(panel, definition, y, compact = false) {
    const { key, label, min, max, step, unit, digits } = definition;
    const paired = key === PAIRED_PANEL_ANGLE_SETTING.key;
    const getValue = () => paired ? Math.round((this.settings.panelLeftYaw - this.settings.panelRightYaw) / 2) : this.settings[key];
    const setValue = paired ? this.actions.setSidePanelAngle : next => this.actions.setSetting(key, next);
    const value = getValue();
    const ctx = panel.ctx;
    // ラベルの下と、操作欄から次のラベルまでに12px以上の余白を確保する。
    const controlY = y + 26;
    const controlHeight = compact ? 40 : 52;
    const textSize = compact ? 22 : 28;
    const controlCenterY = controlY + controlHeight / 2;
    this.text(panel, label, 70, y, textSize);
    if (definition.type === 'toggle') {
      this.text(panel, value ? 'ON' : 'OFF', 1030, y, textSize, value ? CYAN : MUTED, 'right');
      this.button(panel, `${key}-off`, 'OFF', 171, controlY, 360, controlHeight, () => setValue(0), { primary: value === 0 });
      this.button(panel, `${key}-on`, 'ON', 569, controlY, 360, controlHeight, () => setValue(1), { primary: value === 1 });
      return;
    }
    this.text(panel, `${(key === 'offset' || key === 'audioOffset' || key === 'laneOffsetZ' || key === 'lanePitch') && value > 0 ? '+' : ''}${value.toFixed(digits)}${unit}`, 1030, y, textSize, CYAN, 'right');
    this.button(panel, `${key}-minus`, '−', 70, controlY, 70, controlHeight, () => setValue(getValue() - step));
    this.button(panel, `${key}-plus`, '＋', 960, controlY, 70, controlHeight, () => setValue(getValue() + step));
    const x = 171;
    const width = 758;
    const ratio = (value - min) / (max - min);
    ctx.fillStyle = '#24374e';
    ctx.fillRect(x, controlCenterY - 5, width, 10);
    ctx.fillStyle = CYAN;
    ctx.fillRect(x, controlCenterY - 5, width * ratio, 10);
    ctx.fillStyle = '#ddfaff';
    ctx.fillRect(x + width * ratio - 7, controlCenterY - 16, 14, 32);
    panel.regions.push({ id: `${key}-slider`, type: 'slider', x, y: controlY, width, height: controlHeight, disabled: this.busy, activate: point => setValue(min + Math.max(0, Math.min(1, (point.x - x) / width)) * (max - min)) });
  }

  drawNotice() {
    const panel = this.notice;
    this.background(panel, '', '#ff8c9d');
    this.wrap(panel, this.message, 30, 48, 1180, 28, 39, 2, '#ffd0d7');
    panel.texture.needsUpdate = true;
  }

  update(now, songTime = this.game.songTime) {
    this.prepareScreenTransition(now);
    // レーンの正面配置には追従し、台の高さ変更でUIの高さは動かさない。
    const anchor = this.view.root;
    if (this.anchorDirty || this.root.position.x !== anchor.position.x || this.root.position.z !== anchor.position.z || this.root.rotation.y !== anchor.rotation.y) {
      this.root.position.set(anchor.position.x, 0, anchor.position.z);
      this.root.rotation.y = anchor.rotation.y;
      this.root.updateMatrixWorld(true);
      this.anchorDirty = false;
    }
    const fadingOut = this.screenPhase === 'out';
    const centerVisible = !fadingOut && (this.settingsOpen || this.songSelectionOpen || this.game.state !== 'playing');
    this.setPanelVisible(this.center, centerVisible);
    const selectionVisible = !fadingOut && this.songSelectionOpen && !this.settingsOpen;
    this.setPanelVisible(this.details, selectionVisible);
    this.setPanelVisible(this.left, !fadingOut && !selectionVisible);
    this.setPanelVisible(this.right, !fadingOut && !selectionVisible);
    this.setPanelVisible(this.notice, !fadingOut && Boolean(this.message));
    this.updateSidePanelFocus(now);
    for (const panel of this.panels) this.updatePanelTransition(panel, now);

    const time = Math.max(0, Math.min(songTime, this.game.chart.duration));
    const progress = time / this.game.chart.duration;
    // バーと点灯は軽い3Dオブジェクトの変更だけで動かし、画像は転送しない。
    this.progressFill.visible = progress > 0;
    this.progressFill.scale.x = progress;
    this.progressFill.position.x = this.progressLeft + this.progressFill.geometry.parameters.width * progress / 2;
    for (let lane = 0; lane < 4; lane++) this.keyFlashes[lane].visible = this.view.pressed[lane] || this.view.flashes[lane] > 0 && now - this.view.flashes[lane] < 120;
    const second = Math.floor(time);
    const percent = Math.round(progress * 100);
    if (second !== this.lastTrackSecond) {
      this.lastTrackSecond = second;
      this.elapsedText.setText(`${formatTime(time)} / ${this.durationText}`);
    }
    if (percent !== this.lastTrackPercent) {
      this.lastTrackPercent = percent;
      this.percentText.setText(`${percent}%`);
    }
    if (this.statsDirty) this.updateStatsText();

    // 変化したパネルだけを更新する。入力によるdirtyでも更新間隔を飛ばさない。
    // 大きい画像のGPU転送が同じフレームに集中しないよう、1フレーム1枚に分散。
    for (const panel of this.drawOrder) {
      if (!panel.targetVisible || !panel.dirty || now - panel.lastDraw < 50) continue;
      // 選曲内の変更は表示したまま更新し、別画面への切替は消え切ってから描き直す。
      if (panel.viewKey !== panel.desiredViewKey && panel.opacity > 0 && !this.canUpdatePanelInPlace(panel)) continue;
      if (panel === this.left) this.drawTrack(now);
      else if (panel === this.right) this.drawStats();
      else if (panel === this.details) this.drawSongDetails();
      else if (panel === this.center) {
        if (this.settingsOpen) this.drawSettings();
        else if (this.songSelectionOpen) this.drawSongSelection();
        else if (this.game.state === 'paused') this.drawPause();
        else this.drawMenu();
      }
      else this.drawNotice();
      panel.dirty = false;
      panel.lastDraw = now;
      panel.viewKey = panel.desiredViewKey;
      if (this.screenPhase === 'stable') this.startPanelFade(panel, 1, now);
      break;
    }
    this.finishScreenTransition(now);
  }

  makePickResult() {
    return { panel: null, region: null, x: 0, y: 0, point: new this.T.Vector3(), distance: 8 };
  }

  pick(origin, direction, result = this.mouseHit) {
    result.panel = result.region = null;
    result.distance = 8;
    for (const panel of this.panels) {
      if (!panel.mesh.visible && !this.panelFocusable(panel)) continue;
      panel.mesh.updateWorldMatrix(true, false);
      intersectPanel(panel, origin, direction, result, result.distance);
    }
    const panel = result.panel;
    if (!panel) return null;
    if (this.panelInteractive(panel)) {
      for (const region of panel.regions) {
        if (result.x < region.x || result.x > region.x + region.width || result.y < region.y || result.y > region.y + region.height) continue;
        result.region = region;
        break;
      }
    }
    return result;
  }

  pickMouse(event) {
    const rect = this.scene.canvas.getBoundingClientRect();
    this.mousePresent = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    this.mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.mouse, this.scene.camera);
    return this.pick(this.raycaster.ray.origin, this.raycaster.ray.direction);
  }

  setHover(id, hit) {
    const previous = this.hover.get(id);
    if (previous?.panel !== hit?.panel || previous?.region?.id !== hit?.region?.id) {
      if (previous?.region) previous.panel.dirty = true;
      if (hit?.region) hit.panel.dirty = true;
    }
    // 判定結果は次のフレームに再利用するため、ホバーの比較元とは分けて保持する。
    if (hit) {
      if (previous) { previous.panel = hit.panel; previous.region = hit.region; }
      else this.hover.set(id, { panel: hit.panel, region: hit.region });
    } else this.hover.delete(id);
  }

  activate(hit) {
    if (!hit?.region || hit.region.disabled || this.busy || !this.panelInteractive(hit.panel)) return;
    hit.region.activate(hit);
  }

  bindMouse() {
    this.canvas = this.scene.canvas;
    this.onPointerMove = event => {
      if (this.scene.is('vr-mode')) return;
      const hit = this.pickMouse(event);
      this.setHover('mouse', hit);
      this.canvas.style.cursor = hit?.region && !hit.region.disabled ? 'pointer' : '';
      const down = this.pointerDown;
      if (down?.id === event.pointerId && down.hit.region?.type === 'slider' && hit?.panel === down.hit.panel) {
        this.activate({ ...hit, region: down.hit.region });
        event.preventDefault();
      }
    };
    this.onPointerDown = event => {
      if (this.scene.is('vr-mode') || event.button !== 0) return;
      const hit = this.pickMouse(event);
      if (!hit) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const camera = this.scene.querySelector('#camera');
      this.pointerDown = { id: event.pointerId, hit: { panel: hit.panel, region: hit.region }, x: event.clientX, y: event.clientY, lookEnabled: camera.components['look-controls'].data.enabled };
      camera.setAttribute('look-controls', 'enabled', false);
      this.canvas.setPointerCapture(event.pointerId);
      if (hit.region?.type === 'slider') this.activate(hit);
    };
    this.onPointerUp = event => {
      const down = this.pointerDown;
      if (!down || down.id !== event.pointerId) return;
      const hit = this.scene.is('vr-mode') ? null : this.pickMouse(event);
      this.releaseMouse();
      if (event.type !== 'pointerup') return;
      event.preventDefault();
      if (down.hit.region?.type === 'slider') return;
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 8 && hit?.panel === down.hit.panel && hit?.region?.id === down.hit.region?.id) this.activate(hit);
    };
    this.onPointerLeave = () => { this.mousePresent = false; if (!this.pointerDown) this.setHover('mouse', null); };
    this.onBlur = () => { this.releaseMouse(); this.mousePresent = false; this.setHover('mouse', null); };
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown, true);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('lostpointercapture', this.onBlur);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('blur', this.onBlur);
  }

  releaseMouse() {
    const down = this.pointerDown;
    if (!down) return;
    this.pointerDown = null;
    this.scene.querySelector('#camera').setAttribute('look-controls', 'enabled', down.lookEnabled);
    if (this.canvas.hasPointerCapture(down.id)) this.canvas.releasePointerCapture(down.id);
  }

  pointerFor(source) {
    if (this.xrPointers.has(source)) return this.xrPointers.get(source);
    const T = this.T;
    const color = source.handedness === 'left' ? CONFIG.colors[0] : CONFIG.colors[3];
    const line = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), new T.LineBasicMaterial({ color, transparent: true, opacity: 0.65 }));
    line.frustumCulled = false;
    const dot = new T.Mesh(new T.SphereGeometry(0.009, 12, 8), new T.MeshBasicMaterial({ color, depthTest: false }));
    dot.renderOrder = 10;
    this.scene.object3D.add(line, dot);
    const pointer = { line, dot, hit: null, hitResult: this.makePickResult() };
    this.xrPointers.set(source, pointer);
    return pointer;
  }

  updateXR(frame, referenceSpace, sources) {
    const pointerFrame = ++this.pointerFrame;
    this.rig.updateWorldMatrix(true, false);
    for (const source of sources) {
      if (source.targetRayMode !== 'tracked-pointer') continue;
      const pointer = this.pointerFor(source);
      pointer.frame = pointerFrame;
      const pose = frame.getPose(source.targetRaySpace, referenceSpace);
      if (!pose) { pointer.hit = null; pointer.line.visible = false; pointer.dot.visible = false; this.setHover(source, null); continue; }
      const p = pose.transform.position;
      const q = pose.transform.orientation;
      this.quaternion.set(q.x, q.y, q.z, q.w);
      this.rayOrigin.set(p.x, p.y, p.z).applyMatrix4(this.rig.matrixWorld);
      this.rayDirection.set(0, 0, -1).applyQuaternion(this.quaternion).transformDirection(this.rig.matrixWorld);
      const hit = this.pick(this.rayOrigin, this.rayDirection, pointer.hitResult);
      pointer.hit = hit;
      this.setHover(source, hit);
      const show = Boolean(hit) || this.game.state !== 'playing' || this.settingsOpen;
      pointer.line.visible = show;
      pointer.dot.visible = Boolean(hit);
      const endpoint = hit?.point ?? this.pointerEndpoint.copy(this.rayOrigin).addScaledVector(this.rayDirection, 2);
      const positions = pointer.line.geometry.attributes.position;
      positions.setXYZ(0, this.rayOrigin.x, this.rayOrigin.y, this.rayOrigin.z);
      positions.setXYZ(1, endpoint.x, endpoint.y, endpoint.z);
      positions.needsUpdate = true;
      if (hit) pointer.dot.position.copy(hit.point);
    }
    for (const [source, pointer] of this.xrPointers) if (pointer.frame !== pointerFrame) this.removeXRPointer(source);
  }

  selectXR(source) {
    const hit = this.xrPointers.get(source)?.hit;
    if (!hit || !hit.panel.mesh.visible) return false;
    this.activate(hit);
    // パネルの余白を選択した場合も、クイックスタートへ入力を流さない。
    return true;
  }

  removeXRPointer(source) {
    const pointer = this.xrPointers.get(source);
    if (!pointer) return;
    this.scene.object3D.remove(pointer.line, pointer.dot);
    pointer.line.geometry.dispose();
    pointer.line.material.dispose();
    pointer.dot.geometry.dispose();
    pointer.dot.material.dispose();
    this.xrPointers.delete(source);
    this.setHover(source, null);
  }

  clearXR() {
    for (const source of this.xrPointers.keys()) this.removeXRPointer(source);
  }

  dispose() {
    this.releaseMouse();
    this.clearXR();
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown, true);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('lostpointercapture', this.onBlur);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('blur', this.onBlur);
    this.scene.object3D.remove(this.root);
    for (const panel of this.panels) {
      panel.mesh.traverse(object => {
        if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); }
      });
      panel.texture.dispose();
    }
  }
}
