# review-service

> [!WARNING]
> This repository is a **read-only mirror** of [`services/review-service`](https://github.com/luminary-dev/service-hub/tree/main/services/review-service) in the service-hub monorepo. Do not push or open PRs here — changes land via monorepo PRs and are synced out with `npm run sync:repos`. Direct pushes are blocked by branch protection.

Owns reviews and review photos for Service Hub (port `4003`, database
`review_db`). Part of the microservice split described in
`docs/ARCHITECTURE.md` — reached only through the api-gateway; every request
must carry `x-internal-secret`.

## Endpoints

Public (via gateway):

- `POST /api/providers/:id/reviews` — create/update the signed-in user's
  review (multipart: `rating`, `comment`, up to 3 `photos`). Provider
  existence checked S2S against provider-service.
- `DELETE /api/reviews/photos/:id` — review author or admin.
- `DELETE /api/admin/reviews/:id` — admin only.
- `GET /files/*` — locally stored uploads (gateway path `/api/files/review/*`).

Internal (S2S):

- `GET /internal/ratings?providerIds=a,b,c` →
  `{ ratings: { [providerId]: { rating, count } } }`
- `GET /internal/by-provider/:id` → reviews with reviewer names (hydrated from
  identity-service) and photos.
- `GET /internal/count` → `{ count }`

`GET /healthz` is unauthenticated (compose healthchecks).

## Development

```sh
cp .env.example .env
npm install
npm run db:push   # create tables in review_db
npm run db:seed   # demo reviews (ids line up with identity/provider seeds)
npm run dev
```

Checks: `npm run typecheck`, `npm test`, `npm run build`.

Uploads go to Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, otherwise to
`$UPLOAD_DIR` (default `./data/uploads`) and are served via `GET /files/*`.
