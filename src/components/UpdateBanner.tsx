/**
 * "A new version is ready" (spec 43 §B).
 *
 * The worker deliberately waits rather than taking over, so someone has to
 * offer the swap. Without this the update simply never applies while a tab
 * stays open — which on an installed PWA can be days.
 *
 * Deliberately not a modal: nothing here is urgent, and interrupting someone
 * mid-route to announce a deploy would be worse than the staleness.
 */
import { Button } from "./ui/Button";

export interface UpdateBannerProps {
  /** Present only when a new worker is waiting. */
  onApply?: () => void;
  onDismiss(): void;
}

export default function UpdateBanner({ onApply, onDismiss }: UpdateBannerProps) {
  if (!onApply) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-3 z-[1400] mx-auto flex max-w-md items-center gap-3 rounded-xl border border-trail-200 bg-white px-4 py-3 shadow-lg dark:border-slate-600 dark:bg-slate-800"
    >
      <p className="flex-1 text-sm text-trail-800 dark:text-slate-100">
        A new version of Trailward is ready.
      </p>
      <Button variant="ghost" onClick={onDismiss}>
        Later
      </Button>
      <Button variant="primary" onClick={onApply}>
        Reload
      </Button>
    </div>
  );
}
