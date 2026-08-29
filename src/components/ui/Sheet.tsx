/**
 * Bottom sheet (spec 08/33) — the mobile surface for results, filters, and
 * trek detail. Zero-dep by design: transform-positioned, snap points as
 * viewport-height fractions, dragged ONLY from its 44 px handle (content
 * scrolls natively, so there is no scroll-vs-drag arbitration), velocity
 * flings one snap, releasing below the lowest snap closes (when closable).
 * Modal sheets mount a Scrim and trap focus; the results sheet is non-modal.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Scrim } from "./Scrim";
import { useDialogFocus } from "../../lib/useDialogFocus";
import { settleSnap, translateYFor } from "../../lib/sheetMath";

export interface SheetProps {
  /** Fractions of the viewport height the sheet reveals, ascending. */
  snapPoints?: number[];
  /** Controlled snap index into snapPoints. */
  snap: number;
  onSnapChange(index: number): void;
  /** Modal: scrim + focus trap + aria-modal; tap on scrim closes. */
  modal?: boolean;
  /** When present the sheet can be dismissed (swipe-down past min / scrim / Escape). */
  onClose?(): void;
  labelledBy: string;
  className?: string;
  children: ReactNode;
}

const DEFAULT_SNAPS = [0.25, 0.55, 0.92];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

export function Sheet({
  snapPoints = DEFAULT_SNAPS,
  snap,
  onSnapChange,
  modal = false,
  onClose,
  labelledBy,
  className = "",
  children,
}: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{
    startY: number;
    startTranslate: number;
    lastY: number;
    lastT: number;
    velocity: number;
  } | null>(null);

  const maxSnap = snapPoints[snapPoints.length - 1];
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useDialogFocus(ref, {
    trap: modal,
    onClose: () => closeRef.current?.(),
  });

  // Position for the current snap; transitions are suppressed while dragging
  // (style is written per-frame) and under prefers-reduced-motion.
  const applySnap = (idx: number, animate: boolean) => {
    const el = ref.current;
    if (!el) return;
    const vh = window.innerHeight;
    const ty = translateYFor(snapPoints[idx], maxSnap, vh);
    el.style.transition =
      animate && !prefersReducedMotion() ? "transform 200ms cubic-bezier(0.32,0.72,0,1)" : "none";
    el.style.transform = `translateY(${ty}px)`;
    // The sheet is sized to its TALLEST snap and translated down — without
    // this, the bottom `ty` pixels of content sit below the viewport and can
    // never be scrolled to at lower snaps (the GPX-button-unreachable bug).
    if (contentRef.current) contentRef.current.style.paddingBottom = `${ty}px`;
  };
  useEffect(() => {
    applySnap(snap, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, snapPoints.join(",")]);
  useEffect(() => {
    const onResize = () => applySnap(snap, false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const m = /translateY\(([-\d.]+)px\)/.exec(el.style.transform);
    dragging.current = {
      startY: e.clientY,
      startTranslate: m
        ? Number(m[1])
        : translateYFor(snapPoints[snap], maxSnap, window.innerHeight),
      lastY: e.clientY,
      lastT: performance.now(),
      velocity: 0,
    };
    el.style.transition = "none";
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragging.current;
    const el = ref.current;
    if (!d || !el) return;
    const now = performance.now();
    const dt = now - d.lastT;
    if (dt > 0) {
      // Positive velocity = pointer moving UP = revealing more sheet.
      d.velocity = (d.lastY - e.clientY) / dt;
      d.lastY = e.clientY;
      d.lastT = now;
    }
    const ty = Math.max(0, d.startTranslate + (e.clientY - d.startY));
    el.style.transform = `translateY(${ty}px)`;
    if (contentRef.current) contentRef.current.style.paddingBottom = `${ty}px`;
  };
  const onPointerUp = () => {
    const d = dragging.current;
    const el = ref.current;
    dragging.current = null;
    if (!d || !el) return;
    const vh = window.innerHeight;
    const m = /translateY\(([-\d.]+)px\)/.exec(el.style.transform);
    const revealedPx = maxSnap * vh - (m ? Number(m[1]) : 0);
    const target = settleSnap(snapPoints, snap, revealedPx, vh, d.velocity, !!onClose);
    if (target === "close") {
      closeRef.current?.();
      return;
    }
    applySnap(target, true);
    if (target !== snap) onSnapChange(target);
  };

  const onHandleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowUp" && snap < snapPoints.length - 1) {
      e.preventDefault();
      onSnapChange(snap + 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (snap > 0) onSnapChange(snap - 1);
      else closeRef.current?.();
    }
  };

  return (
    <>
      {modal && <Scrim onClick={() => closeRef.current?.()} className="fixed inset-0 z-[1190]" />}
      <div
        ref={ref}
        // A persistent, always-available surface is a REGION; only the modal
        // variants (filters, detail) are dialogs (spec 33 — honest semantics).
        role={modal ? "dialog" : "region"}
        aria-modal={modal || undefined}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        data-testid="sheet"
        className={
          "fixed inset-x-0 bottom-0 z-[1200] flex flex-col rounded-t-2xl bg-white shadow-2xl " +
          "pb-[env(safe-area-inset-bottom)] focus:outline-none dark:bg-slate-900 " +
          className
        }
        style={{ height: `${maxSnap * 100}dvh`, touchAction: "none" }}
      >
        {/* The ONLY drag surface — 44px tall, keyboard-resizable. */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Resize panel"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onHandleKeyDown}
          className="flex h-11 flex-none cursor-grab items-center justify-center active:cursor-grabbing"
        >
          <span className="h-1.5 w-10 rounded-full bg-trail-200 dark:bg-slate-600" aria-hidden />
        </div>
        <div
          ref={contentRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          style={{ touchAction: "pan-y" }}
        >
          {children}
        </div>
      </div>
    </>
  );
}
