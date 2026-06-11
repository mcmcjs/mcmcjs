import { readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Sweeps the mcmcjs-prefixed temp dirs this test session created. Several
 * suites mkdtemp scratch dirs; cleaning them centrally keeps /tmp tidy without
 * per-file teardown boilerplate. The mtime filter spares pre-existing dirs but
 * not a concurrent test session's (dev-only exposure). The per-user runtime
 * parent mcmcjs-<uid> is explicitly excluded: it holds live worker sockets
 * and sandboxes, never test scratch.
 */
export default function globalSetup(): () => void {
  const startedAt = Date.now() - 1_000;
  return () => {
    for (const name of readdirSync(tmpdir())) {
      if (!name.startsWith("mcmcjs-") || /^mcmcjs-\d+$/.test(name)) continue;
      const path = join(tmpdir(), name);
      try {
        if (statSync(path).mtimeMs >= startedAt) rmSync(path, { recursive: true, force: true });
      } catch {}
    }
  };
}
