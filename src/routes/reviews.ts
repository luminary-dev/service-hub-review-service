import { Hono } from "hono";
import { db } from "../db";
import { getAuth, s2s } from "../lib/http";
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
    // (verified=false here) must not strip a previously earned one.
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

// Port of the monolith's DELETE /api/admin/reviews/[id]. Matches the monolith
// exactly: plain deleteMany (photo rows cascade in the DB; no file cleanup).
reviews.delete("/api/admin/reviews/:id", async (c) => {
  const auth = getAuth(c);
  if (auth?.role !== "ADMIN") {
    return c.json({ error: "Forbidden" }, 403);
  }
  const id = c.req.param("id");
  await db.review.deleteMany({ where: { id } });
  return c.json({ ok: true });
});
