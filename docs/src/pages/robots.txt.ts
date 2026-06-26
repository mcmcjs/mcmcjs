import type { APIRoute } from "astro";
import { withBase } from "../lib/paths";

export const GET: APIRoute = ({ site }) => {
	const baseUrl = site ?? new URL("https://mcmcjs.github.io");
	const sitemapUrl = new URL(withBase("/sitemap-index.xml"), baseUrl).href;
	const host = baseUrl.host;

	const body = [
		"# Open crawling policy: all bots are welcome",
		"User-agent: *",
		"Allow: /",
		"",
		"User-agent: Googlebot",
		"Allow: /",
		"",
		"User-agent: Bingbot",
		"Allow: /",
		"",
		"User-agent: GPTBot",
		"Allow: /",
		"",
		"User-agent: ChatGPT-User",
		"Allow: /",
		"",
		"User-agent: ClaudeBot",
		"Allow: /",
		"",
		"User-agent: PerplexityBot",
		"Allow: /",
		"",
		"User-agent: Bytespider",
		"Allow: /",
		"",
		"User-agent: CCBot",
		"Allow: /",
		"",
		`Host: ${host}`,
		`Sitemap: ${sitemapUrl}`,
	].join("\n");

	return new Response(body, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
};
