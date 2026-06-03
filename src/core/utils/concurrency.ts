// Owner: @BE | Scope: bounded-concurrency runner

/**
 * Runs `worker` over `items` with at most `limit` in flight at once.
 * Always returns a settled result per item — never throws.
 *
 * Order of results matches order of `items` (not completion order).
 *
 * @example
 *   const results = await runWithConcurrency(stores, fetchStore, 3);
 *   for (const r of results) {
 *     if (r.status === 'fulfilled') console.log(r.value);
 *   }
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  limit: number,
): Promise<PromiseSettledResult<R>[]> {
  if (limit < 1) throw new Error('runWithConcurrency: limit must be >= 1');
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  async function lane(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      const item = items[i] as T;
      try {
        const value = await worker(item, i);
        results[i] = { status: 'fulfilled', value };
      } catch (err) {
        results[i] = { status: 'rejected', reason: err };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => lane()),
  );
  return results;
}
