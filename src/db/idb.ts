function getDB() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('probemaster', 4);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('samples')) {
        db.createObjectStore('samples', { keyPath: '_id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('probes')) {
        db.createObjectStore('probes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('locations')) {
        db.createObjectStore('locations', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('areasData')) {
        db.createObjectStore('areasData', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('pixelData')) {
        db.createObjectStore('pixelData', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('timestamps')) {
        db.createObjectStore('timestamps', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function idbGetAll(storeName: string) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function idbGet(storeName: string, key: string) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function idbPut(storeName: string, value: any) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(null);
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbBulkAddSamples(samples: any[]) {
  if (!samples.length) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('samples', 'readwrite');
    const store = tx.objectStore('samples');
    samples.forEach((sample) => store.add(sample));
    tx.oncomplete = () => resolve(null);
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbClear(storeName: string) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve(null);
    tx.onerror = () => reject(tx.error);
  });
}
