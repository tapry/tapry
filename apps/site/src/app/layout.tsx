import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./site.css";

// Downloaded at build time and served with the site: visitors make no requests to Google.
const geist = Geist({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-geist-mono", display: "swap" });

const title = "Tapry: record any guest in studio quality";
const description =
  "Every guest is recorded on their own computer and uploaded while you talk, so a bad connection never reaches the recording. Free and open source, on your own server.";

export const metadata: Metadata = {
  // The site's public address (e.g. https://tapry.app), for absolute canonical links. Unset: relative.
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
  title,
  description,
  openGraph: { type: "website", siteName: "Tapry", title, description },
  twitter: { card: "summary", title, description },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

// Without script the landing page's header can't tell when the page has scrolled: keep it solid.
const NO_SCRIPT = ".site-nav-overlay{background:#fff;color:#0b0b0f;border-bottom-color:#ececef}.site-nav-overlay .nav-cta{background:#0b0b0f}.site-nav-overlay .nav-brand svg{color:#e8553d}";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        <noscript>
          <style>{NO_SCRIPT}</style>
        </noscript>
        {children}
      </body>
    </html>
  );
}
