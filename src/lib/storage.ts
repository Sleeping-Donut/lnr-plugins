export type StorageItem<T = unknown> = {
  created: Date;
  value: T;
  expires?: number;
};

const STORAGE_KEY = 'lnreader-playground-storage';

class Storage {
  private db: Record<string, StorageItem>;

  /**
   * Initializes a new instance of the Storage class, restoring any values
   * previously persisted to the browser's localStorage.
   */
  constructor() {
    this.db = this.load();
  }

  private load(): Record<string, StorageItem> {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, StorageItem>;
      for (const item of Object.values(parsed)) {
        if (item?.created) item.created = new Date(item.created);
      }
      return parsed;
    } catch {
      return {};
    }
  }

  private persist(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.db));
    } catch {
      // Ignore quota or availability errors in the playground
    }
  }

  /**
   * Sets a key-value pair in storage.
   *
   * @param {string} key - The key to set.
   * @param {T} value - The value to set.
   * @param {Date | number} [expires] - Optional expiry date or time in milliseconds.
   */
  set<T>(key: string, value: T, expires?: Date | number): void {
    this.db[key] = {
      created: new Date(),
      value,
      expires: expires instanceof Date ? expires.getTime() : expires,
    };
    this.persist();
  }

  /**
   * Retrieves the value for a given key from storage.
   *
   * @param {string} key - The key to retrieve the value for.
   * @param {boolean} [raw] - Optional flag to return the raw stored item.
   * @returns The stored value or undefined if key is not found.
   */
  get<T = unknown>(key: string, raw: true): StorageItem<T> | undefined;
  get<T = unknown>(key: string, raw?: false): T | undefined;
  get<T = unknown>(key: string, raw?: boolean): T | StorageItem<T> | undefined {
    const item = this.db[key] as StorageItem<T> | undefined;
    if (item?.expires && Date.now() > item.expires) {
      this.delete(key);
      return undefined;
    }
    return raw ? item : item?.value;
  }

  /**
   * Retrieves all keys set by the `set` method.
   *
   * @returns {string[]} An array of keys.
   */
  getAllKeys(): string[] {
    return Object.keys(this.db);
  }

  /**
   * Deletes a key from the storage.
   *
   * @param key - The key to delete.
   */
  delete(key: string): void {
    delete this.db[key];
    this.persist();
  }

  /**
   * Clears all stored items from storage.
   */
  clearAll(): void {
    this.db = {};
    this.persist();
  }
}

// Export a singleton instance of the Storage class
export const storage = new Storage();

/*
These parameters cannot be implemented in `test-web`.
They are generated in the browser when js-scripts are executed
Read more

https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage
*/

/**
 * Represents the structure of a storage object with string keys and values.
 */
type StorageObject = Record<string, string>;

/**
 * Represents a simplified version of the browser's localStorage.
 */
class LocalStorage {
  private db: StorageObject;

  constructor() {
    this.db = {};
  }

  get(): StorageObject | undefined {
    return this.db;
  }
}

// Export singleton instances of LocalStorage and sessionStorage
export const localStorage = new LocalStorage();
export const sessionStorage = new LocalStorage();
