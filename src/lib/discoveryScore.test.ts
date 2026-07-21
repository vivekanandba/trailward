import { describe, it, expect } from "vitest";
import {
  band,
  scoreDiscovery,
  DEFAULT_WEIGHTS,
  type ObscuritySignals,
  type TerrainInput,
} from "./discoveryScore";

describe("band (trapezoid membership)", () => {
  it("is 0 outside [lo, hi] and 1 on the [a, b] plateau", () => {
    expect(band(5, 10, 20, 30, 40)).toBe(0);
    expect(band(45, 10, 20, 30, 40)).toBe(0);
    expect(band(25, 10, 20, 30, 40)).toBe(1);
    expect(band(20, 10, 20, 30, 40)).toBe(1);
    expect(band(30, 10, 20, 30, 40)).toBe(1);
  });

  it("ramps linearly up on [lo, a] and down on [b, hi]", () => {
    expect(band(15, 10, 20, 30, 40)).toBeCloseTo(0.5, 6); // halfway up
    expect(band(35, 10, 20, 30, 40)).toBeCloseTo(0.5, 6); // halfway down
  });

  it("treats a degenerate ramp (lo===a) as a hard step, never dividing by zero", () => {
    expect(band(20, 20, 20, 30, 40)).toBe(1);
    expect(band(19.999, 20, 20, 30, 40)).toBe(0);
  });
});

const flatObscurity: ObscuritySignals = {
  hasWikipediaTag: false,
  hasWikidataTag: false,
  nearbyAmenityCount: 0,
  wikiArticlesWithin1km: 0,
};

const sweetSpot: TerrainInput = {
  reliefM: 400,
  prominenceProxyM: 300,
  meanSlopeDeg: 22,
  confidence: 1,
};

describe("scoreDiscovery", () => {
  it("gives a high topo score to adventurous-but-feasible terrain", () => {
    const { topoScore } = scoreDiscovery(sweetSpot, flatObscurity);
    expect(topoScore).toBeCloseTo(1, 6); // all three bands on their plateau, confidence 1
  });

  it("scores flat terrain near zero on topo", () => {
    const flat: TerrainInput = { reliefM: 5, prominenceProxyM: 2, meanSlopeDeg: 1, confidence: 0 };
    expect(scoreDiscovery(flat, flatObscurity).topoScore).toBe(0);
  });

  it("penalises dangerously steep / extreme terrain via the upper band edge", () => {
    const extreme: TerrainInput = {
      reliefM: 2000, // above the relief band's hi
      prominenceProxyM: 1500,
      meanSlopeDeg: 60, // above the slope band's hi
      confidence: 1,
    };
    expect(scoreDiscovery(extreme, flatObscurity).topoScore).toBe(0);
  });

  it("discounts topo by terrain confidence", () => {
    const lowConf: TerrainInput = { ...sweetSpot, confidence: 0 };
    const { topoScore } = scoreDiscovery(lowConf, flatObscurity);
    expect(topoScore).toBeCloseTo(0.5, 6); // 1 * (0.5 + 0.5*0)
  });

  it("rewards obscurity: no wiki tags, no nearby article, no amenities → 1", () => {
    expect(scoreDiscovery(sweetSpot, flatObscurity).obscurityScore).toBeCloseTo(1, 6);
  });

  it("drops obscurity when the place is well documented", () => {
    const known: ObscuritySignals = {
      hasWikipediaTag: true,
      hasWikidataTag: true,
      nearbyAmenityCount: 20,
      wikiArticlesWithin1km: 3,
    };
    expect(scoreDiscovery(sweetSpot, known).obscurityScore).toBe(0);
  });

  it("treats an un-looked-up article count (-1) as neutral (0.5)", () => {
    const o: ObscuritySignals = { ...flatObscurity, wikiArticlesWithin1km: -1 };
    // noWikiTag 1*0.4 + lowAmenity 1*0.3 + noArticle 0.5*0.3 = 0.85
    expect(scoreDiscovery(sweetSpot, o).obscurityScore).toBeCloseTo(0.85, 6);
  });

  it("composes score = 0.6*topo + 0.4*obscurity by default weights", () => {
    const { score, topoScore, obscurityScore } = scoreDiscovery(sweetSpot, flatObscurity);
    expect(score).toBeCloseTo(
      DEFAULT_WEIGHTS.topo * topoScore + DEFAULT_WEIGHTS.obscurity * obscurityScore,
      6,
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
