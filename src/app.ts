import { Hono } from "hono";
import { requireInternalSecret } from "./lib/http";
import { log } from "./lib/log";
import { getRequestId, requestLogger } from "./lib/logging";
import { reviews } from "./routes/reviews";
import { reports } from "./routes/reports";
import { account } from "./routes/account";
import { files } from "./routes/files";
import { internal } from "./routes/internal";

export const app = new Hono();

app.use(requestLogger(log));
app.get("/healthz", (c) => c.json({ ok: true, service: "review-service" }));
app.use("*", requireInternalSecret);

app.route("/", reviews);
app.route("/", reports);
app.route("/", account);
app.route("/files", files);
app.route("/internal", internal);

// Fallbacks mirror the monolith's Next.js behavior.
app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  log.error("unhandled error", { requestId: getRequestId(c), err });
  return c.json({ error: "Internal server error" }, 500);
});
