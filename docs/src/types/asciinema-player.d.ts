declare module "asciinema-player" {
	interface PlayerOptions {
		autoplay?: boolean;
		preload?: boolean;
		loop?: boolean;
		speed?: number;
		idleTimeLimit?: number;
		cols?: number;
		rows?: number;
		fit?: "width" | "height" | "both" | "none" | false;
		theme?: string;
		terminalFontSize?: string;
		terminalFontFamily?: string;
		[key: string]: unknown;
	}

	interface PlayerInstance {
		dispose(): void;
		play(): Promise<void>;
		pause(): void;
		seek(time: number | string): Promise<void>;
		getCurrentTime(): number | undefined;
		getRemainingTime(): number | undefined;
		getDuration(): number | undefined;
		isPaused(): boolean;
		isFinished(): boolean;
	}

	export function create(
		src: string,
		element: Element,
		options?: PlayerOptions,
	): PlayerInstance;
}
