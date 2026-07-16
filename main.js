'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { startServer } = require('./src/server');

const WINDOW_WIDTH = 640;
const WINDOW_HEIGHT = 580;

let serverInstance = null;
let serverUrl = null;
let mainWindow = null;

function loadingPageHtml(message) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      color: #475569;
    }
    .wrap { text-align: center; }
    .spinner {
      width: 32px; height: 32px;
      margin: 0 auto 16px;
      border: 3px solid #cbd5e1;
      border-top-color: #4f6bed;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="spinner"></div>
    <div>${message}</div>
  </div>
</body>
</html>`;
  return 'data:text/html;base64,' + Buffer.from(html).toString('base64');
}

function errorPageHtml(message) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #fff1f2;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      color: #9f1239;
      text-align: center;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div>启动失败：${message}<br>请关闭后重试</div>
</body>
</html>`;
  return 'data:text/html;base64,' + Buffer.from(html).toString('base64');
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 540,
    minHeight: 480,
    backgroundColor: '#f1f5f9',
    title: '图片转换',
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'src', 'preload.js'),
    },
  });

  win.setMenu(null);
  win.on('closed', () => {
    mainWindow = null;
  });

  win.webContents.on('will-download', (event, item) => {
    const savePath = uniqueSavePath(app.getPath('downloads'), item.getFilename());
    item.setSavePath(savePath);
  });

  return win;
}

function safeFileName(name) {
  const src = String(name || '').trim();
  const cleaned = src.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned || 'file';
}

function uniqueSavePath(dir, name) {
  const base = safeFileName(name);
  let candidate = path.join(dir, base);
  if (!fs.existsSync(candidate)) return candidate;

  const ext = path.extname(base);
  const stem = path.basename(base, ext);
  let index = 1;
  do {
    candidate = path.join(dir, `${stem} (${index})${ext}`);
    index += 1;
  } while (fs.existsSync(candidate));
  return candidate;
}

function downloadToFile(url, savePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(savePath);
    http.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close((err) => (err ? reject(err) : resolve(savePath))));
    }).on('error', reject);
    file.on('error', reject);
  });
}

async function downloadFilesViaMain(files) {
  if (!serverUrl) throw new Error('服务尚未启动');
  const downloadDir = app.getPath('downloads');
  const saved = [];
  const total = files.length;

  for (let i = 0; i < total; i++) {
    const f = files[i];
    const url = new URL(f.url, serverUrl).toString();
    const savePath = uniqueSavePath(downloadDir, f.name);
    await downloadToFile(url, savePath);
    saved.push(savePath);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', {
        done: i + 1,
        total,
        file: f.name,
      });
    }
  }

  return saved;
}

function registerIpcHandlers() {
  ipcMain.handle('download-files', async (_event, files) => {
    try {
      const saved = await downloadFilesViaMain(files);
      return { ok: true, saved, dir: app.getPath('downloads') };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

async function bootstrap() {
  mainWindow = createMainWindow();
  mainWindow.loadURL(loadingPageHtml('正在启动服务…'));
  registerIpcHandlers();

  try {
    const jobsRoot = path.join(app.getPath('userData'), 'jobs');
    const result = await startServer({ openBrowser: false, jobsRoot });
    serverInstance = result.server;
    serverUrl = result.url;

    if (mainWindow) {
      mainWindow.loadURL(serverUrl);
    }
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error(message);
    if (mainWindow) {
      mainWindow.loadURL(errorPageHtml(message));
    }
  }
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverUrl) {
    mainWindow = createMainWindow();
    mainWindow.loadURL(serverUrl);
  }
});

app.on('before-quit', () => {
  if (serverInstance && serverInstance.listening) {
    serverInstance.close();
  }
});
