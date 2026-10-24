// 3Dパネルは矩形の平面なので、三角形のRaycastを使わず直接交点を求める。
// resultとそのpointを使い回し、視線・マウス・両手の毎フレーム判定で配列や頂点を生成しない。
export function intersectPanel(panel, origin, direction, result, maxDistance = 8) {
  const m = panel.mesh.matrixWorld.elements;
  const ax = m[0], ay = m[1], az = m[2];
  const bx = m[4], by = m[5], bz = m[6];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const denominator = nx * direction.x + ny * direction.y + nz * direction.z;
  if (denominator === 0) return false;
  const t = (nx * (m[12] - origin.x) + ny * (m[13] - origin.y) + nz * (m[14] - origin.z)) / denominator;
  const distance = t * Math.hypot(direction.x, direction.y, direction.z);
  if (t < 0 || !Number.isFinite(distance) || distance > maxDistance) return false;
  const x = origin.x + direction.x * t;
  const y = origin.y + direction.y * t;
  const z = origin.z + direction.z * t;
  const dx = x - m[12], dy = y - m[13], dz = z - m[14];
  const aa = ax * ax + ay * ay + az * az;
  const bb = bx * bx + by * by + bz * bz;
  const ab = ax * bx + ay * by + az * bz;
  const da = dx * ax + dy * ay + dz * az;
  const db = dx * bx + dy * by + dz * bz;
  const determinant = aa * bb - ab * ab;
  if (determinant <= 0) return false;
  // 親の回転・拡縮を含む座標から、元のパネル上の位置へ戻す。
  const localX = (da * bb - db * ab) / determinant;
  const localY = (db * aa - da * ab) / determinant;
  if (Math.abs(localX) > panel.width / 2 || Math.abs(localY) > panel.height / 2) return false;
  const pixelX = (localX / panel.width + 0.5) * panel.canvas.width;
  const pixelY = (0.5 - localY / panel.height) * panel.canvas.height;
  if (panel.containsPoint && !panel.containsPoint(pixelX, pixelY)) return false;
  result.panel = panel;
  result.x = pixelX;
  result.y = pixelY;
  result.point.set(x, y, z);
  result.distance = distance;
  return true;
}
