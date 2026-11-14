import { CtaRow, DarkBtn, H1, H2, HERO_BG, LEAD, OutlineBtn, SectionHead, Shell } from "@/components/ui";
import { CLOUD_NEWS, GET_STARTED, HAS_CLOUD, pageMeta, SETUP_GUIDE } from "@/content/site";
import { HAS_CHECKOUT } from "@/content/tiers";

export const metadata = pageMeta({
  title: "Tapry for schools, universities and research: record interviews and student work · Tapry",
  description: "Record interviews, oral exams and student presentations in full quality, on your own server or on Tapry Cloud with more free hours and a discount for education. Students need no account.",
  path: "/education/",
});

const USES: Array<[string, string, string]> = [
  ["01", "Research interviews", "Sound-only studios, a consent text each participant accepts before joining, a consent record with every recording, and transcripts in the layouts NVivo, MAXQDA and ATLAS.ti import, with names replaced if you need."],
  ["02", "Student assignments", "Start a studio from the Class template and share its solo link. Each student records alone in their browser, without an account, and their recording arrives in your studio. Recordings can delete themselves after a term."],
  ["03", "Seminars, panels and oral exams", "Everyone is recorded on their own device in full quality, so a weak connection in a dorm or abroad doesn’t spoil the recording. A producer can run the session without being recorded."],
  ["04", "Data that stays where it must", "Run Tapry on a university server, or record into your own storage bucket. Transcripts are made on the server by default. That is usually what an ethics board or a data protection officer asks first."],
];

export default function EducationPage() {
  const cloud = HAS_CLOUD
    ? [
        "A verified education account records 10 hours a month on the Free plan instead of 2.",
        HAS_CHECKOUT ? "Creator, Studio and Team are 30% off for education accounts." : "Paid plans aren’t open yet. When they are, Creator, Studio and Team will be 30% off for education accounts.",
        "An account whose owner has a confirmed address at a school or university (.edu, .ac.uk and the like) is recognised by itself. Other schools ask from Settings, Plan, and we look at each request by hand.",
      ]
    : [`Tapry Cloud, the hosted version, is planned. It is meant to give education accounts more free hours and a discount; to hear when it opens, ${CLOUD_NEWS}.`];
  return (
    <Shell label="Education">
      <section style={{ background: HERO_BG, padding: "80px 32px 64px" }}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: "24px 64px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", alignItems: "end" }}>
          <h1 className="rise" style={{ ...H1, textWrap: "balance" }}>
            For teaching and research
          </h1>
          <p className="rise" style={{ ...LEAD, animationDelay: ".08s" }}>
            Record interviews, presentations and oral exams in full quality, on a server your institution controls or on Tapry Cloud. Students and participants join from a link, with no account.
          </p>
        </div>
      </section>

      <section style={{ borderTop: "1px solid #ececef", padding: "96px 32px" }}>
        <div style={{ margin: "0 auto", display: "flex", maxWidth: 1180, flexDirection: "column", gap: 48 }}>
          <SectionHead title="What people use it for" kicker="In practice" num="1.0" />
          <div style={{ display: "grid", gap: "40px 32px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))" }}>
            {USES.map(([n, t, b]) => (
              <div key={n} className="reveal" style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid #0b0b0f", paddingTop: 18 }}>
                <span style={{ fontSize: 13, color: "#737378" }}>{n}</span>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 500, letterSpacing: "-.015em" }}>{t}</h3>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#6b6b70", textWrap: "pretty" }}>{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ borderTop: "1px solid #ececef", padding: "96px 32px" }}>
        <div style={{ margin: "0 auto", display: "grid", maxWidth: 1180, gap: "40px 64px", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))" }}>
          <h2 style={{ ...H2, lineHeight: 1.2, textWrap: "balance" }}>What it costs a school</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, fontSize: 17, lineHeight: 1.55, color: "#3a3a3c", textWrap: "pretty" }}>
            <p style={{ margin: 0 }}>
              <strong style={{ fontWeight: 500, color: "#0b0b0f" }}>On your own server: nothing.</strong> Tapry is open source. A department or an IT service can run it with Docker, with no limit on hours, people or studios, and nothing leaves the
              institution.
            </p>
            {cloud.map((line, i) => (
              <p key={i} style={{ margin: 0 }}>
                {i === 0 && <strong style={{ fontWeight: 500, color: "#0b0b0f" }}>On Tapry Cloud: </strong>}
                {line}
              </p>
            ))}
            <p style={{ margin: 0, fontSize: 15, color: "#6b6b70" }}>
              Two free tools help with the paperwork: the <a href="/consent-form/" style={{ color: "#0b0b0f", textDecoration: "underline", textUnderlineOffset: 3 }}>consent form generator</a> and the{" "}
              <a href="/data-map/" style={{ color: "#0b0b0f", textDecoration: "underline", textUnderlineOffset: 3 }}>recording data map</a> for ethics and data protection reviews.
            </p>
          </div>
        </div>
      </section>

      <CtaRow title="Try it with one class or one study before deciding anything.">
        <DarkBtn href={SETUP_GUIDE}>Run it on your server</DarkBtn>
        <OutlineBtn href={GET_STARTED}>{HAS_CLOUD ? "Start on Tapry Cloud" : "See the plans"}</OutlineBtn>
      </CtaRow>
    </Shell>
  );
}
