// A calendar invite (.ics) for a recording session: the time, the guest's link and their
// tech-check link, in a file every calendar opens. Made in the browser; nothing is sent.

/** iCalendar text values: backslash, semicolon, comma and line breaks are escaped. */
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** 20261113T140000Z */
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
/** Lines are at most 75 bytes; longer ones continue on the next line after a space. */
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 75;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > (out.length ? 74 : 75)) cut--;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  out.push(rest);
  return out.join("\r\n ");
}

export function sessionInvite(e: { studio: string; host: string; startMs: number; minutes: number; joinUrl: string; checkUrl: string; uid: string; nowMs: number }): string {
  const description = [
    `${e.host} has invited you to a recording in ${e.studio}.`,
    ``,
    `Join here, in Chrome, Firefox or Safari on a computer: ${e.joinUrl}`,
    ``,
    `Before the day, check your camera, microphone and connection (two minutes): ${e.checkUrl}`,
    ``,
    `Wear headphones if you can, and plug in your laptop. You are recorded on your own computer, so a shaky connection won't spoil your recording.`,
  ].join("\n");
  return (
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Tapry//Recording session//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(e.nowMs)}`,
      `DTSTART:${stamp(e.startMs)}`,
      `DTEND:${stamp(e.startMs + e.minutes * 60_000)}`,
      `SUMMARY:${text(`Recording: ${e.studio}`)}`,
      `DESCRIPTION:${text(description)}`,
      `URL:${e.joinUrl}`,
      `LOCATION:${text(e.joinUrl)}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${text(`Recording in ${e.studio} in 15 minutes`)}`,
      "TRIGGER:-PT15M",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .map(fold)
      .join("\r\n") + "\r\n"
  );
}
