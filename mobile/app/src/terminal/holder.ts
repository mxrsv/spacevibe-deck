/**
 * A mutable cell for values that callbacks (the bridge's `post`, the page's `init`) read when
 * they run, not while rendering. A class instead of `useRef`, so React's render-purity checks do
 * not mistake those callbacks for render-time reads.
 */
export class Holder<T> {
  private value: T;
  constructor(initial: T) {
    this.value = initial;
  }
  get(): T {
    return this.value;
  }
  set(next: T): void {
    this.value = next;
  }
}
