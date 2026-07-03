// Pure aggregation over Prisma `review.groupBy` rows — kept side-effect free
// so the math is unit-testable without a database.
export type RatingGroupRow = {
  providerId: string;
  _avg: { rating: number | null };
  _count: { _all: number };
};

export type RatingSummary = { rating: number; count: number };

// { [providerId]: { rating: <average, not rounded>, count } }
export function aggregateRatings(rows: RatingGroupRow[]): Record<string, RatingSummary> {
  const ratings: Record<string, RatingSummary> = {};
  for (const row of rows) {
    ratings[row.providerId] = {
      rating: row._avg.rating ?? 0,
      count: row._count._all,
    };
  }
  return ratings;
}
