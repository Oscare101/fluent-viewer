// Кеш файлів у IndexedDB за git-хешем (sha): вміст за sha ніколи не змінюється, тож кеш не застаріває.
// Будь-яка помилка IndexedDB = працюємо без кешу.
const DB = 'fdh-cache'
const STORE = 'blobs'
let dbp: Promise<IDBDatabase | null> | null = null

function db(): Promise<IDBDatabase | null> {
  if (!dbp) {
    dbp = new Promise((resolve) => {
      try {
        const r = indexedDB.open(DB, 1)
        r.onupgradeneeded = () => r.result.createObjectStore(STORE)
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => resolve(null)
        r.onblocked = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }
  return dbp
}

export async function cacheGet(sha: string): Promise<ArrayBuffer | null> {
  const d = await db()
  if (!d) return null
  return new Promise((resolve) => {
    try {
      const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(sha)
      r.onsuccess = () => resolve((r.result as ArrayBuffer | undefined) ?? null)
      r.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function cachePut(sha: string, buf: ArrayBuffer): Promise<void> {
  const d = await db()
  if (!d) return
  try {
    d.transaction(STORE, 'readwrite').objectStore(STORE).put(buf, sha)
  } catch {
    /* переповнено або заборонено — не страшно */
  }
}
