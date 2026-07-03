import { describe, expect, it } from "vitest";
import { aggregateRatings, type RatingGroupRow } from "./ratings";

function row(providerId: string, avg: number | null, count: number): RatingGroupRow {
  return { providerId, _avg: { rating: avg }, _count: { _all: count } };
}

describe("aggregateRatings", () => {
  it("returns an empty map for no rows", () => {
    expect(aggregateRatings([])).toEqual({});
  });

  it("keys summaries by providerId", () => {
    expect(aggregateRatings([row("prov_a", 4.5, 2), row("prov_b", 5, 1)])).toEqual({
      prov_a: { rating: 4.5, count: 2 },
      prov_b: { rating: 5, count: 1 },
    });
  });

  it("keeps the average unrounded", () => {
    const avg = (5 + 4 + 4) / 3; // 4.333...
    expect(aggregateRatings([row("prov_a", avg, 3)])).toEqual({
      prov_a: { rating: avg, count: 3 },
    });
    expect(aggregateRatings([row("prov_a", avg, 3)]).prov_a.rating).not.toBe(4.3);
  });

  it("falls back to 0 when the average is null", () => {
    expect(aggregateRatings([row("prov_a", null, 0)])).toEqual({
      prov_a: { rating: 0, count: 0 },
    });
  });
});
