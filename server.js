/*
 * Small server for the EFL Fund Tracker (plain Node 18+, no packages needed).
 * Serves the app, saves every change the app makes, and fetches FPL data for the app
 * (browsers block pages from calling the FPL API directly).
 *
 *   npm start      then open http://localhost:3000
 *
 * Optional environment variables (see README → Put it online):
 *   PORT          port to listen on (default 3000; hosting services set it for you)
 *   EFL_PASSWORD  password for opening the app; without it only this computer can open it
 *   DATA_FILE     where the data is saved (default: data.json next to this file)
 *   GIST_ID       keep the data in this GitHub gist instead of DATA_FILE (for hosts without a disk);
 *   GITHUB_TOKEN    together with a GitHub token that is allowed to edit gists
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
const GIST_ID = process.env.GIST_ID || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GIST_FILE = 'data.json';
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

// Set by hosting services (Render, Fly.io, Heroku, Cloud Run, Railway). There, a missing password would
// otherwise only show up as "no open port" after a long wait, so stop straight away with the reason.
const HOSTED = ['RENDER', 'FLY_APP_NAME', 'DYNO', 'K_SERVICE', 'RAILWAY_ENVIRONMENT_NAME'].some(v => process.env[v]);
if (HOSTED && !PASSWORD && !process.env.HOST) {
  console.error('EFL_PASSWORD is not set. Online the app needs a password, otherwise anyone could change the data.\n' +
    'Add the environment variable EFL_PASSWORD in your hosting dashboard, then deploy again.');
  process.exit(1);
}
if (!GIST_ID !== !GITHUB_TOKEN) {
  console.error('To keep the data in a GitHub gist, set both GIST_ID and GITHUB_TOKEN (or neither, to use DATA_FILE).');
  process.exit(1);
}
if (HOSTED && !process.env.DATA_FILE && !GIST_ID) {
  console.warn('⚠ Data is saved inside the app folder, which most hosts wipe on every restart or deploy.\n' +
    '  Set DATA_FILE to a file on a persistent disk, or GIST_ID and GITHUB_TOKEN to keep it in a GitHub gist (see README → Put it online).');
}

/* ---------- Where the data is kept: { where, read() -> text or null, write(text) } ---------- */

function fileStorage() {
  // A new DATA_FILE (e.g. on a fresh persistent disk) starts as a copy of the data.json shipped with the app.
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE) && fs.existsSync(SEED_FILE)) fs.copyFileSync(SEED_FILE, DATA_FILE);
  return {
    where: DATA_FILE,
    read: () => fs.promises.readFile(DATA_FILE, 'utf8').catch(e => (e.code === 'ENOENT' ? null : Promise.reject(e))),
    write: text => fs.promises.writeFile(DATA_FILE, text)
  };
}

// For hosts without a persistent disk. Every save becomes a gist revision, so old versions can be restored.
// The data is read from GitHub once and then kept in memory (restart the server after editing the gist by hand).
function gistStorage() {
  const api = async (method, body) => {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method,
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'EFL Fund Tracker',
        'Content-Type': 'application/json'
      },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} ${(await res.text()).slice(0, 150)}`);
    return res.json();
  };
  let cache = null;
  return {
    where: `GitHub gist ${GIST_ID}`,
    async read() {
      if (cache != null) return cache;
      const file = (await api('GET')).files[GIST_FILE];
      if (file && file.truncated) throw new Error(`${GIST_FILE} in the gist is too big to read`);
      if (file) return (cache = file.content);
      console.log(`The gist has no ${GIST_FILE} yet, so the app starts from the app folder's copy; the first save adds it to the gist.`);
      return (cache = fs.existsSync(SEED_FILE) ? fs.readFileSync(SEED_FILE, 'utf8') : null);
    },
    async write(text) {
      await api('PATCH', { files: { [GIST_FILE]: { content: text } } });
      cache = text;
    }
  };
}

const storage = GIST_ID ? gistStorage() : fileStorage();
let saving = Promise.resolve(); // saves run one after another, in the order they arrive

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
  storage.read().then(text => {
    if (text == null) return res.writeHead(404).end('No data yet');
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' }).end(text);
  }, e => {
    console.error('Could not read the data:', e.message);
    res.writeHead(503, { 'Content-Type': 'text/plain' }).end('Could not read the data: ' + e.message);
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
    let text;
    try {
      const data = JSON.parse(body);
      if (!Array.isArray(data.players) || !Array.isArray(data.gameweeks)) throw new Error('not EFL data');
      text = JSON.stringify(data, null, 2) + '\n';
    } catch (e) {
      return res.writeHead(400, { 'Content-Type': 'text/plain' }).end(e.message);
    }
    // Reading first means stored data that couldn't be loaded (e.g. GitHub was down) is never overwritten.
    const job = saving.then(() => storage.read()).then(() => storage.write(text));
    saving = job.catch(() => {});
    job.then(() => res.writeHead(204).end(), e => {
      console.error('Could not save the data:', e.message);
      res.writeHead(503, { 'Content-Type': 'text/plain' }).end('Could not save the data: ' + e.message);
    });
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
    console.log(`EFL Fund Tracker: http://localhost:${PORT}  (saving to ${storage.where})`);
    if (PASSWORD) console.log(`Password protected, listening on ${HOST}.`);
    else if (HOST === '127.0.0.1') console.log('Only this computer can open it. To use it from other devices or host it online, set EFL_PASSWORD.');
    else console.log(`⚠ Listening on ${HOST} without EFL_PASSWORD: anyone who can reach this server can change the data.`);
    // Check the gist settings straight away, so a wrong GIST_ID or token shows up in the log.
    if (GIST_ID) {
      storage.read().then(() => console.log('Connected to the gist.'),
        e => console.error(`⚠ Could not read the gist: ${e.message}\n  Check GIST_ID and GITHUB_TOKEN (the token needs the "gist" permission).`));
    }
  });
