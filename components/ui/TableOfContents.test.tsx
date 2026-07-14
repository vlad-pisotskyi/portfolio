import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TableOfContents } from "@/components/ui/TableOfContents";

const ITEMS = [
  { id: "context", heading: "Context" },
  { id: "architecture", heading: "Architecture" },
];

function mountHeading(id: string, top: number) {
  const el = document.createElement("h2");
  el.id = id;
  el.getBoundingClientRect = () =>
    ({ top }) as DOMRect;
  document.body.appendChild(el);
}

describe("TableOfContents", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a labeled navigation landmark", () => {
    render(<TableOfContents items={ITEMS} />);
    expect(
      screen.getByRole("navigation", { name: "On this page" }),
    ).toBeInTheDocument();
  });

  it("renders one anchor link per item", () => {
    render(<TableOfContents items={ITEMS} />);
    expect(screen.getByRole("link", { name: "Context" })).toHaveAttribute(
      "href",
      "#context",
    );
    expect(screen.getByRole("link", { name: "Architecture" })).toHaveAttribute(
      "href",
      "#architecture",
    );
  });

  it("highlights the first item before any scroll", () => {
    render(<TableOfContents items={ITEMS} />);
    expect(screen.getByRole("link", { name: "Context" })).toHaveClass(
      "border-accent",
    );
    expect(screen.getByRole("link", { name: "Architecture" })).not.toHaveClass(
      "border-accent",
    );
  });

  it("highlights the last heading scrolled past the nav offset", () => {
    mountHeading("context", -400);
    mountHeading("architecture", 40);
    render(<TableOfContents items={ITEMS} />);
    fireEvent.scroll(window);
    expect(screen.getByRole("link", { name: "Architecture" })).toHaveClass(
      "border-accent",
    );
    expect(screen.getByRole("link", { name: "Context" })).not.toHaveClass(
      "border-accent",
    );
  });
});
