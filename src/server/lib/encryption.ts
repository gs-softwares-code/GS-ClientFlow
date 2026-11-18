import crypto from "crypto";

/**
 * Enterprise PII Protection & Field-Level Encryption
 * Uses AES-256-GCM for compliant storage of sensitive credentials,
 * webhook secrets, and identity fields at rest.
 */

const MASTER_KEY_RAW = process.env.ENCRYPTION_MASTER_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
// Standardize to 32 bytes (256 bits)
const MASTER_KEY = crypto.createHash("sha256").update(MASTER_KEY_RAW).digest();
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM

export type EncryptedPayload = {
  v: number; // schema version
  iv: string; // hex
  tag: string; // hex auth tag
  data: string; // hex ciphertext
};

/**
 * Encrypt plain text using AES-256-GCM
 */
export function encryptField(plainText: string): string {
  if (!plainText) return plainText;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);

  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    v: 1,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted,
  };

  return `enc:${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

/**
 * Decrypt cipher text; falls back gracefully if raw plain text
 */
export function decryptField(cipherText: string): string {
  if (!cipherText || !cipherText.startsWith("enc:")) return cipherText;

  try {
    const raw = Buffer.from(cipherText.slice(4), "base64url").toString("utf8");
    const payload = JSON.parse(raw) as EncryptedPayload;

    const iv = Buffer.from(payload.iv, "hex");
    const tag = Buffer.from(payload.tag, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(payload.data, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("[PII Decryption Failed]:", err);
    return "[DECRYPTION_ERROR]";
  }
}

/**
 * Mask sensitive customer identifiers (email, phone) for logging & views
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
