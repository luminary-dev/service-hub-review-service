import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_SIZE, validateImage } from "./storage";

function fakeFile(type: string, size = 1024): File {
  return new File([new Uint8Array(size)], `photo.${type.split("/")[1] ?? "bin"}`, { type });
}

describe("validateImage", () => {
  it("accepts jpeg, png and webp under the size limit", () => {
    expect(validateImage(fakeFile("image/jpeg"))).toBeNull();
    expect(validateImage(fakeFile("image/png"))).toBeNull();
    expect(validateImage(fakeFile("image/webp"))).toBeNull();
  });

  it("accepts a file exactly at the size limit", () => {
    expect(validateImage(fakeFile("image/jpeg", MAX_UPLOAD_SIZE))).toBeNull();
  });

  it("rejects disallowed types", () => {
    expect(validateImage(fakeFile("image/gif"))).toBe(
      "Only JPEG, PNG or WebP images are allowed"
    );
    expect(validateImage(fakeFile("application/pdf"))).toBe(
      "Only JPEG, PNG or WebP images are allowed"
    );
    expect(validateImage(fakeFile("text/plain"))).toBe(
      "Only JPEG, PNG or WebP images are allowed"
    );
  });

  it("rejects files over 5MB", () => {
    expect(validateImage(fakeFile("image/png", MAX_UPLOAD_SIZE + 1))).toBe(
      "Image must be under 5MB"
    );
  });
});
