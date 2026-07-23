import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const KEY = "mcmc-report-theme";

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme(): { resolved: ResolvedTheme; mode: ThemeMode; toggle: () => void } {
  const [mode, setMode] = useState<ThemeMode>(
    () => (localStorage.getItem(KEY) as ThemeMode | null) ?? "system",
  );
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => setSystem(systemTheme());
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const resolved = mode === "system" ? system : mode;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
    if (mode === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  }, [mode, resolved]);

  const toggle = (): void => setMode(resolved === "dark" ? "light" : "dark");
  return { resolved, mode, toggle };
}
