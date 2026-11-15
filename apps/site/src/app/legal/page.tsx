import { Shell } from "@/components/ui";
import { LEGAL, pageMeta } from "@/content/site";
import { Legal } from "./legal";

// Not indexed until the owner has signed the text off (NEXT_PUBLIC_LEGAL_PUBLISHED): until then it says "Draft for review".
export const metadata = pageMeta({
  title: "Privacy and terms · Tapry",
  description: "What this website and self-hosted Tapry do with your data, and the terms for using them." + (LEGAL.published ? "" : " Draft for review."),
  path: "/legal/",
  index: LEGAL.published,
});

export default function LegalPage() {
  return (
    <Shell label="Legal">
      <Legal />
    </Shell>
  );
}
