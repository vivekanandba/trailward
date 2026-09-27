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
  /** Whether a worker already controls this page when we register. */
  hasController(): boolean;
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

  // A worker already waiting when we arrive: the update landed on a previous
  // visit and was never applied.
  if (reg.waiting) offerUpdate(env, reg);

  reg.addEventListener("updatefound", () => {
    const incoming = reg.installing;
    if (!incoming) return;
    incoming.addEventListener("statechange", () => {
      // "installed" with an existing controller means an UPDATE is ready.
      // Without a controller it is the very first install — nothing to offer,
      // the user already has what it just cached.
      if (incoming.state === "installed" && reg.waiting) offerUpdate(env, reg);
    });
  });

  // Once a NEW worker takes over, the page must reload to match the assets it
  // is now being served.
  //
  // "New" is load-bearing. On a first install the worker calls clients.claim(),
  // which fires controllerchange too — reloading there would make every first
  // visit refresh itself in the user's face for no reason. Only an update,
  // i.e. a change of controller where one already existed, warrants a reload.
  const controlledAtStart = env.hasController();
  env.onControllerChange(() => {
    if (controlledAtStart) env.reload();
  });

  return reg;
}

function offerUpdate(env: SwEnvironment, reg: Registration): void {
  env.onUpdateReady(() => reg.waiting?.postMessage("SKIP_WAITING"));
}

/** The real browser environment. Thin on purpose — the logic is above. */
export function browserEnvironment(onUpdateReady: (apply: () => void) => void): SwEnvironment {
  return {
    isProduction: import.meta.env.PROD,
    supported: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    hasController: () => Boolean(navigator.serviceWorker?.controller),
    register: (url) => navigator.serviceWorker.register(url) as unknown as Promise<Registration>,
    onUpdateReady,
    onControllerChange: (fn) => {
      let reloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        // Chrome can fire this more than once; reloading twice is a visible
        // flicker and loses whatever the user was doing.
        if (reloading) return;
        reloading = true;
        fn();
      });
    },
    reload: () => window.location.reload(),
  };
}
