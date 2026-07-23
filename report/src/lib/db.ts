import type { RunBundle } from "@mcmcjs/core";

export interface StoredRun {
  id: string;
  savedAt: number;
  bundle: RunBundle;
}

const DB_NAME = "mcmcjs-report";
const RUNS = "runs";
const HANDLES = "handles";
const ROOTS = "roots";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RUNS)) db.createObjectStore(RUNS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(HANDLES)) db.createObjectStore(HANDLES);
      if (!db.objectStoreNames.contains(ROOTS)) {
        db.createObjectStore(ROOTS, { autoIncrement: true });
      }
      if (event.oldVersion === 1) {
        const tx = request.transaction;
        if (tx) {
          const get = tx.objectStore(HANDLES).get("store");
          get.onsuccess = () => {
            if (get.result) tx.objectStore(ROOTS).add(get.result);
          };
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = op(db.transaction(store, mode).objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export function listRuns(): Promise<StoredRun[]> {
  return tx<StoredRun[]>(RUNS, "readonly", (s) => s.getAll() as IDBRequest<StoredRun[]>).then(
    (runs) => runs.sort((a, b) => b.savedAt - a.savedAt),
  );
}

export function getRun(id: string): Promise<StoredRun | undefined> {
  return tx<StoredRun | undefined>(
    RUNS,
    "readonly",
    (s) => s.get(id) as IDBRequest<StoredRun | undefined>,
  );
}

export function putRun(bundle: RunBundle): Promise<StoredRun> {
  const stored: StoredRun = { id: bundle.entry.id, savedAt: Date.now(), bundle };
  return tx(RUNS, "readwrite", (s) => s.put(stored)).then(() => stored);
}

export function deleteRun(id: string): Promise<void> {
  return tx(RUNS, "readwrite", (s) => s.delete(id)).then(() => undefined);
}

export function getStoreHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return tx<FileSystemDirectoryHandle | undefined>(
    HANDLES,
    "readonly",
    (s) => s.get("store") as IDBRequest<FileSystemDirectoryHandle | undefined>,
  );
}

export function setStoreHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  return tx(HANDLES, "readwrite", (s) => s.put(handle, "store")).then(() => undefined);
}

export function listRoots(): Promise<FileSystemDirectoryHandle[]> {
  return tx<FileSystemDirectoryHandle[]>(
    ROOTS,
    "readonly",
    (s) => s.getAll() as IDBRequest<FileSystemDirectoryHandle[]>,
  );
}

export async function addRoot(handle: FileSystemDirectoryHandle): Promise<void> {
  const roots = await listRoots();
  for (const existing of roots) {
    if (await existing.isSameEntry(handle)) return;
  }
  await tx(ROOTS, "readwrite", (s) => s.add(handle));
}
