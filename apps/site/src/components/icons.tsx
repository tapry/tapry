import type { CSSProperties } from "react";

/** Icon paths (Lucide-style, 24×24, stroked) used across the site. */
export const IC = {
  check: "M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20zM9 12l2 2l4-4",
  rec: "M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20zM12 11a1 1 0 1 0 0 2a1 1 0 0 0 0-2z",
  clock: "M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20zM12 6v6l4 2",
  loader: "M21 12a9 9 0 1 1-6.219-8.56",
  shield: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2l4-4",
  cloudUp: "M12 13v8M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M8 17l4-4l4 4",
  cloudCheck: "M17 15l-5.5 5.5L9 18M5 17.743A7 7 0 1 1 15.71 10h1.79a4.5 4.5 0 0 1 1.5 8.742",
  mic: "M12 19v3M19 10v2a7 7 0 0 1-14 0v-2M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z",
  headphones: "M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3",
  cam: "M16 13l5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z",
  disk: "M3 5a9 3 0 1 0 18 0a9 3 0 1 0-18 0M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0",
  wave: "M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3",
  home: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  library: "M16 6l4 14M12 6v14M8 8v12M4 4v16",
  globe: "M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20zM12 2a14.5 14.5 0 0 0 0 20a14.5 14.5 0 0 0 0-20M2 12h20",
  signal: "M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16",
  folder: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  gauge: "M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0",
  plus: "M5 12h14M12 5v14",
  copy: "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zM4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
  link: "M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1",
  logo: "M12 3v18M5 8l7 4l7-4M5 16l7-4l7 4",
};

export function Icon({
  d,
  size = 16,
  stroke = "currentColor",
  width = 2,
  style,
}: {
  d: string;
  size?: number;
  stroke?: string;
  width?: number;
  style?: CSSProperties;
}) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }}>
      <path d={d} />
    </svg>
  );
}

/** The Tapry mark. */
export function LogoMark({ size = 22, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round">
      <path d={IC.logo} />
    </svg>
  );
}
