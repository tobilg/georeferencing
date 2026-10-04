/**
 * Bounded back/forward navigation history. Recording after stepping back discards the
 * forward entries; consecutive equal entries are recorded once.
 * @internal
 */
export class ViewHistory<T> {
  private entries: T[] = [];
  private index = -1;
  /**
   * @param limit - Maximum retained entries; the oldest entry is dropped first.
   * @param equal - Entry equality used to skip duplicate consecutive entries.
   */
  constructor(
    private readonly limit = 50,
    private readonly equal: (a: T, b: T) => boolean = (a, b) =>
      JSON.stringify(a) === JSON.stringify(b),
  ) {}
  /** Whether no entry has been recorded since construction or the last clear. */
  get empty(): boolean {
    return this.index < 0;
  }
  /** Record a new current entry. */
  record(entry: T): void {
    if (this.index >= 0 && this.equal(this.entries[this.index], entry)) return;
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
    this.index = this.entries.length - 1;
  }
  /** Move back (-1) or forward (1), returning the new current entry or undefined at an end. */
  step(direction: -1 | 1): T | undefined {
    const index = this.index + direction;
    if (index < 0 || index >= this.entries.length) return undefined;
    this.index = index;
    return this.entries[index];
  }
  /** Forget every entry. */
  clear(): void {
    this.entries = [];
    this.index = -1;
  }
}
