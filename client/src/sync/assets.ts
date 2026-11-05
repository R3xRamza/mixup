const DB_NAME = 'mixup-assets'
const STORE = 'bytes'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export class ByteStore {
  private db: Promise<IDBDatabase>
  private cache = new Map<string, ArrayBuffer>()

  constructor() {
    this.db = openDb()
  }

  async put(sha256: string, data: ArrayBuffer): Promise<void> {
    this.cache.set(sha256, data)
    const db = await this.db
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(data, sha256)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async get(sha256: string): Promise<ArrayBuffer | null> {
    const cached = this.cache.get(sha256)
    if (cached) return cached
    const db = await this.db
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).get(sha256)
      request.onsuccess = () => {
        const value = request.result as ArrayBuffer | undefined
        if (value) this.cache.set(sha256, value)
        resolve(value ?? null)
      }
      request.onerror = () => reject(request.error)
    })
  }
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value)
}
