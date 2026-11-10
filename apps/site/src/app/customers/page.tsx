import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CtaRow, DarkBtn, H1, HERO_BG, LEAD, Shell } from "@/components/ui";
import { hasCustomers } from "@/content/customers";
import { CustomerStories } from "./customers";

// While src/content/customers.ts is empty this page is the 404 page, and nothing links to it.
export const metadata: Metadata = {
  title: "Customers · Tapry",
  description: "How people who keep their own recordings use Tapry.",
  alternates: { canonical: "/customers/" },
  robots: hasCustomers ? undefined : { index: false },
};

export default function CustomersPage() {
  if (!hasCustomers) notFound();
  return (
    <Shell active="customers" label="Customers">
      <section style={{ background: HERO_BG, padding: "80px 32px 48px" }}>
        <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 20 }}>
          <h1 className="rise" style={{ ...H1, maxWidth: 760, textWrap: "balance" }}>
            Recorded by studios, labs and newsrooms
          </h1>
          <p className="rise" style={{ ...LEAD, maxWidth: 600, animationDelay: ".08s" }}>
            How people who keep their own recordings use Tapry.
          </p>
        </div>
      </section>
      <CustomerStories />
      <CtaRow title="Recording with Tapry? Say how it went.">
        <DarkBtn href="/resources/#help">Share your story</DarkBtn>
      </CtaRow>
    </Shell>
  );
}
