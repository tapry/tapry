import type { Metadata, Viewport } from "next";
// Inter for text, Geist Mono for timers and figures. Both come from npm packages (OFL-1.1) and
// are served by this server: nothing is fetched from a font service, at build time or in browsers.
import "@fontsource-variable/inter";
import "@fontsource-variable/geist-mono";
import "./globals.css";
import { AppearanceSync } from "@/components/appearance";
import { APPEARANCE_SCRIPT } from "@/lib/appearance";

export const metadata: Metadata = {
  title: { default: "Tapry", template: "%s · Tapry" },
  description: "The remote recording studio you own.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by the script before React starts: not a mismatch to complain about.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <AppearanceSync />
        {children}
      </body>
    </html>
  );
}
