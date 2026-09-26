// Move overlapping nodes and plates apart while keeping where each one sits relative
// to the others, so the figure stays the arrangement drawn in the editor.

import { type Point, pushApart, type Shape } from "./geometry";

export interface Body {
  shape(): Shape;
  move(dx: number, dy: number): void;
}

/**
 * Push every pair of bodies at least `gap` apart, each giving way by half. All the
 * pushes in a round are added up before anything moves, so a body squeezed from
 * both sides stays put while its neighbours move out, and no body jumps past another.
 */
export function separate(bodies: Body[], gap: number, rounds = 1000): void {
  for (let round = 0; round < rounds; round++) {
    const shapes = bodies.map((b) => b.shape());
    const moves: Point[] = bodies.map(() => ({ x: 0, y: 0 }));
    let moved = false;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const push = pushApart(shapes[i] as Shape, shapes[j] as Shape, gap);
        if (!push) continue;
        const a = moves[i] as Point;
        const b = moves[j] as Point;
        a.x -= push.x / 2;
        a.y -= push.y / 2;
        b.x += push.x / 2;
        b.y += push.y / 2;
        moved = true;
      }
    }
    if (!moved) return;
    bodies.forEach((body, i) => {
      const m = moves[i] as Point;
      if (m.x !== 0 || m.y !== 0) body.move(m.x, m.y);
    });
  }
}
