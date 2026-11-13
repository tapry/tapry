import { createHash, randomBytes } from "node:crypto";

/** Prefixed random ids, e.g. "trk_3fJ8…", so a stray id in a log says what it is. */
export function newId(prefix: "usr" | "std" | "ses" | "par" | "rec" | "trk" | "job" | "out" | "wrk" | "stg" | "inv" | "mrk") {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

/** 256-bit bearer token (participant or login session). Only its hash is stored. */
export function newToken() {
  return randomBytes(32).toString("base64url");
}

/** Guest invite code: 128 bits, URL-safe. */
export function newInviteCode() {
  return randomBytes(16).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** SHA-256 of a text (UTF-8), hex: how a consent text is identified. */
export function sha256Hex(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
