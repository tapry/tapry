// Overlapping initials: who is in a recording or a studio. No photos are kept, so everyone gets
// their initials on a calm colour (Avatar). Decorative: the names are written out nearby.
import { Avatar, cn } from "./ui";

const SIZES = {
  /** The sidebar's recent recordings. */
  xs: { box: "-ml-1.5 border-[1.5px] border-canvas", avatar: "size-4 text-[7px]" },
  /** Lists and cards. */
  sm: { box: "-ml-2 border-2 border-surface", avatar: "size-6 text-[9px]" },
} as const;

export function Faces({ names, size = "sm", max = 3, className }: { names: string[]; size?: keyof typeof SIZES; max?: number; className?: string }) {
  const s = SIZES[size];
  return (
    <span aria-hidden className={cn("flex shrink-0 items-center", size === "xs" ? "pl-1.5" : "pl-2", className)}>
      {names.slice(0, max).map((n, i) => (
        <span key={`${n}-${i}`} className={cn("rounded-full", s.box)}>
          <Avatar name={n} className={s.avatar} />
        </span>
      ))}
    </span>
  );
}
