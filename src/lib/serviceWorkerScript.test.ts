import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The service worker's POLICY, tested directly (spec 43).
 *
 * public/sw.js is a classic worker script, so it was the one piece of this
 * project with no seam and no test. Review proved the cost: re-adding
 * `skipWaiting()` — reverting the single change spec 43 §B is about — and
 * deleting the SKIP_WAITING handler that receives the update were BOTH
 * invisible to the e2e gate. The page-side test asserts we *post* that
 * message; nothing asserted the worker acts on it (CON-COV-003 — a
 * producer/consumer agreement asserted from one side only).
 *
 * So: load the real file into a fake ServiceWorkerGlobalScope and drive its
 * handlers. No mocking of the worker itself — this is the shipped bytes.
 */

const BASE = "/trailward/";
const SW_SOURCE = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

/** A Cache that records what it holds, enough for the worker's use of it. */
class FakeCache {
  store = new Map<string, { body: string; type: string }>();
  async match(req: string | { url: string }) {
    const key = typeof req === "string" ? req : new URL(req.url).pathname;
    const hit = this.store.get(key);
    return hit ? fakeResponse(hit.body, 200, hit.type) : undefined;
  }
  async put(req: string | { url: string }, res: { _body: string; _type: string }) {
    const key = typeof req === "string" ? req : new URL(req.url).pathname;
    this.store.set(key, { body: res._body, type: res._type });
  }
  async addAll(urls: string[]) {
    for (const u of urls) this.store.set(u, { body: "", type: "text/html" });
  }
  async keys() {
    return [...this.store.keys()].map((k) => ({ url: `https://x${k}` }));
  }
  async delete(req: { url: string }) {
    return this.store.delete(new URL(req.url).pathname);
  }
}

function fakeResponse(body: string, status = 200, type = "text/html") {
  return {
    ok: status >= 200 && status < 300,
    status,
    _body: body,
    _type: type,
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? type : null) },
    clone() {
      return fakeResponse(body, status, type);
    },
    async text() {
      return body;
    },
  };
}

interface Harness {
  listeners: Record<string, ((e: unknown) => void)[]>;
  cache: FakeCache;
  caches: Map<string, FakeCache>;
  skipWaitingCalls: number;
  claimCalls: number;
  fetched: string[];
  /** Responses the network will give, by pathname. */
  network: Map<string, ReturnType<typeof fakeResponse>>;
}

/** Load the real sw.js into a fake global scope. */
function loadWorker(): Harness {
  const cache = new FakeCache();
  const caches = new Map<string, FakeCache>();
  const h: Harness = {
    listeners: {},
    cache,
    caches,
    skipWaitingCalls: 0,
    claimCalls: 0,
    fetched: [],
    network: new Map(),
  };

  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      (h.listeners[type] ??= []).push(fn);
    },
    skipWaiting: () => {
      h.skipWaitingCalls++;
    },
    clients: {
      claim: async () => {
        h.claimCalls++;
      },
    },
    location: { origin: "https://vivekanandba.github.io" },
  };

  const cachesApi = {
    open: async (name: string) => {
      if (!caches.has(name)) caches.set(name, name.includes("trailward") ? cache : new FakeCache());
      return caches.get(name)!;
    },
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
    match: async (req: string | { url: string }) => cache.match(req),
  };

  const fetchImpl = async (req: string | { url: string }) => {
    const url = typeof req === "string" ? req : req.url;
    const path = url.startsWith("http") ? new URL(url).pathname : url;
    h.fetched.push(path);
    const res = h.network.get(path);
    if (!res) throw new Error(`offline: ${path}`);
    return res;
  };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function("self", "caches", "fetch", "URL", "Response", SW_SOURCE);
  run(self, cachesApi, fetchImpl, URL, { error: () => fakeResponse("", 500) });
  return h;
}

/** Fire an event and await whatever the handler passed to waitUntil. */
async function fire(h: Harness, type: string, event: Record<string, unknown> = {}) {
  const waits: Promise<unknown>[] = [];
  let responded: Promise<unknown> | undefined;
  const e = {
    waitUntil: (p: Promise<unknown>) => waits.push(p),
    respondWith: (p: Promise<unknown>) => {
      responded = p;
    },
    ...event,
  };
  for (const fn of h.listeners[type] ?? []) fn(e);
  await Promise.all(waits);
  return responded ? await responded : undefined;
}

const request = (path: string, mode = "cors") => ({
  url: `https://vivekanandba.github.io${path}`,
  method: "GET",
  mode,
});

