import { resolve } from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // Monorepo: trace dependencies from the repo root so workspace packages land in the
  // standalone bundle (deploy/docker/web.Dockerfile). `next build` runs from apps/web.
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  // Lets the Playwright server build into its own folder instead of clobbering `next dev`'s .next/.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // pg and PGlite load native/wasm files at runtime; keep them out of the bundle.
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
};

export default config;
