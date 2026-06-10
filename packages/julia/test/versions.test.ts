import type { CommandRunner } from "@mcmcjs/engine";
import { describe, expect, it } from "vitest";
import {
  addVersion,
  assertVersionsInstalled,
  gcVersions,
  listVersions,
  removeVersion,
  resolveVersion,
  setDefaultVersion,
  updateVersion,
} from "../src/versions";

const CONFIG = JSON.stringify({
  DefaultChannel: {
    Name: "release",
    File: "/home/u/.julia/juliaup/julia-1.12.6/bin/julia",
    Args: [],
    Version: "1.12.6",
    Arch: "x64",
  },
  OtherChannels: [
    {
      Name: "1.10",
      File: "/home/u/.julia/juliaup/julia-1.10.5/bin/julia",
      Args: [],
      Version: "1.10.5",
      Arch: "",
    },
  ],
});

const constant =
  (stdout: string): CommandRunner =>
  async () =>
    stdout;

/** Records every (command, args) invocation for exact-argv assertions. */
function recorder(stdout = ""): { run: CommandRunner; calls: Array<[string, string[]]> } {
  const calls: Array<[string, string[]]> = [];
  return {
    calls,
    run: async (command, args) => {
      calls.push([command, args]);
      return stdout;
    },
  };
}

describe("listVersions", () => {
  it("parses installed versions and marks the default", async () => {
    const versions = await listVersions("juliaup", constant(CONFIG));
    expect(versions).toEqual([
      {
        id: "release",
        version: "1.12.6",
        path: "/home/u/.julia/juliaup/julia-1.12.6/bin/julia",
        isDefault: true,
      },
      {
        id: "1.10",
        version: "1.10.5",
        path: "/home/u/.julia/juliaup/julia-1.10.5/bin/julia",
        isDefault: false,
      },
    ]);
  });

  it("tolerates a null default and empty channels", async () => {
    const versions = await listVersions(
      "juliaup",
      constant('{"DefaultChannel":null,"OtherChannels":[]}'),
    );
    expect(versions).toEqual([]);
  });

  it("throws an actionable error on non-JSON output", async () => {
    await expect(listVersions("juliaup", constant("not json"))).rejects.toThrow(/getconfig1/);
  });

  it("throws when OtherChannels is not an array", async () => {
    await expect(
      listVersions("juliaup", constant('{"DefaultChannel":null,"OtherChannels":{}}')),
    ).rejects.toThrow(/getconfig1/);
  });

  it("throws when a channel is missing its name or path", async () => {
    await expect(
      listVersions(
        "juliaup",
        constant('{"DefaultChannel":null,"OtherChannels":[{"Name":"1.10"}]}'),
      ),
    ).rejects.toThrow(/getconfig1/);
  });
});

describe("mutators issue the right juliaup commands", () => {
  it("add installs the channel", async () => {
    const r = recorder();
    await addVersion("juliaup", "1.10", {}, r.run);
    expect(r.calls).toEqual([["juliaup", ["add", "1.10"]]]);
  });

  it("add --default also sets the default", async () => {
    const r = recorder();
    await addVersion("juliaup", "1.10", { default: true }, r.run);
    expect(r.calls).toEqual([
      ["juliaup", ["add", "1.10"]],
      ["juliaup", ["default", "1.10"]],
    ]);
  });

  it("remove, default, update, and gc map to their subcommands", async () => {
    const r = recorder();
    await removeVersion("juliaup", "1.10", r.run);
    await setDefaultVersion("juliaup", "release", r.run);
    await updateVersion("juliaup", "1.10", r.run);
    await updateVersion("juliaup", undefined, r.run);
    await gcVersions("juliaup", r.run);
    expect(r.calls).toEqual([
      ["juliaup", ["remove", "1.10"]],
      ["juliaup", ["default", "release"]],
      ["juliaup", ["update", "1.10"]],
      ["juliaup", ["update"]],
      ["juliaup", ["gc"]],
    ]);
  });
});

describe("resolveVersion", () => {
  it("returns the channel's absolute binary path", async () => {
    const resolved = await resolveVersion("juliaup", "1.10", constant(CONFIG));
    expect(resolved).toEqual({
      command: "/home/u/.julia/juliaup/julia-1.10.5/bin/julia",
      args: [],
    });
  });

  it("throws with an add hint for a missing channel", async () => {
    await expect(resolveVersion("juliaup", "1.9", constant(CONFIG))).rejects.toThrow(/add 1\.9/);
  });
});

describe("assertVersionsInstalled", () => {
  const installed = [
    { id: "release", isDefault: true },
    { id: "1.10", isDefault: false },
  ];

  it("passes when all requested versions are installed", () => {
    expect(() => assertVersionsInstalled(["release", "1.10"], installed)).not.toThrow();
  });

  it("throws listing the missing versions with add hints", () => {
    expect(() => assertVersionsInstalled(["release", "1.9"], installed)).toThrow(/1\.9.*add 1\.9/s);
  });
});
