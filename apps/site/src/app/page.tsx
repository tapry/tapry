import type { Metadata } from "next";
import { Landing } from "./landing";

export const metadata: Metadata = { alternates: { canonical: "/" }, openGraph: { type: "website", siteName: "Tapry", url: "/", title: "Tapry: record any guest in studio quality", description: "Every guest is recorded on their own computer and uploaded while you talk, so a bad connection never reaches the recording. Free and open source, on your own server." } };

export default function Home() {
  return <Landing />;
}
