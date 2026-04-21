'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const htmlPath = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];
  if (req.method !== 'GET' || (pathname !== '/' && pathname !== '/index.html')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  fs.readFile(htmlPath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('读取 index.html 失败：' + err.message);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n端口 ${PORT} 已被占用，请关闭占用该端口的程序后重试\n`);
  } else {
    console.error('服务器启动失败：', err.message);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('  ┌────────────────────────────────────┐');
  console.log('  │        图片转换服务已启动          │');
  console.log(`  │  地址：${url}       │`);
  console.log('  │  按 Ctrl+C 可停止服务              │');
  console.log('  └────────────────────────────────────┘');
  console.log('');

  const { exec } = require('child_process');
  const cmds = {
    win32: `start "" "${url}"`,
    darwin: `open "${url}"`,
    linux: `xdg-open "${url}"`,
  };
  const cmd = cmds[process.platform] || cmds.linux;
  exec(cmd, (err) => {
    if (err) console.log('请手动在浏览器中打开：' + url);
  });
});
