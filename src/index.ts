import "./load-env";
import { serve } from "@hono/node-server";
import { app } from "./app";

const port = Number(process.env.PORT ?? 4003);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`review-service listening on :${info.port}`);
});
