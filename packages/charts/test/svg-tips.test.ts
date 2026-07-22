// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { attachSvgTips } from "../src/dom/svg-tips";

describe("attachSvgTips", () => {
  it("shows a tooltip for hovered data-tip marks and cleans up on detach", () => {
    const host = document.createElement("div");
    host.innerHTML = '<svg><circle cx="1" cy="1" r="2" data-tip="alpha 1.2 · chain 1"/></svg>';
    document.body.appendChild(host);
    const detach = attachSvgTips(host);

    const circle = host.querySelector("circle") as SVGCircleElement;
    const event = new PointerEvent("pointermove", { bubbles: true, clientX: 40, clientY: 40 });
    circle.dispatchEvent(event);

    const tip = [...document.body.children].find((el) =>
      el.textContent?.includes("alpha 1.2"),
    ) as HTMLDivElement;
    expect(tip).toBeDefined();
    expect(tip.style.display).toBe("block");

    host.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false }));
    expect(tip.style.display).toBe("none");

    detach();
    expect([...document.body.children].includes(tip)).toBe(false);
    host.remove();
  });
});
