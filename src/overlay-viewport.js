// 左右の非対称なXR投影を含め、カメラ前の面で視界全体を覆う。
// resultを使い回し、アニメーション中の配列・頂点の生成を避ける。
export function measureOverlayViewport(scene, distance, result) {
  let halfWidth = 0, halfHeight = 0;
  const xr = scene.renderer?.xr;
  const camera = xr?.isPresenting ? xr.getCamera?.() ?? scene.camera : scene.camera;
  const views = camera?.cameras;
  for (let index = 0, count = views?.length || 1; index < count; index++) {
    const p = (views?.length ? views[index] : camera)?.projectionMatrix?.elements;
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[5]) || !p[0] || !p[5]) continue;
    halfWidth = Math.max(halfWidth, distance * (1 + Math.abs(p[8] ?? 0)) / Math.abs(p[0]));
    halfHeight = Math.max(halfHeight, distance * (1 + Math.abs(p[9] ?? 0)) / Math.abs(p[5]));
  }
  result.viewWidth = (halfWidth || 0.5) * 2;
  result.viewHeight = (halfHeight || 0.5) * 2;
  result.width = result.viewWidth * 1.15 + 0.16;
  result.height = result.viewHeight * 1.15 + 0.16;
  return result;
}

// VRでは表示開始時の視点をワールドに固定し、以後の頭の移動・回転には追従しない。
export class OverlayAnchor {
  constructor(scene, content) {
    this.scene = scene;
    this.root = new AFRAME.THREE.Group();
    this.root.add(content);
    this.viewport = {};
    this.onCameraSetActive = () => { if (!this.worldLocked) this.capture(); };
    this.onModeChange = () => this.capture();
    scene.addEventListener('camera-set-active', this.onCameraSetActive);
    scene.addEventListener('enter-vr', this.onModeChange);
    scene.addEventListener('exit-vr', this.onModeChange);
    this.capture();
  }

  capture() {
    const scene = this.scene;
    const xr = scene.renderer?.xr;
    this.worldLocked = scene.is('vr-mode') || Boolean(xr?.isPresenting);
    this.viewportDirty = true;
    const camera = xr?.isPresenting ? xr.getCamera() : scene.camera;
    if (!camera) return;
    if (this.worldLocked) {
      camera.updateWorldMatrix(true, false);
      scene.object3D.updateWorldMatrix(true, false);
      // カメラのワールド姿勢をシーン座標へ変換して一度だけ保存する。
      this.root.matrix.copy(scene.object3D.matrixWorld).invert().multiply(camera.matrixWorld);
      this.root.matrix.decompose(this.root.position, this.root.quaternion, this.root.scale);
      scene.object3D.add(this.root);
    } else {
      this.root.position.set(0, 0, 0);
      this.root.quaternion.identity();
      this.root.scale.set(1, 1, 1);
      camera.add(this.root);
    }
    this.root.updateMatrixWorld(true);
  }

  measure(distance, result) {
    // 固定したVR画面の大きさも保ち、表示中に視点から再配置しない。
    if (this.viewportDirty || !this.worldLocked) {
      measureOverlayViewport(this.scene, distance, this.viewport);
      this.viewportDirty = false;
    }
    return Object.assign(result, this.viewport);
  }

  dispose() {
    this.scene.removeEventListener('camera-set-active', this.onCameraSetActive);
    this.scene.removeEventListener('enter-vr', this.onModeChange);
    this.scene.removeEventListener('exit-vr', this.onModeChange);
    this.root.removeFromParent();
  }
}
