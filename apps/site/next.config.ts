import type { NextConfig } from "next";

// Plain static files in out/: host anywhere (Cloudflare Pages, GitHub Pages, any web server).
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // `next dev` builds into its own folder, so running `next build` alongside it can't break it.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
};

export default config;
