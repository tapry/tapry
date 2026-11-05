import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Onest } from "next/font/google";
import "./site.css";

// Downloaded at build time and served with the site: visitors make no requests to Google.
const onest = Onest({ subsets: ["latin", "latin-ext"], variable: "--font-onest", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  // The site's public address (e.g. https://tapry.app), for absolute canonical links. Unset: relative.
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
  title: "Tapry: the remote recording studio you own",
  description:
    "Record every guest in full quality on their own computer, even on bad Wi-Fi. Free and open source: host it yourself, or join the cloud waitlist.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${onest.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
