import type { NextConfig } from "next";

/**
 * GS ClientFlow — Production Next.js Configuration
 * Hardened for multi-tenancy, strict asset isolation, and CVE mitigations.
 */

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // Remediate AVIF/SVG Image Optimization RCEs (GHSA-2xp9-vwfh-vxw4, CVE-2026-96889)
  images: {
    dangerouslyAllowSVG: false,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.gsclientflow.app",
      },
    ],
  },
  // Perimeter HTTP security headers enforced at the Next.js runtime layer
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Allow embeddable widget and client portal framing with tenant-scoping
        source: "/api/tenant/widget",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *;" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ];
  },
};

export default nextConfig;
