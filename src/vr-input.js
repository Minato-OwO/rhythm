import { CONFIG, laneAt } from './config.js';

export class VRInput {
  constructor(scene, game, view, settings, actions) {
    this.scene = scene;
    this.game = game;
    this.view = view;
    this.settings = settings;
    this.actions = actions;
    this.session = null;
    this.hands = new Map();
    this.lastGrip = -Infinity;
    const T = AFRAME.THREE;
    this.tip = new T.Vector3();
    this.orientation = new T.Quaternion();
    this.offset = new T.Vector3(...CONFIG.swing.tipOffset);
    this.trackingToLane = new T.Matrix4();
    this.rig = scene.querySelector('#rig').object3D;
    this.onSelect = event => {
      if (this.actions.select?.(event.inputSource)) return;
      if (this.actions.canQuickStart?.() !== false && this.game.state !== 'playing') {
        this.actions.playUISound?.('press');
        this.actions.toggle();
      }
    };
    this.onSqueeze = () => {
      const now = performance.now();
      if (now - this.lastGrip < 400) return;
      this.lastGrip = now;
      if (this.game.state === 'playing') { this.actions.playUISound?.('press'); this.actions.pause(); }
      else if (this.game.state === 'paused') { this.actions.playUISound?.('press'); this.actions.resume(); }
    };
    this.onVisibility = () => {
      this.reset();
      if (this.session?.visibilityState !== 'visible') this.actions.pause();
    };
    this.onSourceChange = () => {
      const sources = Array.from(this.session?.inputSources ?? []);
      for (const source of this.hands.keys()) if (!sources.includes(source)) this.hands.delete(source);
      this.reset();
    };
  }

  connect(session) {
    if (session === this.session) return;
    this.disconnect();
    this.session = session;
    if (!session) return;
    this.lastGrip = -Infinity;
    session.addEventListener('selectstart', this.onSelect);
    session.addEventListener('squeezestart', this.onSqueeze);
    session.addEventListener('visibilitychange', this.onVisibility);
    session.addEventListener('inputsourceschange', this.onSourceChange);
  }

  disconnect() {
    if (this.session) {
      this.session.removeEventListener('selectstart', this.onSelect);
      this.session.removeEventListener('squeezestart', this.onSqueeze);
      this.session.removeEventListener('visibilitychange', this.onVisibility);
      this.session.removeEventListener('inputsourceschange', this.onSourceChange);
    }
    this.session = null;
    this.hands.clear();
    this.game.releaseSource('left');
    this.game.releaseSource('right');
    this.actions.clearPointers?.();
  }

  reset() {
    this.game.releaseSource('left');
    this.game.releaseSource('right');
    for (const hand of this.hands.values()) {
      hand.valid = false;
      hand.armed = false;
    }
  }

  handFor(source) {
    if (!this.hands.has(source)) {
      this.hands.set(source, {
        previous: new AFRAME.THREE.Vector3(),
        valid: false,
        armed: false,
        stickDown: false,
        sampleTime: 0,
        songTime: 0,
        lastSwing: -Infinity,
      });
    }
    return this.hands.get(source);
  }

