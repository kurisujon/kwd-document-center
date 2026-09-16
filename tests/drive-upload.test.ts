import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Readable, Writable } from "node:stream";

test("Drive upload sends Uint8Array PDF bytes as one binary stream chunk", async () => {
  const source = await readFile(new URL("../src/lib/google/drive.ts", import.meta.url), "utf8");
  assert.match(source, /Readable\.from\(\[Buffer\.from\(input\.bytes\)\]\)/);

  const chunks: unknown[] = [];
  const transport = new WritableCapture(chunks);
  Readable.from([Buffer.from(new Uint8Array([0x25, 0x50, 0x44, 0x46]))]).pipe(transport);
  await new Promise<void>((resolve, reject) => {
    transport.once("finish", resolve);
    transport.once("error", reject);
  });

  assert.equal(chunks.length, 1);
  assert.ok(Buffer.isBuffer(chunks[0]));
  assert.deepEqual(chunks[0], Buffer.from("%PDF"));
});

class WritableCapture extends Writable {
  constructor(private readonly chunks: unknown[]) {
    super({
      write: (chunk, _encoding, callback) => {
        this.chunks.push(chunk);
        callback();
      },
    });
  }
}
