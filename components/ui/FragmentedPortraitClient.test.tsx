import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FragmentedPortraitClient } from "@/components/ui/FragmentedPortraitClient";

// The wrapper's whole job is forwarding props into a client-only dynamic()
// import of FragmentedPortrait — stub the heavy component and assert the
// contract.
vi.mock("@/components/ui/FragmentedPortrait", () => ({
  FragmentedPortrait: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

describe("FragmentedPortraitClient", () => {
  it("forwards src and alt to FragmentedPortrait once loaded", async () => {
    render(
      <FragmentedPortraitClient src="/portrait.webp" alt="Vlad Pisotskyi" />,
    );
    const img = await screen.findByRole("img", { name: "Vlad Pisotskyi" });
    expect(img).toHaveAttribute("src", "/portrait.webp");
  });
});
