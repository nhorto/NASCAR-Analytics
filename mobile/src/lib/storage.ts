// Tiny key-value layer over AsyncStorage, loaded lazily so pure modules that
// import this file stay runnable under plain Bun/Node (repo-root `bun test`
// picks up the colocated feature tests). If the native module is unavailable
// we fall back to process-lifetime memory — fine for tests, never persisted.
type Store = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const memory = new Map<string, string>();
const memoryStore: Store = {
  getItem: async (k) => memory.get(k) ?? null,
  setItem: async (k, v) => void memory.set(k, v),
  removeItem: async (k) => void memory.delete(k),
};

let store: Store | null = null;

async function backing(): Promise<Store> {
  if (store) return store;
  try {
    const mod = await import("@react-native-async-storage/async-storage");
    store = (mod.default ?? mod) as unknown as Store;
  } catch {
    store = memoryStore;
  }
  return store;
}

export async function getItem(key: string): Promise<string | null> {
  try {
    return await (await backing()).getItem(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    await (await backing()).setItem(key, value);
  } catch {
    // Losing a preference write is preferable to crashing a screen.
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    await (await backing()).removeItem(key);
  } catch {
    // See above.
  }
}
