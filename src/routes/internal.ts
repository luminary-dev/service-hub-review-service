import { Hono } from "hono";
import { db } from "../db";
import { s2s } from "../lib/http";
import { aggregateRatings } from "../lib/ratings";

const IDENTITY_SERVICE_URL = process.env.IDENTITY_SERVICE_URL ?? "http://localhost:4001";

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

// Reviews for one provider (createdAt desc), photos createdAt asc, reviewer
// names batch-hydrated from identity-service (degrades to "Unknown").
internal.get("/by-provider/:id", async (c) => {
  const id = c.req.param("id");
  const rows = await db.review.findMany({
    where: { providerId: id },
    include: { photos: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    try {
      const res = await s2s(
        IDENTITY_SERVICE_URL,
        `/internal/users?ids=${encodeURIComponent(userIds.join(","))}`
      );
      if (res.ok) {
        const data = (await res.json()) as { users: { id: string; name: string }[] };
        for (const u of data.users ?? []) names.set(u.id, u.name);
      }
    } catch {
      // degrade gracefully — reviewer names fall back to "Unknown"
    }
  }

  return c.json({
    reviews: rows.map((r) => ({
      id: r.id,
      providerId: r.providerId,
      userId: r.userId,
      rating: r.rating,
      comment: r.comment,
      verified: r.verified,
      createdAt: r.createdAt,
      user: { name: names.get(r.userId) ?? "Unknown" },
      photos: r.photos.map((p) => ({ id: p.id, url: p.url, createdAt: p.createdAt })),
    })),
  });
});

// Total review count (home page stats via provider-service).
internal.get("/count", async (c) => {
  const count = await db.review.count();
  return c.json({ count });
});