  update(nowMs) {
    const xr = this.scene.renderer?.xr;
    const session = xr?.getSession();
    this.connect(session ?? null);
    if (!session || !xr.isPresenting || session.visibilityState !== 'visible') {
      this.reset();
      this.actions.clearPointers?.();
      return;
    }
    const frame = xr.getFrame();
    const referenceSpace = xr.getReferenceSpace();
    if (!frame || !referenceSpace) { this.reset(); this.actions.clearPointers?.(); return; }
    this.actions.updatePointers?.(frame, referenceSpace, session.inputSources);
    // 両手で同じ座標変換を使い、手ごとの親行列更新・逆行列計算を避ける。
    this.rig.updateWorldMatrix(true, false);
    this.view.laneRoot.updateWorldMatrix(true, false);
    this.trackingToLane.copy(this.view.laneRoot.matrixWorld).invert().multiply(this.rig.matrixWorld);
    const now = nowMs / 1000;
    const songTime = this.game.songTime;
    for (const source of session.inputSources) {
      // 位置追跡された左右の物理コントローラーを使用する。
      if (source.targetRayMode !== 'tracked-pointer' || !source.gripSpace || !['left', 'right'].includes(source.handedness)) continue;
      const hand = this.handFor(source);
      const stickDown = Boolean(source.gamepad?.buttons[3]?.pressed);
      if (stickDown && !hand.stickDown) { this.actions.playUISound?.('press'); this.actions.recenter(); }
      hand.stickDown = stickDown;
      const pose = frame.getPose(source.gripSpace, referenceSpace);
      if (!pose || pose.emulatedPosition) {
        this.game.releaseSource(source.handedness);
        hand.valid = false;
        hand.armed = false;
        continue;
      }
      const p = pose.transform.position;
      const q = pose.transform.orientation;
      this.orientation.set(q.x, q.y, q.z, q.w);
      this.tip.copy(this.offset).applyQuaternion(this.orientation);
      this.tip.x += p.x;
      this.tip.y += p.y;
      this.tip.z += p.z;
      this.tip.applyMatrix4(this.trackingToLane);
      const contactLane = laneAt(this.tip.x);
      // 見えている判定パッドの前後の端を、そのまま入力範囲に使う。
      const touching = Math.abs(this.tip.z - CONFIG.hitZ) <= CONFIG.hitPadDepth / 2
        && this.tip.y >= CONFIG.hitPlaneY - CONFIG.hold.belowPlane
        && this.tip.y <= CONFIG.hitPlaneY + CONFIG.hold.abovePlane;
      for (let lane = 0; lane < 4; lane++) this.game.setHeld(lane, touching && lane === contactLane, source.handedness, songTime);
      const dt = now - hand.sampleTime;
      if (!hand.valid || dt <= 0 || dt > CONFIG.swing.maxSampleGapSeconds || hand.previous.distanceTo(this.tip) > CONFIG.swing.maxSampleDistance) {
        this.game.releaseSource(source.handedness);
        hand.valid = true;
        hand.armed = this.tip.y > CONFIG.hitPlaneY + CONFIG.swing.rearmHeight;
        this.saveSample(hand, now, songTime);
        continue;
      }
      if (this.tip.y > CONFIG.hitPlaneY + CONFIG.swing.rearmHeight) hand.armed = true;
      const crossesPlane = hand.previous.y > CONFIG.hitPlaneY && this.tip.y <= CONFIG.hitPlaneY;
      if (crossesPlane && hand.armed) {
        hand.armed = false;
        const downwardSpeed = (hand.previous.y - this.tip.y) / dt;
        if (downwardSpeed >= this.settings.swing && now - hand.lastSwing >= CONFIG.swing.cooldownSeconds) {
          // 1フレーム内の通過位置・通過時刻を線形補間し、高速な振りを取りこぼさない。
          const alpha = (hand.previous.y - CONFIG.hitPlaneY) / (hand.previous.y - this.tip.y);
          const x = hand.previous.x + (this.tip.x - hand.previous.x) * alpha;
          const z = hand.previous.z + (this.tip.z - hand.previous.z) * alpha;
          const lane = laneAt(x);
          if (lane !== -1 && Math.abs(z - CONFIG.hitZ) <= CONFIG.hitPadDepth / 2) {
            hand.lastSwing = now;
            const hitTime = hand.songTime + (songTime - hand.songTime) * alpha;
            if (!this.game.autoplay) this.view.flash(lane);
            const rating = this.game.hit(lane, hitTime, source.handedness);
            if (rating) {
              const actuator = source.gamepad?.hapticActuators?.[0];
              if (actuator?.pulse) {
                try { Promise.resolve(actuator.pulse(rating === 'perfectPlus' || rating === 'perfect' ? 0.5 : 0.28, 35)).catch(() => {}); } catch { /* 任意の触覚フィードバック。 */ }
              }
            }
          }
        }
      }
      this.saveSample(hand, now, songTime);
    }
  }

  saveSample(hand, now, songTime) {
    hand.previous.copy(this.tip);
    hand.sampleTime = now;
    hand.songTime = songTime;
  }
}
