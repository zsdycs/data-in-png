'use strict';

const zlib = require('zlib');
const { crc32 } = require('./crc32');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function makeChunk(type4, data) {
  const type = Buffer.from(type4, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length >>> 0, 0);
  const crcInput = Buffer.concat([type, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, type, data, crc]);
}

function writePngRgba8(width, height, rgba) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('PNG 尺寸非法');
  }
  if (rgba.length !== width * height * 4) {
    throw new Error('RGBA 数据长度不匹配');
  }

  const scanlineSize = 1 + width * 4;
  const raw = Buffer.alloc(scanlineSize * height);

  for (let y = 0; y < height; y++) {
    const rowRawOff = y * scanlineSize;
    const rowRgbaOff = y * width * 4;
    raw[rowRawOff] = 0;
    rgba.copy(raw, rowRawOff + 1, rowRgbaOff, rowRgbaOff + width * 4);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width >>> 0, 0);
  ihdr.writeUInt32BE(height >>> 0, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function readPngRgba8(pngBuf) {
  if (!Buffer.isBuffer(pngBuf) || pngBuf.length < 8) {
    throw new Error('PNG 数据为空');
  }
  if (!pngBuf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('PNG 签名非法');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let gotIHDR = false;
  const idats = [];

  while (offset + 12 <= pngBuf.length) {
    const len = pngBuf.readUInt32BE(offset);
    const type = pngBuf.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    const crcOff = dataEnd;

    if (crcOff + 4 > pngBuf.length) throw new Error('PNG chunk 越界');

    const data = pngBuf.subarray(dataStart, dataEnd);
    const storedCrc = pngBuf.readUInt32BE(crcOff);
    const calcCrc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
    if ((storedCrc >>> 0) !== (calcCrc >>> 0)) throw new Error('PNG chunk CRC 校验失败: ' + type);

    if (type === 'IHDR') {
      if (len !== 13) throw new Error('IHDR 长度非法');
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const compression = data[10];
      const filter = data[11];
      const interlace = data[12];

      if (bitDepth !== 8 || colorType !== 6) throw new Error('仅支持 RGBA8 PNG');
      if (compression !== 0 || filter !== 0 || interlace !== 0) throw new Error('仅支持标准无隔行 PNG');
      gotIHDR = true;
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset = crcOff + 4;
  }

  if (!gotIHDR) throw new Error('PNG 缺少 IHDR');
  if (!idats.length) throw new Error('PNG 缺少 IDAT');

  const raw = zlib.inflateSync(Buffer.concat(idats));
  const bpp = 4;
  const rowBytes = width * bpp;
  const scanlineSize = 1 + rowBytes;
  const expected = scanlineSize * height;
  if (raw.length !== expected) throw new Error('PNG 解压后长度异常');

  const rgba = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const rowIn = y * scanlineSize;
    const rowOut = y * rowBytes;
    const filterType = raw[rowIn];

    for (let x = 0; x < rowBytes; x++) {
      const cur = raw[rowIn + 1 + x];
      const left = (x >= bpp) ? rgba[rowOut + x - bpp] : 0;
      const up = (y > 0) ? rgba[rowOut - rowBytes + x] : 0;
      const upLeft = (y > 0 && x >= bpp) ? rgba[rowOut - rowBytes + x - bpp] : 0;

      let recon;
      if (filterType === 0) recon = cur;
      else if (filterType === 1) recon = (cur + left) & 0xFF;
      else if (filterType === 2) recon = (cur + up) & 0xFF;
      else if (filterType === 3) recon = (cur + Math.floor((left + up) / 2)) & 0xFF;
      else if (filterType === 4) recon = (cur + paethPredictor(left, up, upLeft)) & 0xFF;
      else throw new Error('不支持的 PNG 过滤器: ' + filterType);

      rgba[rowOut + x] = recon;
    }
  }

  return { width, height, rgba };
}

module.exports = {
  writePngRgba8,
  readPngRgba8,
};
