export function createHash(): never {
  throw new Error("hashing is not available in the browser");
}

export function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}
