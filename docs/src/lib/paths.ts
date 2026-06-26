export function withBase(path: string): string {
	if (/^(https?:|mailto:|#)/.test(path)) return path;

	const base = import.meta.env.BASE_URL || "/";
	const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;

	return `${normalizedBase}${normalizedPath}` || normalizedPath;
}
