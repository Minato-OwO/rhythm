import { CONFIG, JUDGEMENTS, laneX } from './config.js';
import { GlyphAtlas } from './glyph-text.js';
import { LaneEffects } from './lane-effects.js';
import { ScrollTrack, SpeedTrack, ScrollNoteIndex } from './scroll-track.js';
import { LaneGauges } from './lane-gauges.js';
import { NoteSkins } from './note-skins.js';

export class StageView {
  constructor(scene, settings) {
    this.scene = scene;
    this.settings = settings;
    this.THREE = AFRAME.THREE;
    const T = this.THREE;
    this.root = new T.Group();
    // 正面合わせの基準と、レーン自体の前後・傾きを分ける。
    this.laneRoot = new T.Group();
    this.laneRoot.visible = false;
    this.root.add(this.laneRoot);
    scene.querySelector('#playfield').setObject3D('stage', this.root);
    this.applyLaneLayout();
    this.noteMeshes = new Map();
    this.noteFrame = 0;
    this.visibleStart = 0;
    this.pool = [];
    this.pressed = [false, false, false, false];
    this.flashes = [0, 0, 0, 0];
    this.materials = CONFIG.colors.map(color => new T.MeshBasicMaterial({ color, fog: false }));
    this.noteGeometry = new T.BoxGeometry(CONFIG.laneWidth - 0.025, 0.045, 0.105);
    this.holdGeometry = new T.BoxGeometry(1, 1, 1);
    this.holdMaterials = CONFIG.colors.map(color => new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, depthWrite: false, fog: false }));
    this.activeHoldMaterials = CONFIG.colors.map(color => new T.MeshBasicMaterial({ color, fog: false }));
    this.noteSkins = new NoteSkins(this);
    this.scrollBounds = { min: 0, max: 0 };
    this.drawIndexedNote = indexed => this.drawNote(indexed.entry);
    this.pads = [];
    this.laneAccents = Array.from({ length: 4 }, () => []);
    this.makeRunway();
    this.effects = new LaneEffects(T, this.laneRoot, settings);
    this.makeEnvironment();
    this.glyphAtlas = new GlyphAtlas(T);
    this.gauges = new LaneGauges(T, this.laneRoot, this.glyphAtlas, settings);
    this.judgement = { mesh: new T.Group() };
    this.judgementLabel = this.glyphAtlas.createText({ height: 0.08, align: 'center', capacity: 16 });
    this.judgementTiming = this.glyphAtlas.createText({ height: 0.032, color: '#a7bcd5', align: 'center', capacity: 24 });
    this.judgementLabel.mesh.position.y = 0.024;
    this.judgementTiming.mesh.position.y = -0.051;
    this.judgement.mesh.add(this.judgementLabel.mesh, this.judgementTiming.mesh);
    this.judgement.mesh.position.set(0, 0.43, -1.13 + (settings.laneOffsetZ ?? 0));
    this.root.add(this.judgement.mesh);
    this.judgement.mesh.visible = false;
    this.countdownLabel = '';
    this.lastJudgement = -Infinity;
    this.cameraPosition = new T.Vector3();
    this.cameraDirection = new T.Vector3();
    this.trackingRig = scene.querySelector('#rig').object3D;
    this.vrPositionOffset = new T.Vector3();
    this.useKeyboardView();
  }

  box(width, height, depth, color, x, y, z, opacity = 1) {
    const T = this.THREE;
    const mesh = new T.Mesh(new T.BoxGeometry(width, height, depth), new T.MeshBasicMaterial({ color, transparent: opacity < 1, opacity }));
    mesh.position.set(x, y, z);
    this.laneRoot.add(mesh);
    return mesh;
  }

  makeRunway() {
    const centerZ = CONFIG.hitZ - CONFIG.laneDepth / 2;
    const coverSideMargin = 0.1;
    const coverEndMargin = 0.25;
    this.laneCover = this.box(
      CONFIG.laneSpacing * CONFIG.keys.length + coverSideMargin * 2,
      0.014, CONFIG.laneDepth + coverEndMargin * 2,
      '#080b10', 0, -0.035, centerZ,
    );
    this.applyLaneCoverOpacity();
    for (let lane = 0; lane < 4; lane++) {
      const x = laneX(lane);
      this.box(CONFIG.laneWidth, CONFIG.laneSurfaceHeight, CONFIG.laneDepth + 0.2, '#101d30', x, CONFIG.laneSurfaceY, centerZ, 0.92);
      const edge = this.box(0.008, 0.007, CONFIG.laneDepth, CONFIG.colors[lane], x - CONFIG.laneSpacing / 2, 0, centerZ, 0.2);
      const pad = this.box(CONFIG.laneWidth, 0.025, 0.25, CONFIG.colors[lane], x, 0.01, CONFIG.hitZ, 0.28);
      this.pads.push(pad);
      const line = this.box(CONFIG.laneWidth, 0.01, 0.018, CONFIG.colors[lane], x, 0.031, CONFIG.hitZ);
      this.laneAccents[lane].push(edge, pad, line);
    }
    this.laneAccents[3].push(this.box(0.008, 0.007, CONFIG.laneDepth, '#ff9478', CONFIG.laneSpacing * 2, 0, centerZ, 0.2));
    for (let index = 1; index <= 12; index++) {
      this.box(1.28, 0.004, 0.007, '#3b5776', 0, 0.002, CONFIG.hitZ - index * CONFIG.laneDepth / 12, 0.3);
    }
  }

  applyLaneCoverOpacity() {
    const opacity = 1 - Math.max(0, Math.min(100, this.settings.laneCoverTransparency ?? 0)) / 100;
    const material = this.laneCover.material;
    const transparent = opacity < 1;
    if (material.transparent !== transparent) {
      material.transparent = transparent;
      material.needsUpdate = true;
    }
    material.opacity = opacity;
    material.depthWrite = opacity === 1;
    this.laneCover.visible = opacity > 0;
  }

  makeEnvironment() {
    const T = this.THREE;
    this.environment = new T.Group();
    const grid = new T.GridHelper(70, 70, '#1b3047', '#122035');
    grid.position.y = -0.025;
    this.environment.add(grid);
    const arches = new T.Group();
    this.environment.add(arches);
    const archMaterial = new T.LineBasicMaterial({ color: '#1a3853', transparent: true, opacity: 0.7 });
    for (let index = 0; index < 5; index++) {
      const z = -6 - index * 4;
      const points = [new T.Vector3(-3.8, 0, z), new T.Vector3(-3.8, 3.8, z), new T.Vector3(3.8, 3.8, z), new T.Vector3(3.8, 0, z)];
      arches.add(new T.Line(new T.BufferGeometry().setFromPoints(points), archMaterial));
    }
    this.environmentParts = { grid, arches };
    this.scene.object3D.add(this.environment);
  }

  recenter() {
    if (!this.scene.is('vr-mode')) return;
    this.scene.camera.getWorldPosition(this.cameraPosition);
    this.scene.camera.getWorldDirection(this.cameraDirection);
    this.cameraDirection.y = 0;
    if (this.cameraDirection.lengthSq() < 0.01) return;
    this.cameraDirection.normalize();
    // 前回の後退分を除いた追跡位置を、レーン配置の基準にする。
    this.cameraPosition.sub(this.vrPositionOffset);
    this.trackingRig.position.sub(this.vrPositionOffset);
    this.vrPositionOffset.copy(this.cameraDirection).multiplyScalar(-CONFIG.vrBackOffset);
    // 共通rigを水平に後退させ、視点・両手表示・振り判定を一緒に移動する。
    this.trackingRig.position.add(this.vrPositionOffset);
    this.trackingRig.updateMatrixWorld(true);
    this.root.position.set(this.cameraPosition.x, this.settings.height, this.cameraPosition.z);
    this.root.rotation.y = Math.atan2(-this.cameraDirection.x, -this.cameraDirection.z);
    this.root.updateMatrixWorld(true);
  }

  resetPosition() {
    this.trackingRig.position.sub(this.vrPositionOffset);
    this.vrPositionOffset.set(0, 0, 0);
    this.trackingRig.updateMatrixWorld(true);
    this.root.position.set(0, this.settings.height, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
  }

  useKeyboardView() {
    this.resetPosition();
    // KBもVRの基準視点と同じ高さ・後退距離で表示する。
    this.trackingRig.position.set(0, CONFIG.vrEyeHeight, CONFIG.vrBackOffset);
    const mount = this.scene.querySelector('#camera-mount').object3D;
    mount.position.set(0, 0, 0);
    mount.rotation.set(0, 0, 0);
    this.trackingRig.updateMatrixWorld(true);
  }

  applyLaneLayout() {
    const pitch = (this.settings.lanePitch ?? 0) * Math.PI / 180;
    const offsetZ = this.settings.laneOffsetZ ?? 0;
    const sine = Math.sin(pitch);
    const cosine = Math.cos(pitch);
    this.root.position.y = this.settings.height;
    // 描画とVR入力が共有する座標系を縮め、見た目と判定範囲を揃える。
    this.laneRoot.scale.x = this.settings.laneWidthScale ?? 1;
    this.laneRoot.rotation.x = pitch;
    // ノーツ中心の判定ラインを回転軸にし、傾きを変えても判定高さを保つ。
    this.laneRoot.position.set(
      0,
      CONFIG.hitPlaneY - (CONFIG.hitPlaneY * cosine - CONFIG.hitZ * sine),
      offsetZ + CONFIG.hitZ - (CONFIG.hitPlaneY * sine + CONFIG.hitZ * cosine),
    );
    // 判定文字は判定ラインに追従し、読みやすい正面向きを維持する。
    if (this.judgement) this.judgement.mesh.position.z = -1.13 + offsetZ;
    this.root.updateMatrixWorld(true);
  }

  setLaneColor(lane, color) {
    this.materials[lane].color.copy(color);
    this.holdMaterials[lane].color.copy(color);
    this.activeHoldMaterials[lane].color.copy(color);
    this.noteSkins?.setLaneColor(lane, color);
    for (const mesh of this.laneAccents[lane]) mesh.material.color.copy(color);
    this.effects.setLaneColor(lane, color);
  }

  clearNotes() {
    for (const mesh of this.noteMeshes.values()) {
      mesh.visible = false;
      this.pool.push(mesh);
    }
    this.noteMeshes.clear();
    this.visibleStart = 0;
    this.pressed.fill(false);
    this.flashes.fill(0);
    this.effects.reset();
    this.lastJudgement = -Infinity;
    this.countdownLabel = '';
  }

  flash(lane, successfulHit = false) {
    const now = performance.now();
    this.flashes[lane] = now;
    if (successfulHit) this.effects.hit(lane, now);
  }

  previewLaneEffects() {
    const now = performance.now();
    for (let lane = 0; lane < 4; lane++) {
      this.flashes[lane] = now;
      this.effects.hit(lane, now);
    }
  }

  drawJudgement(label, color, subtitle = '') {
    this.judgementLabel.setText(label);
    this.judgementLabel.setColor(color);
    this.judgementTiming.setText(subtitle);
  }

  showJudgement({ rating, deltaMs }) {
    const { color, label } = JUDGEMENTS[rating];
    const timing = deltaMs === null ? '' : `${deltaMs < 0 ? 'EARLY' : 'LATE'} ${Math.abs(deltaMs).toFixed(0)} ms`;
    this.drawJudgement(label, color, timing);
    this.lastJudgement = performance.now();
  }

  disposeText() {
    this.gauges.dispose();
    this.root.remove(this.judgement.mesh);
    this.judgementLabel.dispose();
    this.judgementTiming.dispose();
    this.glyphAtlas.dispose();
  }

  prepareNotes(game) {
    if (this.noteSource === game.notes && this.chartSource === game.chart) return;
    this.noteSource = game.notes;
    this.chartSource = game.chart;
    this.scrollTrack = new ScrollTrack(game.chart?.scrollVelocities ?? []);
    this.speedTrack = new SpeedTrack(game.chart?.scrollVelocities ?? []);
    this.scrollEntries = [];
    for (const note of game.notes) {
      const position = this.scrollTrack.positionAt(note.time);
      const entry = { note, position, min: position, max: position };
      if (note.endTime !== null && note.endTime !== undefined) {
        entry.tail = this.scrollTrack.positionAt(note.endTime);
        this.scrollTrack.bounds(note.time, note.endTime, entry);
      }
      this.scrollEntries.push(entry);
    }
    this.indexedScrollRate = null;
  }

  prepareNoteIndex() {
    if (this.indexedScrollRate === this.scrollRate) return;
    this.indexedScrollRate = this.scrollRate;
    this.noteIndex = new ScrollNoteIndex(this.scrollEntries, this.scrollRate, CONFIG.laneDepth);
    // 選曲中に描画用オブジェクトを用意し、プレイ中の密度上昇時の追加生成を減らす。
    // 極端なSVで超過した場合は従来どおり拡張し、ノーツの表示数を制限しない。
    const reserve = Math.min(128, this.scrollEntries.length);
    for (let count = this.noteMeshes.size + this.pool.length; count < reserve; count++) {
      const mesh = this.makeNote(count % CONFIG.keys.length);
      mesh.visible = false;
      this.pool.push(mesh);
    }
  }

  makeNote(lane) {
    const T = this.THREE;
    const group = new T.Group();
    group.head = new T.Mesh(this.noteGeometry, this.materials[lane]);
    group.tail = new T.Mesh(this.noteGeometry, this.materials[lane]);
    group.tail.scale.set(1, 0.75, 1);
    group.body = new T.Mesh(this.holdGeometry, this.holdMaterials[lane]);
    group.add(group.body, group.tail, group.head);
    this.noteSkins?.applyTo(group, lane);
    this.laneRoot.add(group);
    return group;
  }

  drawNote(entry) {
    const note = entry.note;
    if (note.judged || (note.endTime ?? note.time) < this.displayTime - 0.4) return;
    let mesh = this.noteMeshes.get(note.id);
    if (!mesh) {
      mesh = this.pool.pop() ?? this.makeNote(note.lane);
      mesh.visible = true;
      mesh.head.material = mesh.tail.material = this.materials[note.lane];
      this.noteSkins?.applyTo(mesh, note.lane);
      this.noteMeshes.set(note.id, mesh);
    }
    mesh.userData.noteId = note.id;
    mesh.userData.noteFrame = this.noteFrame;
    mesh.userData.holdActive = Boolean(note.started);
    mesh.position.x = laneX(note.lane);
    const rate = this.scrollRate * this.speedMultiplier * (note.scrollMultiplier ?? 1);
    const headDistance = note.started ? 0 : (entry.position - this.scrollPosition) * rate;
    mesh.head.visible = headDistance >= -0.6 && headDistance <= CONFIG.laneDepth;
    mesh.head.position.set(0, CONFIG.hitPlaneY, CONFIG.hitZ - headDistance);
    const hold = note.endTime !== null && note.endTime !== undefined;
    mesh.tail.visible = mesh.body.visible = hold;
    if (!hold) return;
    const tailDistance = (entry.tail - this.scrollPosition) * rate;
    mesh.tail.visible = tailDistance >= -0.6 && tailDistance <= CONFIG.laneDepth;
    mesh.tail.position.set(0, CONFIG.hitPlaneY, CONFIG.hitZ - tailDistance);
    const bounds = note.started ? this.scrollTrack.bounds(Math.min(this.displayTime, note.endTime), note.endTime, this.scrollBounds) : entry;
    const a = (bounds.min - this.scrollPosition) * rate;
    const b = (bounds.max - this.scrollPosition) * rate;
    const near = Math.max(-0.6, Math.min(a, b));
    const far = Math.min(CONFIG.laneDepth, Math.max(a, b));
    mesh.body.visible = far > near;
    mesh.body.material = this.noteSkins?.holdMaterial(note.lane, note.started) ?? (note.started ? this.activeHoldMaterials[note.lane] : this.holdMaterials[note.lane]);
    mesh.body.position.set(0, CONFIG.hitPlaneY - 0.012, CONFIG.hitZ - (near + far) / 2);
    mesh.body.scale.set(CONFIG.laneWidth - 0.025, 0.03, Math.max(0.001, far - near));
  }

  disposeNotes() {
    this.noteSkins?.dispose();
    this.noteGeometry.dispose(); this.holdGeometry.dispose();
    for (const material of [...this.materials, ...this.holdMaterials, ...this.activeHoldMaterials]) material.dispose();
  }

  update(game, now, songTime = game.songTime) {
    // 開始カウントダウンから表示し、ポーズ中とエディタの停止プレビューでも維持する。
    this.laneRoot.visible = game.state === 'playing' || game.state === 'paused';
    const time = songTime;
    this.gauges.update(game.score ?? 0, time, game.duration ?? game.chart.duration);
    this.prepareNotes(game);
    this.displayTime = time;
    this.scrollPosition = this.scrollTrack.positionAt(time);
    this.speedMultiplier = this.speedTrack.multiplierAt(time);
    this.scrollRate = CONFIG.laneDepth / CONFIG.travelSeconds * this.settings.speed;
    this.prepareNoteIndex();
    const noteFrame = ++this.noteFrame;
    if (game.state === 'playing' || game.state === 'paused') {
      this.noteIndex.visit(this.scrollPosition, time, this.speedMultiplier, this.drawIndexedNote);
    }
    for (const mesh of this.noteMeshes.values()) {
      if (mesh.userData.noteFrame === noteFrame) continue;
      mesh.visible = false;
      this.pool.push(mesh);
      this.noteMeshes.delete(mesh.userData.noteId);
    }
    for (let lane = 0; lane < 4; lane++) {
      const age = Math.max(0, now - this.flashes[lane]) / this.settings.laneEffectDuration;
      const strength = this.settings.laneEffects ? this.settings.laneEffectStrength / 100 : 0;
      const pulse = this.flashes[lane] > 0 ? Math.max(0, 1 - age) * strength : 0;
      this.pads[lane].material.opacity = this.pressed[lane] || game.held?.(lane) ? 0.95 : 0.28 + pulse * 0.6;
    }
    this.effects.update(now, this.pressed, this.flashes);
    const remaining = game.countdownRemainingAt?.(time) ?? Math.max(0, -time);
    const countdown = game.state === 'playing' && !game.countdownPending && remaining > 0 ? `READY ${Math.min(CONFIG.countInSeconds, Math.ceil(remaining))}` : '';
    if (countdown) {
      if (countdown !== this.countdownLabel) this.drawJudgement(countdown, '#9aeeff');
      this.countdownLabel = countdown;
      this.judgement.mesh.visible = true;
      this.judgementLabel.setOpacity(1);
      this.judgementTiming.setOpacity(1);
      return;
    }
    if (this.countdownLabel) { this.countdownLabel = ''; this.lastJudgement = -Infinity; }
    const elapsed = now - this.lastJudgement;
    this.judgement.mesh.visible = !game.countdownPending && elapsed < 650;
    const opacity = Math.max(0, 1 - elapsed / 650);
    this.judgementLabel.setOpacity(opacity);
    this.judgementTiming.setOpacity(opacity);
  }
}
