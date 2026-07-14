import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TldrBlock } from "@/components/ui/TldrBlock";

describe("TldrBlock", () => {
  it("renders its children", () => {
    render(<TldrBlock>Built a RAG chatbot in six weeks.</TldrBlock>);
    expect(
      screen.getByText("Built a RAG chatbot in six weeks."),
    ).toBeInTheDocument();
  });

  it("shows the TL;DR label", () => {
    render(<TldrBlock>Summary text</TldrBlock>);
    expect(screen.getByText("TL;DR")).toBeInTheDocument();
  });

  it("is addressable as #tldr with an accessible label", () => {
    render(<TldrBlock>Summary text</TldrBlock>);
    const block = screen.getByLabelText("TL;DR");
    expect(block).toHaveAttribute("id", "tldr");
  });
});
