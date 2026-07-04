// Canonical src/lib/storage.ts for services that accept uploads
// (provider-service, review-service). Port of the monolith's src/lib/upload.ts
// with the local-disk fallback moved from Next's public/ dir to $UPLOAD_DIR,
// served back via GET /files/* through the gateway.
//
// SERVICE_FILE_PREFIX below must be "provider" or "review" to match the
// gateway routes /api/files/provider/* and /api/files/review/*.
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { put, del } from "@vercel/blob";

export const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB
export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./data/uploads";
export const SERVICE_FILE_PREFIX = "review";

export function validateImage(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return "Only JPEG, PNG or WebP images are allowed";
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    return "Image must be under 5MB";
  }
  return null;
}

function extFor(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

// Returns the URL to store in the database: an absolute Vercel Blob URL in
// production, or a gateway-served /api/files/... path locally.
export async function storeImage(file: File, prefix = "uploads"): Promise<string> {
  const filename = `${crypto.randomUUID()}.${extFor(file.type)}`;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`${prefix}/${filename}`, file, { access: "public" });
    return blob.url;
  }
  const dir = path.join(UPLOAD_DIR, prefix);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()));
  return `/api/files/${SERVICE_FILE_PREFIX}/${prefix}/${filename}`;
}

// Best-effort deletion, mirroring the monolith (errors swallowed).
export async function removeStoredFile(url: string): Promise<void> {
  try {
    if (url.startsWith(`/api/files/${SERVICE_FILE_PREFIX}/`)) {
      const rel = url.slice(`/api/files/${SERVICE_FILE_PREFIX}/`.length);
      await unlink(path.join(UPLOAD_DIR, path.normalize(rel)));
    } else if (url.startsWith("http") && process.env.BLOB_READ_WRITE_TOKEN) {
      await del(url);
    }
  } catch {
    // best-effort
  }
}

// GET /files/* handler body: resolve against UPLOAD_DIR, refuse path
// traversal, content-type by extension (jpg/png/webp), 404 otherwise.
export function resolveFilePath(wildcardPath: string): string | null {
  const resolved = path.resolve(UPLOAD_DIR, path.normalize(wildcardPath).replace(/^([/\\])+/, ""));
  if (!resolved.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) return null;
  return resolved;
}
