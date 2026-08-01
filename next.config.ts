import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/form/:slug*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

// Sentry build-time wiring. Source maps upload only when SENTRY_AUTH_TOKEN is
// present (CI), so local and PR builds are unaffected — they just produce
// minified traces, which is fine because those builds never report to Sentry.
//
// org/project come from env rather than being hardcoded so the same config
// keeps working if the Sentry project is renamed or moved.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload a wider set of client bundles so real-user stack traces resolve to
  // source instead of minified frames.
  widenClientFileUpload: true,

  // Tree-shake the SDK's internal logger out of the client bundle. Matters here
  // because the public embeddable form ships from the same build.
  disableLogger: true,

  // Not on Vercel — this repo builds a standalone image behind Traefik.
  automaticVercelMonitors: false,

  // Keep local builds quiet; stay verbose in CI where the log is the record.
  silent: !process.env.CI,
});
