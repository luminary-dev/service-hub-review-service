// Shared listing for a provider's reviews (used by the internal by-provider
// route and the public paginated endpoint): cursor pagination with batched
// reviewer-name hydration from identity-service (degrades to "Unknown").
import { db } from "../db";
import { s2s } from "./http";

const IDENTITY_SERVICE_URL =
  process.env.IDENTITY_SERVICE_URL ?? "http://localhost:4001";

export const DEFAULT_REVIEWS_TAKE = 50;
export const MAX_REVIEWS_TAKE = 100;

// Pure so the clamping rules are unit-testable: anything non-numeric or below
// 1 falls back to the default; the ceiling protects the query either way.
export function normalizeTake(
  raw: string | null | undefined,
  fallback = DEFAULT_REVIEWS_TAKE
): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_REVIEWS_TAKE);
}

export type ReviewDTO = {
  id: string;
  providerId: string;
  userId: string;
  rating: number;
  comment: string;
  verified: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  user: { name: string };
  photos: { id: string; url: string; createdAt: Date }[];
};

export async function listProviderReviews(
  providerId: string,
  opts: { take?: number; cursor?: string; includeDeleted?: boolean } = {}
): Promise<{ reviews: ReviewDTO[]; nextCursor: string | null }> {
  const take = opts.take ?? DEFAULT_REVIEWS_TAKE;

  // Fetch one extra row to learn whether another page exists. id is the
  // unique cursor; (createdAt desc, id desc) keeps the order stable when
  // several reviews share a timestamp (seed data does).
  const rows = await db.review.findMany({
    where: { providerId, ...(opts.includeDeleted ? {} : { deletedAt: null }) },
    include: { photos: { orderBy: { createdAt: "asc" } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const nextCursor = rows.length > take ? rows[take - 1].id : null;
  const page = rows.slice(0, take);

  const userIds = [...new Set(page.map((r) => r.userId))];
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

  return {
    reviews: page.map((r) => ({
      id: r.id,
      providerId: r.providerId,
      userId: r.userId,
      rating: r.rating,
      comment: r.comment,
      verified: r.verified,
      deletedAt: r.deletedAt,
      createdAt: r.createdAt,
      user: { name: names.get(r.userId) ?? "Unknown" },
      photos: r.photos.map((p) => ({ id: p.id, url: p.url, createdAt: p.createdAt })),
    })),
    nextCursor,
  };
}
