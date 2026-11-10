import { Shell } from "@/components/ui";
import { pageMeta } from "@/content/site";
import { Legal } from "./legal";

// Not indexed until the owner has signed the text off (it says "Draft for review").
export const metadata = pageMeta({
  title: "Privacy and terms · Tapry",
  description: "What this website and self-hosted Tapry do with your data, and the terms for using them. Draft for review.",
  path: "/legal/",
  index: false,
});

export default function LegalPage() {
  return (
    <Shell label="Legal">
      <Legal />
    </Shell>
  );
}
