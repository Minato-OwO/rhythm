import { CONFIG, laneX } from './config.js';

const BURSTS_PER_LANE = 3;
const SPARKS_PER_BURST = 6;

// 発光・波紋・火花は起動時に用意し、ヒット時には開始時刻だけを更新する。
export class LaneEffects {
  constructor(T, parent, settings) {
    this.T = T;
    this.settings = settings;
    this.root = new T.Group();
    parent.add(this.root);
    this.materials = [];
    this.glows = [];
    this.bursts = [];
    this.nextBurst = new Uint8Array(4);
    this.colors = CONFIG.colors.map(color => new T.Color(color));
    this.transform = new T.Object3D();
    this.enabled = false;

    this.glowGeometry = new T.PlaneGeometry(CONFIG.laneWidth, CONFIG.laneDepth, 4, 8);
    const uv = this.glowGeometry.attributes.uv;
    const gradients = new Float32Array(uv.count * 3);
    for (let index = 0; index < uv.count; index++) {
      const across = Math.max(0, 1 - Math.abs(uv.getX(index) * 2 - 1));
      const value = Math.sqrt(across) * (1 - uv.getY(index)) ** 1.5;
      gradients[index * 3] = value;
      gradients[index * 3 + 1] = value;
      gradients[index * 3 + 2] = value;
    }
    this.glowGeometry.setAttribute('color', new T.BufferAttribute(gradients, 3));
    this.ringGeometry = new T.RingGeometry(0.075, 0.084, 24);
    this.sparkGeometry = new T.BoxGeometry(0.65, 1.8, 0.65);

    for (let lane = 0; lane < 4; lane++) {
      const glow = new T.Mesh(this.glowGeometry, this.material(CONFIG.colors[lane], { vertexColors: true }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(laneX(lane), 0.038, CONFIG.hitZ - CONFIG.laneDepth / 2);
      this.root.add(glow);
      this.glows.push(glow);
      for (let slot = 0; slot < BURSTS_PER_LANE; slot++) {
        const ring = new T.Mesh(this.ringGeometry, this.material(CONFIG.colors[lane]));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(laneX(lane), 0.043, CONFIG.hitZ);
        this.root.add(ring);
        this.bursts.push({ lane, started: -Infinity, ring });
      }
    }

    // 火花は全レーンを1つのInstancedMeshにまとめる。
    this.sparks = new T.InstancedMesh(
      this.sparkGeometry,
      this.material('#ffffff', { side: T.FrontSide }),
      this.bursts.length * SPARKS_PER_BURST,
    );
    this.sparks.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.sparks.setColorAt(0, this.colors[0]);
    this.sparks.instanceColor.setUsage(T.DynamicDrawUsage);
    // 動く粒ごとの境界計算を避ける。個数は最大72個に固定。
    this.sparks.frustumCulled = false;
    this.root.add(this.sparks);
    this.directions = Array.from({ length: SPARKS_PER_BURST }, (_, index) => {
      const angle = index / SPARKS_PER_BURST * Math.PI * 2;
      return { x: Math.cos(angle), z: Math.sin(angle), angle, height: 0.1 + index % 3 * 0.055 };
    });
    this.reset();
  }

  material(color, options = {}) {
    const T = this.T;
    const material = new T.MeshBasicMaterial({
      color, transparent: true, opacity: 0, blending: T.AdditiveBlending,
      depthWrite: false, toneMapped: false, fog: false,
      side: T.DoubleSide, forceSinglePass: true, ...options,
    });
    this.materials.push(material);
    return material;
  }

  hit(lane, now) {
    const settings = this.settings;
    if (!settings.laneEffects || settings.laneEffectStrength <= 0 || !settings.laneRipple && !settings.laneSparks) return;
    const slot = this.nextBurst[lane];
    this.bursts[lane * BURSTS_PER_LANE + slot].started = now;
    this.nextBurst[lane] = (slot + 1) % BURSTS_PER_LANE;
  }

  setLaneColor(lane, color) {
    this.colors[lane].copy(color);
    this.glows[lane].material.color.copy(color);
    for (let slot = 0; slot < BURSTS_PER_LANE; slot++) this.bursts[lane * BURSTS_PER_LANE + slot].ring.material.color.copy(color);
  }

  reset() {
    this.nextBurst.fill(0);
    for (const burst of this.bursts) {
      burst.started = -Infinity;
      burst.ring.visible = false;
    }
    for (const glow of this.glows) glow.visible = false;
    this.sparks.count = 0;
    this.sparks.visible = false;
    this.root.visible = false;
    this.enabled = false;
  }

  update(now, pressed, flashes) {
    const settings = this.settings;
    const strength = settings.laneEffectStrength / 100;
    if (!settings.laneEffects || strength <= 0) {
      if (this.enabled) this.reset();
      return;
    }
    this.enabled = true;
    this.root.visible = true;
    const duration = settings.laneEffectDuration;
    for (let lane = 0; lane < 4; lane++) {
      const age = Math.max(0, now - flashes[lane]) / duration;
      const pulse = flashes[lane] > 0 ? Math.max(0, 1 - age) ** 2 : 0;
      const opacity = strength * Math.max(pressed[lane] ? 0.3 : 0, pulse * 0.8);
      const glow = this.glows[lane];
      glow.visible = Boolean(settings.laneGlow) && opacity > 0;
      glow.material.opacity = opacity;
    }

    let sparkCount = 0;
    for (const burst of this.bursts) {
      const age = Math.max(0, now - burst.started) / duration;
      const active = age < 1;
      burst.ring.visible = Boolean(settings.laneRipple) && active;
      if (!active) { burst.started = -Infinity; continue; }
      burst.ring.material.opacity = strength * (1 - age) ** 1.5;
      burst.ring.scale.setScalar(0.65 + age * 1.6);
      if (!settings.laneSparks) continue;
      for (const direction of this.directions) {
        this.transform.position.set(
          laneX(burst.lane) + direction.x * age * 0.18,
          CONFIG.hitPlaneY + Math.sin(age * Math.PI) * direction.height,
          CONFIG.hitZ + direction.z * age * 0.14,
        );
        this.transform.rotation.set(0.5, direction.angle, age * 3);
        this.transform.scale.setScalar(0.012 * (1 - age));
        this.transform.updateMatrix();
        this.sparks.setMatrixAt(sparkCount, this.transform.matrix);
        this.sparks.setColorAt(sparkCount, this.colors[burst.lane]);
        sparkCount++;
      }
    }
    this.sparks.count = sparkCount;
    this.sparks.visible = sparkCount > 0;
    this.sparks.material.opacity = strength;
    if (sparkCount) {
      this.sparks.instanceMatrix.needsUpdate = true;
      this.sparks.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.sparks.dispose();
    this.glowGeometry.dispose();
    this.ringGeometry.dispose();
    this.sparkGeometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
