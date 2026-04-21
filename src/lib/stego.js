'use strict';

const { crc32 } = require('./crc32');
const { safeFileName } = require('./common');

const MAGIC_STEG = Buffer.from('STEG');
const MAGIC_STGM = Buffer.from('STGM');

function encodeBytesIntoPixels(gray, frameBytes) {
  if (frameBytes.length > gray.length) throw new Error('像素容量不足');
  frameBytes.copy(gray, 0);
}

function readBytesFromPixels(gray, totalPixels, startByte, count) {
  if (startByte < 0 || count < 0 || startByte + count > totalPixels) throw new Error('OVERFLOW');
  return Buffer.from(gray.subarray(startByte, startByte + count));
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

function decodeFrameFromPixels(gray, width, height) {
  const totalPixels = width * height;
  const magic = readBytesFromPixels(gray, totalPixels, 0, 4);

  const isSTEG = magic.equals(MAGIC_STEG);
  const isSTGM = magic.equals(MAGIC_STGM);
  if (!isSTEG && !isSTGM) throw new Error('MAGIC_FAIL');

  if (isSTEG) {
    const n = readBytesFromPixels(gray, totalPixels, 4, 4).readUInt32BE(0);
    if (12 + n > totalPixels) throw new Error('OVERFLOW');
    const textBytes = readBytesFromPixels(gray, totalPixels, 8, n);
    const stored = readBytesFromPixels(gray, totalPixels, 8 + n, 4).readUInt32BE(0);
    if ((stored >>> 0) !== (crc32(textBytes) >>> 0)) throw new Error('CRC_FAIL');
    return { format: 'STEG', text: textBytes.toString('utf8') };
  }

  const hdr = readBytesFromPixels(gray, totalPixels, 4, 9);
  const flags = hdr[0];
  const chunkIndex = hdr.readUInt16BE(1);
  const totalChunks = hdr.readUInt16BE(3);
  const chunkCRC = hdr.readUInt32BE(5);

  const mimeLen = readBytesFromPixels(gray, totalPixels, 13, 1)[0];
  const mimeBuf = readBytesFromPixels(gray, totalPixels, 14, mimeLen);
  const mime = mimeBuf.toString('utf8');

  const nameLen = readBytesFromPixels(gray, totalPixels, 14 + mimeLen, 2).readUInt16BE(0);
  const nameBuf = readBytesFromPixels(gray, totalPixels, 16 + mimeLen, nameLen);
  const fileName = nameBuf.toString('utf8');

  const dataLen = readBytesFromPixels(gray, totalPixels, 16 + mimeLen + nameLen, 4).readUInt32BE(0);
  const dataStart = 20 + mimeLen + nameLen;
  if (dataStart + dataLen + 4 > totalPixels) throw new Error('OVERFLOW');

  const data = readBytesFromPixels(gray, totalPixels, dataStart, dataLen);
  if ((chunkCRC >>> 0) !== (crc32(data) >>> 0)) throw new Error('CHUNK_CRC_FAIL');

  const storedFrameCRC = readBytesFromPixels(gray, totalPixels, dataStart + dataLen, 4).readUInt32BE(0);
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
  const pixelsNeeded = Math.max(1, frameBytes.length);
  const side = Math.ceil(Math.sqrt(pixelsNeeded));

  const gray = Buffer.alloc(side * side);
  encodeBytesIntoPixels(gray, frameBytes);
  return { width: side, height: side, gray };
}

module.exports = {
  buildStegFrame,
  buildStgmFrame,
  decodeFrameFromPixels,
  makeCarrierImage,
};
