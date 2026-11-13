// Share-safe transcripts: names, contact details and listed words masked in a copy made on request.
import { describe, expect, it } from "vitest";
import { makeSafe, safeFile } from "../src/server/redaction";

const line = (speaker: string, text: string, startMs = 0) => ({ speaker, startMs, endMs: startMs + 2000, text });
const all = { pseudonyms: true, contacts: true, terms: [] as string[] };

describe("share-safe transcripts", () => {
  it("renames speakers in order of first speaking, also where their names are said", () => {
    const { lines, counts, speakers } = makeSafe(
      [line("Ines Marchetti", "Welcome. I'm Ines, and with me is Tom."), line("Tom", "Thanks Ines. Tomorrow I fly out.", 2000), line("Ines Marchetti", "Ines Marchetti here again.", 4000)],
      all,
    );
    expect(lines.map((l) => [l.speaker, l.text])).toEqual([
      ["Speaker 1", "Welcome. I'm Speaker 1, and with me is Speaker 2."],
      ["Speaker 2", "Thanks Speaker 1. Tomorrow I fly out."], // "Tomorrow" is not Tom
      ["Speaker 1", "Speaker 1 here again."],
    ]);
    expect(speakers).toEqual([["Ines Marchetti", "Speaker 1"], ["Tom", "Speaker 2"]]);
    expect(counts.names).toBe(4);
  });

  it("masks email addresses, links and phone numbers, and leaves years, times and amounts alone", () => {
    const { lines, counts } = makeSafe(
      [
        line("A", "Write to ines.m@example.co.uk or see https://example.org/page?x=1 and www.example.com."),
        line("A", "Call +212 6 12 34 56 78 or (020) 7946-0958. From 2019 - 2024, at 10.30 - 11.45, on 12.05.2024, it cost 1,200 a year."),
      ],
      { ...all, pseudonyms: false },
    );
    expect(lines[0]!.text).toBe("Write to [email] or see [link] and [link]");
    expect(lines[1]!.text).toBe("Call [phone] or [phone]. From 2019 - 2024, at 10.30 - 11.45, on 12.05.2024, it cost 1,200 a year.");
    expect(counts).toMatchObject({ emails: 1, links: 2, phones: 2, names: 0 });
    expect(lines[0]!.speaker).toBe("A"); // not asked to rename
  });

  it("masks the words you list as whole words in any capitalisation and script, longest first", () => {
    const { lines, counts } = makeSafe([line("A", "At ACME and Acme Corp, near Casablanca. Acmeology is a word. Près de Fès, chez Müller.")], { pseudonyms: false, contacts: false, terms: ["acme", "Acme Corp", "Fès", "müller", " ", "x"] });
    expect(lines[0]!.text).toBe("At [removed] and [removed], near Casablanca. Acmeology is a word. Près de [removed], chez [removed].");
    expect(counts.terms).toBe(4);
  });

  it("changes nothing when nothing is asked, and never the times", () => {
    const original = [line("Ines", "Reach me at ines@example.com", 1500)];
    const { lines } = makeSafe(original, { pseudonyms: false, contacts: false, terms: [] });
    expect(lines).toEqual(original);
  });

  it("comes in every transcript format", () => {
    const { lines } = makeSafe([line("Ines", "I'm Ines.", 61_000)], all);
    expect(safeFile(lines, "txt", "T").body).toBe("[00:01:01] Speaker 1: I'm Speaker 1.\n");
    expect(String(safeFile(lines, "vtt", "T").body)).toContain("<v Speaker 1>I'm Speaker 1.");
    expect(String(safeFile(lines, "srt", "T").body)).toContain("Speaker 1: I'm Speaker 1.");
    const docx = safeFile(lines, "docx", "T");
    expect([docx.fileName, (docx.body as Uint8Array).slice(0, 2)]).toEqual(["Transcript (share-safe).docx", new Uint8Array([0x50, 0x4b])]);
  });
});
