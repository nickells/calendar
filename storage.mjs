const DATABASE = 'calendar';
const STORE = 'events';
let database;
let opening;
export function openDatabase() {
  if (database) return Promise.resolve(database);
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    request.onsuccess = () => {
      const db = request.result;
      database = db;
      db.onversionchange = () => { db.close(); if (database === db) database = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other calendar windows and try again.'));
  }).finally(() => { opening = null; });
  return opening;
}
async function transaction(mode, action, storeName = STORE) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = action(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted.'));
    tx.onerror = () => reject(tx.error);
  });
}
export const loadEvents = () => transaction('readonly', store => store.getAll());
export const saveEvent = event => transaction('readwrite', store => store.put(event));
export const deleteEvent = id => transaction('readwrite', store => store.delete(id));

export const loadView = () => transaction('readonly', store => store.get('view'), 'settings');
export const saveView = view => transaction('readwrite', store => store.put(view, 'view'), 'settings');
