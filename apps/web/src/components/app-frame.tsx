"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./ui-extra";
import { cn } from "./ui";

const SidebarContext = createContext<{ toggle: () => void } | null>(null);

const DESKTOP = "(min-width: 768px)";
// Remembered per browser: the frame is rendered again on every page, so state alone would forget.
const STORAGE_KEY = "tapry:sidebar";
const SIDEBAR_ID = "app-sidebar";

function remember(collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(STORAGE_KEY, "collapsed");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage is off (private mode, blocked): the sidebar still works, it just isn't remembered.
  }
}

/**
 * The dashboard's frame (Studio Tembo design): a card on the terracotta backdrop, a 248px sidebar
 * that folds away, a 52px top bar and the scrolling content. From 768px the sidebar sits beside the
 * content and `collapsed` folds it; below that it's hidden and `overlay` opens it over the content.
 */
export function AppFrame({ sidebar, crumbs, actions, children }: { sidebar: ReactNode; crumbs: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [overlay, setOverlay] = useState(false);
  // No sliding until the remembered state is in place, or every page would open folding away.
  const [animate, setAnimate] = useState(false);
  const pathname = usePathname();
  const aside = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  // The server can't know what's remembered, so it renders the sidebar open; this runs before the
  // first paint on the client.
  useLayoutEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "collapsed") setCollapsed(true);
    } catch {
      // See remember().
    }
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // A sidebar opened over the content closes when a link in it is followed, and when the window
  // grows to where it sits beside the content.
  useEffect(() => setOverlay(false), [pathname]);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const close = () => mq.matches && setOverlay(false);
    mq.addEventListener("change", close);
    return () => mq.removeEventListener("change", close);
  }, []);

  // While it's over the content: focus goes into it, Escape closes it, and closing hands focus
  // back to the button that opened it.
  useEffect(() => {
    if (!overlay) return;
    const box = aside.current;
    box?.querySelector<HTMLElement>("a[href], button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOverlay(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const active = document.activeElement;
      if (!active || active === document.body || box?.contains(active) || active.getAttribute("data-sidebar-scrim") !== null) opener.current?.focus();
    };
  }, [overlay]);

  const toggle = () => {
    if (window.matchMedia(DESKTOP).matches) {
      setCollapsed((c) => {
        remember(!c);
        return !c;
      });
    } else setOverlay((o) => !o);
  };

  return (
    <div className="bg-ember h-dvh md:p-[22px]">
      <div
        className={cn(
          "relative grid h-full grid-cols-[0px_minmax(0,1fr)] overflow-hidden bg-canvas text-sm text-text ember-card md:rounded-[19px]",
          animate && "transition-[grid-template-columns] duration-[450ms] ease-[cubic-bezier(.2,.7,.2,1)]",
          !collapsed && "md:grid-cols-[248px_minmax(0,1fr)]",
        )}
      >
        {/* Hidden means invisible too, not just zero wide: otherwise its links stay in the tab order. */}
        <aside
          ref={aside}
          id={SIDEBAR_ID}
          className={cn(
            "col-start-1 row-start-1 min-w-0 overflow-hidden bg-canvas",
            animate && "md:transition-[visibility] md:duration-[450ms]",
            collapsed && "md:invisible",
            overlay
              ? "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:shadow-[0_30px_60px_-20px_rgba(0,0,0,.35)]"
              : "max-md:invisible",
          )}
        >
          <SidebarContext.Provider value={{ toggle }}>{sidebar}</SidebarContext.Provider>
        </aside>
        {overlay && (
          <button
            type="button"
            data-sidebar-scrim
            aria-label="Close sidebar"
            onClick={() => setOverlay(false)}
            className="absolute inset-0 z-20 cursor-default bg-black/35 md:hidden"
          />
        )}

        {/* Placed by hand: over the content the sidebar leaves the grid, and this would slide into its 0px column. */}
        <div className="relative col-start-2 row-start-1 flex min-w-0 flex-col overflow-hidden" inert={overlay}>
          <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-border px-5">
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              <button
                ref={opener}
                type="button"
                aria-label="Open sidebar"
                aria-expanded={false}
                aria-controls={SIDEBAR_ID}
                onClick={toggle}
                className={cn(
                  "grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text",
                  !collapsed && "md:hidden",
                )}
              >
                <Icon name="sidebarOpen" />
              </button>
              {crumbs}
            </span>
            {actions && <span className="flex shrink-0 items-center gap-2">{actions}</span>}
          </div>
          <main className="flex-1 overflow-auto px-4 py-7 sm:px-8 lg:px-11 lg:py-9">
            <div className="mx-auto flex max-w-[960px] animate-fade-up flex-col gap-7">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

/** The sidebar's own "Collapse sidebar" button. */
export function CollapseSidebar() {
  const ctx = useContext(SidebarContext);
  return (
    <button
      type="button"
      aria-label="Collapse sidebar"
      aria-expanded
      aria-controls={SIDEBAR_ID}
      onClick={ctx?.toggle}
      className="grid size-7 cursor-pointer place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      <Icon name="sidebarClose" size={15} />
    </button>
  );
}
