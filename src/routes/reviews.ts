import { Hono } from "hono";
import { db } from "../db";
import { getAuth, s2s } from "../lib/http";
import { listProviderReviews, normalizeTake } from "../lib/provider-reviews";
import { removeStoredFile, storeImage, validateImage } from "../lib/storage";
import { MAX_REVIEW_PHOTOS, reviewSchema } from "../lib/validation";

const PROVIDER_SERVICE_URL = process.env.PROVIDER_SERVICE_URL ?? "http://localhost:4002";

type ProviderSummary = { id: string; userId: string; suspended: boolean };

// Verified badge: the review is backed by a real interaction if the reviewer
// previously sent this provider an inquiry through the platform. Evidence,
// not a hard gate — plenty of real customers call the provider directly using
// the public phone number — and a peer outage must not block reviews, so
// failures degrade to unverified.
async function hasPriorInteraction(
  providerId: string,
  userId: string
): Promise<boolean> {
  try {
    const res = await s2s(
      PROVIDER_SERVICE_URL,
      `/internal/inquiries/exists?providerId=${encodeURIComponent(providerId)}&userId=${encodeURIComponent(userId)}`
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { exists?: boolean };
    return data.exists === true;
  } catch {
    return false;
  }
}

export const reviews = new Hono();

// Public paginated reviews for a profile page's lazy-loading (the gateway's
// /api/providers/:id/reviews route is method-agnostic, so GET lands here and
// POST below). Pages default to 10, capped at 100. If the provider-existence
// check itself fails we still serve — reviews are public read data and a peer
// outage must not blank them; suspended providers 404 like their profile.
reviews.get("/api/providers/:id/reviews", async (c) => {
  const id = c.req.param("id");
  try {
    const res = await s2s(PROVIDER_SERVICE_URL, `/internal/providers/${id}/summary`);
    if (res.ok) {
      const data = (await res.json()) as { provider: ProviderSummary | null };
      if (!data.provider || data.provider.suspended) {
        return c.json({ error: "Provider not found" }, 404);
      }
    }
  } catch {
    // degrade open
  }

  const { reviews: page, nextCursor } = await listProviderReviews(id, {
    take: normalizeTake(c.req.query("take"), 10),
    cursor: c.req.query("cursor") || undefined,
  });
  return c.json({ reviews: page, nextCursor });
});

// Port of the monolith's POST /api/providers/[id]/reviews (rate limiting now
// lives in the gateway). Upsert semantics: a user has one review per provider;
// posting again replaces rating/comment and appends photos up to the cap.
reviews.post("/api/providers/:id/reviews", async (c) => {
  const auth = getAuth(c);
  if (!auth) {
    return c.json({ error: "Sign in to leave a review" }, 401);
  }

  const id = c.req.param("id");
  let provider: ProviderSummary | null = null;
  try {
    const res = await s2s(PROVIDER_SERVICE_URL, `/internal/providers/${id}/summary`);
    if (res.status === 404) {
      provider = null;
    } else if (!res.ok) {
      return c.json({ error: "Upstream service unavailable" }, 502);
    } else {
      const data = (await res.json()) as { provider: ProviderSummary | null };
      provider = data.provider ?? null;
    }
  } catch {
    return c.json({ error: "Upstream service unavailable" }, 502);
  }
  if (!provider) {
    return c.json({ error: "Provider not found" }, 404);
  }
  if (provider.userId === auth.userId) {
    return c.json({ error: "You cannot review your own profile" }, 400);
  }

  const form = await c.req.formData().catch(() => null);
  if (!form) {
    return c.json({ error: "Invalid input" }, 400);
  }
  const parsed = reviewSchema.safeParse({
    rating: Number(form.get("rating")),
    comment: String(form.get("comment") ?? ""),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid input" }, 400);
  }

  const files = form
    .getAll("photos")
    .filter((f): f is File => f instanceof File && f.size > 0);

  const verified = await hasPriorInteraction(id, auth.userId);

  const review = await db.review.upsert({
    where: { providerId_userId: { providerId: id, userId: auth.userId } },
    create: { providerId: id, userId: auth.userId, verified, ...parsed.data },
    // On re-review only ever upgrade the badge: a provider-service outage
    // (verified=false here) must not strip a previously earned one. deletedAt
    // is deliberately untouched — editing a moderated review must not
    // resurrect it (the admin's removal stands until restored).
    update: { ...parsed.data, ...(verified ? { verified } : {}) },
    include: { photos: true },
  });

  if (files.length > 0) {
    const remaining = MAX_REVIEW_PHOTOS - review.photos.length;
    if (files.length > remaining) {
      return c.json(
        { error: `A review can have at most ${MAX_REVIEW_PHOTOS} photos.` },
        400
      );
    }
    for (const file of files) {
      const check = validateImage(file);
      if (check) {
        return c.json({ error: check }, 400);
      }
      const url = await storeImage(file, "reviews");
      await db.reviewPhoto.create({ data: { reviewId: review.id, url } });
    }
  }

  return c.json({ ok: true });
});

// Port of the monolith's DELETE /api/reviews/photos/[id].
reviews.delete("/api/reviews/photos/:id", async (c) => {
  const auth = getAuth(c);
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");
  const photo = await db.reviewPhoto.findUnique({
    where: { id },
    include: { review: { select: { userId: true } } },
  });
  if (!photo) {
    return c.json({ error: "Photo not found" }, 404);
  }

  // The review's author can remove their own photo; admins can moderate any.
  const isOwner = photo.review.userId === auth.userId;
  const isAdmin = auth.role === "ADMIN";
  if (!isOwner && !isAdmin) {
    return c.json({ error: "Forbidden" }, 403);
  }

  await db.reviewPhoto.delete({ where: { id } });
  await removeStoredFile(photo.url); // best-effort (errors swallowed inside)

  return c.json({ ok: true });
});

// Admin moderation removal is a SOFT delete (#32): the row, photos and files
// all survive so the action is reversible via the restore endpoint below.
// Account erasure remains a hard delete regardless.
reviews.delete("/api/admin/reviews/:id", async (c) => {
  const auth = getAuth(c);
  if (auth?.role !== "ADMIN") {
    return c.json({ error: "Forbidden" }, 403);
  }
  const id = c.req.param("id");
  await db.review.updateMany({
    where: { id },
    data: { deletedAt: new Date() },
  });
  return c.json({ ok: true });
});

reviews.patch("/api/admin/reviews/:id/restore", async (c) => {
  const auth = getAuth(c);
  if (auth?.role !== "ADMIN") {
    return c.json({ error: "Forbidden" }, 403);
  }
  const id = c.req.param("id");
  await db.review.updateMany({ where: { id }, data: { deletedAt: null } });
  return c.json({ ok: true });
});
