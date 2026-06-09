const ReadPreviewDirectoryStore = (() => {
  const DB_NAME = 'xsuite-read-preview';
  const STORE_NAME = 'handles';
  const HANDLE_KEY = 'markdown-export-root';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function withStore(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const request = fn(store);
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error || request?.error);
      tx.onabort = () => reject(tx.error || request?.error);
    }).finally(() => {
      db.close();
    });
  }

  async function get() {
    return withStore('readonly', (store) => store.get(HANDLE_KEY));
  }

  async function set(handle) {
    return withStore('readwrite', (store) => store.put(handle, HANDLE_KEY));
  }

  async function clear() {
    return withStore('readwrite', (store) => store.delete(HANDLE_KEY));
  }

  async function ensureWritePermission(handle) {
    if (!handle) return false;
    const options = { mode: 'readwrite' };
    if ((await handle.queryPermission(options)) === 'granted') return true;
    return (await handle.requestPermission(options)) === 'granted';
  }

  return {
    get,
    set,
    clear,
    ensureWritePermission
  };
})();
