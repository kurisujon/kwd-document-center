/**
 * Pure TypeScript SVG QR Code Generator (ISO/IEC 18004 compatible subset).
 * Generates clean, zero-dependency SVG barcodes for document URLs.
 */

// Basic Galois Field (GF(256)) arithmetic for Reed-Solomon error correction
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisField() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = val;
    GF_EXP[i + 255] = val;
    GF_LOG[val] = i;
    val = (val << 1) ^ (val & 0x80 ? 0x11d : 0);
  }
})();

function gfMultiply(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return GF_EXP[GF_LOG[x] + GF_LOG[y]];
}

function rsComputePoly(ecLen: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < ecLen; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMultiply(poly[j], GF_EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const poly = rsComputePoly(ecLen);
  const result = new Uint8Array(data.length + ecLen);
  result.set(data);

  for (let i = 0; i < data.length; i++) {
    const factor = result[i];
    if (factor !== 0) {
      for (let j = 0; j < poly.length; j++) {
        result[i + j] ^= gfMultiply(poly[j], factor);
      }
    }
  }
  return result.slice(data.length);
}

export interface QrOptions {
  size?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
  title?: string;
}

/**
 * Builds a QR Version 4 (33x33 matrix, Medium error correction) supporting up to 64 bytes.
 */
export function generateQrMatrix(text: string): boolean[][] {
  const size = 33; // Version 4 size
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null),
  );

  function fillFinder(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        if (
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        ) {
          matrix[nr][nc] = true;
        } else {
          matrix[nr][nc] = false;
        }
      }
    }
  }

  // 1. Finder patterns at three corners
  fillFinder(0, 0);
  fillFinder(0, size - 7);
  fillFinder(size - 7, 0);

  // 2. Alignment pattern for Version 4 (center at 24, 24)
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const isBlack =
        Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
      matrix[24 + r][24 + c] = isBlack;
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // 4. Dark module
  matrix[size - 8][8] = true;

  // 5. Reserve format info areas
  for (let i = 0; i <= 8; i++) {
    if (matrix[8][i] === null) matrix[8][i] = false;
    if (matrix[i][8] === null) matrix[i][8] = false;
  }
  for (let i = size - 8; i < size; i++) {
    if (matrix[8][i] === null) matrix[8][i] = false;
    if (matrix[i][8] === null) matrix[i][8] = false;
  }

  // 6. Encode payload data: Byte mode (0100)
  const bytes = new TextEncoder().encode(text);
  const dataLen = bytes.length;
  const bitStream: number[] = [];

  function pushBits(val: number, len: number) {
    for (let i = len - 1; i >= 0; i--) {
      bitStream.push((val >>> i) & 1);
    }
  }

  pushBits(0b0100, 4); // Byte mode indicator
  pushBits(dataLen, 8); // Character count indicator for Ver 4
  for (const b of bytes) {
    pushBits(b, 8);
  }
  pushBits(0b0000, 4); // Terminator
  while (bitStream.length % 8 !== 0) bitStream.push(0);

  // Pad to 64 data codewords (Version 4-M has 64 data codewords, 36 EC codewords)
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bitStream.length < 64 * 8) {
    pushBits(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  const dataCodewords = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    let byteVal = 0;
    for (let b = 0; b < 8; b++) {
      byteVal = (byteVal << 1) | bitStream[i * 8 + b];
    }
    dataCodewords[i] = byteVal;
  }

  // Error correction (36 codewords)
  const ecCodewords = rsEncode(dataCodewords, 36);

  // Combine data + EC into complete bit stream
  const finalBits: number[] = [];
  for (const b of dataCodewords) {
    for (let i = 7; i >= 0; i--) finalBits.push((b >>> i) & 1);
  }
  for (const b of ecCodewords) {
    for (let i = 7; i >= 0; i--) finalBits.push((b >>> i) & 1);
  }

  // 7. Place bits in matrix (right-to-left, bottom-to-top zigzag)
  let bitIdx = 0;
  let upwards = true;
  for (let rightCol = size - 1; rightCol > 0; rightCol -= 2) {
    if (rightCol === 6) rightCol--; // Skip vertical timing pattern

    const rows = upwards
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const r of rows) {
      for (const colOffset of [0, 1]) {
        const c = rightCol - colOffset;
        if (matrix[r][c] === null) {
          const bit = bitIdx < finalBits.length ? finalBits[bitIdx++] : 0;
          // Apply standard mask pattern 000: (row + col) % 2 === 0
          const mask = (r + c) % 2 === 0;
          matrix[r][c] = (bit === 1) !== mask;
        }
      }
    }
    upwards = !upwards;
  }

  return matrix.map((row) => row.map((cell) => Boolean(cell)));
}

/**
 * Generates an accessible, clean SVG string for the QR code.
 */
export function generateQrSvg(text: string, options?: QrOptions): string {
  const matrix = generateQrMatrix(text);
  const matrixSize = matrix.length;
  const margin = options?.margin ?? 4;
  const totalSize = matrixSize + margin * 2;
  const renderSize = options?.size ?? 180;
  const dark = options?.darkColor ?? "#0f172a";
  const light = options?.lightColor ?? "#ffffff";
  const title = options?.title ?? "Document Verification QR Code";

  const paths: string[] = [];
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      if (matrix[r][c]) {
        paths.push(`M${c + margin},${r + margin}h1v1h-1z`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${renderSize}" height="${renderSize}" shape-rendering="crispEdges" role="img" aria-label="${title}"><title>${title}</title><rect width="100%" height="100%" fill="${light}"/><path d="${paths.join("")}" fill="${dark}"/></svg>`;
}
