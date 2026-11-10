// Blog posts. Every claim in a post must hold for the code as released: check it before adding.
export type ArticleBlock = ["h" | "p" | "q", string];

export type Post = {
  slug: string;
  tag: string;
  title: string;
  /** One line for the cards. */
  summary: string;
  lede: string;
  author: string;
  /** Month and year, as shown. */
  date: string;
  blocks: ArticleBlock[];
};

export const posts: Post[] = [
  {
    slug: "why-the-call-is-the-preview",
    tag: "Engineering",
    title: "Why the call is the preview and the files are the product",
    summary: "How local-first recording and uploading during the session keep a bad connection out of the result.",
    lede: "A video call and a recording want opposite things from your connection. Tapry stops pretending they're the same stream.",
    author: "Tapry",
    date: "November 2026",
    blocks: [
      ["h", "Two jobs, one wire"],
      [
        "p",
        "A call has to be fast, so it gives up quality the moment the network struggles: lower resolution, fewer frames, squeezed audio. A recording has to be complete, and doesn't mind arriving a minute late. Record the call, and the recording inherits every compromise the call made.",
      ],
      ["h", "Record where the person is"],
      [
        "p",
        "Tapry records each person in their own browser, at the studio's full quality, in four-second pieces. Every piece is written to the browser's storage on that computer before it is sent anywhere. The live call runs alongside, on 360p copies of the camera and microphone, so nothing the call does can touch what is being recorded.",
      ],
      ["q", "A dropped connection blurs the call but never the recording."],
      ["h", "Upload during the session"],
      [
        "p",
        "Pieces upload in the background while you talk, each one straight to storage through a short-lived signed link. The browser only deletes a piece once the server has confirmed it arrived. If the Wi-Fi drops, recording carries on and the pieces wait on the guest's computer; if the tab closes, they're still there when the guest opens the link again, and the upload picks up where it stopped. Uploading the same piece twice is harmless.",
      ],
      [
        "p",
        "Meanwhile the host sees, for each person, how much has arrived and whether their upload is falling behind, so nobody has to guess whether it is safe to say goodbye.",
      ],
      ["h", "What you get"],
      [
        "p",
        "Once you press Stop and everyone's upload is in, a worker on your server lines every track up to the moment you pressed Record, evens out the volume toward -16 LUFS without compression, and makes one WAV and one MP4 per person, a combined video and, when transcripts are on, a transcript with each speaker named. The call was only ever the preview; the files are the product.",
      ],
    ],
  },
];

export const postHref = (p: Post) => `/blog/${p.slug}/`;

/** Minutes to read at about 220 words a minute. */
export function readingMinutes(p: Post) {
  const words = [p.lede, ...p.blocks.map((b) => b[1])].join(" ").split(/\s+/).length;
  return Math.max(1, Math.round(words / 220));
}
