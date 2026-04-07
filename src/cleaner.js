import { rm } from "node:fs/promises";

/**
 * Delete a list of directories.
 * items: [{ path, size }]
 * onProgress(item, index, total)
 * Returns { cleaned: [{ path, size }], failed: [{ path, size, error }] }
 */
export async function clean(items, { onProgress } = {}) {
  const cleaned = [];
  const failed = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (onProgress) onProgress(item, i, items.length);

    try {
      await rm(item.path, { recursive: true, force: true });
      cleaned.push(item);
    } catch (err) {
      failed.push({ ...item, error: err.message });
    }
  }

  return { cleaned, failed };
}
