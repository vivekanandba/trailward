import { useRef, type ReactNode } from "react";
import { useDialogFocus } from "../lib/useDialogFocus";

interface PanelProps {
  onClose(): void;
  labelledBy: string; // id of the heading that names the dialog
  /**
   * Modal (default): aria-modal + Tab trap — mobile overlays, where the app
   * also inerts the background. Non-modal: role="dialog" WITHOUT aria-modal
   * and no trap — the desktop side panel, which deliberately keeps the map
   * and list interactive so clicking another pin switches the detail
   * (spec 33: the old panel claimed aria-modal="true" while being non-modal,
   * telling screen readers the still-interactive page was gone).
   */
  modal?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A slide-over dialog (spec 08/33): focuses itself on open, closes on Escape,
 * restores focus to the opener on close; traps Tab only when modal.
 */
export default function Panel({
  onClose,
  labelledBy,
  modal = true,
  className,
  children,
}: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, { trap: modal, onClose });

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal={modal || undefined}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      className={className}
    >
      {children}
    </div>
  );
}
