'use strict';

const { parentPort } = require('worker_threads');
const { writePngGray8 } = require('./png-codec');
const { buildStgmFrame, makeCarrierImage } = require('./stego');

if (!parentPort) {
  throw new Error('Worker must run in worker_threads context');
}

parentPort.on('message', (msg) => {
  if (!msg || msg.type !== 'encode') return;

  try {
    const chunkIndex = Number(msg.chunkIndex);
    const totalChunks = Number(msg.totalChunks);
    const mime = String(msg.mime || 'application/octet-stream');
    const fileName = String(msg.fileName || 'file.bin');
    const chunk = Buffer.isBuffer(msg.chunk) ? msg.chunk : Buffer.from(msg.chunk || []);

    const frame = buildStgmFrame(chunk, chunkIndex, totalChunks, mime, fileName);
    const carrier = makeCarrierImage(frame);
    const png = writePngGray8(carrier.width, carrier.height, carrier.gray);
    const pngBytes = new Uint8Array(png.buffer, png.byteOffset, png.byteLength);

    parentPort.postMessage({
      type: 'result',
      chunkIndex,
      width: carrier.width,
      height: carrier.height,
      size: png.length,
      png: pngBytes,
    }, [pngBytes.buffer]);
  } catch (err) {
    parentPort.postMessage({
      type: 'error',
      message: err && err.message ? err.message : '分片编码失败',
    });
  }
});
