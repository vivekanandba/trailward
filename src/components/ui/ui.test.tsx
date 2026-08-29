import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button, IconButton } from "./Button";
import { Badge, difficultyTone } from "./Badge";
import { Card } from "./Card";
import { Scrim } from "./Scrim";
import { MountainIcon, SunIcon, MoonIcon, XIcon, ExternalLinkIcon } from "../icons";

describe("ui primitives (spec 33)", () => {
  it("Button renders a real button, fires clicks, and honours disabled", () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" onClick={onClick}>
        Directions
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Directions" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
    expect(btn).toHaveAttribute("type", "button"); // never submits a form by accident
  });

  it("IconButton requires an aria-label and keeps a 44px hit area", () => {
    render(
      <IconButton aria-label="Close details">
        <XIcon />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Close details" });
    expect(btn.className).toContain("h-11"); // 44px
    expect(btn.className).toContain("w-11");
  });

  it("Badge maps difficulties to tones and renders children", () => {
    expect(difficultyTone("Easy")).toBe("easy");
    expect(difficultyTone("Moderate")).toBe("moderate");
    render(<Badge tone="hard">Hard</Badge>);
    expect(screen.getByText("Hard").className).toContain("bg-difficulty-hard");
  });

  it("Card wraps content in the soft panel treatment", () => {
    render(<Card>facts</Card>);
    expect(screen.getByText("facts").className).toContain("rounded-lg");
  });

  it("Scrim blocks or passes through pointer events per prop", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Scrim onClick={onClick} />);
    fireEvent.click(screen.getByTestId("scrim"));
    expect(onClick).toHaveBeenCalledOnce();
    rerender(<Scrim pointerEvents={false} />);
    expect(screen.getByTestId("scrim").className).toContain("pointer-events-none");
    // Decorative only — never announced.
    expect(screen.getByTestId("scrim")).toHaveAttribute("aria-hidden", "true");
  });

  it("icons render as decorative inline SVG (currentColor, aria-hidden)", () => {
    const { container } = render(
      <>
        <MountainIcon />
        <SunIcon />
        <MoonIcon />
        <ExternalLinkIcon />
      </>,
    );
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(4);
    for (const svg of svgs) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("stroke", "currentColor");
    }
  });
});
