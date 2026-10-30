export const MIN_FREE_BYTES = 2 * 1024 ** 3;

export interface StorageCheck {
  supported: boolean;
  freeBytes: number | null;
  ok: boolean;
}

/** Green-room check: is there room to buffer the recording if the upload falls behind? */
export async function checkStorage(minFreeBytes = MIN_FREE_BYTES): Promise<StorageCheck> {
  const estimate = await globalThis.navigator?.storage?.estimate?.();
  if (!estimate || estimate.quota === undefined) return { supported: false, freeBytes: null, ok: true };
  const freeBytes = estimate.quota - (estimate.usage ?? 0);
  return { supported: true, freeBytes, ok: freeBytes >= minFreeBytes };
}

/** Ask the browser not to evict our storage under pressure. Call before recording. */
export async function requestPersistentStorage(): Promise<boolean> {
  return (await globalThis.navigator?.storage?.persist?.()) ?? false;
}
