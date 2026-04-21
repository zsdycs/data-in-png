'use strict';

const { crc32 } = require('./crc32');
const { safeFileName } = require('./common');

const MAGIC_STEG = Buffer.from('STEG');
const MAGIC_STGM = Buffer.from('STGM');

function encodeBitsIntoPixels(rgba, frameBytes) {
  const bits = frameBytes.length * 8;
  const capacityBits = Math.floor(rgba.length / 4) * 3;
  if (bits > capacityBits) throw new Error('像素容量不足');

  for (let byteIdx = 0; byteIdx < frameBytes.length; byteIdx++) {
    const byte = frameBytes[byteIdx];
    for (let bit = 0; bit < 8; bit++) {
      const b = (byte >>> (7 - bit)) & 1;
      const totalBit = byteIdx * 8 + bit;
      const pixelIdx = Math.floor(totalBit / 3);
      const ch = totalBit % 3;
      const i = pixelIdx * 4 + ch;
      rgba[i] = (rgba[i] & 0xFE) | b;
    }
  }
}

function readBytesFromPixels(rgba, totalPixels, startByte, count) {
  const out = Buffer.alloc(count);
  for (let bIdx = 0; bIdx < count; bIdx++) {
    let val = 0;
    for (let bit = 0; bit < 8; bit++) {
      const totalBit = (startByte + bIdx) * 8 + bit;
      const pixelIdx = Math.floor(totalBit / 3);
      if (pixelIdx >= totalPixels) throw new Error('OVERFLOW');
      const ch = totalBit % 3;
      val = ((val << 1) | (rgba[pixelIdx * 4 + ch] & 1)) & 0xFF;
    }
    out[bIdx] = val;
  }
  return out;
}

function buildStegFrame(text) {
  const textBytes = Buffer.from(String(text), 'utf8');
  const n = textBytes.length;
  const frame = Buffer.alloc(12 + n);
  MAGIC_STEG.copy(frame, 0);
  frame.writeUInt32BE(n >>> 0, 4);
  textBytes.copy(frame, 8);
  frame.writeUInt32BE(crc32(textBytes), 8 + n);
  return frame;
}

function buildStgmFrame(chunkBytes, chunkIndex, totalChunks, mime, fileName) {
  const mimeBuf = Buffer.from(String(mime || 'application/octet-stream'), 'utf8');
  const nameBuf = Buffer.from(safeFileName(fileName), 'utf8');
  if (mimeBuf.length > 255) throw new Error('MIME 过长');
  if (nameBuf.length > 65535) throw new Error('文件名过长');

  const flags = totalChunks > 1 ? 1 : 0;
  const chunkCRC = crc32(chunkBytes);
  const dataStart = 20 + mimeBuf.length + nameBuf.length;

  const frameNoCRC = Buffer.alloc(dataStart + chunkBytes.length);
  MAGIC_STGM.copy(frameNoCRC, 0);
  frameNoCRC[4] = flags;
  frameNoCRC.writeUInt16BE(chunkIndex & 0xFFFF, 5);
  frameNoCRC.writeUInt16BE(totalChunks & 0xFFFF, 7);
  frameNoCRC.writeUInt32BE(chunkCRC >>> 0, 9);
  frameNoCRC[13] = mimeBuf.length & 0xFF;
  mimeBuf.copy(frameNoCRC, 14);
  frameNoCRC.writeUInt16BE(nameBuf.length & 0xFFFF, 14 + mimeBuf.length);
  nameBuf.copy(frameNoCRC, 16 + mimeBuf.length);
  frameNoCRC.writeUInt32BE(chunkBytes.length >>> 0, 16 + mimeBuf.length + nameBuf.length);
  chunkBytes.copy(frameNoCRC, dataStart);

  const frame = Buffer.alloc(frameNoCRC.length + 4);
  frameNoCRC.copy(frame, 0);
  frame.writeUInt32BE(crc32(frameNoCRC), frameNoCRC.length);
  return frame;
}

