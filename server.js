/*
 * Small server for the EFL Fund Tracker (plain Node, no packages needed).
 * Serves the app, writes every change the app makes into data.json, and
 * fetches FPL data for the app (browsers block pages from calling the FPL API directly).
 *
 *   npm start      then open http://localhost:3000
 *
 * Optional environment variables (see README → Put it online):
 *   PORT          port to listen on (default 3000; hosting services set it for you)
 *   EFL_PASSWORD  password for opening the app; without it only this computer can open it
 *   DATA_FILE     where the data is saved (default: data.json next to this file)
 *   HOST          address to listen on (default 127.0.0.1, or 0.0.0.0 when EFL_PASSWORD is set)
 */
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const PASSWORD = process.env.EFL_PASSWORD || '';
// Without a password the data must stay private, so the server only listens to this computer.
const HOST = process.env.HOST || (PASSWORD ? '0.0.0.0' : '127.0.0.1');
const SEED_FILE = path.join(ROOT, 'data.json');
const DATA_FILE = path.resolve(process.env.DATA_FILE || SEED_FILE);
const FPL_API = 'https://fantasy.premierleague.com/api/';
// Only the FPL endpoints the app uses can be reached through /fpl/.
const FPL_PATHS = /^(bootstrap-static|leagues-classic\/\d+\/standings|entry\/\d+\/history)\/$/;
// The only files handed out (not server.js, README, …). data.json has its own route.
const PUBLIC_FILES = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

// A new DATA_FILE (e.g. on a fresh persistent disk) starts as a copy of the data.json shipped with the app.
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
if (!fs.existsSync(DATA_FILE) && fs.existsSync(SEED_FILE)) fs.copyFileSync(SEED_FILE, DATA_FILE);

// With EFL_PASSWORD set, the browser asks for it once (any user name) and then remembers it.
function authorized(req) {
  if (!PASSWORD) return true;
  const [scheme, value] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !value) return false;
  const login = Buffer.from(value, 'base64').toString('utf8');
  const hash = s => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(hash(login.slice(login.indexOf(':') + 1)), hash(PASSWORD));
}

function sendData(res) {
  fs.readFile(DATA_FILE, (err, buf) => {
    if (err) return res.writeHead(404).end('No data yet');
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' }).end(buf);
  });
}

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
  let name;
  try {
    name = PUBLIC_FILES[new URL(req.url, 'http://localhost').pathname];
  } catch (e) {
    return res.writeHead(400).end('Bad request');
  }
  if (!name) return res.writeHead(404).end('Not found');
  fs.readFile(path.join(ROOT, name), (err, buf) => {
    if (err) return res.writeHead(404).end('Not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)], 'Cache-Control': 'no-store' }).end(buf);
  });
}

// GET /fpl/<path>?<query>  ->  https://fantasy.premierleague.com/api/<path>?<query>
function proxyFpl(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const apiPath = url.pathname.slice('/fpl/'.length);
  if (!FPL_PATHS.test(apiPath)) return res.writeHead(404).end('Not found');
  const upstream = https.get(FPL_API + apiPath + url.search, {
    headers: { 'User-Agent': 'Mozilla/5.0 (EFL Fund Tracker)', Accept: 'application/json' },
    timeout: 15000
  }, up => {
    res.writeHead(up.statusCode, { 'Content-Type': up.headers['content-type'] || 'text/plain', 'Cache-Control': 'no-store' });
    up.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('FPL did not answer in time')));
  upstream.on('error', e => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Could not reach FPL: ' + e.message);
  });
}

http.createServer((req, res) => {
  // For hosting services checking that the app is up; needs no password.
  if (req.url === '/healthz') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
  if (!authorized(req)) {
    return res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="EFL Fund Tracker", charset="UTF-8"',
      'Content-Type': 'text/plain'
    }).end('Password required');
  }
  if (req.method === 'PUT' && req.url === '/data.json') return saveData(req, res);
  if (req.method === 'GET' && req.url === '/data.json') return sendData(res);
  if (req.method === 'GET' && req.url.startsWith('/fpl/')) return proxyFpl(req, res);
  if (req.method === 'GET') return serveFile(req, res);
  res.writeHead(405).end();
})
  .on('error', e => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use – is the tracker already running?` : e.message);
    process.exit(1);
  })
  .listen(PORT, HOST, () => {
    console.log(`EFL Fund Tracker: http://localhost:${PORT}  (saving to ${DATA_FILE})`);
    if (PASSWORD) console.log(`Password protected, listening on ${HOST}.`);
    else if (HOST === '127.0.0.1') console.log('Only this computer can open it. To use it from other devices or host it online, set EFL_PASSWORD.');
    else console.log(`⚠ Listening on ${HOST} without EFL_PASSWORD: anyone who can reach this server can change the data.`);
  });
