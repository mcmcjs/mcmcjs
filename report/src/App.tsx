import { useCallback, useEffect, useState } from "react";
import { Landing } from "./components/Landing";
import { RunView } from "./components/RunView";
import { getRun, type StoredRun } from "./lib/db";
import { type DeepLink, parseHash, runHash } from "./lib/deeplink";
import { useTheme } from "./lib/theme";

function readHash(): DeepLink | null {
  return parseHash(window.location.hash);
}

export function App() {
  const { resolved, toggle } = useTheme();
  const [deepLink, setDeepLink] = useState<DeepLink | null>(readHash);
  const [current, setCurrent] = useState<StoredRun | null>(null);

  const openRun = useCallback((id: string) => {
    getRun(id).then((run) => {
      if (run) {
        setCurrent(run);
        window.location.hash = runHash(id, readHash());
      }
    });
  }, []);

  useEffect(() => {
    const onHash = (): void => {
      const link = readHash();
      setDeepLink(link);
      setCurrent((current) =>
        link?.runId && current && current.id !== link.runId ? null : current,
      );
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // A deep link opens directly when the run is already in the browser library.
  useEffect(() => {
    if (!deepLink?.runId) return;
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
