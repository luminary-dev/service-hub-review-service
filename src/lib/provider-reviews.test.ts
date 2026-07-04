import { describe, it, expect } from "vitest";
import {
  normalizeTake,
  DEFAULT_REVIEWS_TAKE,
  MAX_REVIEWS_TAKE,
} from "./provider-reviews";

describe("normalizeTake", () => {
  it("falls back to the default for junk or missing input", () => {
    expect(normalizeTake(undefined)).toBe(DEFAULT_REVIEWS_TAKE);
    expect(normalizeTake(null)).toBe(DEFAULT_REVIEWS_TAKE);
    expect(normalizeTake("abc")).toBe(DEFAULT_REVIEWS_TAKE);
    expect(normalizeTake("0")).toBe(DEFAULT_REVIEWS_TAKE);
    expect(normalizeTake("-3")).toBe(DEFAULT_REVIEWS_TAKE);
  });

  it("parses valid values and floors fractions", () => {
    expect(normalizeTake("10")).toBe(10);
    expect(normalizeTake("7.9")).toBe(7);
  });

  it("caps at the maximum", () => {
    expect(normalizeTake("1000")).toBe(MAX_REVIEWS_TAKE);
  });

  it("honors a custom fallback", () => {
    expect(normalizeTake(null, 10)).toBe(10);
  });
});
