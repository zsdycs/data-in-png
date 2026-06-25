'use strict';

const path = require('path');
const { app, BrowserWindow } = require('electron');
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
    },
  });

  win.setMenu(null);
  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

async function bootstrap() {
  mainWindow = createMainWindow();
  mainWindow.loadURL(loadingPageHtml('正在启动服务…'));

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
