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
