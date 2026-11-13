// constitution-ok: this file tests the gate, so it must contain the local
// paths and fabricated rule ids the gate is built to reject.
import { describe, it, expect } from "vitest";
import {
  parseLock,
  findLocalPaths,
  findUnknownRuleIds,
  findCopiedText,
  exitCodeFor,
  isExempt,
  decodeGhContent,
  type RemoteStatus,
} from "./constitution";

const VALID = JSON.stringify({
  repo: "https://github.com/vivekanandba/fleet",
  ref: "main",
  commit: "76d7593abcdef0123456789abcdef0123456789a",
  sha256: "03ab3c86dc3032cadd24daa0b1e0da6e41cd956c9aaed3d1043e678d232bb821",
});

describe("parseLock (spec 39)", () => {
  it("accepts a well-formed lock", () => {
    const lock = parseLock(VALID);
    expect(lock.repo).toContain("github.com");
    expect(lock.ref).toBe("main");
  });

  it("rejects a malformed lock, naming the field", () => {
    const bad = (over: Record<string, unknown>) =>
      JSON.stringify({ ...JSON.parse(VALID), ...over });
    expect(() => parseLock("not json")).toThrow(/lock/i);
    expect(() => parseLock(bad({ repo: "git@github.com:x/y.git" }))).toThrow(/repo/);
    expect(() => parseLock(bad({ commit: "76d7593" }))).toThrow(/commit/);
    expect(() => parseLock(bad({ sha256: "abc" }))).toThrow(/sha256/);
    expect(() => parseLock(bad({ ref: "" }))).toThrow(/ref/);
  });
});

describe("findLocalPaths (spec 39 — the local clone must never be referenced)", () => {
  it("flags a path into the local constitution clone", () => {
    expect(findLocalPaths("see ~/data-dash/constitution/CONSTITUTION.md")).toHaveLength(1);
    expect(findLocalPaths("loaded from /home/ubuntu/data-dash/constitution")).toHaveLength(1);
  });

  it("accepts the remote URL and ordinary prose", () => {
    expect(findLocalPaths("https://github.com/vivekanandba/fleet")).toEqual([]);
    expect(findLocalPaths("the engineering constitution defines CON-VER-001")).toEqual([]);
  });
});

describe("findUnknownRuleIds (spec 39 — a citation to a rule that doesn't exist reads as authority)", () => {
  const known = new Set(["CON-VER-001", "CON-COV-002", "CON-DATA-001"]);

  it("flags an id the constitution does not define", () => {
    expect(findUnknownRuleIds("we follow CON-FAKE-999 here", known)).toEqual(["CON-FAKE-999"]);
  });

  it("accepts ids the constitution defines", () => {
    expect(findUnknownRuleIds("per CON-VER-001 and CON-COV-002", known)).toEqual([]);
  });

  it("reports each unknown id once, however many times it appears", () => {
    expect(findUnknownRuleIds("CON-FAKE-999 ... CON-FAKE-999", known)).toEqual(["CON-FAKE-999"]);
  });
});

