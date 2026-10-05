// Saves in the game's own IndexedDB database "minor-sabotage" (ADR-0001), never the
// prototype's shared /Saves. Two records: the campaign (between phases, and a phase's losses as
// they happen) and a one-time bookmark of the phase in progress, written when the phone is locked.
import type { Campaign } from "../missions/campaign";

const DB = "minor-sabotage";
const STORE = "saves";

function open(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch {
      res(null);
    }
  });
}

async function put(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((res) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
  db.close();
}

async function get<T>(key: string): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  const v = await new Promise<T | null>((res) => {
    const tx = db.transaction(STORE, "readonly");
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => res((r.result as T) ?? null);
    r.onerror = () => res(null);
  });
  db.close();
  return v;
}

async function del(key: string): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((res) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
  db.close();
}

export interface Bookmark {
  phase: string;
  campaign: Campaign;
  sim: string;
  at: number;
}

export const store = {
  saveCampaign: (c: Campaign) => put("campaign", c),
  loadCampaign: () => get<Campaign>("campaign"),
  clearCampaign: () => del("campaign"),
  saveBookmark: (b: Bookmark) => put("bookmark", b),
  /** Read the bookmark and delete it: it resumes once, it is not a save. */
  takeBookmark: async () => {
    const b = await get<Bookmark>("bookmark");
    if (b) await del("bookmark");
    return b;
  },
};
