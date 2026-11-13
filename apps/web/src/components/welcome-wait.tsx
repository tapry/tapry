"use client";

// On /welcome while Paddle's webhook hasn't confirmed the payment yet: look again every few
// seconds for a minute, then say what to do.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Notice } from "./ui";
import { Spinner } from "./ui-extra";

export function WelcomeWait() {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries >= 15) return;
    const t = setTimeout(() => {
      setTries((n) => n + 1);
      router.refresh();
    }, 4000);
    return () => clearTimeout(t);
  }, [tries, router]);
  return tries < 15 ? (
    <Notice className="flex items-center gap-2" data-testid="welcome-waiting">
      <Spinner /> Waiting for the payment provider to confirm it. This usually takes a few seconds.
    </Notice>
  ) : (
    <Notice tone="warn" data-testid="welcome-slow">
      It&apos;s taking longer than usual. Your plan changes as soon as the payment is confirmed; Settings, Plan shows it. If it hasn&apos;t changed in an hour, write to hello@tapry.app.
    </Notice>
  );
}
