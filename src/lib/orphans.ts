// Orphaned-upload sweep (#36): files whose DB row is gone (missed best-effort
// deletes, crashes between file write and row write) accumulate forever.
// Callers pass the set of URLs the database still references; anything in the
// store that is old enough and unreferenced gets removed. Canonical shared
// module — provider-service and review-service keep identical copies.
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { del, list } from "@vercel/blob";
import { SERVICE_FILE_PREFIX, UPLOAD_DIR } from "./storage";

export const DEFAULT_GRACE_MS = 24 * 60 * 60_000;

export type StoredFile = { key: string; url: string; modifiedAt: Date };

// Pure so the policy is unit-testable: an orphan is old enough to be outside
// the grace window (protects in-flight uploads racing their DB write) AND
// unreferenced by any database row.
export function findOrphans(
  files: StoredFile[],
  referenced: Set<string>,
  graceMs = DEFAULT_GRACE_MS,
  now = Date.now()
): StoredFile[] {
  return files.filter(
    (f) => now - f.modifiedAt.getTime() > graceMs && !referenced.has(f.url)
  );
}

async function listLocalFiles(): Promise<StoredFile[]> {
  const files: StoredFile[] = [];
  let prefixes: string[];
  try {
    prefixes = await readdir(UPLOAD_DIR);
  } catch {
    return files; // no uploads yet
  }
  for (const prefix of prefixes) {
    const dir = path.join(UPLOAD_DIR, prefix);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue; // not a directory
    }
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        const s = await stat(full);
        if (!s.isFile()) continue;
        files.push({
          key: full,
          url: `/api/files/${SERVICE_FILE_PREFIX}/${prefix}/${name}`,
          modifiedAt: s.mtime,
        });
      } catch {
        // raced a delete — skip
      }
    }
  }
  return files;
}

async function listBlobFiles(): Promise<StoredFile[]> {
  const files: StoredFile[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ cursor });
    for (const b of page.blobs) {
      files.push({ key: b.url, url: b.url, modifiedAt: new Date(b.uploadedAt) });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return files;
}

// Compares the store (Vercel Blob when configured, local disk otherwise)
// against the referenced set and removes orphans. Removal is best-effort per
// file; one failure doesn't abort the sweep.
export async function sweepOrphans(
  referenced: Set<string>,
  graceMs = DEFAULT_GRACE_MS
): Promise<{ scanned: number; removed: number }> {
  const useBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const files = useBlob ? await listBlobFiles() : await listLocalFiles();
  const orphans = findOrphans(files, referenced, graceMs);
  let removed = 0;
  for (const f of orphans) {
    try {
      if (useBlob) {
        await del(f.url);
      } else {
        await unlink(f.key);
      }
      removed++;
    } catch {
      // best-effort
    }
  }
  return { scanned: files.length, removed };
}
