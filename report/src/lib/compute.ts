import { useEffect, useMemo, useState } from "react";
import type { ComputeRequest, ComputeResponse } from "./compute-worker";

export interface SamplesMeta {
  variables: string[];
  nChains: number;
  nDraws: number;
}

/** One worker per open run: samples parse once off-thread, plots compute FIFO. */
export class Compute {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor() {
    this.worker = new Worker(new URL("./compute-worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<ComputeResponse>) => {
      const entry = this.pending.get(event.data.id);
      if (!entry) return;
      this.pending.delete(event.data.id);
      if (event.data.error) entry.reject(new Error(event.data.error));
      else entry.resolve(event.data.data);
    };
  }

  private send<T>(request: Omit<ComputeRequest, "id">): Promise<T> {
    this.seq += 1;
    const id = this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...request, id });
    });
  }

  load(samplesText: string): Promise<SamplesMeta> {
    return this.send({ type: "load", samplesText });
  }

  run<T>(op: string, extras: Partial<ComputeRequest> = {}): Promise<T> {
    return this.send({ type: "compute", op, ...extras });
  }

  destroy(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}

export function useComputeSession(samplesText: string): {
  compute: Compute | null;
  meta: SamplesMeta | null;
} {
  const compute = useMemo(() => new Compute(), []);
  const [meta, setMeta] = useState<SamplesMeta | null>(null);
  useEffect(() => {
    let alive = true;
    compute.load(samplesText).then((m) => {
      if (alive) setMeta(m);
    });
    return () => {
      alive = false;
    };
  }, [compute, samplesText]);
  useEffect(() => () => compute.destroy(), [compute]);
  return { compute: meta ? compute : null, meta };
}

export function useComputed<T>(
  compute: Compute | null,
  op: string,
  extras: Partial<ComputeRequest> = {},
): T | null {
  const [data, setData] = useState<T | null>(null);
  const key = JSON.stringify(extras);
  useEffect(() => {
    if (!compute) return;
    let alive = true;
    setData(null);
    compute.run<T>(op, JSON.parse(key) as Partial<ComputeRequest>).then(
      (result) => {
        if (alive) setData(result);
      },
      () => {
        if (alive) setData(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [compute, op, key]);
  return data;
}
