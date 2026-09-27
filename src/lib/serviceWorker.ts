/**
 * Service-worker registration and the update handshake (spec 43 §B).
 *
 * Lives here rather than in main.tsx so it is testable: main.tsx is a
 * bootstrap file, and burying the one piece of logic that decides whether a
 * user ever sees an update inside it is how this subsystem went un-gated for
 * as long as it did.
 *
 * The worker deliberately does NOT skipWaiting. A new one waits; we notice it
 * waiting, tell the app, and only swap when the user accepts — because the
 * activate handler prunes hashed assets, and taking over under a running page
 * would prune the chunks it still needs.
 */

/** The bits of ServiceWorkerRegistration we use — keeps tests honest. */
export interface Registration {
  installing: { state: string; addEventListener(t: "statechange", fn: () => void): void } | null;
  waiting: { postMessage(msg: string): void } | null;
  addEventListener(type: "updatefound", fn: () => void): void;
}

export interface SwEnvironment {
  isProduction: boolean;
  supported: boolean;
  /**
   * Defer until the page has finished loading. Registration re-fetches the
   * whole shell (~680 KB measured) to precache it, and doing that while the
   * browser is still painting and the app is fetching its cells is direct
   * contention for first paint — which is why the load-deferred idiom exists.
   */
  whenIdle(fn: () => void): void;
  register(url: string): Promise<Registration>;
  /** Called when a new version is ready and waiting. */
  onUpdateReady(apply: () => void): void;
  /** Reload after the new worker takes over. */
  onControllerChange(fn: () => void): void;
  reload(): void;
}

/**
 * Register, and wire the update prompt.
 *
 * Returns the registration, or null when we deliberately did nothing — in dev,
 * where a stale cache wastes hours, or where the browser has no support. A
 * registration failure is never fatal: the app is a normal web app without it,
 * and it must never block first paint.
 */
export async function registerServiceWorker(
  env: SwEnvironment,
  url: string,
): Promise<Registration | null> {
  if (!env.isProduction || !env.supported) return null;

  let reg: Registration;
  try {
    reg = await env.register(url);
  } catch {
    return null;
  }

  // Reload ONLY when we asked for the swap.
  //
  // The previous version keyed this on "was a controller present when we
  // registered", which was broken: on a first visit clients.claim() fires
  // controllerchange, that consumed the one-shot guard, and the real update
  // later in the same session could then never reload — the banner stayed up
  // forever while the page was controlled by a worker that had just replaced
  // its assets. Tracking our own intent is exact: we swap, we reload.
  let accepted = false;
  let reloaded = false;
  // Offer each waiting worker ONCE. Both entry points below can fire for the
  // same worker — a tab that arrives to find one already waiting *and*
  // already installed hits both — and offering twice means prompting twice.
  let offeredFor: Registration["waiting"] = null;
  const offer = (): void => {
    if (!reg.waiting || offeredFor === reg.waiting) return;
    offeredFor = reg.waiting;
    env.onUpdateReady(() => {
      accepted = true;
      // No waiting worker left? Another TAB already accepted this update: its
      // worker skipped waiting, activated, and claimed every client including
      // this one. Posting into the void leaves a dead Reload button and a
      // banner that never goes away — the round-1 symptom, re-created in the
      // two-tab path. There is nothing to wait for, so just reload.
      if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING");
      else env.reload();
    });
  };

  // Already waiting when we arrive: the update landed on a previous visit and
  // was never applied.
  if (reg.waiting) offer();

  // Already installing when we arrive — a second tab opened while the first
  // tab's worker was mid-install gets no `updatefound` of its own, so without
  // this that tab is never told.
  if (reg.installing) watch(reg.installing, reg, offer);

  reg.addEventListener("updatefound", () => {
    if (reg.installing) watch(reg.installing, reg, offer);
  });

  env.onControllerChange(() => {
    // A first install's claim() fires this too; reloading there refreshes the
    // page in the user's face for nothing. `reloaded` guards the browser
    // firing it more than once, which would be a second, visible reload.
    if (!accepted || reloaded) return;
    reloaded = true;
    env.reload();
  });

  return reg;
}

/** Offer the update once this worker finishes installing and starts waiting. */
function watch(
  incoming: NonNullable<Registration["installing"]>,
  reg: Registration,
  offer: () => void,
): void {
  const check = (): void => {
    // "installed" with something waiting is an UPDATE. Without a waiting
    // worker it is the very first install — the user already has what it just
    // cached, and a "new version" prompt would be a lie.
    if (incoming.state === "installed" && reg.waiting) offer();
  };
  incoming.addEventListener("statechange", check);
  check(); // it may already be past `installed` by the time we look
}

/** The real browser environment. Thin on purpose — the logic is above. */
export function browserEnvironment(onUpdateReady: (apply: () => void) => void): SwEnvironment {
  return {
    isProduction: import.meta.env.PROD,
    supported: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    register: (url) => navigator.serviceWorker.register(url) as unknown as Promise<Registration>,
    onUpdateReady,
    // Deliberately NOT de-duplicated here: the "have we already reloaded"
    // decision belongs with the logic above, which is tested. A latch in this
    // adapter silently swallowed the real update's controllerchange after the
    // first install's claim had already spent it.
    onControllerChange: (fn) => {
      navigator.serviceWorker.addEventListener("controllerchange", fn);
    },
    whenIdle: (fn) => {
      if (document.readyState === "complete") fn();
      else window.addEventListener("load", fn, { once: true });
    },
    reload: () => window.location.reload(),
  };
}
