import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { LogOutButton } from "@/components/studio-forms";
import { ListCard, PageTitle } from "@/components/ui-extra";
import { getServices } from "@/server/context";
import { requireUser } from "@/server/page-auth";
import { SettingsTabs } from "./tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

type Tab = "recording" | "guests" | "workspace" | "account";
const TABS: Tab[] = ["recording", "guests", "workspace", "account"];

/** Studio settings (Recording, Guests), how the server is set up (Workspace, admins), and the account. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; studio?: string }> }) {
  const user = await requireUser();
  const services = await getServices();
  const { tab, studio } = await searchParams;
  const studios = await services.studios.list(user);
  const w = user.isAdmin ? await services.library.workspace(user) : null;

  const workspace = w && (
    <ListCard>
      <span className="border-b border-border pt-3 pb-2 text-[13px] text-muted">How this server is set up. Read-only here: change it in docker-compose.yml (or .env) and restart.</span>
      <Row label="Email" help="Guests can ask for a link to their recording by email at the end of a session." value={w.emailOn ? "On" : "Off"} env="SMTP_HOST" />
      <Row label="Transcripts" help="Each person's audio is transcribed on this server with whisper.cpp." value={!w.transcriptsModel ? "Off" : w.transcriptsModel.found === false ? `${w.transcriptsModel.name} not found: transcripts fail` : `On · ${w.transcriptsModel.name}`} env="WHISPER_MODEL" />
      <Row label="Live call" help="Without it, recording still works; people just don't see or hear each other in Tapry." value={w.callOn ? "On" : "Off"} env="LIVEKIT_URL" />
      <Row label="Update check" help="Compares this version with the latest release on GitHub. Off by default, for privacy." value={w.updateRepo ? `On · ${w.updateRepo}` : "Off"} env="UPDATE_CHECK_REPO" />
      <Row
        label="Original uploads"
        help="What happens to the pieces guests uploaded once a recording's files are ready."
        value={w.rawRetentionDays === null ? "Kept" : `Removed after ${w.rawRetentionDays} day${w.rawRetentionDays === 1 ? "" : "s"}`}
        env="RAW_RETENTION_DAYS"
      />
      <Row
        label="Setup code"
        help="Asked for when the first account is created, so a stranger can't claim a new install."
        value={w.setupTokenSet ? "Set · no longer asked (the first account exists)" : "Not set"}
        env="SETUP_TOKEN"
      />
      <Row label="New accounts" help="Whether anyone besides the first account can sign up." value={w.allowSignup ? "Open" : "Closed"} env="ALLOW_SIGNUP" />
      <Row label="Version" value={w.version} last />
    </ListCard>
  );

  const account = (
    <ListCard>
      <Row label="Name" help="Shown to guests on the invite and in the studio." value={user.name} />
      <Row label="Email" help="What you log in with." value={user.email} />
      <Row label="Role" help={user.isAdmin ? "The first account on this server: sees Server health and how it's set up." : "Creates studios and invites guests."} value={user.isAdmin ? "Admin" : "Host"} />
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
        <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-[3px]">
          <span className="font-medium">Log out</span>
          <span className="text-[13px] leading-normal text-muted">On this browser.</span>
        </span>
        <LogOutButton />
      </div>
    </ListCard>
  );

  return (
    <DashboardShell user={user} studios={studios} current="settings" title="Settings">
      <PageTitle>Settings</PageTitle>
      <SettingsTabs
        initial={TABS.includes(tab as Tab) ? (tab as Tab) : "recording"}
        studios={studios.map((s) => ({ id: s.id, name: s.name, settings: s.settings }))}
        studioId={studio ?? null}
        hostName={user.name}
        workspace={workspace}
        account={account}
      />
    </DashboardShell>
  );
}

function Row({ label, help, value, env, last }: { label: string; help?: string; value: ReactNode; env?: string; last?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4 ${last ? "" : "border-b border-divider"}`}>
      <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-[3px]">
        <span className="font-medium">{label}</span>
        {help && <span className="text-[13px] leading-normal text-pretty text-muted">{help}</span>}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-2 text-text-2">
        <span className="min-w-0 break-words">{value}</span>
        {env && <code className="rounded-md border border-border px-2 py-0.5 font-mono text-[12px] text-muted">{env}</code>}
      </span>
    </div>
  );
}
