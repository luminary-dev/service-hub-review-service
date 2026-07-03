import { z } from "zod";

export const MAX_REVIEW_PHOTOS = 3;

// Identical rules to the monolith's POST /api/providers/[id]/reviews schema.
export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().min(3).max(1000),
});
