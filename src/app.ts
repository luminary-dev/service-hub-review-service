import { Hono } from "hono";
import { logger } from "hono/logger";
import { requireInternalSecret } from "./lib/http";
import { reviews } from "./routes/reviews";
import { account } from "./routes/account";
import { files } from "./routes/files";
import { internal } from "./routes/internal";

export const app = new Hono();

app.use(logger());
app.get("/healthz", (c) => c.json({ ok: true, service: "review-service" }));
app.use("*", requireInternalSecret);

app.route("/", reviews);
app.route("/", account);
app.route("/files", files);
app.route("/internal", internal);

// Fallbacks mirror the monolith's Next.js behavior.
app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});
