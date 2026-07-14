import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GitHubIcon } from "@/components/ui/GitHubIcon";

describe("GitHubIcon", () => {
  it("renders as decorative (hidden from assistive tech)", () => {
    const { container } = render(<GitHubIcon />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("defaults to 16px", () => {
    const { container } = render(<GitHubIcon />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "16");
    expect(svg).toHaveAttribute("height", "16");
  });

  it("sizes to the size prop", () => {
    const { container } = render(<GitHubIcon size={24} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "24");
    expect(svg).toHaveAttribute("height", "24");
  });

  it("passes className through", () => {
    const { container } = render(<GitHubIcon className="text-muted" />);
    expect(container.querySelector("svg")).toHaveClass("text-muted");
  });
});
