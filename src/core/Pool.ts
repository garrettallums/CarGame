/** Fixed-capacity object pool. When exhausted, the oldest active item is recycled. */
export class Pool<T> {
  private free: T[] = [];
  private active: T[] = [];

  constructor(
    capacity: number,
    create: () => T,
    private onRelease: (item: T) => void = () => {},
  ) {
    for (let i = 0; i < capacity; i++) this.free.push(create());
  }

  acquire(): T {
    let item = this.free.pop();
    if (item === undefined) {
      item = this.active.shift()!;
      this.onRelease(item);
    }
    this.active.push(item);
    return item;
  }

  release(item: T): void {
    const i = this.active.indexOf(item);
    if (i < 0) return;
    this.active.splice(i, 1);
    this.onRelease(item);
    this.free.push(item);
  }

  releaseAll(): void {
    while (this.active.length) this.release(this.active[0]);
  }

  get items(): readonly T[] {
    return this.active;
  }
}
