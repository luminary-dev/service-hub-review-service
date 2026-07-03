import { describe, expect, it } from "vitest";
import { MAX_REVIEW_PHOTOS, reviewSchema } from "./validation";

describe("reviewSchema", () => {
  it("accepts ratings 1 through 5 with a valid comment", () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(reviewSchema.safeParse({ rating, comment: "Great work" }).success).toBe(true);
    }
  });

  it("rejects out-of-range ratings", () => {
    expect(reviewSchema.safeParse({ rating: 0, comment: "Great work" }).success).toBe(false);
    expect(reviewSchema.safeParse({ rating: 6, comment: "Great work" }).success).toBe(false);
  });

  it("rejects non-integer and non-numeric ratings", () => {
    expect(reviewSchema.safeParse({ rating: 3.5, comment: "Great work" }).success).toBe(false);
    // Number("abc") from the form → NaN
    expect(reviewSchema.safeParse({ rating: NaN, comment: "Great work" }).success).toBe(false);
  });

  it("enforces comment length bounds (3–1000)", () => {
    expect(reviewSchema.safeParse({ rating: 5, comment: "ab" }).success).toBe(false);
    expect(reviewSchema.safeParse({ rating: 5, comment: "abc" }).success).toBe(true);
    expect(reviewSchema.safeParse({ rating: 5, comment: "a".repeat(1000) }).success).toBe(true);
    expect(reviewSchema.safeParse({ rating: 5, comment: "a".repeat(1001) }).success).toBe(false);
  });

  it("caps reviews at 3 photos", () => {
    expect(MAX_REVIEW_PHOTOS).toBe(3);
  });
});
