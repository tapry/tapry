"use client";

import type { StudioSettings } from "@tapry/shared";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { StudioSettingsForm } from "@/components/studio-forms";
import { cn } from "@/components/ui";

type Tab = "recording" | "guests" | "members" | "plan" | "workspace" | "account";

/**
 * The Settings page's tabs. Recording and Guests are one studio's settings (the same form as on
 * the studio page, showing one part at a time, so one Save keeps both); Workspace and Account
 * come rendered from the server.
 */
export function SettingsTabs({
  initial,
  studios,
  studioId,
  hostName,
  members,
  plan,
  workspace,
  account,
}: {
  initial: Tab;
  studios: Array<{ id: string; name: string; settings: StudioSettings }>;
  studioId: string | null;
  hostName: string;
  /** The people in this account. */
  members: ReactNode;
  /** Tapry Cloud's plan and usage. Null on a self-hosted server: the tab isn't shown. */
  plan: ReactNode | null;
  /** Null for hosts who aren't the admin: the tab isn't shown. */
  workspace: ReactNode | null;
  account: ReactNode;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((initial === "workspace" && !workspace) || (initial === "plan" && !plan) ? "recording" : initial);
  const studio = studios.find((s) => s.id === studioId) ?? studios[0];
  const tabs: Array<[Tab, string]> = [
    ["recording", "Recording"],
    ["guests", "Guests"],
    ["members", "Members"],
    ...(plan ? ([["plan", "Plan"]] as Array<[Tab, string]>) : []),
    ...(workspace ? ([["workspace", "Workspace"]] as Array<[Tab, string]>) : []),
    ["account", "Account"],
  ];
  const go = (t: Tab) => {
    setTab(t);
    const next = new URLSearchParams(params);
    next.set("tab", t);
    router.replace(`${path}?${next}`, { scroll: false });
  };
  const studioTab = tab === "recording" || tab === "guests";

  return (
    <>
      <div className="-mb-2 flex gap-1 overflow-x-auto border-b border-border pb-3" role="tablist" aria-label="Settings">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`settings-tab-${key}`}
            aria-selected={tab === key}
            aria-controls="settings-panel"
            onClick={() => go(key)}
            className={cn(
              "cursor-pointer rounded-md px-[11px] py-[5px] text-sm whitespace-nowrap transition-colors duration-[250ms] focus-visible:-outline-offset-2",
              tab === key ? "bg-surface-2 font-medium text-text" : "text-muted hover:text-text",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} className="flex animate-fade-up flex-col gap-4" key={studioTab ? "studio" : tab}>
        {studioTab &&
          (studio ? (
            <>
              {studios.length > 1 && (
                <label className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                  <span className="font-medium">Studio</span>
                  <select
                    value={studio.id}
                    onChange={(e) => {
                      const next = new URLSearchParams(params);
                      next.set("studio", e.target.value);
                      next.set("tab", tab);
                      router.replace(`${path}?${next}`, { scroll: false });
                    }}
                    className="h-[34px] min-w-0 rounded-md border border-border bg-surface px-2.5 text-sm text-text shadow-xs focus:border-ring focus:shadow-[0_0_0_3px_var(--ring-soft)] focus:outline-none"
                  >
                    {studios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-[13px] text-muted">Each studio has its own settings.</span>
                </label>
              )}
              <StudioSettingsForm key={studio.id} studioId={studio.id} name={studio.name} settings={studio.settings} hostName={hostName} section={tab as "recording" | "guests"} />
            </>
          ) : (
            <p className="text-muted">
              Settings belong to a studio.{" "}
              <a href="/studios/new" className="font-medium text-text underline underline-offset-[3px] hover:text-accent-strong">
                Create your first studio
              </a>
              .
            </p>
          ))}
        {tab === "members" && members}
        {tab === "plan" && plan}
        {tab === "workspace" && workspace}
        {tab === "account" && account}
      </div>
    </>
  );
}
