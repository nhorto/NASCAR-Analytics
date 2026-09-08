// boot.js runs on every page and now owns behavior that used to be inline
// markup — the confirm dialogs on /account, the season navigation on /races,
// the print control on /dfs, service-worker registration, and the live dot.
// Deleting an inline handler and forgetting its replacement would break those
// silently, so this evaluates the REAL client/boot.js against a minimal DOM
// and drives the handlers, rather than asserting on its source text.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BOOT_JS = readFileSync(
  fileURLToPath(new URL("../src/app/client/boot.js", import.meta.url)),
  "utf8",
);

interface FakeElement {
  nodeName: string;
  attrs: Record<string, string>;
  value?: string;
  hidden?: boolean;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  closest(selector: string): FakeElement | null;
}

function el(nodeName: string, attrs: Record<string, string>, extra: Partial<FakeElement> = {}): FakeElement {
  const node: FakeElement = {
    nodeName,
    attrs,
    hasAttribute: (name) => name in attrs,
    getAttribute: (name) => attrs[name] ?? null,
    // Only `[data-x]` selectors are used by boot.js.
    closest(selector) {
      const key = selector.replace(/^\[|\]$/g, "");
      return key in attrs ? node : null;
    },
    ...extra,
  };
  return node;
}

interface Harness {
  /** Dispatch a document-level event to boot.js's delegated listener. */
  fire(type: string, event: Record<string, unknown>): void;
  /** Dispatch a window-level event (`load`). */
  fireWindow(type: string): void;
  window: Record<string, unknown>;
  location: { href: string };
  livedot: FakeElement;
  prevented: number;
  confirms: string[];
  prints: number;
  registered: string[];
  fetches: Array<{ url: string; init?: unknown }>;
}

function boot(
  dataset: Record<string, string>,
  opts: {
    confirmResult?: boolean;
    readyState?: string;
    liveStatus?: unknown;
    liveOk?: boolean;
  } = {},
): Harness {
  const docListeners: Record<string, (e: unknown) => void> = {};
  const winListeners: Record<string, () => void> = {};
  const livedot = el("I", {}, { hidden: true });
  const location = { href: "" };
  const state = {
    prevented: 0,
    confirms: [] as string[],
    prints: 0,
    registered: [] as string[],
    fetches: [] as Array<{ url: string; init?: unknown }>,
  };

  const document = {
    documentElement: { dataset },
    readyState: opts.readyState ?? "complete",
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      docListeners[type] = fn;
    },
    querySelector: (selector: string) =>
      selector === ".tabbar .tab-live .livedot" ? livedot : null,
  };

  const window: Record<string, unknown> = {
    confirm: (message: string) => {
      state.confirms.push(message);
      return opts.confirmResult ?? true;
    },
    print: () => {
      state.prints++;
    },
    addEventListener: (type: string, fn: () => void) => {
      winListeners[type] = fn;
    },
  };

  const navigator = {
    serviceWorker: {
      register: (url: string) => {
        state.registered.push(url);
        return Promise.resolve();
      },
    },
  };

  const fetchImpl = (url: string, init?: unknown) => {
    state.fetches.push({ url, init });
    return opts.liveOk === false
      ? Promise.reject(new Error("offline"))
      : Promise.resolve({ json: () => Promise.resolve(opts.liveStatus ?? { live: false }) });
  };

  new Function("document", "window", "navigator", "location", "fetch", BOOT_JS)(
    document,
    window,
    navigator,
    location,
    fetchImpl,
  );

  return {
    fire(type, event) {
      const listener = docListeners[type];
      if (!listener) throw new Error(`boot.js registered no "${type}" listener`);
      listener({ preventDefault: () => state.prevented++, ...event });
    },
    fireWindow(type) {
      const listener = winListeners[type];
      if (!listener) throw new Error(`boot.js registered no window "${type}" listener`);
      listener();
    },
    window,
    location,
    livedot,
    get prevented() {
      return state.prevented;
    },
    get confirms() {
      return state.confirms;
    },
    get prints() {
      return state.prints;
    },
    get registered() {
      return state.registered;
    },
    get fetches() {
      return state.fetches;
    },
  };
}

describe("page config from <html data-*>", () => {
  test("publishes the live origin, series and plan as globals", () => {
    const h = boot({ liveApi: "https://live.example.com", series: "3", pro: "true" });
    expect(h.window.__LIVE_API__).toBe("https://live.example.com");
    expect(h.window.__SERIES__).toBe(3);
    expect(h.window.__PRO__).toBe(true);
  });

  test("defaults to Cup and free when the attributes are missing or junk", () => {
    const h = boot({});
    expect(h.window.__LIVE_API__).toBe("");
    expect(h.window.__SERIES__).toBe(1);
    expect(h.window.__PRO__).toBe(false);

    const junk = boot({ series: "not-a-number", pro: "yes" });
    expect(junk.window.__SERIES__).toBe(1);
    // Anything but the exact string "true" is free — a truthy-string bug here
    // would hand every visitor the Pro compare UI.
    expect(junk.window.__PRO__).toBe(false);
  });
});

