# data-in-png

> 将文本和文件编码进 PNG 图片的 Electron 桌面应用

利用 PNG 灰度图像的最低有效位（LSB）像素隐写，把任意文本或文件“藏”进一张看起来普通的 PNG 图片里，也可以从这样的图片中还原出原始内容。

![icon](src/assets/icon.png)

---

## 功能特性

- **文本隐写**：输入一段文本，一键生成包含该文本的 PNG 图片。
- **文件隐写**：选择任意文件，将其编码为一张或多张 PNG 图片；大文件会自动分片。
- **图片还原**：上传隐写图片，自动识别并还原出文本或原始文件。
- **本地运行**：内置 HTTP 服务 + Electron 窗口，无需联网，数据不出本机。
- **并行处理**：文件分片编码使用 Worker 线程并行执行，充分利用多核 CPU。
- **跨平台**：支持 Windows（便携版 `.exe`）和 Linux（AppImage）。

---

## 下载与安装

### Windows

```bash
npm run build-client:win-x64
```

打包产物：`dist/data-in-png-1.0.0-win-x64.exe`（便携版，双击即可运行）。

### Linux

```bash
npm run build-client:linux-x64
# 或 ARM64
npm run build-client:linux-arm64
```

打包产物：`dist/data-in-png-1.0.0-linux-x86_64.AppImage`。

---

## 开发运行

### 环境要求

- Node.js ≥ 18
- npm

### 安装依赖

```bash
npm install
```

### 启动桌面应用

```bash
npm start
# 或
npm run client:dev
```

### 仅启动后端服务

```bash
npm run server
```

服务默认监听 `http://localhost:3000`，可直接用浏览器访问。

---

## 构建命令

| 命令 | 说明 |
|------|------|
| `npm run build-client` | 构建当前平台默认产物（Windows x64 便携版） |
| `npm run build-client:win-x64` | Windows x64 便携版 |
| `npm run build-client:linux-x64` | Linux x64 AppImage |
| `npm run build-client:linux-arm64` | Linux ARM64 AppImage |
| `npm run pack` | 只生成未打包的目录，便于调试 |

所有产物输出到 `dist/` 目录。

---

## 配置说明

应用配置位于 `src/config.js`，可在打包前修改：

```js
module.exports = {
  PORT: 3000,                    // 本地服务端口
  PREVIEW_CHARS: 20,             // 文本生成文件名时截取的字符数
  CHUNK_SIZE_BYTES: 19 * 1024 * 1024, // 文件分片阈值（19 MB）
  DOWNLOAD_BATCH_SIZE: 0,        // 自动下载分批数量，0 表示不节流
  MAX_UPLOAD_BYTES: 300 * 1024 * 1024, // 单次请求最大 300 MB
  MAX_WORKERS: 0,                // 并行线程数，0 表示按 CPU 核心自动
};
```

---

## 项目结构

```
data-in-png/
├── main.js                 # Electron 主进程入口
├── package.json
├── src/
│   ├── assets/             # 应用图标
│   │   ├── icon.ico
│   │   └── icon.png
│   ├── config.js           # 应用配置
│   ├── index.html          # 前端页面
│   ├── server.js           # HTTP 服务与 API
│   └── lib/
│       ├── common.js       # 通用工具函数
│       ├── config-loader.js
│       ├── crc32.js        # CRC32 校验
│       ├── encode-chunk-worker.js  # 分片编码 Worker
│       ├── http-utils.js
│       ├── png-codec.js    # 自定义 PNG 编解码
│       └── stego.js        # 隐写帧构建与解析
└── dist/                   # 打包输出目录
```

---

## 技术原理

1. **帧格式**：
   - `STEG` 帧：用于存储文本，包含魔数、长度、UTF-8 文本、CRC32 校验。
   - `STGM` 帧：用于存储文件分片，包含魔数、分片索引、总分片数、MIME 类型、文件名、数据及多层 CRC32 校验。

2. **载体图像**：根据帧大小生成最小正方形灰度图（8 bit/像素），一像素对应一字节。

3. **PNG 编码**：使用自定义的灰度 PNG 编码器生成标准 PNG 文件。

4. **并行分片**：文件超过 `CHUNK_SIZE_BYTES` 时拆分为多个 `STGM` 帧，由 Worker 线程池并行编码。

---

## 注意事项

- 便携版（portable）每次运行会先将自身解压到临时目录，首次启动速度受磁盘性能影响；如需秒开，可直接运行 `dist/win-unpacked/data-in-png.exe`，或使用安装版目标。
- 解码时请上传原始生成的 PNG 图片，经过有损压缩或格式转换的图片将无法还原。

---

## 许可证

MIT
