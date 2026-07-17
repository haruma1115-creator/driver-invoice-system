// 依存パッケージなし(Node.js標準機能のみ)で動く超軽量Webフレームワーク。
// npm install が使えない/したくない環境でも `node server.js` だけで起動できるようにするため、
// Express風の最小限のAPI(app.get/post/put/delete, req.body/query/params, res.json/status など)を自前実装しています。
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function pathToRegex(pattern) {
  const paramNames = [];
  const regexStr = '^' + pattern.replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  }) + '$';
  return { regex: new RegExp(regexStr), paramNames };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function sign(value, secret) {
  const h = crypto.createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${h}`;
}

function unsign(signed, secret) {
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', secret).update(value).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return value;
}

function createApp() {
  const routes = []; // { method, regex, paramNames, handlers }
  let sessionSecret = null;
  let staticDirs = [];

  function addRoute(method, pattern, handlers) {
    const { regex, paramNames } = pathToRegex(pattern);
    routes.push({ method, regex, paramNames, handlers });
  }

  const app = {
    get: (p, ...h) => addRoute('GET', p, h),
    post: (p, ...h) => addRoute('POST', p, h),
    put: (p, ...h) => addRoute('PUT', p, h),
    delete: (p, ...h) => addRoute('DELETE', p, h),
    useSession: (secret) => { sessionSecret = secret; },
    useStatic: (dir) => { staticDirs.push(dir); },
    listen: (port, cb) => http.createServer(handleRequest).listen(port, cb)
  };

  function finalizeSessionCookie(req, res) {
    if (!sessionSecret) return;
    if (req.session === null) {
      res.setHeader('Set-Cookie', 'session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
      return;
    }
    const payload = Buffer.from(JSON.stringify(req.session || {})).toString('base64url');
    const signed = sign(payload, sessionSecret);
    res.setHeader('Set-Cookie', `session=${signed}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax`);
  }

  function attachResHelpers(req, res) {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => {
      finalizeSessionCookie(req, res);
      const body = JSON.stringify(obj);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(body);
    };
    res.html = (str) => {
      finalizeSessionCookie(req, res);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(str);
    };
    res.send = (str) => {
      finalizeSessionCookie(req, res);
      if (typeof str === 'object') return res.json(str);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(String(str));
    };
    res.redirect = (loc) => {
      finalizeSessionCookie(req, res);
      res.statusCode = 302;
      res.setHeader('Location', loc);
      res.end();
    };
  }

  function loadSession(req) {
    if (!sessionSecret) { req.session = {}; return; }
    const cookies = parseCookies(req.headers.cookie);
    const raw = cookies.session;
    if (!raw) { req.session = {}; return; }
    const payload = unsign(raw, sessionSecret);
    if (!payload) { req.session = {}; return; }
    try {
      req.session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch (e) {
      req.session = {};
    }
  }

  function safeStaticPath(dir, urlPath) {
    const decoded = decodeURIComponent(urlPath);
    const resolved = path.normalize(path.join(dir, decoded));
    if (!resolved.startsWith(path.normalize(dir))) return null;
    return resolved;
  }

  function tryServeStatic(req, res, pathname) {
    for (const dir of staticDirs) {
      let filePath = safeStaticPath(dir, pathname);
      if (!filePath) continue;
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
        res.statusCode = 200;
        fs.createReadStream(filePath).pipe(res);
        return true;
      }
    }
    return false;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  async function handleRequest(req, res) {
    attachResHelpers(req, res);
    try {
      const [pathname, queryStr] = req.url.split('?');
      req.pathname = decodeURIComponent(pathname);
      req.query = {};
      if (queryStr) {
        for (const pair of queryStr.split('&')) {
          if (!pair) continue;
          const [k, v] = pair.split('=');
          req.query[decodeURIComponent(k)] = decodeURIComponent(v || '');
        }
      }

      loadSession(req);

      req.body = {};
      if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        const raw = await readBody(req);
        if (raw) {
          try { req.body = JSON.parse(raw); } catch (e) { req.body = {}; }
        }
      }

      for (const route of routes) {
        if (route.method !== req.method) continue;
        const m = route.regex.exec(req.pathname);
        if (!m) continue;
        req.params = {};
        route.paramNames.forEach((name, i) => { req.params[name] = decodeURIComponent(m[i + 1]); });

        for (const handler of route.handlers) {
          const result = await handler(req, res);
          if (result === false) return; // ミドルウェアが既にレスポンス済み
        }
        return;
      }

      if (req.method === 'GET' && tryServeStatic(req, res, req.pathname)) return;

      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not Found');
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'サーバーエラーが発生しました' }));
    }
  }

  return app;
}

module.exports = { createApp };
