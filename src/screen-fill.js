// カメラの向き・位置に依存しない単色の面。VRでは各眼の視界全体を覆う。
export class ScreenFill {
  constructor(scene, { color = '#000000', renderOrder = 30000 } = {}) {
    const T = AFRAME.THREE;
    this.geometry = new T.PlaneGeometry(2, 2);
    this.material = new T.ShaderMaterial({
      uniforms: { uColor: { value: new T.Color(color) }, uOpacity: { value: 0 } },
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        void main() {
          gl_FragColor = vec4(uColor, uOpacity);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new T.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = renderOrder;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.object3D.add(this.mesh);
  }

  get opacity() { return this.material.uniforms.uOpacity.value; }

  setOpacity(value) {
    this.material.uniforms.uOpacity.value = value;
    this.mesh.visible = value > 0;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
