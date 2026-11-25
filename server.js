'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const engine = require('./lib/engine');

const PORT = Number(process.env.PORT) || 8000;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 64 * 1024;
const KEY_STAGE_DELAY_MS = 130;
const OP_STAGE_DELAY_MS = 95;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

/** @type {Map<string, Set<http.ServerResponse>>} */
const sseClients = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function emitStage(jobId, stage, message) {
  if (!jobId || typeof jobId !== 'string') return;
  const listeners = sseClients.get(jobId);
  if (!listeners || listeners.size === 0) return;

  const frame = `event: stage\ndata: ${JSON.stringify({ stage, message })}\n\n`;
  for (const clientRes of listeners) {
    if (!clientRes.writableEnded && !clientRes.destroyed) {
      clientRes.write(frame);
    }
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(Object.assign(new Error('Request body too large.'), { statusCode: 400 }));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(Object.assign(new Error('JSON body must be an object.'), { statusCode: 400 }));
          return;
        }
        resolve(parsed);
      } catch (_err) {
        reject(Object.assign(new Error('Malformed JSON body.'), { statusCode: 400 }));
      }
    });

    req.on('error', (err) => {
      reject(Object.assign(err, { statusCode: 400 }));
    });
  });
}

function parseDecimalBigInt(value, fieldName, allowZero = false) {
  if (typeof value !== 'string') {
    throw Object.assign(
      new Error(`Field "${fieldName}" must be a decimal string.`),
      { statusCode: 400 }
    );
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw Object.assign(
      new Error(`Field "${fieldName}" is not a valid non-negative decimal string.`),
      { statusCode: 400 }
    );
  }
  const big = BigInt(trimmed);
  if (!allowZero && big <= 0n) {
    throw Object.assign(
      new Error(`Field "${fieldName}" must be greater than zero.`),
      { statusCode: 400 }
    );
  }
  return big;
}

function serializeTrace(trace) {
  return trace.map((step) => ({
    i: step.i,
    bit: step.bit,
    acc: step.acc.toString(10),
    base: step.base.toString(10)
  }));
}

