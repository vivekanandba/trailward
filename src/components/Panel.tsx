import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface PanelProps {
  onClose(): void;
  labelledBy: string; // id of the heading that names the dialog
  className?: string;
  children: ReactNode;
}

/**
 * A slide-over that behaves as an accessible modal dialog (spec 08): it focuses
 * itself on open, traps Tab within, closes on Escape, and restores focus to the
 * control that opened it on close.
 */
export default function Panel({ onClose, labelledBy, className, children }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Read onClose via a ref so the effect can run exactly once (mount/unmount).
  // Keying it on onClose would re-run — and refocus the opener — on every
  // parent re-render, since App passes a fresh closure each time.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    el?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null,
      );
      if (items.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    el?.addEventListener("keydown", onKeyDown);
    return () => {
      el?.removeEventListener("keydown", onKeyDown);
      // Restore focus to the opener so keyboard users aren't dumped at the top.
      opener?.focus?.();
    };
    // Mount/unmount only — onClose is read via ref (see above).
  }, []);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      className={className}
    >
      {children}
    </div>
  );
}
