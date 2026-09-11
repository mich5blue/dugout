/**
 * Deterministic PRNG (mulberry32). Generation must be reproducible given the
 * same inputs and seed, so nothing in the optimizer may call Math.random().
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Ensure a non-zero 32-bit state.
    this.state = (seed | 0) === 0 ? 0x9e3779b9 : seed | 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Fisher-Yates shuffle of a copy. */
  shuffled<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const a = out[i];
      const b = out[j];
      out[i] = b;
      out[j] = a;
    }
    return out;
  }
}
