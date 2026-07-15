'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { Worker } = require('worker_threads');

const { loadConfig } = require('./lib/config-loader');
const { sendJson, sendText, parseReqUrl, readBody } = require('./lib/http-utils');
const { safeFileName, ensureSafePath, makeJobId } = require('./lib/common');
const { writePngGray8, readPngGray8 } = require('./lib/png-codec');
const { buildStegFrame, buildStgmFrame, decodeFrameFromPixels, makeCarrierImage } = require('./lib/stego');

const ROOT_DIR = __dirname;
const HTML_PATH = path.join(ROOT_DIR, 'index.html');
const DEFAULT_JOBS_ROOT = path.join(ROOT_DIR, '.jobs');
const ENCODE_WORKER_PATH = path.join(ROOT_DIR, 'lib', 'encode-chunk-worker.js');

const progressStreams = new Map();
const progressSnapshot = new Map();

let CONFIG;
try {
  CONFIG = loadConfig();
} catch (err) {
  console.error('读取 config.js 失败：' + err.message);
  process.exit(1);
}

function createJobDir(jobsRoot) {
  const jobId = makeJobId();
  const dir = path.join(jobsRoot, jobId);
  fs.mkdirSync(dir, { recursive: true });
  return { jobId, dir };
}

function getParallelWorkerCount(totalChunks) {
  const cpuCount = (typeof os.availableParallelism === 'function')
    ? os.availableParallelism()
    : ((os.cpus() && os.cpus().length) || 1);

  const configured = CONFIG.MAX_WORKERS > 0 ? Math.floor(CONFIG.MAX_WORKERS) : cpuCount;
  const upperBound = Math.max(1, cpuCount * 2);
  return Math.max(1, Math.min(totalChunks, configured, upperBound));
}

async function encodeChunksInParallel(job, body, chunkSize, totalChunks, mime, fileName, taskId) {
  const base = safeFileName(path.parse(fileName).name);
  const files = new Array(totalChunks);
  const workerCount = getParallelWorkerCount(totalChunks);

  let finished = 0;
  let nextChunkIndex = 0;
  let stopped = false;

  return await new Promise((resolve, reject) => {
    const workers = [];

    function terminateAll() {
      for (const worker of workers) {
        worker.terminate().catch(() => {});
      }
    }

    function fail(err) {
      if (stopped) return;
      stopped = true;
      terminateAll();
      reject(err instanceof Error ? err : new Error(String(err || '并行处理失败')));
    }

    function maybeDone() {
      if (stopped) return;
      if (finished !== totalChunks) return;

      stopped = true;
      terminateAll();
      resolve(files);
    }

    function dispatch(worker) {
      if (stopped) return;
      const chunkIndex = nextChunkIndex;
      if (chunkIndex >= totalChunks) {
        maybeDone();
        return;
      }

      nextChunkIndex += 1;

      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, body.length);
      const chunk = Buffer.from(body.subarray(start, end));
      worker.postMessage({
        type: 'encode',
        chunkIndex,
        totalChunks,
        mime,
        fileName,
        chunk,
      });
    }

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(ENCODE_WORKER_PATH);
      workers.push(worker);

      worker.on('message', async (msg) => {
        if (stopped) return;
        if (!msg || typeof msg !== 'object') {
          fail(new Error('Worker 返回了无效消息'));
          return;
        }

        if (msg.type === 'error') {
          fail(new Error(msg.message || '分片编码失败'));
          return;
        }

        if (msg.type !== 'result') {
          fail(new Error('Worker 返回了未知消息类型'));
          return;
        }

        const chunkIndex = Number(msg.chunkIndex);
        if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= totalChunks) {
          fail(new Error('Worker 返回的分片索引非法'));
          return;
        }

        const outName = totalChunks > 1 ? `${base}_${chunkIndex + 1}of${totalChunks}.png` : `${base}.png`;
        const outPath = path.join(job.dir, outName);
        const pngBuffer = Buffer.isBuffer(msg.png) ? msg.png : Buffer.from(msg.png || []);

        try {
          await fs.promises.writeFile(outPath, pngBuffer);
        } catch (err) {
          fail(err);
          return;
        }

        files[chunkIndex] = {
          name: outName,
          url: '/api/download/' + encodeURIComponent(job.jobId) + '/' + encodeURIComponent(outName),
          width: Number(msg.width) || 0,
          height: Number(msg.height) || 0,
          size: Number(msg.size) || pngBuffer.length,
          chunkIndex,
          totalChunks,
        };

        finished += 1;
        writeProgress(taskId, {
          stage: 'process',
          current: finished,
          total: totalChunks,
          percent: (finished / totalChunks) * 100,
          message: `分片处理中 ${finished}/${totalChunks}`,
        });

        dispatch(worker);
      });

      worker.on('error', (err) => fail(err));

      worker.on('exit', (code) => {
        if (!stopped && code !== 0) {
          fail(new Error('Worker 异常退出，退出码：' + code));
        }
      });

      dispatch(worker);
    }
  });
}

