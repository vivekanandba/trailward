import { describe, it, expect, vi } from "vitest";
import {
  browserEnvironment,
  registerServiceWorker,
  type Registration,
  type SwEnvironment,
} from "./serviceWorker";

/** A registration whose lifecycle a test can drive by hand. */
function fakeRegistration(): Registration & {
  fireUpdateFound(): void;
  fireStateChange(state: string): void;
  posted: string[];
  setWaiting(present: boolean): void;
} {
  const posted: string[] = [];
  let updateFound: (() => void) | undefined;
  let stateChange: (() => void) | undefined;
  const installing = {
    state: "installing",
    addEventListener: (_t: "statechange", fn: () => void) => {
      stateChange = fn;
    },
  };
  const reg = {
    installing,
    waiting: null as Registration["waiting"],
    addEventListener: (_t: "updatefound", fn: () => void) => {
      updateFound = fn;
    },
    fireUpdateFound: () => updateFound?.(),
    fireStateChange: (state: string) => {
      installing.state = state;
      stateChange?.();
    },
    posted,
    setWaiting: (present: boolean) => {
      reg.waiting = present ? { postMessage: (m: string) => posted.push(m) } : null;
    },
  };
  return reg;
}

function env(over: Partial<SwEnvironment> = {}): SwEnvironment & {
  updates: Array<() => void>;
  reloads: number;
  controllerChange?: () => void;
} {
  const updates: Array<() => void> = [];
  let reloads = 0;
  let controllerChange: (() => void) | undefined;
  return {
    isProduction: true,
    supported: true,
    whenIdle: (fn: () => void) => fn(),
    register: async () => fakeRegistration(),
    onUpdateReady: (apply) => updates.push(apply),
    onControllerChange: (fn) => {
      controllerChange = fn;
    },
    reload: () => {
      reloads++;
    },
    updates,
    get reloads() {
      return reloads;
    },
    get controllerChange() {
      return controllerChange;
    },
    ...over,
  } as SwEnvironment & {
    updates: Array<() => void>;
    reloads: number;
    controllerChange?: () => void;
  };
}

