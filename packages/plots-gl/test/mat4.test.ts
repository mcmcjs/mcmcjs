import { describe, expect, it } from "vitest";
import { mat4LookAt, mat4Multiply, mat4Perspective, projectPt } from "../src/mat4";

/** Compare two matrices element-wise to 5 decimal places. */
function expectMatClose(actual: Float32Array, expected: number[]): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i] ?? Number.NaN).toBeCloseTo(expected[i] ?? Number.NaN, 5);
  }
}

describe("mat4Perspective", () => {
  it("matches the reference golden matrix (FOV=PI/4, aspect=1.5)", () => {
    const m = mat4Perspective(Math.PI / 4, 1.5, 0.01, 50);
    // Column-major: only m0, m5, m10, m11, m14 are non-zero.
    expect(m[0]).toBeCloseTo(1.60947573, 5);
    expect(m[5]).toBeCloseTo(2.41421366, 5);
    expect(m[10]).toBeCloseTo(-1.00040007, 5);
    expect(m[11]).toBe(-1);
    expect(m[14]).toBeCloseTo(-0.020004, 5);
    // All other entries are zero.
    for (const i of [1, 2, 3, 4, 6, 7, 8, 9, 12, 13, 15]) expect(m[i]).toBe(0);
  });
});

describe("mat4LookAt", () => {
  it("is a pure -z translation when the eye sits on the +z axis", () => {
    const m = mat4LookAt(0, 0, 3.2);
    expectMatClose(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -3.2, 1]);
  });

  it("matches the reference golden view for the default orbit eye", () => {
    // eye(theta=0.6, phi=0.4, r=3.2) = (1.6642245, 1.2461387, 2.43259021)
    const m = mat4LookAt(1.6642245, 1.2461387, 2.43259021);
    expectMatClose(
      m,
      [
        0.82533562, -0.21988213, 0.52007014, 0, 0, 0.92106098, 0.38941833, 0, -0.56464249,
        -0.32140082, 0.76018447, 0, 0, 0, -3.20000005, 1,
      ],
    );
  });
});

describe("mat4Multiply", () => {
  it("is the identity on the right", () => {
    const id = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const m = mat4Perspective(Math.PI / 4, 1.5, 0.01, 50);
    expectMatClose(mat4Multiply(m, id), Array.from(m));
  });

  it("produces the reference perspective * lookAt(eye) product", () => {
    const p = mat4Perspective(Math.PI / 4, 1.5, 0.01, 50);
    const v = mat4LookAt(1.6642245, 1.2461387, 2.43259021);
    expectMatClose(
      mat4Multiply(p, v),
      [
        1.328358, -0.530842, -0.520278, -0.52007, 0, 2.223638, -0.389574, -0.389418, -0.908778,
        -0.77593, -0.760489, -0.760184, 0, 0, 3.181276, 3.2,
      ],
    );
  });
});

describe("projectPt", () => {
  const mvp = mat4Multiply(
    mat4Perspective(Math.PI / 4, 1.5, 0.01, 50),
    mat4LookAt(1.6642245, 1.2461387, 2.43259021),
  );

  it("projects the origin to the viewport center", () => {
    const p = projectPt(mvp, 0, 0, 0, 800, 600);
    expect(p).not.toBeNull();
    expect(p?.[0]).toBeCloseTo(400, 4);
    expect(p?.[1]).toBeCloseTo(300, 4);
  });

  it("matches the reference projection of (1,1,1)", () => {
    const p = projectPt(mvp, 1, 1, 1, 800, 600);
    expect(p?.[0]).toBeCloseTo(509.6705, 3);
    expect(p?.[1]).toBeCloseTo(120.2609, 3);
  });

  it("returns null for a point behind the camera (clip w <= 0)", () => {
    const behind = mat4Multiply(mat4Perspective(Math.PI / 4, 1.5, 0.01, 50), mat4LookAt(0, 0, 3.2));
    expect(projectPt(behind, 0, 0, 5, 800, 600)).toBeNull();
  });
});
