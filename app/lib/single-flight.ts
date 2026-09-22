/** Share identical work while it runs. Failures are never retained. */
export class SingleFlight<T> {
  private pending = new Map<string, Promise<T>>();
  run(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const operation = Promise.resolve().then(work);
    this.pending.set(key, operation);
    void operation.finally(() => { if (this.pending.get(key) === operation) this.pending.delete(key); }).catch(() => {});
    return operation;
  }
  clear() { this.pending.clear(); }
}
