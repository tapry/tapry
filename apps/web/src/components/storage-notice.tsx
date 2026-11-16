// Shown on every dashboard page while the server's storage refuses writes (HealthService.storageTrouble):
// recordings can't arrive then, though nothing is lost. Admins get the way to the health page.
import Link from "next/link";
import { Notice } from "./ui";

export function StorageNotice({ since, admin }: { since: number; admin: boolean }) {
  const when = new Date(since).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  return (
    <Notice tone="danger" data-testid="storage-trouble">
      <strong className="font-medium">Recordings can&apos;t be uploaded right now.</strong> The server&apos;s storage has been refusing
      them since {when} UTC. Nothing is lost: each person&apos;s recording stays on their device and is sent once storage works again,
      as long as they open the session link again.
      {admin ? (
        <>
          {" "}
          <Link href="/admin/health" className="underline underline-offset-[3px]">
            See server health
          </Link>
          .
        </>
      ) : (
        " The server's admin has been told on the health page."
      )}
    </Notice>
  );
}
