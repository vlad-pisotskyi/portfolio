import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ScrollProgress } from "@/components/ui/ScrollProgress";

function setScrollMetrics({
  scrollTop,
  scrollHeight,
  clientHeight,
}: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}) {
  Object.defineProperty(document.documentElement, "scrollTop", {
    value: scrollTop,
    configurable: true,
  });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    value: clientHeight,
    configurable: true,
  });
}

describe("ScrollProgress", () => {
  afterEach(() => {
    setScrollMetrics({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
  });

  it("is hidden from assistive tech", () => {
    const { container } = render(<ScrollProgress />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("starts at 0% when the page has no scrollable height", () => {
    const { container } = render(<ScrollProgress />);
    expect(container.firstChild).toHaveStyle({ width: "0%" });
  });

  it("tracks scroll position as a percentage", () => {
    setScrollMetrics({ scrollTop: 500, scrollHeight: 1800, clientHeight: 800 });
    const { container } = render(<ScrollProgress />);
    fireEvent.scroll(window);
    expect(container.firstChild).toHaveStyle({ width: "50%" });
  });

  it("reaches 100% at the bottom of the page", () => {
    setScrollMetrics({
      scrollTop: 1000,
      scrollHeight: 1800,
      clientHeight: 800,
    });
    const { container } = render(<ScrollProgress />);
    fireEvent.scroll(window);
    expect(container.firstChild).toHaveStyle({ width: "100%" });
  });
});
