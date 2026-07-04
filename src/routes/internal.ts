import { Hono } from "hono";
import { db } from "../db";
import { listProviderReviews, normalizeTake } from "../lib/provider-reviews";
import { aggregateRatings } from "../lib/ratings";

export const internal = new Hono();

// Batch rating summaries for provider cards / listings / admin lists.
// GET /internal/ratings?providerIds=a,b,c
internal.get("/ratings", async (c) => {
  const ids = (c.req.query("providerIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const rows = ids.length
    ? await db.review.groupBy({
        by: ["providerId"],
        where: { providerId: { in: ids } },
        _avg: { rating: true },
        _count: { _all: true },
      })
    : [];
  return c.json({ ratings: aggregateRatings(rows) });
});

// Reviews for one provider (createdAt desc, cursor-paginated), photos
// createdAt asc, reviewer names batch-hydrated from identity-service
// (degrades to "Unknown"). `nextCursor` is additive — existing consumers
// keep reading `reviews`.
internal.get("/by-provider/:id", async (c) => {
  const { reviews, nextCursor } = await listProviderReviews(c.req.param("id"), {
    take: normalizeTake(c.req.query("take")),
    cursor: c.req.query("cursor") || undefined,
  });
  return c.json({ reviews, nextCursor });
});

// Total review count (home page stats via provider-service).
internal.get("/count", async (c) => {
  const count = await db.review.count();
  return c.json({ count });
});
