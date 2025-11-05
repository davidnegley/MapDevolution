import type { MapData } from '../types'

const DB_NAME = 'MapCache'
const STORE_NAME = 'tiles'
const DB_VERSION = 1

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(new Error(request.error?.message || 'Failed to open database'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'bbox' })
      }
    }
  })
}

export const getCachedData = async (bbox: string): Promise<MapData | null> => {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(bbox)
      request.onerror = () => reject(new Error(request.error?.message || 'Failed to get cached data'))
      request.onsuccess = () => {
        const result = request.result as { data: MapData } | undefined
        resolve(result?.data || null)
      }
    })
  } catch (error) {
    console.error('Cache read error:', error)
    return null
  }
}

export const setCachedData = async (bbox: string, data: MapData): Promise<void> => {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put({ bbox, data, timestamp: Date.now() })
      request.onerror = () => reject(new Error(request.error?.message || 'Failed to cache data'))
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.error('Cache write error:', error)
  }
}
