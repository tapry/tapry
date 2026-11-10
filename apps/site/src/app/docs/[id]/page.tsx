import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DOCS } from "@/content/docs";
import { DocView, docMeta } from "../doc-view";

export const dynamicParams = false;

// The first page is /docs/ itself.
export function generateStaticParams() {
  return DOCS.slice(1).map((d) => ({ id: d.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const d = DOCS.find((x) => x.id === id);
  return d ? docMeta(d) : {};
}

export default async function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = DOCS.find((x) => x.id === id);
  if (!d) notFound();
  return <DocView doc={d} />;
}