function isValidTaskId(taskId) {
  return typeof taskId === 'string' && /^[a-zA-Z0-9_-]{6,64}$/.test(taskId);
}

function writeProgress(taskId, payload) {
  if (!isValidTaskId(taskId)) return;

  const normalized = {
    ts: Date.now(),
    ...payload,
  };
  progressSnapshot.set(taskId, normalized);

  const clients = progressStreams.get(taskId);
  if (!clients || clients.size === 0) return;

  const line = `data: ${JSON.stringify(normalized)}\n\n`;
  for (const client of clients) {
    client.write(line);
  }
}

function openUrlInBrowser(url) {
  const cmds = {
    win32: `start "" "${url}"`,
    darwin: `open "${url}"`,
    linux: `xdg-open "${url}"`,
  };
  const cmd = cmds[process.platform] || cmds.linux;
  exec(cmd, (err) => {
    if (err) console.log('请手动在浏览器中打开：' + url);
  });
}

function openProgressStream(taskId, res) {
  if (!isValidTaskId(taskId)) {
    sendJson(res, 400, { error: 'taskId 非法' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  let set = progressStreams.get(taskId);
  if (!set) {
    set = new Set();
    progressStreams.set(taskId, set);
  }
  set.add(res);

  if (progressSnapshot.has(taskId)) {
    res.write(`data: ${JSON.stringify(progressSnapshot.get(taskId))}\n\n`);
  }
}

function closeProgressStream(taskId, res) {
  const set = progressStreams.get(taskId);
  if (!set) return;

  set.delete(res);
  if (set.size === 0) {
    progressStreams.delete(taskId);
  }
}

function serveIndex(res) {
  fs.readFile(HTML_PATH, (err, data) => {
    if (err) {
      sendText(res, 500, '读取 index.html 失败：' + err.message);
      return;
    }
    const configForClient = {
      PREVIEW_CHARS: CONFIG.PREVIEW_CHARS,
      CHUNK_SIZE_BYTES: CONFIG.CHUNK_SIZE_BYTES,
      DOWNLOAD_BATCH_SIZE: CONFIG.DOWNLOAD_BATCH_SIZE,
      MAX_UPLOAD_BYTES: CONFIG.MAX_UPLOAD_BYTES,
    };
    const injectScript = '<script>window.__APP_CONFIG__=' + JSON.stringify(configForClient) + ';</script>';
    const html = data.toString('utf8').replace('</head>', injectScript + '\n</head>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
}

async function handleEncodeText(req, res, jobsRoot) {
  const body = await readBody(req, CONFIG.MAX_UPLOAD_BYTES);
  let obj;
  try {
    obj = JSON.parse(body.toString('utf8') || '{}');
  } catch (_e) {
    sendJson(res, 400, { error: 'JSON 格式错误' });
    return;
  }

  const text = String(obj.text || '');
  if (!text.trim()) {
    sendJson(res, 400, { error: 'text 不能为空' });
    return;
  }

  const frame = buildStegFrame(text);
  const carrier = makeCarrierImage(frame);
  const png = writePngGray8(carrier.width, carrier.height, carrier.gray);

  const job = createJobDir(jobsRoot);
  const preview = Array.from(text).slice(0, CONFIG.PREVIEW_CHARS).join('');
  const outName = safeFileName(preview || 'text') + '.png';
  fs.writeFileSync(path.join(job.dir, outName), png);

  sendJson(res, 200, {
    ok: true,
    jobId: job.jobId,
    files: [{
      name: outName,
      url: '/api/download/' + encodeURIComponent(job.jobId) + '/' + encodeURIComponent(outName),
      width: carrier.width,
      height: carrier.height,
      size: png.length,
    }],
  });
}

async function handleEncodeFile(req, res, jobsRoot) {
  const taskIdHeader = req.headers['x-task-id'];
  const taskId = isValidTaskId(taskIdHeader) ? taskIdHeader : null;

  let rawFileName = 'file.bin';
  const b64Header = req.headers['x-file-name-b64'];
  if (typeof b64Header === 'string' && b64Header.trim()) {
    try {
      rawFileName = Buffer.from(b64Header, 'base64').toString('utf8') || 'file.bin';
    } catch (_e) {
      rawFileName = 'file.bin';
    }
  } else if (typeof req.headers['x-file-name'] === 'string' && req.headers['x-file-name'].trim()) {
    rawFileName = req.headers['x-file-name'];
  }

  const fileName = safeFileName(rawFileName);
  const mime = (typeof req.headers['x-mime-type'] === 'string' && req.headers['x-mime-type'].trim())
    ? req.headers['x-mime-type'].trim()
    : 'application/octet-stream';

  const body = await readBody(req, CONFIG.MAX_UPLOAD_BYTES);
  if (!body.length) {
    writeProgress(taskId, { stage: 'error', message: '文件内容为空' });
    sendJson(res, 400, { error: '文件内容为空' });
    return;
  }

  writeProgress(taskId, { stage: 'upload', percent: 100, loaded: body.length, total: body.length });

  const chunkSize = CONFIG.CHUNK_SIZE_BYTES;
  const totalChunks = Math.max(1, Math.ceil(body.length / chunkSize));
  const job = createJobDir(jobsRoot);
  writeProgress(taskId, {
    stage: 'process',
    current: 0,
    total: totalChunks,
    percent: 0,
    message: `已启动并行处理（${getParallelWorkerCount(totalChunks)} 线程）`,
  });

  const files = await encodeChunksInParallel(job, body, chunkSize, totalChunks, mime, fileName, taskId);

  writeProgress(taskId, {
    stage: 'done',
    percent: 100,
    total: totalChunks,
    message: '处理完成',
  });

  sendJson(res, 200, { ok: true, jobId: job.jobId, fileName, mime, totalChunks, files });
}

async function handleDecodeImage(req, res) {
  const body = await readBody(req, CONFIG.MAX_UPLOAD_BYTES);
  if (!body.length) {
    sendJson(res, 400, { error: 'PNG 内容为空' });
    return;
  }

  let png;
  try {
    png = readPngGray8(body);
  } catch (err) {
    sendJson(res, 400, { error: 'PNG 解析失败', detail: err.message });
    return;
  }

  try {
    const decoded = decodeFrameFromPixels(png.gray, png.width, png.height);
    if (decoded.format === 'STEG') {
      sendJson(res, 200, { ok: true, format: 'STEG', text: decoded.text });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      format: 'STGM',
      flags: decoded.flags,
      chunkIndex: decoded.chunkIndex,
      totalChunks: decoded.totalChunks,
      mime: decoded.mime,
      fileName: decoded.fileName,
      data: decoded.data.toString('base64'),
    });
  } catch (err) {
    sendJson(res, 400, { error: '隐写帧解析失败', detail: err.message });
  }
}

function handleDownload(res, pathname, jobsRoot) {
  const m = pathname.match(/^\/api\/download\/([^/]+)\/([^/]+)$/);
  if (!m) {
    sendJson(res, 404, { error: 'Not Found' });
    return;
  }

  const jobId = decodeURIComponent(m[1]);
  const safeName = safeFileName(decodeURIComponent(m[2]));
  if (!/^[a-z0-9]+$/i.test(jobId)) {
    sendJson(res, 400, { error: 'jobId 非法' });
    return;
  }

  const abs = path.join(jobsRoot, jobId, safeName);
  if (!ensureSafePath(jobsRoot, abs)) {
    sendJson(res, 400, { error: '路径非法' });
    return;
  }

  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) {
      sendJson(res, 404, { error: '文件不存在' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': String(st.size),
      'Content-Disposition': 'attachment; filename="' + encodeURIComponent(safeName) + '"',
    });
    fs.createReadStream(abs).pipe(res);
  });
}

function createRequestHandler(jobsRoot) {
  return async (req, res) => {
    const method = req.method || 'GET';
    const pathname = parseReqUrl(req).pathname;

    let trackedTaskId = null;
    const taskIdHeader = req.headers['x-task-id'];
    if (isValidTaskId(taskIdHeader)) trackedTaskId = taskIdHeader;

    req.on('close', () => {
      if (trackedTaskId && method === 'GET' && pathname.startsWith('/api/progress/')) {
        closeProgressStream(trackedTaskId, res);
      }
    });

    try {
      if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        serveIndex(res);
        return;
      }

      if (method === 'GET' && pathname === '/api/config') {
        sendJson(res, 200, {
          PORT: CONFIG.PORT,
          PREVIEW_CHARS: CONFIG.PREVIEW_CHARS,
          CHUNK_SIZE_BYTES: CONFIG.CHUNK_SIZE_BYTES,
          DOWNLOAD_BATCH_SIZE: CONFIG.DOWNLOAD_BATCH_SIZE,
          MAX_UPLOAD_BYTES: CONFIG.MAX_UPLOAD_BYTES,
          MAX_WORKERS: CONFIG.MAX_WORKERS,
        });
        return;
      }

      if (method === 'GET' && pathname.startsWith('/api/progress/')) {
        const m = pathname.match(/^\/api\/progress\/([^/]+)$/);
        const taskId = m ? decodeURIComponent(m[1]) : null;
        trackedTaskId = taskId;
        openProgressStream(taskId, res);
        return;
      }

      if (method === 'GET' && pathname.startsWith('/api/download/')) {
        handleDownload(res, pathname, jobsRoot);
        return;
      }

      if (method === 'POST' && pathname === '/api/encode-text') {
        await handleEncodeText(req, res, jobsRoot);
        return;
      }

      if (method === 'POST' && pathname === '/api/encode-file') {
        await handleEncodeFile(req, res, jobsRoot);
        return;
      }

      if (method === 'POST' && pathname === '/api/decode-image') {
        await handleDecodeImage(req, res);
        return;
      }

      sendJson(res, 404, { error: 'Not Found' });
    } catch (err) {
      if (trackedTaskId) {
        writeProgress(trackedTaskId, { stage: 'error', message: err.message || '服务器错误' });
      }
      if (err && err.message === 'PAYLOAD_TOO_LARGE') {
        sendJson(res, 413, {
          error: '请求体过大',
          code: 'PAYLOAD_TOO_LARGE',
          maxBytes: CONFIG.MAX_UPLOAD_BYTES,
        });
        return;
      }
      sendJson(res, 500, { error: '服务器错误', detail: err.message });
    }
  };
}

function startServer(options = {}) {
  const openBrowser = Boolean(options.openBrowser);
  const jobsRoot = options.jobsRoot || DEFAULT_JOBS_ROOT;

  fs.mkdirSync(jobsRoot, { recursive: true });

  const server = http.createServer(createRequestHandler(jobsRoot));

  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error('\n端口 ' + CONFIG.PORT + ' 已被占用，请关闭占用该端口的程序后重试\n');
      } else {
        console.error('服务器启动失败：', err.message);
      }
      reject(err);
    });

    server.listen(CONFIG.PORT, '127.0.0.1', () => {
      const url = 'http://localhost:' + CONFIG.PORT;
      console.log('');
      console.log('  ┌────────────────────────────────────┐');
      console.log('  │        图片转换服务已启动          │');
      console.log('  │  地址：' + url + '       │');
      console.log('  │  按 Ctrl+C 可停止服务              │');
      console.log('  └────────────────────────────────────┘');
      console.log('');

      if (openBrowser) {
        openUrlInBrowser(url);
      }

      resolve({ server, url });
    });
  });
}

if (require.main === module) {
  startServer({ openBrowser: true }).catch(() => process.exit(1));
}

module.exports = { startServer };