describe("findCopiedText (spec 39 — cite, never restate)", () => {
  const source =
    "A coverage floor only ratchets up. Raise it as coverage grows and never lower it to " +
    "make a red build green, because the fix belongs in the test or the code.";

  it("flags a long verbatim run lifted from the constitution", () => {
    const hits = findCopiedText(
      "Our policy: raise it as coverage grows and never lower it to make a red build green, because the fix belongs in the test.",
      source,
      12,
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it("ignores a short quoted phrase", () => {
    expect(findCopiedText("we keep a coverage floor", source, 12)).toEqual([]);
  });
});

describe("exitCodeFor (spec 39 — never report success it has not earned)", () => {
  const status = (s: RemoteStatus) => s;

  it("passes on a match", () => {
    expect(exitCodeFor(status("match"), { ci: true, accessConfigured: true })).toBe(0);
  });

  it("FAILS on a mismatch, in CI and locally alike — the rules moved", () => {
    expect(exitCodeFor(status("mismatch"), { ci: true, accessConfigured: true })).toBe(1);
    expect(exitCodeFor(status("mismatch"), { ci: false, accessConfigured: true })).toBe(1);
  });

  it("fails in CI when access IS configured but the remote could not be read", () => {
    expect(exitCodeFor(status("unreachable"), { ci: true, accessConfigured: true })).toBe(1);
  });

  it("warns rather than blocking when no access is configured yet", () => {
    // The repo is private and CI has no credential; developers must not be
    // blocked by infrastructure that hasn't landed.
    expect(exitCodeFor(status("unreachable"), { ci: true, accessConfigured: false })).toBe(0);
    expect(exitCodeFor(status("unreachable"), { ci: false, accessConfigured: false })).toBe(0);
  });
});

describe("isExempt (spec 39 — a gate with no legitimate exit gets routed around)", () => {
  it("honours a marker that states a reason", () => {
    expect(isExempt("// constitution-ok: this file tests the gate itself")).toBe(true);
  });

  it("refuses a bare marker with no reason", () => {
    expect(isExempt("// constitution-ok:")).toBe(false);
    expect(isExempt("// constitution-ok")).toBe(false);
  });

  it("is false for ordinary files", () => {
    expect(isExempt("const x = 1;")).toBe(false);
  });
});

describe("decodeGhContent (spec 39 — base64 must be joined before decoding)", () => {
  it("survives a multi-byte character split across base64 lines", () => {
    // GitHub returns base64 wrapped at 60 chars. Decoding each line to a
    // STRING separately corrupts any UTF-8 sequence that straddles a chunk
    // boundary — which the constitution is full of (— · ").
    const text = "— rules · with “smart” quotes —".repeat(12);
    const wrapped = (
      Buffer.from(text, "utf8")
        .toString("base64")
        .match(/.{1,60}/g) ?? []
    ).join("\n");
    expect(decodeGhContent(wrapped)).toBe(text);
  });

  it("handles a trailing newline and empty lines", () => {
    const b64 = Buffer.from("hello", "utf8").toString("base64");
    expect(decodeGhContent(`${b64}\n`)).toBe("hello");
  });
});

describe("nextLock — commit and sha256 move together (spec 39)", () => {
  const lock = {
    repo: "https://github.com/vivekanandba/fleet",
    ref: "main",
    commit: "0".repeat(40),
    sha256: "a".repeat(64),
  };

  it("records BOTH the new commit and the new hash", async () => {
    // --sync used to update sha256 and leave commit untouched, so the lock
    // claimed a commit whose content it did not hold. Nothing caught it: the
    // verify path compares sha256 only, and `commit` exists for the human
    // reading the diff — exactly who it was misleading (CON-DATA-001).
    const { nextLock } = await import("../check-constitution");
    const next = nextLock(lock, "# rules\n", "b".repeat(40));
    expect(next.commit).toBe("b".repeat(40));
    expect(next.sha256).not.toBe(lock.sha256);
  });

  it("leaves the repo and ref alone — a sync adopts, it does not re-point", async () => {
    const { nextLock } = await import("../check-constitution");
    const next = nextLock(lock, "# rules\n", "b".repeat(40));
    expect(next.repo).toBe(lock.repo);
    expect(next.ref).toBe(lock.ref);
  });

  it("produces a lock its own parser accepts", async () => {
    const { nextLock } = await import("../check-constitution");
    const next = nextLock(lock, "# rules\n", "b".repeat(40));
    expect(() => parseLock(JSON.stringify(next))).not.toThrow();
  });
});

describe("parseCommitSha (spec 39)", () => {
  it("accepts a full sha, trimming the newline gh prints", async () => {
    const { parseCommitSha } = await import("../check-constitution");
    expect(parseCommitSha(`${"a".repeat(40)}\n`)).toBe("a".repeat(40));
  });

  it("REFUSES anything that is not one — a failure dressed as success", async () => {
    // An HTML error page, an empty body, a truncated or upper-case answer.
    // Recording any of these as the pinned commit is worse than refusing.
    const { parseCommitSha } = await import("../check-constitution");
    for (const bad of [
      "",
      "   ",
      "not-a-sha",
      "<html>404</html>",
      "a".repeat(39),
      "A".repeat(40),
    ]) {
      expect(parseCommitSha(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("fetchRemote (spec 39) — the fetch policy", () => {
  const lock = {
    repo: "https://github.com/vivekanandba/fleet",
    ref: "main",
    commit: "0".repeat(40),
    sha256: "a".repeat(64),
  };

  it("uses the API when a token exists — raw is CDN-cached and may be stale", async () => {
    const { fetchRemote } = await import("../check-constitution");
    const prev = process.env.CONSTITUTION_TOKEN;
    process.env.CONSTITUTION_TOKEN = "t";
    try {
      const seen: string[] = [];
      const body = fetchRemote(lock, (cmd, args) => {
        seen.push(cmd);
        void args;
        return Buffer.from("# rules\n", "utf8").toString("base64");
      });
      expect(seen).toEqual(["gh"]);
      expect(body).toBe("# rules\n");
    } finally {
      if (prev === undefined) delete process.env.CONSTITUTION_TOKEN;
      else process.env.CONSTITUTION_TOKEN = prev;
    }
  });

  it("falls back to a CACHE-BUSTED raw read with no token", async () => {
    const { fetchRemote } = await import("../check-constitution");
    const prevA = process.env.CONSTITUTION_TOKEN;
    const prevB = process.env.GH_TOKEN;
    delete process.env.CONSTITUTION_TOKEN;
    delete process.env.GH_TOKEN;
    try {
      let args: string[] = [];
      const body = fetchRemote(lock, (cmd, a) => {
        expect(cmd).toBe("curl");
        args = a;
        return "# rules\n";
      });
      expect(body).toBe("# rules\n");
      // A match read from a CDN copy can mean yesterday's rules, and a
      // verification that might be stale is not one.
      expect(args.join(" ")).toContain("Cache-Control: no-cache");
    } finally {
      if (prevA !== undefined) process.env.CONSTITUTION_TOKEN = prevA;
      if (prevB !== undefined) process.env.GH_TOKEN = prevB;
    }
  });

  it("treats an EMPTY body as a miss, not as empty rules", async () => {
    const { fetchRemote } = await import("../check-constitution");
    const prev = process.env.CONSTITUTION_TOKEN;
    delete process.env.CONSTITUTION_TOKEN;
    const prevB = process.env.GH_TOKEN;
    delete process.env.GH_TOKEN;
    try {
      expect(fetchRemote(lock, () => "   ")).toBeNull();
    } finally {
      if (prev !== undefined) process.env.CONSTITUTION_TOKEN = prev;
      if (prevB !== undefined) process.env.GH_TOKEN = prevB;
    }
  });

  it("returns null when the command throws — private repo, or the ref is gone", async () => {
    const { fetchRemote } = await import("../check-constitution");
    expect(
      fetchRemote(lock, () => {
        throw new Error("404");
      }),
    ).toBeNull();
  });

  it("returns null for a repo URL that is not GitHub", async () => {
    const { fetchRemote } = await import("../check-constitution");
    expect(fetchRemote({ ...lock, repo: "https://gitlab.com/a/b" }, () => "x")).toBeNull();
  });
});

describe("scannableFiles and accessConfigured (spec 39)", () => {
  it("scans our own text and code, never generated artefacts", async () => {
    const { scannableFiles } = await import("../check-constitution");
    const files = scannableFiles().map((f) => f.replace(`${process.cwd()}/`, ""));

    expect(files.some((f) => f.startsWith("specs/"))).toBe(true);
    expect(files.some((f) => f.startsWith("src/"))).toBe(true);
    // Generated or vendored trees would make the gate scan its own output and
    // the rules it pins — the copied-text check would then flag the pinned
    // copy as a copy of itself.
    for (const excluded of [".constitution/", "node_modules/", "dist/", "coverage/", "src/data/"]) {
      expect(
        files.filter((f) => f.startsWith(excluded)),
        `${excluded} must not be scanned`,
      ).toEqual([]);
    }
  });

  it("reports access only when something could actually read the remote", async () => {
    const { accessConfigured } = await import("../check-constitution");
    const saved = {
      a: process.env.CONSTITUTION_TOKEN,
      b: process.env.GH_TOKEN,
      c: process.env.CONSTITUTION_PUBLIC,
    };
    delete process.env.CONSTITUTION_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.CONSTITUTION_PUBLIC;
    try {
      expect(accessConfigured()).toBe(false);
      process.env.CONSTITUTION_PUBLIC = "1";
      expect(accessConfigured()).toBe(true);
    } finally {
      for (const [k, v] of [
        ["CONSTITUTION_TOKEN", saved.a],
        ["GH_TOKEN", saved.b],
        ["CONSTITUTION_PUBLIC", saved.c],
      ] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

// Issue #85: the token the gate is told to use must reach gh, the repo URL is
// parsed once, and a sync pins content and commit from one revision.
describe("the token, the repo and the revision (issue #85)", () => {
  const lock = {
    repo: "https://github.com/vivekanandba/fleet",
    ref: "main",
    commit: "0".repeat(40),
    sha256: "a".repeat(64),
  };
  const SHA = "b".repeat(40);

  function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
    const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      fn();
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  it("hands CONSTITUTION_TOKEN to gh, which reads only GH_TOKEN", async () => {
    const { fetchRemote } = await import("../check-constitution");
    withEnv({ CONSTITUTION_TOKEN: "secret", GH_TOKEN: undefined }, () => {
      let env: Record<string, string> | undefined;
      fetchRemote(lock, (_cmd, _args, e) => {
        env = e;
        return Buffer.from("# rules\n").toString("base64");
      });
      expect(env?.GH_TOKEN).toBe("secret");
    });
  });

  it("parses owner and repo once, without a trailing .git", async () => {
    const { repoParts } = await import("../check-constitution");
    expect(repoParts("https://github.com/vivekanandba/fleet.git")).toEqual({
      owner: "vivekanandba",
      repo: "fleet",
    });
    expect(repoParts("https://github.com/vivekanandba/fleet")).toEqual({
      owner: "vivekanandba",
      repo: "fleet",
    });
    expect(repoParts("https://gitlab.com/a/b")).toBeNull();
    expect(repoParts("https://notgithub.com/a/b")).toBeNull();
    expect(repoParts("https://gist.github.com/a/b")).toBeNull();
  });

  it("resolves the commit with the token, and refuses an answer that is not a sha", async () => {
    const { resolveCommit } = await import("../check-constitution");
    withEnv({ CONSTITUTION_TOKEN: "secret", GH_TOKEN: undefined }, () => {
      let seen: { args: string[]; env?: Record<string, string> } | undefined;
      expect(
        resolveCommit(lock, (_c, args, env) => {
          seen = { args, env };
          return `${SHA}\n`;
        }),
      ).toBe(SHA);
      expect(seen?.args).toContain("repos/vivekanandba/fleet/commits/main");
      expect(seen?.env?.GH_TOKEN).toBe("secret");
      expect(resolveCommit(lock, () => "<html>")).toBeNull();
    });
  });

  it("a sync fetches the rules at the commit it resolved, not at the moving ref", async () => {
    const { syncFromRemote } = await import("../check-constitution");
    withEnv({ CONSTITUTION_TOKEN: "secret" }, () => {
      const calls: string[] = [];
      const got = syncFromRemote(lock, (_c, args) => {
        const path = args[1];
        calls.push(path);
        return path.includes("/commits/") ? SHA : Buffer.from("# rules\n").toString("base64");
      });
      expect(got).toEqual({ remote: "# rules\n", commit: SHA });
      expect(calls).toEqual([
        "repos/vivekanandba/fleet/commits/main",
        `repos/vivekanandba/fleet/contents/CONSTITUTION.md?ref=${SHA}`,
      ]);
    });
  });

  it("a sync that cannot resolve the commit fetches nothing", async () => {
    const { syncFromRemote } = await import("../check-constitution");
    withEnv({ CONSTITUTION_TOKEN: "secret" }, () => {
      const calls: string[] = [];
      const got = syncFromRemote(lock, (_c, args) => {
        calls.push(args[1]);
        throw new Error("404");
      });
      expect(typeof got).toBe("string");
      expect(calls).toHaveLength(1);
    });
  });

  it("the real runner hands the env it is given to the command", async () => {
    const { defaultRun } = await import("../check-constitution");
    const seen = defaultRun(
      "node",
      ["-e", "process.stdout.write(process.env.GH_TOKEN ?? '<unset>')"],
      {
        GH_TOKEN: "secret",
      },
    );
    expect(seen).toBe("secret");
  });

  it("blames the token, not its absence, when a set token cannot read the remote", async () => {
    const { unreachableReason } = await import("../check-constitution");
    expect(unreachableReason(lock, true)).not.toMatch(/no CONSTITUTION_TOKEN/);
    expect(unreachableReason(lock, true)).toMatch(/with the token that is set/);
    expect(unreachableReason(lock, false)).toMatch(/no CONSTITUTION_TOKEN\/GH_TOKEN is set/);
  });

  it("with no token, a sync reads both the commit and the rules anonymously, at the sha", async () => {
    const { syncFromRemote } = await import("../check-constitution");
    withEnv({ CONSTITUTION_TOKEN: undefined, GH_TOKEN: undefined }, () => {
      const calls: string[] = [];
      const got = syncFromRemote(lock, (cmd, args) => {
        const url = args[args.length - 1];
        calls.push(`${cmd} ${url}`);
        return url.includes("/commits/") ? `${SHA}\n` : "# rules\n";
      });
      expect(got).toEqual({ remote: "# rules\n", commit: SHA });
      expect(calls).toEqual([
        "curl https://api.github.com/repos/vivekanandba/fleet/commits/main",
        `curl https://raw.githubusercontent.com/vivekanandba/fleet/${SHA}/CONSTITUTION.md`,
      ]);
    });
  });

  it("a sync that resolves the commit but cannot read the rules says which half failed", async () => {
    const { syncFromRemote } = await import("../check-constitution");
    withEnv({ CONSTITUTION_TOKEN: "secret" }, () => {
      const got = syncFromRemote(lock, (_c, args) => {
        if (args[1].includes("/commits/")) return SHA;
        throw new Error("404");
      });
      expect(got).toMatch(/resolved main to bbbbbbb but could not read its CONSTITUTION\.md/);
    });
  });
});
