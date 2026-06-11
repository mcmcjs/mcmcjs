import { readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Sweeps the mcmcjs-prefixed temp dirs this test session created. Several
 * suites mkdtemp scratch dirs; cleaning them centrally keeps /tmp tidy without
 * per-file teardown boilerplate. Only dirs newer than the session start are
 * touched, so concurrent work is safe.
 */
export default function globalSetup(): () => void {
  const startedAt = Date.now() - 1_000;
  return () => {
    for (const name of readdirSync(tmpdir())) {
      if (!name.startsWith("mcmcjs-")) continue;
      const path = join(tmpdir(), name);
      try {
        if (statSync(path).mtimeMs >= startedAt) rmSync(path, { recursive: true, force: true });
      } catch {}
    }
  };
}
