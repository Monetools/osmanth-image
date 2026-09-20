/**
 * Bounds-checked big/little-endian reads. Every parser in this folder goes through these helpers
 * so a truncated or hostile file raises a ParseError instead of reading out of range.
 */
export class ParseError extends Error {}

export class Reader {
  constructor(
    readonly bytes: Uint8Array,
    public littleEndian = false,
  ) {}

  get length(): number {
    return this.bytes.length;
  }

  check(offset: number, size: number): void {
    if (!Number.isInteger(offset) || offset < 0 || size < 0 || offset + size > this.bytes.length) {
      throw new ParseError(`read of ${size} bytes at ${offset} is out of range (${this.bytes.length})`);
    }
  }

  u8(o: number): number {
    this.check(o, 1);
    return this.bytes[o];
  }

  u16(o: number): number {
    this.check(o, 2);
    const b = this.bytes;
    return this.littleEndian ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
  }

  u32(o: number): number {
    this.check(o, 4);
    const b = this.bytes;
    const v = this.littleEndian
      ? b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)
      : (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    return v >>> 0;
  }

  ascii(o: number, n: number): string {
    this.check(o, n);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.bytes[o + i]);
    return s;
  }

  slice(o: number, n: number): Uint8Array {
    this.check(o, n);
    return this.bytes.subarray(o, o + n);
  }
}

export function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}