describe("sw.js install/activate (spec 43 §B)", () => {
  let h: Harness;
  beforeEach(() => {
    h = loadWorker();
  });

  it("does NOT skipWaiting on install — that is the whole point of §B", () => {
    // Reverting this was invisible to the e2e gate. A worker that takes over
    // under a running page prunes assets that page still needs.
    expect(h.skipWaitingCalls).toBe(0);
  });

  it("skips waiting ONLY when the page asks, via SKIP_WAITING", async () => {
    await fire(h, "message", { data: "SKIP_WAITING" });
    expect(h.skipWaitingCalls).toBe(1);
  });

  it("ignores any other message", async () => {
    await fire(h, "message", { data: "SOMETHING_ELSE" });
    await fire(h, "message", { data: undefined });
    expect(h.skipWaitingCalls).toBe(0);
  });

  it("claims clients on activate, so the FIRST visit is cached", async () => {
    await fire(h, "activate");
    expect(h.claimCalls).toBe(1);
  });

  it("precaches the cell index only when it really is JSON", async () => {
    h.network.set(
      BASE + "data/cells/index.json",
      fakeResponse('{"cells":{}}', 200, "application/json"),
    );
    await fire(h, "install");
    expect(h.cache.store.has(BASE + "data/cells/index.json")).toBe(true);
  });

  it("does NOT precache an HTML soft-404 served where the index should be", async () => {
    // A static host answers an unknown path with the SPA shell, 200 text/html.
    // Storing that under a .json URL gives an offline first visit a 200 that
    // JSON.parse rejects.
    h.network.set(
      BASE + "data/cells/index.json",
      fakeResponse("<!doctype html>", 200, "text/html"),
    );
    await fire(h, "install");
    expect(h.cache.store.has(BASE + "data/cells/index.json")).toBe(false);
  });
});

describe("sw.js pruning (spec 43 §B)", () => {
  let h: Harness;
  beforeEach(() => {
    h = loadWorker();
  });

  it("keeps assets the shell references and drops the ones it does not", async () => {
    h.cache.store.set(BASE, {
      body: `<script src="${BASE}assets/live.js"></script><link href="${BASE}assets/live.css">`,
      type: "text/html",
    });
    h.cache.store.set(BASE + "assets/live.js", { body: "", type: "text/javascript" });
    h.cache.store.set(BASE + "assets/live.css", { body: "", type: "text/css" });
    h.cache.store.set(BASE + "assets/old.js", { body: "", type: "text/javascript" });

    await fire(h, "activate");

    expect(h.cache.store.has(BASE + "assets/live.js")).toBe(true);
    expect(h.cache.store.has(BASE + "assets/old.js")).toBe(false);
  });

  it("keeps FONTS, which are referenced from the CSS and not the HTML", async () => {
    // Scraping only the HTML deleted both self-hosted fonts on every activate.
    h.cache.store.set(BASE, { body: `<link href="${BASE}assets/app.css">`, type: "text/html" });
    h.cache.store.set(BASE + "assets/app.css", {
      body: `@font-face{src:url(${BASE}assets/inter.woff2)}`,
      type: "text/css",
    });
    h.cache.store.set(BASE + "assets/inter.woff2", { body: "", type: "font/woff2" });

    await fire(h, "activate");
    expect(h.cache.store.has(BASE + "assets/inter.woff2")).toBe(true);
  });

  it("prunes NOTHING when it cannot see a shell that references anything", async () => {
    // An empty live set means the shell is missing or unreadable. Pruning on
    // that basis deletes the whole app, which offline is a blank screen.
    h.cache.store.set(BASE, { body: "<p>a trek page, no bundled assets</p>", type: "text/html" });
    h.cache.store.set(BASE + "assets/index.js", { body: "", type: "text/javascript" });

    await fire(h, "activate");
    expect(h.cache.store.has(BASE + "assets/index.js")).toBe(true);
  });
});

describe("sw.js fetch routing (spec 43 §A)", () => {
  let h: Harness;
  beforeEach(() => {
    h = loadWorker();
  });

  it("does not touch version.json — it says which build is LIVE", async () => {
    const res = await fire(h, "fetch", { request: request(BASE + "version.json") });
    expect(res).toBeUndefined(); // no respondWith: straight to the network
  });

  it("leaves cross-origin requests alone — map tiles are not ours to cache", async () => {
    const res = await fire(h, "fetch", {
      request: { url: "https://basemaps.cartocdn.com/x/1/2/3.png", method: "GET", mode: "cors" },
    });
    expect(res).toBeUndefined();
  });

  it("caches the APP ROOT as the offline shell", async () => {
    h.network.set(BASE, fakeResponse("<html>app</html>"));
    await fire(h, "fetch", { request: request(BASE, "navigate") });
    expect(h.cache.store.get(BASE)?.body).toBe("<html>app</html>");
  });

  it("does NOT let a trek page become the offline shell", async () => {
    // It used to cache EVERY navigation under BASE. A generated trek page
    // references no bundled assets, so it became the shell and the next
    // prune then deleted every asset the app has.
    h.cache.store.set(BASE, { body: "<html>app</html>", type: "text/html" });
    h.network.set(BASE + "t/skandagiri/", fakeResponse("<html>trek</html>"));

    await fire(h, "fetch", { request: request(BASE + "t/skandagiri/", "navigate") });
    expect(h.cache.store.get(BASE)?.body).toBe("<html>app</html>");
  });

  it("does not cache a failed navigation as the shell", async () => {
    h.cache.store.set(BASE, { body: "<html>app</html>", type: "text/html" });
    h.network.set(BASE, fakeResponse("<html>500</html>", 500));
    await fire(h, "fetch", { request: request(BASE, "navigate") });
    expect(h.cache.store.get(BASE)?.body).toBe("<html>app</html>");
  });

  it("falls back to the cached shell when a navigation cannot reach the network", async () => {
    h.cache.store.set(BASE, { body: "<html>app</html>", type: "text/html" });
    const res = (await fire(h, "fetch", { request: request(BASE, "navigate") })) as {
      text(): Promise<string>;
    };
    expect(await res.text()).toBe("<html>app</html>");
  });
});