function decodeFrameFromPixels(rgba, width, height) {
  const totalPixels = width * height;
  const magic = readBytesFromPixels(rgba, totalPixels, 0, 4);

  const isSTEG = magic.equals(MAGIC_STEG);
  const isSTGM = magic.equals(MAGIC_STGM);
  if (!isSTEG && !isSTGM) throw new Error('MAGIC_FAIL');

  if (isSTEG) {
    const n = readBytesFromPixels(rgba, totalPixels, 4, 4).readUInt32BE(0);
    if (Math.ceil((12 + n) * 8 / 3) > totalPixels) throw new Error('OVERFLOW');
    const textBytes = readBytesFromPixels(rgba, totalPixels, 8, n);
    const stored = readBytesFromPixels(rgba, totalPixels, 8 + n, 4).readUInt32BE(0);
    if ((stored >>> 0) !== (crc32(textBytes) >>> 0)) throw new Error('CRC_FAIL');
    return { format: 'STEG', text: textBytes.toString('utf8') };
  }

  const hdr = readBytesFromPixels(rgba, totalPixels, 4, 9);
  const flags = hdr[0];
  const chunkIndex = hdr.readUInt16BE(1);
  const totalChunks = hdr.readUInt16BE(3);
  const chunkCRC = hdr.readUInt32BE(5);

  const mimeLen = readBytesFromPixels(rgba, totalPixels, 13, 1)[0];
  const mimeBuf = readBytesFromPixels(rgba, totalPixels, 14, mimeLen);
  const mime = mimeBuf.toString('utf8');

  const nameLen = readBytesFromPixels(rgba, totalPixels, 14 + mimeLen, 2).readUInt16BE(0);
  const nameBuf = readBytesFromPixels(rgba, totalPixels, 16 + mimeLen, nameLen);
  const fileName = nameBuf.toString('utf8');

  const dataLen = readBytesFromPixels(rgba, totalPixels, 16 + mimeLen + nameLen, 4).readUInt32BE(0);
  const dataStart = 20 + mimeLen + nameLen;
  if (Math.ceil((dataStart + dataLen + 4) * 8 / 3) > totalPixels) throw new Error('OVERFLOW');

  const data = readBytesFromPixels(rgba, totalPixels, dataStart, dataLen);
  if ((chunkCRC >>> 0) !== (crc32(data) >>> 0)) throw new Error('CHUNK_CRC_FAIL');

  const storedFrameCRC = readBytesFromPixels(rgba, totalPixels, dataStart + dataLen, 4).readUInt32BE(0);
  const frameNoCRC = Buffer.alloc(dataStart + dataLen);
  MAGIC_STGM.copy(frameNoCRC, 0);
  frameNoCRC[4] = flags;
  frameNoCRC.writeUInt16BE(chunkIndex, 5);
  frameNoCRC.writeUInt16BE(totalChunks, 7);
  frameNoCRC.writeUInt32BE(chunkCRC >>> 0, 9);
  frameNoCRC[13] = mimeLen;
  mimeBuf.copy(frameNoCRC, 14);
  frameNoCRC.writeUInt16BE(nameLen, 14 + mimeLen);
  nameBuf.copy(frameNoCRC, 16 + mimeLen);
  frameNoCRC.writeUInt32BE(dataLen >>> 0, 16 + mimeLen + nameLen);
  data.copy(frameNoCRC, dataStart);
  if ((storedFrameCRC >>> 0) !== (crc32(frameNoCRC) >>> 0)) throw new Error('FRAME_CRC_FAIL');

  return { format: 'STGM', flags, chunkIndex, totalChunks, mime, fileName, data };
}

function makeCarrierImage(frameBytes) {
  const bits = frameBytes.length * 8;
  const pixelsNeeded = Math.ceil((bits / 3) * 1.1);
  const side = Math.max(200, Math.ceil(Math.sqrt(pixelsNeeded)) + 10);

  const rgba = Buffer.alloc(side * side * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = Math.floor(Math.random() * 256);
    rgba[i + 1] = Math.floor(Math.random() * 256);
    rgba[i + 2] = Math.floor(Math.random() * 256);
    rgba[i + 3] = 255;
  }

  encodeBitsIntoPixels(rgba, frameBytes);
  return { width: side, height: side, rgba };
}

module.exports = {
  buildStegFrame,
  buildStgmFrame,
  decodeFrameFromPixels,
  makeCarrierImage,
};
