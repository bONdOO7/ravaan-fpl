/*
 * Tiny local server for the EFL Fund Tracker (plain Node, no packages needed).
 * Serves the app and writes every change the app makes into data.json.
 *
 *   node server.js      then open http://localhost:3000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function saveData(req, res) {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 5 * 1024 * 1024) req.destroy();
  });
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      if (!Array.isArray(data.players) || !Array.isArray(data.gameweeks)) throw new Error('not EFL data');
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n');
      res.writeHead(204).end();
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end(e.message);
    }
  });
}

function serveFile(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    return res.writeHead(400).end('Bad request');
  }
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  const type = TYPES[path.extname(file)];
  if (!type || path.relative(ROOT, file).startsWith('..')) return res.writeHead(404).end('Not found');
  fs.readFile(file, (err, buf) => {
    if (err) return res.writeHead(404).end('Not found');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(buf);
  });
}

http.createServer((req, res) => {
  if (req.method === 'PUT' && req.url === '/data.json') return saveData(req, res);
  if (req.method === 'GET') return serveFile(req, res);
  res.writeHead(405).end();
})
  .on('error', e => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use – is the tracker already running?` : e.message);
    process.exit(1);
  })
  // 127.0.0.1 = only this computer can open (and change) the data.
  .listen(PORT, '127.0.0.1', () => {
    console.log(`EFL Fund Tracker: http://localhost:${PORT}  (saving to ${DATA_FILE})`);
  });
