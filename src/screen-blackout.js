export const BLACKOUT_TIMING = Object.freeze({ fadeOutMs: 180, holdMs: 150, fadeInMs: 240 });

// クリップ座標の黒い面で、VRの両眼も頭の向きによらず全面を覆う。
export class ScreenBlackout {
  constructor(scene) {
    const T = AFRAME.THREE;
    this.phase = 'idle';
    this.geometry = new T.PlaneGeometry(2, 2);
    this.material = new T.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform float uOpacity; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, uOpacity); }',
    });
    this.mesh = new T.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 30000;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.object3D.add(this.mesh);
  }

  get active() { return this.phase !== 'idle'; }

  begin(now, { onCovered = () => {}, onReveal = () => {} } = {}) {
    this.phase = 'out';
    this.startedAt = now;
    this.onCovered = onCovered;
    this.onReveal = onReveal;
    this.material.uniforms.uOpacity.value = 0;
    this.mesh.visible = true;
  }

  update(now, ready = true) {
    const timing = BLACKOUT_TIMING;
    if (this.phase === 'out') {
      const p = Math.max(0, Math.min(1, (now - this.startedAt) / timing.fadeOutMs));
      this.material.uniforms.uOpacity.value = p * p * (3 - 2 * p);
      if (p === 1) {
        this.phase = 'hold';
        this.startedAt = now;
        this.onCovered();
      }
    } else if (this.phase === 'hold') {
      if (ready && now - this.startedAt >= timing.holdMs) {
        this.phase = 'in';
        this.startedAt = now;
        this.onReveal();
      }
    } else if (this.phase === 'in') {
      const p = Math.max(0, Math.min(1, (now - this.startedAt) / timing.fadeInMs));
      this.material.uniforms.uOpacity.value = 1 - p * p * (3 - 2 * p);
      if (p === 1) this.cancel();
    }
  }

  cancel() {
    this.phase = 'idle';
    this.mesh.visible = false;
    this.material.uniforms.uOpacity.value = 0;
    this.onCovered = this.onReveal = null;
  }

  dispose() {
    this.cancel();
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
