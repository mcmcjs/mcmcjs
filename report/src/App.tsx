import { useCallback, useEffect, useState } from "react";
import { type DeepLink, Landing } from "./components/Landing";
import { RunView } from "./components/RunView";
import { getRun, type StoredRun } from "./lib/db";
import { useTheme } from "./lib/theme";

function parseHash(): DeepLink | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const runId = params.get("run");
  if (!runId) return null;
  return {
    runId,
    storePath: params.get("store") ?? undefined,
    connect: params.get("connect") ?? undefined,
  };
}

export function App() {
  const { resolved, toggle } = useTheme();
  const [deepLink, setDeepLink] = useState<DeepLink | null>(parseHash);
  const [current, setCurrent] = useState<StoredRun | null>(null);

  const openRun = useCallback((id: string) => {
    getRun(id).then((run) => {
      if (run) {
        setCurrent(run);
        window.location.hash = `run=${encodeURIComponent(id)}`;
      }
    });
  }, []);

  useEffect(() => {
    const onHash = (): void => setDeepLink(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // A deep link opens directly when the run is already in the browser library.
  useEffect(() => {
    if (!deepLink) return;
    getRun(deepLink.runId).then((run) => {
      if (run) setCurrent(run);
    });
  }, [deepLink]);

  const back = useCallback(() => {
    setCurrent(null);
    setDeepLink(null);
    window.location.hash = "";
  }, []);

  const themeLabel = resolved === "dark" ? "light mode" : "dark mode";

  if (current) {
    return (
      <RunView
        run={current}
        onBack={back}
        theme={resolved}
        onToggleTheme={toggle}
        themeLabel={themeLabel}
      />
    );
  }
  return (
    <Landing deepLink={deepLink} onOpen={openRun} onToggleTheme={toggle} themeLabel={themeLabel} />
  );
}
