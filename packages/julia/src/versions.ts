import type { CommandRunner, RuntimeVersion } from "@mcmcjs/engine";

interface ChannelInfo {
  Name: string;
  File: string;
  Args?: string[];
  Version?: string;
  Arch?: string;
}

interface Getconfig1 {
  DefaultChannel: ChannelInfo | null;
  OtherChannels: ChannelInfo[];
}

function parseChannel(value: unknown): ChannelInfo {
  const c = value as Record<string, unknown>;
  if (!c || typeof c.Name !== "string" || typeof c.File !== "string") {
    throw new Error("unexpected `juliaup api getconfig1` channel shape");
  }
  return {
    Name: c.Name,
    File: c.File,
    Args: Array.isArray(c.Args) ? (c.Args as string[]) : undefined,
    Version: typeof c.Version === "string" ? c.Version : undefined,
    Arch: typeof c.Arch === "string" ? c.Arch : undefined,
  };
}

function parseGetconfig1(raw: string): Getconfig1 {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("could not parse `juliaup api getconfig1` output as JSON");
  }
  const obj = data as Record<string, unknown>;
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.OtherChannels)) {
    throw new Error("unexpected `juliaup api getconfig1` output");
  }
  return {
    DefaultChannel: obj.DefaultChannel ? parseChannel(obj.DefaultChannel) : null,
    OtherChannels: obj.OtherChannels.map(parseChannel),
  };
}

function toVersion(channel: ChannelInfo, isDefault: boolean): RuntimeVersion {
  return { id: channel.Name, version: channel.Version, path: channel.File || undefined, isDefault };
}

/** Lists the installed Julia versions, marking the default channel. */
export async function listVersions(bin: string, run: CommandRunner): Promise<RuntimeVersion[]> {
  const config = parseGetconfig1(await run(bin, ["api", "getconfig1"]));
  const versions: RuntimeVersion[] = [];
  if (config.DefaultChannel) versions.push(toVersion(config.DefaultChannel, true));
  for (const channel of config.OtherChannels) versions.push(toVersion(channel, false));
  return versions;
}

export async function addVersion(
  bin: string,
  channel: string,
  opts: { default?: boolean },
  run: CommandRunner,
): Promise<void> {
  await run(bin, ["add", channel]);
  if (opts.default) await run(bin, ["default", channel]);
}

export async function removeVersion(
  bin: string,
  channel: string,
  run: CommandRunner,
): Promise<void> {
  await run(bin, ["remove", channel]);
}

export async function setDefaultVersion(
  bin: string,
  channel: string,
  run: CommandRunner,
): Promise<void> {
  await run(bin, ["default", channel]);
}

export async function updateVersion(
  bin: string,
  channel: string | undefined,
  run: CommandRunner,
): Promise<void> {
  await run(bin, channel ? ["update", channel] : ["update"]);
}

export async function gcVersions(bin: string, run: CommandRunner): Promise<void> {
  await run(bin, ["gc"]);
}

/** Resolves a channel to a concrete invocation, preferring its absolute binary path. */
export async function resolveVersion(
  bin: string,
  channel: string,
  run: CommandRunner,
): Promise<{ command: string; args: string[] }> {
  const config = parseGetconfig1(await run(bin, ["api", "getconfig1"]));
  const all = config.DefaultChannel
    ? [config.DefaultChannel, ...config.OtherChannels]
    : config.OtherChannels;
  const match = all.find((c) => c.Name === channel);
  if (!match?.File) {
    throw new Error(
      `Julia version "${channel}" is not installed. Add it with: mcmc julia version add ${channel}`,
    );
  }
  return { command: match.File, args: match.Args ?? [] };
}

/** Throws with an actionable message if any requested channel is not installed. */
export function assertVersionsInstalled(channels: string[], installed: RuntimeVersion[]): void {
  const have = new Set(installed.map((v) => v.id));
  const missing = channels.filter((c) => !have.has(c));
  if (missing.length > 0) {
    const fixes = missing.map((m) => `mcmc julia version add ${m}`).join("; ");
    throw new Error(
      `Julia version(s) not installed: ${missing.join(", ")}. Install with: ${fixes}`,
    );
  }
}
