import { describe, expect, it } from "vitest";
import {
  endpointFromPairing,
  ledgerUrl,
  linkedRunUrl,
  parseConnect,
  runUrl,
  storesUrl,
  toPairing,
} from "../src/lib/cli-server";

const CURRENT = "http://127.0.0.1:7788/v1/deadbeef/stores/abc123";
const LEGACY = "http://127.0.0.1:41234/deadbeef";

describe("parseConnect", () => {
  it("reads the daemon origin, token, and store from a current link", () => {
    expect(parseConnect(CURRENT)).toEqual({
      origin: "http://127.0.0.1:7788",
      token: "deadbeef",
      storeId: "abc123",
      legacy: false,
    });
  });

  it("still understands the pre-pairing link an older CLI emits", () => {
    expect(parseConnect(LEGACY)).toEqual({
      origin: "http://127.0.0.1:41234",
      token: "deadbeef",
      legacy: true,
    });
  });

  it("rejects anything that is not a handoff", () => {
    expect(parseConnect("not a url")).toBeUndefined();
    expect(parseConnect("http://127.0.0.1:7788/")).toBeUndefined();
    expect(parseConnect("http://127.0.0.1:7788/v1/tok/stores")).toBeUndefined();
  });
});

describe("endpoint urls", () => {
  it("builds the store's ledger and run paths", () => {
    const endpoint = parseConnect(CURRENT);
    if (!endpoint) throw new Error("expected an endpoint");
    expect(ledgerUrl(endpoint)).toBe(`${CURRENT}/ledger`);
    expect(runUrl(endpoint, "r1")).toBe(`${CURRENT}/runs/r1`);
    expect(storesUrl(endpoint)).toBe("http://127.0.0.1:7788/v1/deadbeef/stores");
    expect(linkedRunUrl(endpoint, "r1")).toBe(`${CURRENT}/runs/r1`);
  });

  it("keeps the old paths for an old link, whose base is the linked run", () => {
    const endpoint = parseConnect(LEGACY);
    if (!endpoint) throw new Error("expected an endpoint");
    expect(ledgerUrl(endpoint)).toBe(`${LEGACY}/ledger`);
    expect(runUrl(endpoint, "r1")).toBe(`${LEGACY}/run/r1`);
    expect(linkedRunUrl(endpoint, "r1")).toBe(LEGACY);
  });
});

describe("pairing round trip", () => {
  it("rebuilds a working endpoint from what was saved", () => {
    const endpoint = parseConnect(CURRENT);
    if (!endpoint) throw new Error("expected an endpoint");
    const restored = endpointFromPairing(toPairing(endpoint));
    expect(restored).toEqual(endpoint);
    expect(ledgerUrl(restored)).toBe(`${CURRENT}/ledger`);
  });

  it("lets a caller point a saved pairing at another store", () => {
    const pairing = { origin: "http://127.0.0.1:7788", token: "tok", storeId: "one" };
    expect(runUrl(endpointFromPairing(pairing, "two"), "r")).toBe(
      "http://127.0.0.1:7788/v1/tok/stores/two/runs/r",
    );
  });
});
