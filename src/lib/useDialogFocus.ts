/**
 * Dialog focus behaviour (spec 33), shared by Panel and Sheet: autofocus on
 * mount, Escape closes, focus restores to the opener on unmount — always.
 *
 * `autoFocus: false` is for a surface that is PRESENT from page load rather
 * than opened by the user. The mobile results sheet is one: autofocusing it
 * put focus inside the sheet before anyone had acted, which pushed the skip
 * link out of reach entirely — tabbing forward from load walked the whole
 * header it exists to skip and never came back (spec 37/42).
 * Tab-TRAPPING only when `trap` (i.e. only for genuinely modal surfaces;
 * the desktop detail panel is deliberately non-modal so clicking another pin
 * switches it, and trapping there would lie to keyboard users).
 */
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useDialogFocus(
  ref: RefObject<HTMLElement>,
  { trap, onClose, autoFocus = true }: { trap: boolean; onClose(): void; autoFocus?: boolean },
): void {
  // Read the latest callbacks via refs so the effect runs exactly once
  // (mount/unmount). Keying on onClose would refocus the opener on every
  // parent re-render, since App passes a fresh closure each time.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const trapRef = useRef(trap);
  trapRef.current = trap;

  useEffect(() => {
    const el = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (autoFocus) el?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (!trapRef.current || e.key !== "Tab" || !el) return;
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
      // Restore focus to the opener so keyboard users aren't dumped at the
      // top — but only if we took it in the first place. Restoring focus we
      // never had would steal it from wherever the user actually is.
      if (autoFocus) opener?.focus?.();
    };
    // Mount/unmount only — callbacks are read via refs (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
