// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { adoptBundleCss, mirrorPrimeVueStyles } from "../src/widget/utils/shadowStyles";

const registry = () => {
  const g = globalThis as { __DOODLEPPL_CSS__?: string[] };
  g.__DOODLEPPL_CSS__ = g.__DOODLEPPL_CSS__ || [];
  return g.__DOODLEPPL_CSS__;
};

const makeRoot = () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host.attachShadow({ mode: "open" });
};

afterEach(() => {
  registry().length = 0;
  for (const style of document.head.querySelectorAll("style")) style.remove();
  document.body.innerHTML = "";
});

describe("adoptBundleCss", () => {
  it("replays font imports into the head exactly once per chunk", () => {
    registry().push('@import "https://fonts.example/icons.css";.a { color: red; }');
    const stop1 = adoptBundleCss(makeRoot());
    const stop2 = adoptBundleCss(makeRoot());
    const fontTags = document.head.querySelectorAll("style[data-doodleppl-fonts]");
    expect(fontTags).toHaveLength(1);
    expect(fontTags[0].textContent).toContain('@import "https://fonts.example/icons.css";');
    expect(fontTags[0].textContent).not.toContain(".a {");
    stop1();
    stop2();
  });

  it("copies recorded chunk CSS into the shadow root and follows late chunks", () => {
    registry().push(".a { color: red; }");
    const root = makeRoot();
    const stop = adoptBundleCss(root);
    expect([...root.querySelectorAll("style")].map((s) => s.textContent)).toEqual([
      ".a { color: red; }",
    ]);

    registry().push(".b { color: blue; }");
    document.dispatchEvent(new CustomEvent("doodleppl:css"));
    expect(root.querySelectorAll("style")).toHaveLength(2);

    stop();
    registry().push(".c { color: green; }");
    document.dispatchEvent(new CustomEvent("doodleppl:css"));
    expect(root.querySelectorAll("style")).toHaveLength(2);
  });
});

describe("mirrorPrimeVueStyles", () => {
  const addHeadStyle = (id: string, css: string) => {
    const style = document.createElement("style");
    style.setAttribute("data-primevue-style-id", id);
    style.textContent = css;
    document.head.appendChild(style);
    return style;
  };

  it("clones existing and later PrimeVue head styles, tracking rewrites", async () => {
    addHeadStyle("theme", ":root { --x: 1; }");
    const root = makeRoot();
    const stop = mirrorPrimeVueStyles(root);

    const cloneFor = (id: string) => root.querySelector(`style[data-primevue-style-id="${id}"]`);
    expect(cloneFor("theme")?.textContent).toBe(":root { --x: 1; }");

    const button = addHeadStyle("button", ".p-button { color: red; }");
    await new Promise((r) => setTimeout(r, 0));
    expect(cloneFor("button")?.textContent).toBe(".p-button { color: red; }");

    button.textContent = ".p-button { color: blue; }";
    await new Promise((r) => setTimeout(r, 0));
    expect(cloneFor("button")?.textContent).toBe(".p-button { color: blue; }");
    expect(root.querySelectorAll('style[data-primevue-style-id="button"]')).toHaveLength(1);

    stop();
  });

  it("ignores non-PrimeVue head styles", () => {
    const style = document.createElement("style");
    style.textContent = ".host { color: red; }";
    document.head.appendChild(style);
    const root = makeRoot();
    const stop = mirrorPrimeVueStyles(root);
    expect(root.querySelectorAll("style")).toHaveLength(0);
    stop();
  });

  it("re-emits the dark token remaps at :host scope so the overlay anchor turns dark", () => {
    addHeadStyle(
      "theme",
      ":root,:host{--p-content-background:#ffffff}.db-dark-mode{--p-content-background:#18181b}",
    );
    const root = makeRoot();
    const stop = mirrorPrimeVueStyles(root);
    const darkHost = root.querySelector("style[data-doodleppl-dark-host]");
    expect(darkHost).not.toBeNull();
    const css = (darkHost?.textContent ?? "").replace(/\s+/g, "");
    expect(css).toContain(":host(.db-dark-mode){");
    expect(css).toContain("--p-content-background:#18181b");
    stop();
  });
});
