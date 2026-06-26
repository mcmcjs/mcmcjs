import type { APIRoute } from "astro";
import { generateOgImage } from "../utils/ogImage";

export const GET: APIRoute = async () => {
	const png = await generateOgImage(
		"MCMC.js",
		"Command-line tools for Bayesian modelling, MCMC inference, and post-inference diagnostics.",
	);
	const body = new Uint8Array(png);
	return new Response(body, {
		headers: {
			"Content-Type": "image/png",
			"Cache-Control": "public, max-age=31536000, immutable",
		},
	});
};
