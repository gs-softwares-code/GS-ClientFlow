/**
 * Turnstile server-side validation.
 *
 * Live mode: when TURNSTILE_SECRET is configured the token is verified against
 * Cloudflare's siteverify endpoint server-side (never client-side).
 * Sandbox mode: no secret exists in this environment, so a deterministic
 * demo token protocol is validated instead. The UI clearly labels this.
 */
export async function verifyTurnstile(token: string | null | undefined): Promise<{
  ok: boolean;
  mode: "live" | "sandbox";
  reason?: string;
}> {
  const secret = process.env.TURNSTILE_SECRET;

  if (!secret) {
    if (token && /^sandbox-[a-z0-9]{8}$/.test(token)) {
      return { ok: true, mode: "sandbox" };
    }
    return { ok: false, mode: "sandbox", reason: "Captcha token missing or malformed" };
  }

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token ?? "" }),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success ? { ok: true, mode: "live" } : { ok: false, mode: "live", reason: "Challenge failed" };
  } catch (err) {
    return { ok: false, mode: "live", reason: `Siteverify unreachable: ${String(err)}` };
  }
}

/** Generates the deterministic sandbox token the portal UI uses. */
export function sandboxTurnstileToken(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let suffix = "";
  for (let i = 0; i < 8; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `sandbox-${suffix}`;
}
