import type { Metadata, Viewport } from "next";
// Inter for text, Geist Mono for timers and figures. Both come from npm packages (OFL-1.1) and
// are served by this server: nothing is fetched from a font service, at build time or in browsers.
import "@fontsource-variable/inter";
import "@fontsource-variable/geist-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Tapry", template: "%s · Tapry" },
  description: "The remote recording studio you own.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
