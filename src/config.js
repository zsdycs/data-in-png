'use strict';

/**
 * 应用配置（服务端启动时加载）
 * 所有单位均为字节，除非特别说明。
 */
module.exports = {
  /** HTTP 服务端口 */
  PORT: 3000,

  /** 预览文本字符数（用于文本生成文件名等场景） */
  PREVIEW_CHARS: 20,

  /** 文件分片阈值：超过该值自动分片（2 MB） */
  CHUNK_SIZE_BYTES: 2 * 1024 * 1024,

  /** 前端自动下载节流：每批触发下载的文件数量 */
  DOWNLOAD_BATCH_SIZE: 0,

  /** 单次请求体最大大小（300 MB） */
  MAX_UPLOAD_BYTES: 300 * 1024 * 1024,

  /**
   * 分片编码并行线程数（0 表示自动按 CPU 核心数）
   * 建议范围：CPU 核心数 ~ 2 倍核心数。
   */
  MAX_WORKERS: 0,
};