describe("registerServiceWorker (spec 43 §B)", () => {
  it("registers in production and returns the registration", async () => {
    const reg = fakeRegistration();
    const e = env({ register: async () => reg });
    await expect(registerServiceWorker(e, "/sw.js")).resolves.toBe(reg);
  });

  it("does NOTHING in development — a stale cache in dev wastes hours", async () => {
    const register = vi.fn();
    const e = env({ isProduction: false, register });
    await expect(registerServiceWorker(e, "/sw.js")).resolves.toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it("does nothing where the browser has no support", async () => {
    const register = vi.fn();
    const e = env({ supported: false, register });
    expect(await registerServiceWorker(e, "/sw.js")).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it("survives a registration failure — no worker is not a broken app", async () => {
    // Blocked by policy, private mode, an unsupported scheme. The app is a
    // normal web app without a worker and must not break.
    const e = env({
      register: async () => {
        throw new Error("SecurityError");
      },
    });
    await expect(registerServiceWorker(e, "/sw.js")).resolves.toBeNull();
  });

  it("offers the update when a worker is ALREADY waiting on arrival", async () => {
    // The update landed on a previous visit and was never applied.
    const reg = fakeRegistration();
    reg.setWaiting(true);
    const e = env({ register: async () => reg });
    await registerServiceWorker(e, "/sw.js");
    expect(e.updates).toHaveLength(1);
  });

  it("offers the update when one finishes installing while the page is open", async () => {
    const reg = fakeRegistration();
    const e = env({ register: async () => reg });
    await registerServiceWorker(e, "/sw.js");
    expect(e.updates).toHaveLength(0);

    reg.fireUpdateFound();
    reg.setWaiting(true);
    reg.fireStateChange("installed");
    expect(e.updates).toHaveLength(1);
  });

  it("does NOT offer an update on the very first install", async () => {
    // "installed" with nothing waiting is the first install — the user already
    // has what it just cached, and a "new version" prompt would be a lie.
    const reg = fakeRegistration();
    const e = env({ register: async () => reg });
    await registerServiceWorker(e, "/sw.js");

    reg.fireUpdateFound();
    reg.setWaiting(false);
    reg.fireStateChange("installed");
    expect(e.updates).toHaveLength(0);
  });

  it("applies the update by asking the WAITING worker to skip waiting", async () => {
    // This message is the entire handshake: the worker never skips waiting on
    // its own, because taking over would prune the running page's chunks.
    const reg = fakeRegistration();
    reg.setWaiting(true);
    const e = env({ register: async () => reg });
    await registerServiceWorker(e, "/sw.js");

    e.updates[0]();
    expect(reg.posted).toEqual(["SKIP_WAITING"]);
  });

  it("does NOT reload on the first install's claim", async () => {
    // The worker calls clients.claim() so the very first visit is cached, and
    // that fires controllerchange too. Reloading there refreshes the page in
    // the user's face on every first visit.
    const e = env();
    await registerServiceWorker(e, "/sw.js");
    e.controllerChange!();
    expect(e.reloads).toBe(0);
  });

  it("reloads after WE accept an update", async () => {
    const reg = fakeRegistration();
    reg.setWaiting(true);
    const e = env({ register: async () => reg });
    await registerServiceWorker(e, "/sw.js");

    e.updates[0](); // user presses Reload
    e.controllerChange!(); // the new worker takes over
    expect(e.reloads).toBe(1);
  });

  it("STILL reloads for an update that arrives after a first-install claim", async () => {
    // The sequence that was broken, and the reason this is keyed on intent
    // rather than on "was there a controller at startup": on a first visit the
    // claim fires controllerchange, which spent the old one-shot guard — so a
    // deploy later in the SAME session left the banner up forever and never
    // reloaded, on a page whose assets the new worker had just replaced.
    const reg = fakeRegistration();
    const e = env({ register: async () => reg });
    await registerServiceWorker(e, "/sw.js");

    e.controllerChange!(); // first install's claim — must not reload
    expect(e.reloads).toBe(0);

    reg.fireUpdateFound(); // a deploy lands while the page is open
    reg.setWaiting(true);
    reg.fireStateChange("installed");
    expect(e.updates).toHaveLength(1);

    e.updates[0](); // user presses Reload
    e.controllerChange!(); // the new worker takes over
    expect(e.reloads).toBe(1);
  });

  it("reloads directly when ANOTHER TAB already applied the update", async () => {
    // Two tabs, both showing the banner. The user accepts in tab A: its worker
    // skips waiting, activates and claims every client — so in tab B there is
    // no waiting worker left. Posting into the void there left a dead Reload
    // button and a banner that never went away, which is the round-1 symptom
    // re-created in the two-tab path. Nothing to wait for, so just reload.
    const reg = fakeRegistration();
    reg.setWaiting(true);
    const e = env({ register: async () => reg });
    await registerServiceWorker(e, "/sw.js");

    reg.setWaiting(false); // the other tab's worker took over
    e.updates[0](); // user presses Reload here
    expect(e.reloads).toBe(1);
    expect(reg.posted).toEqual([]);
  });

  it("reloads at most once, however often the browser fires controllerchange", async () => {
    const reg = fakeRegistration();
    reg.setWaiting(true);
    const e = env({ register: async () => reg });
    await registerServiceWorker(e, "/sw.js");
    e.updates[0]();
    e.controllerChange!();
    e.controllerChange!();
    e.controllerChange!();
    expect(e.reloads).toBe(1);
  });

  it("offers an update that was ALREADY installing when we registered", async () => {
    // A second tab opened mid-install gets a registration with `installing`
    // set and no further updatefound of its own.
    const reg = fakeRegistration();
    reg.setWaiting(true);
    reg.installing!.state = "installed";
    const e = env({ register: async () => reg });
    await registerServiceWorker(e, "/sw.js");
    expect(e.updates).toHaveLength(1);
  });

  it("ignores a statechange that is not 'installed'", async () => {
    const reg = fakeRegistration();
    const e = env({ register: async () => reg });
    await registerServiceWorker(e, "/sw.js");
    reg.fireUpdateFound();
    reg.setWaiting(true);
    reg.fireStateChange("installing");
    expect(e.updates).toHaveLength(0);
  });
});

describe("browserEnvironment (the thin adapter)", () => {
  interface FakeSw {
    controller: object | null;
    register: (url: string) => Promise<unknown>;
    addEventListener: (t: string, fn: () => void) => void;
  }

  function withNavigator(sw: FakeSw | undefined, fn: () => void): void {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      value: sw ? { serviceWorker: sw } : {},
      configurable: true,
    });
    try {
      fn();
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
    }
  }

  const fakeSw = (over: Partial<FakeSw> = {}): FakeSw & { listeners: Array<() => void> } => {
    const listeners: Array<() => void> = [];
    return {
      controller: null,
      register: async () => ({}),
      addEventListener: (_t, fn) => listeners.push(fn),
      listeners,
      ...over,
    };
  };

  it("reports support only when the browser actually has serviceWorker", () => {
    withNavigator(fakeSw(), () => {
      expect(browserEnvironment(() => {}).supported).toBe(true);
    });
    withNavigator(undefined, () => {
      expect(browserEnvironment(() => {}).supported).toBe(false);
    });
  });

  it("defers registration until the page has loaded", () => {
    // Registration re-fetches ~680 KB to precache the shell; doing that during
    // first paint is the contention the load-deferred idiom exists to avoid.
    const sw = fakeSw();
    withNavigator(sw, () => {
      const originalState = document.readyState;
      Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
      let ran = false;
      browserEnvironment(() => {}).whenIdle(() => (ran = true));
      expect(ran, "must NOT run while the document is still loading").toBe(false);
      window.dispatchEvent(new Event("load"));
      expect(ran).toBe(true);
      Object.defineProperty(document, "readyState", {
        value: originalState,
        configurable: true,
      });
    });
  });

  it("runs immediately when the page has already loaded", () => {
    const sw = fakeSw();
    withNavigator(sw, () => {
      let ran = false;
      browserEnvironment(() => {}).whenIdle(() => (ran = true));
      expect(ran).toBe(true); // jsdom reports "complete"
    });
  });

  it("delivers EVERY controllerchange — de-duplication belongs to the logic", () => {
    // A latch here swallowed the real update's controllerchange, because the
    // first install's claim had already spent it. The adapter stays dumb; the
    // "have we reloaded" decision is tested above.
    const sw = fakeSw();
    withNavigator(sw, () => {
      let called = 0;
      browserEnvironment(() => {}).onControllerChange(() => called++);
      sw.listeners.forEach((fn) => fn());
      sw.listeners.forEach((fn) => fn());
      expect(called).toBe(2);
    });
  });

  it("passes the registration URL straight through", async () => {
    const seen: string[] = [];
    const sw = fakeSw({
      register: async (url: string) => {
        seen.push(url);
        return {};
      },
    });
    let env!: ReturnType<typeof browserEnvironment>;
    withNavigator(sw, () => {
      env = browserEnvironment(() => {});
    });
    await withNavigatorAsync(sw, () => env.register("/trailward/sw.js"));
    expect(seen).toEqual(["/trailward/sw.js"]);
  });

  async function withNavigatorAsync<T>(sw: FakeSw, fn: () => Promise<T>): Promise<T> {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      value: { serviceWorker: sw },
      configurable: true,
    });
    try {
      return await fn();
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
    }
  }
});