describe("data-confirm (the /account destructive actions)", () => {
  test("cancelling the dialog blocks the submit", () => {
    const h = boot({}, { confirmResult: false });
    h.fire("submit", { target: el("FORM", { "data-confirm": "Delete your account permanently?" }) });
    expect(h.confirms).toEqual(["Delete your account permanently?"]);
    expect(h.prevented).toBe(1);
  });

  test("confirming lets it through", () => {
    const h = boot({}, { confirmResult: true });
    h.fire("submit", { target: el("FORM", { "data-confirm": "Sign out everywhere?" }) });
    expect(h.prevented).toBe(0);
  });

  test("a form without the attribute is never interrupted", () => {
    const h = boot({});
    h.fire("submit", { target: el("FORM", { method: "post" }) });
    expect(h.confirms).toEqual([]);
    expect(h.prevented).toBe(0);
  });

  test("a non-form submit target is ignored", () => {
    const h = boot({}, { confirmResult: false });
    h.fire("submit", { target: el("DIV", { "data-confirm": "nope" }) });
    expect(h.confirms).toEqual([]);
    expect(h.prevented).toBe(0);
  });
});

describe("data-nosubmit (the compare range form)", () => {
  test("always blocks, and never shows a dialog", () => {
    const h = boot({}, { confirmResult: false });
    h.fire("submit", { target: el("FORM", { "data-nosubmit": "" }) });
    expect(h.prevented).toBe(1);
    expect(h.confirms).toEqual([]);
  });
});

describe("data-nav (the season picker)", () => {
  test("navigates to the selected option's value", () => {
    const h = boot({});
    h.fire("change", { target: el("SELECT", { "data-nav": "" }, { value: "/races/2024" }) });
    expect(h.location.href).toBe("/races/2024");
  });

  test("re-picking the current season (empty value) does not reload", () => {
    const h = boot({});
    h.fire("change", { target: el("SELECT", { "data-nav": "" }, { value: "" }) });
    expect(h.location.href).toBe("");
  });

  test("a select without the attribute never navigates", () => {
    const h = boot({});
    h.fire("change", { target: el("SELECT", {}, { value: "/evil" }) });
    expect(h.location.href).toBe("");
  });
});

describe("data-print (the DFS cheat sheet)", () => {
  test("prints and suppresses the default action", () => {
    const h = boot({});
    h.fire("click", { target: el("BUTTON", { "data-print": "" }) });
    expect(h.prints).toBe(1);
    expect(h.prevented).toBe(1);
  });

  test("an unrelated click does nothing", () => {
    const h = boot({});
    h.fire("click", { target: el("A", { href: "/drivers" }) });
    expect(h.prints).toBe(0);
    expect(h.prevented).toBe(0);
  });
});

describe("service worker", () => {
  test("registers on load, not during parse", () => {
    const h = boot({});
    expect(h.registered).toEqual([]);
    h.fireWindow("load");
    expect(h.registered).toEqual(["/sw.js"]);
  });
});

describe("live indicator", () => {
  /** Let the fetch → json → apply promise chain settle. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("asks the configured origin for the page's series", () => {
    const h = boot({ liveApi: "https://live.example.com", series: "2" });
    expect(h.fetches).toHaveLength(1);
    expect(h.fetches[0]!.url).toBe("https://live.example.com/api/live/status?series=2");
    expect(h.fetches[0]!.init).toEqual({ cache: "no-store" });
  });

  test("does not call out at all when no live origin is configured", () => {
    expect(boot({}).fetches).toEqual([]);
  });

  test("reveals the dot only when a race is live", async () => {
    const live = boot({ liveApi: "https://live.example.com" }, { liveStatus: { live: true } });
    await flush();
    expect(live.livedot.hidden).toBe(false);

    const idle = boot({ liveApi: "https://live.example.com" }, { liveStatus: { live: false } });
    await flush();
    expect(idle.livedot.hidden).toBe(true);
  });

  test("a failed status call is swallowed — the tab bar just stays quiet", async () => {
    const h = boot({ liveApi: "https://live.example.com" }, { liveOk: false });
    await flush();
    expect(h.livedot.hidden).toBe(true);
  });

  test("waits for DOMContentLoaded when the document is still parsing", () => {
    // boot.js is a blocking <head> script, so the tab bar does not exist yet.
    const h = boot({ liveApi: "https://live.example.com" }, { readyState: "loading" });
    expect(h.fetches).toEqual([]);
    h.fire("DOMContentLoaded", {});
    expect(h.fetches).toHaveLength(1);
  });
});