function handleSse(req, res, searchParams) {
  const jobId = (searchParams.get('id') || '').trim();
  if (!jobId || jobId.length > 128) {
    sendJson(res, 400, { error: 'Valid query parameter "id" is required for SSE.' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  if (res.socket) {
    res.socket.setNoDelay(true);
  }

  res.write(': trapdoor-sse-open\n\n');

  let set = sseClients.get(jobId);
  if (!set) {
    set = new Set();
    sseClients.set(jobId, set);
  }
  set.add(res);

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(': keepalive\n\n');
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const active = sseClients.get(jobId);
    if (active) {
      active.delete(res);
      if (active.size === 0) {
        sseClients.delete(jobId);
      }
    }
  });
}

async function handleGenerateKeys(req, res) {
  const body = await readJsonBody(req);
  const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
  const bits = body.bits === undefined ? 64 : Number(body.bits);

  if (bits !== 64 && bits !== 128) {
    sendJson(res, 400, { error: 'Invalid prime bit length: bits must be 64 or 128.' });
    return;
  }

  const startedAt = performance.now();

  emitStage(jobId, 'candidate', 'scanning odd candidates');
  await sleep(KEY_STAGE_DELAY_MS);

  const p = engine.randomPrime(bits);
  emitStage(jobId, 'prime-p', 'p confirmed prime — Miller-Rabin passed');
  await sleep(KEY_STAGE_DELAY_MS);

  let q = engine.randomPrime(bits);
  while (q === p) {
    q = engine.randomPrime(bits);
  }
  emitStage(jobId, 'prime-q', 'q confirmed prime — Miller-Rabin passed');
  await sleep(KEY_STAGE_DELAY_MS);

  const n = p * q;
  emitStage(jobId, 'modulus', 'n = p × q');
  await sleep(KEY_STAGE_DELAY_MS);

  const phi = (p - 1n) * (q - 1n);
  emitStage(jobId, 'totient', 'φ(n) = (p−1)(q−1)');
  await sleep(KEY_STAGE_DELAY_MS);

  let e = 65537n;
  if (e >= phi) {
    e = 3n;
  }
  while (engine.egcd(e, phi).g !== 1n) {
    e += 2n;
  }
  emitStage(jobId, 'public-e', 'e chosen coprime to φ(n)');
  await sleep(KEY_STAGE_DELAY_MS);

  const d = engine.modInverse(e, phi);
  emitStage(jobId, 'private-d', 'd = e⁻¹ mod φ(n) — key pair ready');
  await sleep(KEY_STAGE_DELAY_MS);

  emitStage(jobId, 'done', 'key generation finished');

  const durationMs = Math.max(1, Math.round(performance.now() - startedAt));

  sendJson(res, 200, {
    p: p.toString(10),
    q: q.toString(10),
    n: n.toString(10),
    phi: phi.toString(10),
    e: e.toString(10),
    d: d.toString(10),
    steps: [
      { label: 'p × q', value: n.toString(10) },
      { label: '(p−1)(q−1)', value: phi.toString(10) },
      { label: 'gcd(e, φ(n))', value: '1' },
      { label: 'e⁻¹ mod φ(n)', value: d.toString(10) }
    ],
    meta: {
      bits,
      durationMs,
      safe: false
    }
  });
}

async function handleEncrypt(req, res) {
  const body = await readJsonBody(req);
  const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
  const n = parseDecimalBigInt(body.n, 'n', false);
  const e = parseDecimalBigInt(body.e, 'e', false);

  if (typeof body.message !== 'string' || body.message.length === 0) {
    sendJson(res, 400, { error: 'Field "message" must be a non-empty string.' });
    return;
  }

  let m;
  try {
    m = engine.encodeMessage(body.message, n);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
    return;
  }

  emitStage(jobId, 'encode', 'UTF-8 bytes encoded as big-endian integer m');
  await sleep(OP_STAGE_DELAY_MS);

  const { c, trace } = engine.encrypt(m, e, n);
  emitStage(jobId, 'pow', 'c = m^e mod n computed via square-and-multiply');
  await sleep(OP_STAGE_DELAY_MS);

  emitStage(jobId, 'done', 'ciphertext c ready');

  sendJson(res, 200, {
    m: m.toString(10),
    c: c.toString(10),
    trace: serializeTrace(trace),
    steps: [
      { label: 'UTF-8 → m', value: m.toString(10) },
      { label: 'm < n', value: 'true' },
      { label: 'm^e mod n', value: c.toString(10) }
    ]
  });
}

async function handleDecrypt(req, res) {
  const body = await readJsonBody(req);
  const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
  const n = parseDecimalBigInt(body.n, 'n', false);
  const d = parseDecimalBigInt(body.d, 'd', false);
  const c = parseDecimalBigInt(body.c, 'c', true);

  if (c >= n) {
    sendJson(res, 400, { error: 'Ciphertext c must be smaller than modulus n.' });
    return;
  }

  emitStage(jobId, 'pow', 'm = c^d mod n computed via square-and-multiply');
  const { m, trace } = engine.decrypt(c, d, n);
  await sleep(OP_STAGE_DELAY_MS);

  emitStage(jobId, 'decode', 'integer m decoded back into UTF-8 bytes');
  const message = engine.decodeMessage(m);
  await sleep(OP_STAGE_DELAY_MS);

  emitStage(jobId, 'done', 'plaintext recovered');

  sendJson(res, 200, {
    c: c.toString(10),
    m: m.toString(10),
    message,
    trace: serializeTrace(trace)
  });
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch (_err) {
    sendJson(res, 400, { error: 'Bad request path.' });
    return;
  }

  const resolved = path.resolve(PUBLIC_DIR, decodedPath);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    sendJson(res, 403, { error: 'Forbidden.' });
    return;
  }

  fs.stat(resolved, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      sendJson(res, 404, { error: 'Not found.' });
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': ext === '.js' && resolved.includes('vendor') ? 'public, max-age=3600' : 'no-cache'
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(resolved);
    stream.on('error', () => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Failed to read static asset.' });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch (_err) {
    sendJson(res, 400, { error: 'Invalid request URL.' });
    return;
  }

  const { pathname, searchParams } = parsedUrl;

  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        engine: 'RSA-BigInt',
        uptime: Math.round(process.uptime() * 1000) / 1000
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/events') {
      handleSse(req, res, searchParams);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/keys') {
      await handleGenerateKeys(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/encrypt') {
      await handleEncrypt(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/decrypt') {
      await handleDecrypt(req, res);
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Unknown API endpoint.' });
      return;
    }

    serveStatic(req, res, pathname);
  } catch (err) {
    const status = err && Number.isInteger(err.statusCode) ? err.statusCode : 500;
    if (!res.headersSent) {
      sendJson(res, status, { error: err.message || 'Internal server error.' });
    }
  }
});

const verify = engine.selfTest();
console.log(`engine ok: n=${verify.n} d=${verify.d} ${verify.m}→${verify.c}→${verify.plain}`);

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`TRAPDOOR listening on http://${HOST}:${PORT}`);
  });
}

module.exports = { server };
