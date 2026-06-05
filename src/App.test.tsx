import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

// Sample component test — confirms React Testing Library + jsdom work.
describe("App", () => {
  it("renders the Trailward heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Trailward" })).toBeInTheDocument();
  });
});
