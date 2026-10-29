/* Investigation persistence in chrome.storage.local: one key per investigation + a small index. */
import { Investigation } from '../shared/schemas.ts';

export const INV_PREFIX = 'cf:inv:';
export const INDEX_KEY = 'cf:invIndex';
export const ACTIVE_KEY = 'cf:activeInv';
export const MAX_INVESTIGATIONS = 50;

export interface IndexEntry {
  id: string;
  handle: string;
  updatedAt: string;
  version: number;
  headline: string;
}

type Area = {
  get(k: any): Promise<any>;
  set(o: any): Promise<void>;
  remove(k: any): Promise<void>;
};

export async function loadInvestigation(area: Area, id: string): Promise<Investigation | null> {
  const got = await area.get(INV_PREFIX + id);
  const raw = got[INV_PREFIX + id];
  if (!raw) return null;
  const r = Investigation.safeParse(raw);
  return r.success ? r.data : null; // a corrupted record is ignored, not trusted
}

let saveQueue: Promise<unknown> = Promise.resolve();
export function saveInvestigation(area: Area, inv: Investigation): Promise<IndexEntry[]> {
  const task = saveQueue.catch(() => {}).then(() => saveImmediately(area, inv));
  saveQueue = task;
  return task;
}
async function saveImmediately(area: Area, inv: Investigation): Promise<IndexEntry[]> {
  const valid = Investigation.parse(inv);
  const got = await area.get(INDEX_KEY);
  let index: IndexEntry[] = Array.isArray(got[INDEX_KEY]) ? got[INDEX_KEY] : [];
  const snap = valid.snapshots[valid.snapshots.length - 1];
  index = [
    {
      id: valid.id,
      handle: valid.subject.handle,
      updatedAt: valid.updatedAt,
      version: valid.currentVersion,
      headline: snap.headline,
    },
    ...index.filter((e) => e.id !== valid.id),
  ];
  const dropped = index.slice(MAX_INVESTIGATIONS);
  index = index.slice(0, MAX_INVESTIGATIONS);
  await area.set({ [INV_PREFIX + valid.id]: valid, [INDEX_KEY]: index, [ACTIVE_KEY]: valid.id });
  if (dropped.length) await area.remove(dropped.map((e) => INV_PREFIX + e.id));
  return index;
}

export async function deleteInvestigation(area: Area, id: string): Promise<void> {
  const got = await area.get([INDEX_KEY, ACTIVE_KEY]);
  const index: IndexEntry[] = (got[INDEX_KEY] || []).filter((e: IndexEntry) => e.id !== id);
  await area.remove(INV_PREFIX + id);
  await area.set({
    [INDEX_KEY]: index,
    [ACTIVE_KEY]: got[ACTIVE_KEY] === id ? (index[0] ? index[0].id : null) : got[ACTIVE_KEY],
  });
}
