import { DOCS } from "@/content/docs";
import { DocView, docMeta } from "./doc-view";

export const metadata = docMeta(DOCS[0]!);

export default function DocsPage() {
  return <DocView doc={DOCS[0]!} />;
}
