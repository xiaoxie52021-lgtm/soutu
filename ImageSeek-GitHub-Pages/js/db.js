/**
 * IndexedDB 本地图库：照片特征与缩略图全部保存在浏览器内。
 *
 * 分出 photos / thumbs 两个 store：搜索时只需要读取很小的特征记录，
 * 缩略图按需加载，图库很大时也不会一次性占用大量内存。
 */

const DB_NAME = "imageseek-mobile";
const DB_VERSION = 1;

let connection = null;

export function openDB() {
  if (connection) return Promise.resolve(connection);
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("photos")) {
        const store = db.createObjectStore("photos", { keyPath: "id" });
        store.createIndex("added", "added");
      }
      if (!db.objectStoreNames.contains("thumbs")) {
        db.createObjectStore("thumbs", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("数据库事务失败"));
    tx.onabort = () => reject(tx.error || new Error("数据库事务被中止"));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllPhotos() {
  const db = await openDB();
  const tx = db.transaction("photos", "readonly");
  const photos = await requestResult(tx.objectStore("photos").getAll());
  return photos.sort((a, b) => (b.added || 0) - (a.added || 0));
}

export async function putPhoto(record, thumbBlob) {
  const db = await openDB();
  const tx = db.transaction(["photos", "thumbs"], "readwrite");
  tx.objectStore("photos").put(record);
  tx.objectStore("thumbs").put({ id: record.id, blob: thumbBlob });
  return transactionDone(tx);
}

export async function getThumb(id) {
  const db = await openDB();
  const tx = db.transaction("thumbs", "readonly");
  const row = await requestResult(tx.objectStore("thumbs").get(id));
  return row ? row.blob : null;
}

export async function deletePhoto(id) {
  const db = await openDB();
  const tx = db.transaction(["photos", "thumbs"], "readwrite");
  tx.objectStore("photos").delete(id);
  tx.objectStore("thumbs").delete(id);
  return transactionDone(tx);
}

export async function clearAll() {
  const db = await openDB();
  const tx = db.transaction(["photos", "thumbs"], "readwrite");
  tx.objectStore("photos").clear();
  tx.objectStore("thumbs").clear();
  return transactionDone(tx);
}

export async function countPhotos() {
  const db = await openDB();
  const tx = db.transaction("photos", "readonly");
  return requestResult(tx.objectStore("photos").count());
}

export async function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}

export async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return "unsupported";
  try {
    const granted = await navigator.storage.persist();
    return granted ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}

export async function persistenceState() {
  if (!navigator.storage || !navigator.storage.persisted) return "unsupported";
  try {
    return (await navigator.storage.persisted()) ? "granted" : "default";
  } catch {
    return "unsupported";
  }
}
