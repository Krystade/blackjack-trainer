/**
 * D19: THE DECODED CLIP CACHE HAS A BYTE BUDGET.
 *
 * Every clip played through Web Audio (every Drive session, once a mic has
 * been opened) kept its decoded AudioBuffer for the life of the page: float32
 * PCM at the context rate, for every distinct card, hand and correction line,
 * and a second full set after switching clip voice (entries are keyed by URL,
 * which includes the voice). This keeps the same promise-per-URL cache, least
 * recently used first out, once the decoded bytes pass the budget.
 *
 * Evicting is safe while a chain plays: a started AudioBufferSourceNode holds
 * its own buffer, and a later play of an evicted URL just decodes it again.
 * The newest entries are the ones a chain has just prefetched, so LRU never
 * evicts the clips about to be played.
 */

export const DECODED_CLIP_BUDGET_BYTES = 24 * 1024 * 1024;

interface Sized {
  length: number;
  numberOfChannels: number;
}

/** Bytes an AudioBuffer holds: float32 per sample per channel. */
export function bufferBytes(b: Sized): number {
  return b.length * b.numberOfChannels * 4;
}

export class DecodedClipCache<T extends Sized> {
  /** Insertion order is recency order: a get moves an entry to the end. */
  private entries = new Map<string, { promise: Promise<T>; bytes: number }>();
  private total = 0;

  constructor(private readonly budget: number = DECODED_CLIP_BUDGET_BYTES) {}

  get(url: string): Promise<T> | undefined {
    const e = this.entries.get(url);
    if (!e) return undefined;
    this.entries.delete(url);
    this.entries.set(url, e);
    return e.promise;
  }

  set(url: string, promise: Promise<T>): void {
    this.delete(url);
    const entry = { promise, bytes: 0 };
    this.entries.set(url, entry);
    promise.then(
      (buf) => {
        // Replaced or cleared meanwhile: not ours to count.
        if (this.entries.get(url) !== entry) return;
        entry.bytes = bufferBytes(buf);
        this.total += entry.bytes;
        this.evict(url);
      },
      () => {
        // A failed decode must not poison the cache for the next attempt.
        if (this.entries.get(url) === entry) this.entries.delete(url);
      },
    );
  }

  delete(url: string): void {
    const e = this.entries.get(url);
    if (!e) return;
    this.total -= e.bytes;
    this.entries.delete(url);
  }

  clear(): void {
    this.entries.clear();
    this.total = 0;
  }

  get bytes(): number {
    return this.total;
  }

  get size(): number {
    return this.entries.size;
  }

  has(url: string): boolean {
    return this.entries.has(url);
  }

  /** Oldest first, never the entry that has just arrived. */
  private evict(keep: string): void {
    for (const [url, e] of this.entries) {
      if (this.total <= this.budget) return;
      if (url === keep) continue;
      this.total -= e.bytes;
      this.entries.delete(url);
    }
  }
}
