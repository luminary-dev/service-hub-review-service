import { Hono } from "hono";
import { readFile } from "fs/promises";
import path from "path";
import { resolveFilePath } from "../lib/storage";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

// Serves locally stored uploads from $UPLOAD_DIR (public through the gateway
// as /api/files/review/*).
export const files = new Hono();

files.get("/*", async (c) => {
  const rel = decodeURIComponent(c.req.path.replace(/^\/files\//, ""));
  const filePath = resolveFilePath(rel);
  if (!filePath) {
    return c.json({ error: "Not found" }, 404);
  }
  const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
  if (!type) {
    return c.json({ error: "Not found" }, 404);
  }
  try {
    const body = await readFile(filePath);
    return c.body(new Uint8Array(body), 200, { "content-type": type });
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});
