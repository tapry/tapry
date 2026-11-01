import type { NextConfig } from "next";

// Plain static files in out/: host anywhere (Cloudflare Pages, GitHub Pages, any web server).
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default config;
