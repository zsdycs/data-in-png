'use strict';

/** 文件名清洗：移除系统非法字符，避免路径问题 */
function safeFileName(name) {
  const src = String(name || '').trim();
  const cleaned = src.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned || 'file';
}

/** 校验目标路径是否仍在 base 目录之下 */
function ensureSafePath(base, target) {
  const rel = require('path').relative(base, target);
  return !rel.startsWith('..') && !require('path').isAbsolute(rel);
}

function makeJobId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

module.exports = {
  safeFileName,
  ensureSafePath,
  makeJobId,
};
