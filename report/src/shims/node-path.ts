export function join(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "." : path.slice(0, i);
}

export function extname(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot);
}

export function resolve(...parts: string[]): string {
  return join(...parts);
}
