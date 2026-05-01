import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  // Suppresses source map upload logs during build
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Only upload source maps in CI with auth token present
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Tree-shakes Sentry logger statements for smaller bundle
  disableLogger: true,
  sourcemaps: {
    // Hide source maps from client bundles in production
    deleteSourcemapsAfterUpload: true,
  },
});
