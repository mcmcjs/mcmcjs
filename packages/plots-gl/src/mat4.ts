/**
 * Compact column-major 4x4 matrix helpers (WebGL convention) for the 3D scatter
 * camera. These are pure and renderer-free so they can be unit-tested without a
 * GL context. A matrix is a 16-element `Float32Array` laid out column-major:
 * element `m[r + c * 4]` is row `r`, column `c`.
 */

/** Perspective projection matrix from a vertical field of view (radians). */
export function mat4Perspective(
  fovY: number,
  aspect: number,
  near: number,
  far: number,
): Float32Array {
  const f = 1 / Math.tan(fovY * 0.5);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

/**
 * Minimal look-at view matrix with the target fixed at the origin and up fixed
 * at [0, 1, 0]; `(ex, ey, ez)` is the eye position. The caller must clamp the
 * camera so the forward vector is never parallel to up.
 */
export function mat4LookAt(ex: number, ey: number, ez: number): Float32Array {
  let fx = -ex;
  let fy = -ey;
  let fz = -ez;
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  let rx = -fz;
  let rz = fx;
  const rl = Math.sqrt(rx * rx + rz * rz) || 1;
  rx /= rl;
  rz /= rl;
  const ry = 0;
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  const m = new Float32Array(16);
  m[0] = rx;
  m[4] = ry;
  m[8] = rz;
  m[12] = -(rx * ex + ry * ey + rz * ez);
  m[1] = ux;
  m[5] = uy;
  m[9] = uz;
  m[13] = -(ux * ex + uy * ey + uz * ez);
  m[2] = -fx;
  m[6] = -fy;
  m[10] = -fz;
  m[14] = fx * ex + fy * ey + fz * ez;
  m[3] = 0;
  m[7] = 0;
  m[11] = 0;
  m[15] = 1;
  return m;
}

/** Column-major matrix product `a * b`. */
export function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[r + c * 4] =
        (a[r] ?? 0) * (b[c * 4] ?? 0) +
        (a[r + 4] ?? 0) * (b[c * 4 + 1] ?? 0) +
        (a[r + 8] ?? 0) * (b[c * 4 + 2] ?? 0) +
        (a[r + 12] ?? 0) * (b[c * 4 + 3] ?? 0);
    }
  }
  return o;
}

/**
 * Project an NDC point `(nx, ny, nz)` through the view-projection matrix `m` to
 * CSS pixel coordinates within a `cssW` x `cssH` viewport. Returns `null` when the
 * point is behind the camera (clip w <= 0).
 */
export function projectPt(
  m: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  cssW: number,
  cssH: number,
): [number, number] | null {
  const clipX = (m[0] ?? 0) * nx + (m[4] ?? 0) * ny + (m[8] ?? 0) * nz + (m[12] ?? 0);
  const clipY = (m[1] ?? 0) * nx + (m[5] ?? 0) * ny + (m[9] ?? 0) * nz + (m[13] ?? 0);
  const clipW = (m[3] ?? 0) * nx + (m[7] ?? 0) * ny + (m[11] ?? 0) * nz + (m[15] ?? 0);
  if (clipW <= 0) return null;
  const sx = (clipX / clipW + 1) * 0.5 * cssW;
  const sy = (1 - clipY / clipW) * 0.5 * cssH;
  return [sx, sy];
}
