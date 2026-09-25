"use strict";

/* The Omarchy wallpaper, and a wallpaper the user picks on the new tab.
 *
 * The native host streams the current wallpaper in base64 chunks (a native
 * message is capped at 1 MB); the background page reassembles them into one
 * Blob and keeps it in the extension's IndexedDB, which every extension
 * page shares. storage.local only carries the wallpaper's id, so open new
 * tabs hear about a change through storage.onChanged. */
(function (root) {
  const DB_NAME = "omafox";
  const STORE = "files";
  const ID_KEY = "wallpaperId";
  const OMARCHY = "wallpaper";
  const CUSTOM = "custom-wallpaper";

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function transact(mode, operation) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE, mode);
        const request = operation(transaction.objectStore(STORE));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  const read = (key) => transact("readonly", (store) => store.get(key));
  const write = (key, value) => transact("readwrite", (store) => store.put(value, key));
  const remove = (key) => transact("readwrite", (store) => store.delete(key));

  function isWallpaperMessage(message) {
    return Boolean(message) && message.protocol === "omafox" && message.action === "wallpaper";
  }

  function decodeBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /* Returns an accept(message) that yields { id, blob } once a wallpaper is
   * complete ({ id: "", blob: null } when the host reports none), else
   * null. Chunks arrive in order; anything out of sequence drops the
   * partial image, and the next index-0 chunk starts over. */
  function createAssembler() {
    let pending = null;
    return function accept(message) {
      if (!message.count) {
        pending = null;
        return { id: "", blob: null };
      }
      if (message.index === 0) {
        pending = { id: message.id, mime: message.mime, size: message.size, count: message.count, parts: [] };
      }
      if (!pending || message.id !== pending.id || message.index !== pending.parts.length
          || typeof message.data !== "string") {
        pending = null;
        return null;
      }
      pending.parts.push(decodeBase64(message.data));
      if (pending.parts.length < pending.count) return null;
      const done = pending;
      pending = null;
      const blob = new Blob(done.parts, { type: done.mime });
      return blob.size === done.size ? { id: done.id, blob } : null;
    };
  }

  const api = { ID_KEY, OMARCHY, CUSTOM, read, write, remove, isWallpaperMessage, createAssembler };
  root.OmafoxWallpaper = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
