// Customer account history (#46): the reviews the signed-in user has written,
// for the web app's /account page. Soft-deleted (moderated) reviews are
// hidden from their author too — the admin's removal stands until restored.
import { Hono } from "hono";
import { db } from "../db";
import { getAuth, s2s } from "../lib/http";

const PROVIDER_SERVICE_URL =
  process.env.PROVIDER_SERVICE_URL ?? "http://localhost:4002";

const MAX_ACCOUNT_REVIEWS = 50;

export const account = new Hono();

account.get("/api/account/reviews", async (c) => {
  const auth = getAuth(c);
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // (createdAt desc, id desc) keeps the order stable when timestamps collide
  // (seed data does).
  const rows = await db.review.findMany({
    where: { userId: auth.userId, deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_ACCOUNT_REVIEWS,
    include: { photos: { orderBy: { createdAt: "asc" } } },
  });

  // One batch call hydrates every provider name; a provider-service outage
  // degrades to "Unknown" (peer reads never fail the page).
  const providerIds = [...new Set(rows.map((r) => r.providerId))];
  const names = new Map<string, string>();
  if (providerIds.length > 0) {
    try {
      const res = await s2s(
        PROVIDER_SERVICE_URL,
        `/internal/providers?ids=${encodeURIComponent(providerIds.join(","))}`
      );
      if (res.ok) {
        const data = (await res.json()) as {
          providers: { id: string; contactName: string }[];
        };
        for (const p of data.providers ?? []) names.set(p.id, p.contactName);
      }
    } catch {
      // degrade gracefully — provider names fall back to "Unknown"
    }
  }

  return c.json({
    reviews: rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      verified: r.verified,
      createdAt: r.createdAt,
      provider: {
        id: r.providerId,
        name: names.get(r.providerId) ?? "Unknown",
      },
      photos: r.photos.map((p) => ({ id: p.id, url: p.url })),
    })),
  });
});
