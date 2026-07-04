import { Hono } from "hono";
import { db } from "../db";
import { listProviderReviews, normalizeTake } from "../lib/provider-reviews";
import { aggregateRatings } from "../lib/ratings";
import { sweepOrphans } from "../lib/orphans";
import { removeStoredFile } from "../lib/storage";

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
        where: { providerId: { in: ids }, deletedAt: null },
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
    // Admin moderation views need to see (and restore) soft-deleted reviews.
    includeDeleted: c.req.query("includeDeleted") === "1",
  });
  return c.json({ reviews, nextCursor });
});

// Total review count (home page stats via provider-service).
internal.get("/count", async (c) => {
  const count = await db.review.count({ where: { deletedAt: null } });
  return c.json({ count });
});

// Periodic maintenance (#36): remove stored review-photo files no database
// row references any more. Grace window protects in-flight uploads; run it
// from ops tooling (cron/curl with the internal secret).
internal.post("/maintenance/sweep-orphans", async (c) => {
  const photos = await db.reviewPhoto.findMany({ select: { url: true } });
  const result = await sweepOrphans(new Set(photos.map((p) => p.url)));
  return c.json(result);
});

// POST /internal/users/:id/erase — account-deletion fan-out from
// identity-service. Deletes the user's reviews (photo rows cascade) and their
// stored photo files (best-effort — removeStoredFile swallows errors).
// Idempotent: erasing an unknown user is a no-op 200.
internal.post("/users/:id/erase", async (c) => {
  const userId = c.req.param("id");
  const photos = await db.reviewPhoto.findMany({
    where: { review: { userId } },
    select: { url: true },
  });
  await db.review.deleteMany({ where: { userId } });
  for (const p of photos) {
    await removeStoredFile(p.url);
  }
  return c.json({ ok: true });
});
