// Extra primitives for the dashboard, sign-in and setup screens (the "Tapry … Tembo" designs):
// the designs' inline icons, the framed card on the terracotta backdrop, and the eq/ring motion.
import type { CSSProperties, ReactNode } from "react";
import { cn } from "./ui";

/** Icon paths from the designs (Lucide shapes, 24×24, stroked). */
export const ICONS = {
  check: "M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20zM9 12l2 2l4-4",
  rec: "M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20zM12 11a1 1 0 1 0 0 2a1 1 0 0 0 0-2z",
  pause: "M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20zM10 15V9M14 15V9",
  loader: "M21 12a9 9 0 1 1-6.219-8.56",
  alert: "M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01",
  shield:
    "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2l4-4",
  wifi: "M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.859a10 10 0 0 1 14 0M8.5 16.429a5 5 0 0 1 7 0",
  clock: "M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20zM12 6v6l4 2",
  cloudCheck: "M17 15l-5.5 5.5L9 18M5 17.743A7 7 0 1 1 15.71 10h1.79a4.5 4.5 0 0 1 1.5 8.742",
  cloudUp: "M12 13v8M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M8 17l4-4l4 4",
  studios: "M16 6l4 14M12 6v14M8 8v12M4 4v16",
  guests: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  wave: "M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3",
  storage: "M3 5a9 3 0 1 0 18 0a9 3 0 1 0-18 0M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0",
  settings:
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z",
  home: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  camera: "M16 13l5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z",
  mic: "M12 19v3M19 10v2a7 7 0 0 1-14 0v-2M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z",
  screen: "M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 21h8M12 17v4",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  copy: "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zM4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
  download: "M12 15V3M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5l5-5",
  plus: "M5 12h14M12 5v14",
  close: "M18 6L6 18M6 6l12 12",
  back: "M15 18l-6-6l6-6",
  logout: "M16 17l5-5l-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",
  sidebarClose: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 3v18M16 15l-3-3l3-3",
  sidebarOpen: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 3v18M14 9l3 3l-3 3",
  pulse: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
  gauge: "M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0",
  file: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v4a2 2 0 0 0 2 2h4",
  text: "M17 6.1H3M21 12.1H3M15.1 18H3",
  trash: "M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2",
  mail: "M22 7l-8.99 5.73a2 2 0 0 1-2.02 0L2 7M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  eye: "M2.062 12.348a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 19.876 0a1 1 0 0 1 0 .696a10.75 10.75 0 0 1-19.876 0M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z",
  eyeOff:
    "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575a1 1 0 0 1 0 .696a10.747 10.747 0 0 1-1.444 2.49M14.084 14.158a3 3 0 0 1-4.242-4.242M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 4.446-5.143M2 2l20 20",
  arrowRight: "M5 12h14M12 5l7 7l-7 7",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  search: "M21 21l-4.34-4.34M11 3a8 8 0 1 0 0 16a8 8 0 0 0 0-16z",
  play: "M6 4l14 8l-14 8z",
  pauseBars: "M7 4v16M17 4v16",
  sliders: "M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4",
} as const;

export type IconName = keyof typeof ICONS;

/** One of the designs' stroked icons. */
export function Icon({
  name,
  size = 16,
  strokeWidth = 2,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
      style={style}
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

/** The spinning arc in busy buttons. */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Icon name="loader" size={size} className={cn("animate-spin-fast", className)} />;
}

/** The deep terracotta page with the framed card on it (sign-in, welcome, guest pages). */
export function EmberPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("bg-ember flex min-h-dvh items-center justify-center px-[16px] py-[30px] sm:px-[22px]", className)}>{children}</div>
  );
}

/** The card on the ember backdrop: 19px corners, canvas fill, white halo and a warm shadow. */
export function EmberCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("ember-card w-full rounded-[19px] bg-canvas text-text", className)}>{children}</div>;
}

/** Level bars ("eq"): the speaking lane in the sign-in picture. Decorative. */
export function EqBars({ count = 16, active, className }: { count?: number; active: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("flex h-4 min-w-0 flex-1 items-center justify-between gap-0.5 overflow-hidden", className)}>
      {Array.from({ length: count }, (_, k) => (
        <span
          key={k}
          className={cn("h-4 max-w-[3px] min-w-[2px] flex-[1_1_0] rounded-[2px]", active ? "bg-accent" : "bg-subtle")}
          style={{
            transform: "scaleY(.3)",
            animation: active
              ? `eq ${(0.5 + ((k * 37) % 10) / 20).toFixed(2)}s ease-in-out ${(-k * 0.07).toFixed(2)}s infinite`
              : `eqlow ${(1.5 + ((k * 29) % 10) / 10).toFixed(2)}s ease-in-out ${(-k * 0.11).toFixed(2)}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

/** A dashboard page's heading: 26px, medium (semibold for the Studios, Recording and Settings pages in the designs). */
export function PageTitle({
  children,
  className,
  strong = false,
  ...props
}: { children: ReactNode; className?: string; strong?: boolean } & React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h1
      className={cn("text-[27px] leading-tight text-balance break-words", strong ? "font-semibold tracking-[-.025em]" : "font-medium tracking-[-.02em]", className)}
      {...props}
    >
      {children}
    </h1>
  );
}

/** The white bordered list card from the designs: rows separated by hairlines, 18px inset. */
export function ListCard({ children, className, ...props }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col overflow-hidden rounded-xl border border-border bg-surface px-[18px] py-1", className)} {...props}>
      {children}
    </div>
  );
}
