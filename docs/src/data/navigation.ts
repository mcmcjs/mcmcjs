export const navGroups = [
	{
		title: "Get started",
		items: [
			{ title: "Introduction", href: "/docs/" },
			{ title: "Installation", href: "/docs/install/" },
			{ title: "Quickstart", href: "/docs/quickstart/" },
		],
	},
	{
		title: "Guides",
		items: [
			{ title: "Run inference", href: "/docs/guides/run/" },
			{ title: "Diagnose convergence", href: "/docs/guides/diagnose/" },
			{ title: "Plot", href: "/docs/guides/plot/" },
			{ title: "Predict", href: "/docs/guides/predict/" },
			{ title: "The run store", href: "/docs/guides/run-store/" },
			{ title: "Convert DoodleBUGS", href: "/docs/guides/convert/" },
			{ title: "Manage Julia", href: "/docs/guides/julia/" },
			{ title: "Use Stan", href: "/docs/guides/stan/" },
		],
	},
	{
		title: "Reference",
		items: [
			{ title: "CLI commands", href: "/docs/reference/commands/" },
			{ title: "Spec file", href: "/docs/reference/spec/" },
			{ title: "Samples file", href: "/docs/reference/samples/" },
			{ title: "Exit codes", href: "/docs/reference/exit-codes/" },
		],
	},
	{
		title: "Develop",
		items: [
			{ title: "Architecture", href: "/docs/dev/architecture/" },
			{ title: "Packages", href: "/docs/dev/packages/" },
			{ title: "Engine contract", href: "/docs/dev/engine/" },
			{ title: "Julia driver", href: "/docs/dev/julia/" },
			{ title: "Stan engine", href: "/docs/dev/stan/" },
			{ title: "Plotting internals", href: "/docs/dev/plotting/" },
			{ title: "Contributing", href: "/docs/dev/contributing/" },
		],
	},
];

export const quickLinks = navGroups.flatMap((group) => group.items);
