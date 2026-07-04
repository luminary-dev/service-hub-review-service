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
import sharp from "sharp";

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


// Decode-and-re-encode with sharp (#19/#132/#140): proves the payload really
// is an image in the claimed family (a polyglot or mislabeled file fails to
// decode), applies the EXIF orientation, and drops ALL metadata — EXIF GPS
// coordinates in tradespeople's phone photos would otherwise leak home
// locations. Returns null for anything that is not a decodable JPEG/PNG/WebP.
export class InvalidImageError extends Error {}

export async function processImage(
  input: Buffer
): Promise<{ data: Buffer; ext: string }> {
  try {
    const img = sharp(input, { failOn: "error", limitInputPixels: 50_000_000 });
    const meta = await img.metadata();
    // rotate() bakes in the EXIF orientation BEFORE metadata is stripped, so
    // phone photos don't come out sideways.
    if (meta.format === "jpeg") {
      return { data: await img.rotate().jpeg({ quality: 85 }).toBuffer(), ext: "jpg" };
    }
    if (meta.format === "png") {
      return { data: await img.rotate().png().toBuffer(), ext: "png" };
    }
    if (meta.format === "webp") {
      return { data: await img.rotate().webp().toBuffer(), ext: "webp" };
    }
  } catch {
    // fall through
  }
  throw new InvalidImageError("Only JPEG, PNG or WebP images are allowed");
}

function extFor(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

// Returns the URL to store in the database: an absolute Vercel Blob URL in
// production, or a gateway-served /api/files/... path locally.
export async function storeImage(file: File, prefix = "uploads"): Promise<string> {
  // Re-encoded content decides the extension — the claimed content-type has
  // already been checked but is untrusted. Throws InvalidImageError for
  // payloads that don't decode; callers translate that into a 400.
  const { data, ext } = await processImage(Buffer.from(await file.arrayBuffer()));
  const filename = `${crypto.randomUUID()}.${ext}`;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`${prefix}/${filename}`, data, { access: "public" });
    return blob.url;
  }
  const dir = path.join(UPLOAD_DIR, prefix);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), data);
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
