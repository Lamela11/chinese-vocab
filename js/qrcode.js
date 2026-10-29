// qrcode.js - draws a QR code, so your phone can set itself up by scanning the laptop's screen
// instead of you typing the sync key. Written for this app from the QR code standard
// (ISO/IEC 18004): byte mode, error correction level M, versions 1 to 40.

// Error correction codewords per block, and number of blocks, for level M (index = version).
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
  26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
  17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const LEVEL_M = 0; // its two bits in the format information

const bit = (value, i) => ((value >>> i) & 1) !== 0;

// How many modules carry data (and error correction) in a version, all fixed patterns left out.
function dataModules(version) {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

const dataCodewords = (version) => Math.floor(dataModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version];

// --- Reed-Solomon error correction, in GF(2^8) with the QR code's polynomial 0x11d ---------------

function times(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function divisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = times(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = times(root, 2);
  }
  return result;
}

function remainder(data, by) {
  const result = by.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    by.forEach((c, i) => (result[i] ^= times(c, factor)));
  }
  return result;
}

// --- Building the code ----------------------------------------------------------------------------

// The text as codewords: mode, length, the bytes, then padding, split into blocks that each get
// their error correction, and the blocks interleaved.
function codewords(bytes, version) {
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const blocks = BLOCKS[version];
  const eccLength = ECC_PER_BLOCK[version];
  const raw = Math.floor(dataModules(version) / 8);
  const short = blocks - (raw % blocks); // the first blocks are one byte shorter
  const shortLength = Math.floor(raw / blocks);
  const by = divisor(eccLength);
  const parts = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const part = data.slice(k, k + shortLength - eccLength + (i < short ? 0 : 1));
    k += part.length;
    const ecc = remainder(part, by);
    if (i < short) part.push(0); // a place holder, left out below
    parts.push(part.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < parts[0].length; i++) {
    parts.forEach((part, j) => {
      if (i !== shortLength - eccLength || j >= short) out.push(part[i]);
    });
  }
  return out;
}

function alignmentPositions(version, size) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// The standard's penalty for a finished code: long runs, 2x2 blocks, look-alikes of the corner
// squares and too much dark or light all make it harder to scan. The mask with the lowest wins.
function penalty(dark) {
  const size = dark.length;
  const lines = [];
  for (let a = 0; a < size; a++) {
    lines.push(dark[a]);
    lines.push(dark.map((row) => row[a]));
  }
  let score = 0;
  const finder = [true, false, true, true, true, false, true];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    for (let i = 0; i + 7 <= size; i++) {
      if (!finder.every((v, k) => line[i + k] === v)) continue;
      const lightBefore = [1, 2, 3, 4].every((k) => !line[i - k]);
      const lightAfter = [0, 1, 2, 3].every((k) => !line[i + 7 + k]);
      if (lightBefore || lightAfter) score += 40;
    }
  }
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const c = dark[y][x];
      if (c === dark[y][x + 1] && c === dark[y + 1][x] && c === dark[y + 1][x + 1]) score += 3;
    }
  }
  const darkCount = dark.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((darkCount * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

// The code for a text, as rows of modules (true = dark).
export function qrModules(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  while (version <= 40 && 4 + (version < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(version) * 8) version++;
  if (version > 40) throw new Error("Too long for a QR code");
  const size = version * 4 + 17;
  const dark = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, on) => {
    dark[y][x] = on;
    fixed[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, ring !== 2 && ring !== 4);
      }
    }
  }
  const align = alignmentPositions(version, size);
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      const corner = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  const format = (mask) => {
    const data = (LEVEL_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i));
    set(8, 7, bit(bits, 6));
    set(8, 8, bit(bits, 7));
    set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits, i));
    set(8, size - 8, true);
  };
  format(0); // keeps the places free; drawn for real with the chosen mask
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(bits, i));
      set(b, a, bit(bits, i));
    }
  }

  const words = codewords(bytes, version);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing pattern is skipped
    for (let step = 0; step < size; step++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - step : step;
        if (!fixed[y][x] && i < words.length * 8) {
          dark[y][x] = bit(words[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }

  const flip = (mask) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[mask](x, y)) dark[y][x] = !dark[y][x];
    }
  };
  let best = 0;
  let lowest = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    flip(mask);
    format(mask);
    const score = penalty(dark);
    if (score < lowest) [best, lowest] = [mask, score];
    flip(mask);
  }
  flip(best);
  format(best);
  return dark;
}

// The code as an SVG picture: black on white with the margin scanners need, whatever the theme.
export function qrSvg(text) {
  const dark = qrModules(text);
  const size = dark.length + 8;
  let path = "";
  dark.forEach((row, y) => row.forEach((on, x) => on && (path += `M${x + 4} ${y + 4}h1v1h-1z`)));
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
