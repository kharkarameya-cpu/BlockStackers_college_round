import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function createPNG(width, height, colorR, colorG, colorB) {
  // Construct a minimal uncompressed or deflated PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // Raw image data: height scanlines, each starting with filter type 0 (None)
  const rowBytes = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowBytes);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    rawData[rowOffset] = 0; // Filter: none
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;
      // Draw a sleek cyan/blue gradient circle badge
      const cx = width / 2;
      const cy = height / 2;
      const dist = Math.hypot(x - cx, y - cy);
      const radius = width * 0.45;

      if (dist <= radius) {
        // Gradient effect
        const t = (x + y) / (width + height);
        rawData[pixelOffset] = Math.round(colorR * (1 - t) + 14 * t);     // R
        rawData[pixelOffset + 1] = Math.round(colorG * (1 - t) + 165 * t); // G
        rawData[pixelOffset + 2] = Math.round(colorB * (1 - t) + 233 * t); // B
        rawData[pixelOffset + 3] = 255;                                   // Alpha
      } else {
        // Transparent background
        rawData[pixelOffset] = 0;
        rawData[pixelOffset + 1] = 0;
        rawData[pixelOffset + 2] = 0;
        rawData[pixelOffset + 3] = 0;
      }
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressedData);

  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(8 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);

  const crc = crc32(chunk.subarray(4, 8 + len));
  chunk.writeUInt32BE(crc >>> 0, 8 + len);
  return chunk;
}

// Simple CRC32 table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF);
}

const outDir = path.resolve('public/icons');
fs.mkdirSync(outDir, { recursive: true });

// Handsfree cyan/blue colors: rgb(37, 99, 235) to cyan(6, 182, 212)
fs.writeFileSync(path.join(outDir, 'icon-16.png'), createPNG(16, 16, 37, 99, 235));
fs.writeFileSync(path.join(outDir, 'icon-48.png'), createPNG(48, 48, 37, 99, 235));
fs.writeFileSync(path.join(outDir, 'icon-128.png'), createPNG(128, 128, 37, 99, 235));

console.log('Successfully generated icon-16.png, icon-48.png, icon-128.png in public/icons/');
