'use strict';

const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.js');

function loadConfig() {
  const cfg = require(CONFIG_PATH);
  const out = {
    PORT: Number(cfg.PORT || 3000),
    PREVIEW_CHARS: Number(cfg.PREVIEW_CHARS || 20),
    CHUNK_SIZE_BYTES: Number(cfg.CHUNK_SIZE_BYTES || (2 * 1024 * 1024)),
    DOWNLOAD_BATCH_SIZE: Number(cfg.DOWNLOAD_BATCH_SIZE ?? 3),
    MAX_UPLOAD_BYTES: Number(cfg.MAX_UPLOAD_BYTES || (300 * 1024 * 1024)),
    MAX_WORKERS: Number(cfg.MAX_WORKERS || 0),
  };

  if (!Number.isFinite(out.PORT) || out.PORT <= 0) throw new Error('PORT 非法');
  if (!Number.isFinite(out.PREVIEW_CHARS) || out.PREVIEW_CHARS <= 0) throw new Error('PREVIEW_CHARS 非法');
  if (!Number.isFinite(out.CHUNK_SIZE_BYTES) || out.CHUNK_SIZE_BYTES <= 0) throw new Error('CHUNK_SIZE_BYTES 非法');
  if (!Number.isFinite(out.DOWNLOAD_BATCH_SIZE) || out.DOWNLOAD_BATCH_SIZE < 0) throw new Error('DOWNLOAD_BATCH_SIZE 非法');
  if (!Number.isFinite(out.MAX_UPLOAD_BYTES) || out.MAX_UPLOAD_BYTES <= 0) throw new Error('MAX_UPLOAD_BYTES 非法');
  if (!Number.isFinite(out.MAX_WORKERS) || out.MAX_WORKERS < 0) throw new Error('MAX_WORKERS 非法');

  return out;
}

module.exports = { loadConfig };
