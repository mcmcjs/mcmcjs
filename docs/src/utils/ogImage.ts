import { Resvg } from "@resvg/resvg-js";
import satori, { type Font } from "satori";

// Grayscale "MCMC.js" mark for the OG card (paper theme: no green/amber accents).
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
	<polyline
		points="14,82 38,60 50,28 62,60 86,82"
		fill="none"
		stroke="#1e2749"
		stroke-width="3.6"
		stroke-linejoin="round"
		stroke-linecap="round"
	/>
	<polyline
		points="38,60 50,28 62,60"
		fill="none"
		stroke="#5b3fd6"
		stroke-width="3.6"
		stroke-linejoin="round"
		stroke-linecap="round"
	/>
	<circle cx="14" cy="82" r="6" fill="#1e2749" />
	<circle cx="38" cy="60" r="6" fill="#1e2749" />
	<circle cx="50" cy="28" r="7" fill="#5b3fd6" />
	<circle cx="62" cy="60" r="6" fill="#5b3fd6" />
	<circle cx="86" cy="82" r="6" fill="#1e2749" />
</svg>`;

const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString("base64")}`;

async function fetchGoogleFont(
	family: string,
	weight: number,
	text: string,
): Promise<ArrayBuffer | null> {
	try {
		const css = await fetch(
			`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`,
			{
				headers: {
					"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
				},
			},
		).then((r) => r.text());
		const match = css.match(
			/src: url\((.+?)\) format\('(opentype|truetype)'\)/,
		);
		if (!match) return null;
		const res = await fetch(match[1]);
		return res.ok ? res.arrayBuffer() : null;
	} catch {
		return null;
	}
}

let fontsCache: Font[] | null = null;

async function loadFonts(text: string): Promise<Font[]> {
	if (fontsCache) return fontsCache;
	const [regular, bold] = await Promise.all([
		fetchGoogleFont("Inter", 400, text),
		fetchGoogleFont("Inter", 700, text),
	]);
	const fonts: Font[] = [];
	if (regular)
		fonts.push({ name: "Inter", data: regular, weight: 400, style: "normal" });
	if (bold)
		fonts.push({ name: "Inter", data: bold, weight: 700, style: "normal" });
	fontsCache = fonts;
	return fonts;
}

export async function generateOgImage(
	title: string,
	description?: string,
): Promise<Uint8Array> {
	const text = [title, description ?? "", "MCMC.js", "—"].join(" ");
	const fonts = await loadFonts(text);
	const fontFamily = fonts.length ? "Inter" : "sans-serif";

	const svg = await satori(
		// satori accepts plain VNode objects matching React.ReactNode shape
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		{
			type: "div",
			props: {
				style: {
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					alignItems: "center",
					padding: "72px 80px",
					textAlign: "center",
					background: "#fbfbfa",
					fontFamily,
					position: "relative",
					overflow: "hidden",
				},
				children: [
					{
						type: "div",
						props: {
							style: {
								display: "flex",
								alignItems: "center",
								gap: "20px",
								marginBottom: description ? "36px" : "0",
							},
							children: [
								{
									type: "img",
									props: {
										src: LOGO_DATA_URI,
										width: 90,
										height: 90,
										style: { display: "block" },
									},
								},
								{
									type: "span",
									props: {
										style: {
											fontSize: 72,
											fontWeight: 700,
											color: "#1a1a1a",
											lineHeight: 1,
											letterSpacing: "-0.02em",
										},
										children: "MCMC.js",
									},
								},
							],
						},
					},
					...(title !== "MCMC.js"
						? [
								{
									type: "div",
									props: {
										style: {
											fontSize: title.length > 40 ? 44 : 52,
											fontWeight: 700,
											color: "#1a1a1a",
											lineHeight: 1.2,
											maxWidth: "860px",
											marginBottom: description ? "20px" : "0",
										},
										children: title,
									},
								},
							]
						: []),
					...(description
						? [
								{
									type: "div",
									props: {
										style: {
											fontSize: 26,
											color: "rgba(26,26,26,0.55)",
											lineHeight: 1.5,
											maxWidth: "780px",
										},
										children: description,
									},
								},
							]
						: []),
				],
			},
		} as Parameters<typeof satori>[0],
		{
			width: 1200,
			height: 630,
			fonts,
		},
	);

	const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } });
	return new Uint8Array(resvg.render().asPng());
}
