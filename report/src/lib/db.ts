import type { RunBundle } from "@mcmcjs/core";

export interface StoredRun {
  id: string;
  savedAt: number;
  bundle: RunBundle;
}

const DB_NAME = "mcmcjs-report";
const RUNS = "runs";
const HANDLES = "handles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RUNS)) db.createObjectStore(RUNS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(HANDLES)) db.createObjectStore(HANDLES);
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

export function clearStoreHandle(): Promise<void> {
  return tx(HANDLES, "readwrite", (s) => s.delete("store")).then(() => undefined);
}
