'use strict';

function sendJson(res, status, data) {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text) {
  const body = Buffer.from(String(text), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': String(body.length),
  });
  res.end(body);
}

function parseReqUrl(req) {
  return new URL(req.url || '/', 'http://127.0.0.1');
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let overflow = false;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        overflow = true;
        // 不再累积数据，也不销毁请求，以便服务端仍能返回 413 响应。
        return;
      }
      if (!overflow) chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflow) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

module.exports = {
  sendJson,
  sendText,
  parseReqUrl,
  readBody,
};
