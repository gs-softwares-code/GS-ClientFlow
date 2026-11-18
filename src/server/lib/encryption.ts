import crypto from "crypto";

/**
 * Enterprise PII Protection & Field-Level Authenticated Encryption
 *
 * Implements AES-256-GCM authenticated encryption with 96-bit (12-byte) IVs,
 * 128-bit authentication tags, and key-version prefixes (`v1:...`) to enable
 * zero-downtime key rotation for compliant storage of credentials, webhook secrets,
 * and PII at rest.
 */

const KEY_ROTATION_RING: Record<string, Buffer> = {
  v1: crypto
    .createHash("sha256")
    .update(
      process.env.ENCRYPTION_MASTER_KEY ||
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    )
    .digest(),
};

const CURRENT_KEY_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM recommended by NIST SP 800-38D
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag

export type EncryptedPayload = {
  v: number;
  iv: string; // hex
  tag: string; // hex
  data: string; // hex
};

/**
 * Encrypt plain text using AES-256-GCM with key-version prefix (v1:...)
 */
export function encryptField(plainText: string, keyVersion = CURRENT_KEY_VERSION): string {
  if (!plainText) return plainText;

  const key = KEY_ROTATION_RING[keyVersion] ?? KEY_ROTATION_RING[CURRENT_KEY_VERSION];
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    v: 1,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted,
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${keyVersion}:${encoded}`;
}

/**
 * Decrypt cipher text enforcing authentication tag verification.
 * Supports both `v1:...` key-versioned envelopes and legacy `enc:...` payloads.
 */
export function decryptField(cipherText: string): string {
  if (!cipherText) return cipherText;

  let keyVersion = CURRENT_KEY_VERSION;
  let rawB64 = "";

  if (cipherText.startsWith("v1:")) {
    keyVersion = "v1";
    rawB64 = cipherText.slice(3);
  } else if (cipherText.startsWith("enc:")) {
    keyVersion = "v1";
    rawB64 = cipherText.slice(4);
  } else {
    // Unencrypted legacy plain text
    return cipherText;
  }

  const key = KEY_ROTATION_RING[keyVersion] ?? KEY_ROTATION_RING[CURRENT_KEY_VERSION];

  try {
    const raw = Buffer.from(rawB64, "base64url").toString("utf8");
    const payload = JSON.parse(raw) as EncryptedPayload;

    const iv = Buffer.from(payload.iv, "hex");
    const tag = Buffer.from(payload.tag, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(payload.data, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("[PII Authenticated Decryption Failed]: Tag mismatch or invalid ciphertext", err);
    throw new Error("Ciphertext integrity verification failed (tampered data or wrong key)");
  }
}

/**
 * Constant-time safe string and token comparison to mitigate timing attacks
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Pad to same length to prevent timing leakage on length mismatch
    const dummy = Buffer.alloc(bufA.length);
    crypto.timingSafeEqual(bufA, dummy);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Mask sensitive customer identifiers (email, phone) for logging & UI presentation
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "***";
  const [user, domain] = email.split("@");
  if (user.length <= 2) return `*@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone || phone.length < 4) return "****";
  return `***-***-${phone.slice(-4)}`;
}

/**
 * Export aliases for backward and test compatibility
 */
export const encryptText = encryptField;
export const decryptText = decryptField;
