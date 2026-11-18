import dns from "node:dns/promises";
import net from "node:net";

export class SsrfError extends Error {
  code: string;
  constructor(message: string, code = "SSRF_BLOCKED") {
    super(message);
    this.name = "SsrfError";
    this.code = code;
  }
}

/**
 * Checks if an IPv4 address falls within private, loopback, or metadata CIDR ranges
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // invalid IP format treated as unsafe
  }

  const [a, b, c] = parts;

  // 0.0.0.0/8 (current network)
  if (a === 0) return true;

  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;

  // 10.0.0.0/8 (private)
  if (a === 10) return true;

  // 172.16.0.0/12 (private: 172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 (private)
  if (a === 192 && b === 168) return true;

  // 169.254.0.0/16 (link-local / AWS & cloud metadata service 169.254.169.254)
  if (a === 169 && b === 254) return true;

  // 100.64.0.0/10 (carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (test networks)
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;

  // 224.0.0.0/4 (multicast) and 240.0.0.0/4 (reserved)
  if (a >= 224) return true;

  return false;
}

/**
 * Checks if an IPv6 address falls within loopback, link-local, or unique-local ranges
 */
function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // Loopback ::1 or unspecified ::
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:")) {
    return true;
  }

  // Unique local addresses fc00::/7 (fc00:... to fdff:...)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }

  // IPv4-mapped IPv6 ::ffff:127.0.0.1
  if (normalized.startsWith("::ffff:")) {
    const v4 = normalized.replace("::ffff:", "");
    if (net.isIPv4(v4)) {
      return isPrivateIPv4(v4);
    }
    return true;
  }

  return false;
}

/**
 * Validates an outbound URL to ensure it is not targeting internal infrastructure or metadata services
 */
export async function validateOutboundUrl(
  inputUrl: string,
  options: { allowHttpInDev?: boolean } = {}
): Promise<{ url: URL; resolvedIps: string[] }> {
  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new SsrfError(`Invalid URL format: ${inputUrl}`, "INVALID_URL");
  }

  const isDev = process.env.NODE_ENV !== "production";
  const allowHttp = options.allowHttpInDev && isDev;

  if (parsed.protocol !== "https:" && (!allowHttp || parsed.protocol !== "http:")) {
    throw new SsrfError(
      `Protocol '${parsed.protocol}' rejected. Outbound connections must use HTTPS.`,
      "INVALID_PROTOCOL"
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  // Direct IP checks
  if (net.isIP(hostname)) {
    if (net.isIPv4(hostname) && isPrivateIPv4(hostname)) {
      throw new SsrfError(`Direct request to private IPv4 address '${hostname}' is prohibited.`, "PRIVATE_IP_BLOCKED");
    }
    if (net.isIPv6(hostname) && isPrivateIPv6(hostname)) {
      throw new SsrfError(`Direct request to private IPv6 address '${hostname}' is prohibited.`, "PRIVATE_IP_BLOCKED");
    }
    return { url: parsed, resolvedIps: [hostname] };
  }

  // Check known internal hostnames
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal" ||
    hostname === "instance-data"
  ) {
    if (!allowHttp) {
      throw new SsrfError(`Request to internal hostname '${hostname}' is prohibited.`, "INTERNAL_HOST_BLOCKED");
    }
  }

  // DNS resolution to verify actual IP addresses
  try {
    const lookupResults = await dns.lookup(hostname, { all: true });
    const resolvedIps = lookupResults.map((r) => r.address);

    for (const record of lookupResults) {
      if (record.family === 4 && isPrivateIPv4(record.address)) {
        throw new SsrfError(
          `Domain '${hostname}' resolves to restricted private IP '${record.address}'.`,
          "DNS_REBINDING_BLOCKED"
        );
      }
      if (record.family === 6 && isPrivateIPv6(record.address)) {
        throw new SsrfError(
          `Domain '${hostname}' resolves to restricted IPv6 '${record.address}'.`,
          "DNS_REBINDING_BLOCKED"
        );
      }
    }

    return { url: parsed, resolvedIps };
  } catch (err) {
    if (err instanceof SsrfError) throw err;
    throw new SsrfError(`DNS resolution failed for hostname '${hostname}': ${(err as Error).message}`, "DNS_LOOKUP_FAILED");
  }
}

/**
 * Safe outbound fetch wrapper with SSRF validation and redirect protection
 */
export async function safeOutboundFetch(
  url: string,
  init: RequestInit = {},
  options: { allowHttpInDev?: boolean } = {}
): Promise<Response> {
  await validateOutboundUrl(url, options);

  // Enforce redirect: 'error' to prevent DNS rebinding or redirect-based SSRF bypass
  const safeInit: RequestInit = {
    ...init,
    redirect: "error",
  };

  return fetch(url, safeInit);
}
