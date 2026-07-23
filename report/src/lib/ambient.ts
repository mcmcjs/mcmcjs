import { seriesColor } from "@mcmcjs/charts";

interface Walker {
  x: number;
  y: number;
  trail: [number, number][];
}

const TRAIL = 140;

// Two-mode Gaussian mixture log-density; the walkers explore it by Metropolis.
function logDensity(x: number, y: number, tight: number): number {
  const a = -((x - 0.32) ** 2 + (y - 0.42) ** 2) / (0.02 * tight);
  const b = -((x - 0.68) ** 2 + (y - 0.62) ** 2) / (0.014 * tight);
  return Math.max(a, b) + Math.log(1 + Math.exp(-Math.abs(a - b)));
}

export interface Ambient {
  setExcited(on: boolean): void;
  destroy(): void;
}

export function startAmbient(canvas: HTMLCanvasElement, reducedMotion: boolean): Ambient {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { setExcited: () => {}, destroy: () => {} };

  const walkers: Walker[] = [
    { x: 0.3, y: 0.4, trail: [] },
    { x: 0.7, y: 0.6, trail: [] },
  ];
  let excited = false;
  let frame = 0;
  let raf = 0;

  const step = (w: Walker): void => {
    const scale = excited ? 0.02 : 0.045;
    const nx = w.x + (Math.random() - 0.5) * scale;
    const ny = w.y + (Math.random() - 0.5) * scale;
    if (nx < 0.03 || nx > 0.97 || ny < 0.06 || ny > 0.94) return;
    const tight = excited ? 0.35 : 1;
    const accept = Math.exp(logDensity(nx, ny, tight) - logDensity(w.x, w.y, tight));
    if (Math.random() < accept) {
      w.x = nx;
      w.y = ny;
    }
    w.trail.push([w.x, w.y]);
    if (w.trail.length > TRAIL) w.trail.shift();
  };

  const draw = (): void => {
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    walkers.forEach((w, i) => {
      if (w.trail.length < 2) return;
      ctx.strokeStyle = seriesColor(i);
      ctx.lineWidth = Math.max(1, width / 640);
      ctx.lineCap = "round";
      for (let k = 1; k < w.trail.length; k++) {
        const [x0, y0] = w.trail[k - 1] as [number, number];
        const [x1, y1] = w.trail[k] as [number, number];
        ctx.globalAlpha = 0.08 + 0.72 * (k / w.trail.length);
        ctx.beginPath();
        ctx.moveTo(x0 * width, y0 * height);
        ctx.lineTo(x1 * width, y1 * height);
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  };

  if (reducedMotion) {
    for (let i = 0; i < TRAIL; i++) walkers.forEach(step);
    draw();
    return { setExcited: () => {}, destroy: () => {} };
  }

  const tick = (): void => {
    frame += 1;
    if (frame % 2 === 0) walkers.forEach(step);
    draw();
    raf = requestAnimationFrame(tick);
  };
  const onVisibility = (): void => {
    cancelAnimationFrame(raf);
    if (!document.hidden) raf = requestAnimationFrame(tick);
  };
  document.addEventListener("visibilitychange", onVisibility);
  raf = requestAnimationFrame(tick);

  return {
    setExcited: (on: boolean) => {
      excited = on;
    },
    destroy: () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(raf);
    },
  };
}
