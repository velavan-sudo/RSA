# TRAPDOOR

**RSA Cryptography: How Key Generation, Encryption, and Decryption Work**

TRAPDOOR is a zero-dependency Node.js web portal that exposes every arithmetic step of textbook RSA. All primality testing, Extended Euclidean inversion, UTF-8 integer encoding, and binary square-and-multiply exponentiation run on the server using native JavaScript `BigInt`, streaming each stage over Server-Sent Events (SSE) to an instrument readout in the browser.

> **Educational Warning:** TRAPDOOR implements unpadded textbook RSA with small primes (64-bit and 128-bit prime factors) so every intermediate integer can be read directly. It does not implement OAEP padding or 2048-bit+ moduli and must never be used to protect real data.

---

## Requirements & Quick Start

- **Node.js 20+** (uses built-in `node:http`, `node:crypto`, `node:fs`, `node:path`, `node:perf_hooks` — no `npm install`, no build step).
- `anime.js` v3.2.2 is vendored locally at `public/vendor/anime.min.js`.

```bash
node server.js
```

On startup the engine verifies textbook reference vectors (`p=61, q=53, n=3233, e=17, d=2753, m=65 -> c=2790 -> m=65`) and logs:

```text
engine ok: n=3233 d=2753 65→2790→65
TRAPDOOR listening on http://0.0.0.0:8000
```

Set `PORT` to override port `8000`.

### Deploying to Render

This repository includes `render.yaml` and `package.json` for Render Web Services (not a static site or GitHub Pages, because key generation, encryption, decryption, and SSE streaming run on the Node.js server):

1. Open [Render Dashboard](https://dashboard.render.com/) and select **New +** -> **Web Service** (or **Blueprint**).
2. Connect `velavan-sudo/RSA` on branch `main`.
3. Render automatically reads `render.yaml` (`Build Command: npm test`, `Start Command: node server.js`, `Health Check Path: /api/health`) and assigns `process.env.PORT`.

---

## File Layout

```text
server.js                    HTTP + SSE server and static asset handler
lib/engine.js                BigInt RSA arithmetic engine and startup self-test
public/index.html            Instrument markup (paper ledger + dark register bay)
public/styles.css            Design tokens, typography, and layout grid
public/app.js                SSE client, server API wiring, and anime.js motion
public/vendor/anime.min.js   Vendored anime.js 3.2.2 (no runtime CDN)
README.md                    Documentation
```

---

## HTTP & SSE API

All large integers cross the wire strictly as base-10 strings.

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Returns `{ ok: true, engine: "RSA-BigInt", uptime }`. |
| `GET` | `/api/events?id=<jobId>` | SSE stream emitting `event: stage` frames for `jobId`. |
| `POST` | `/api/keys` | Body `{ jobId, bits: 64 \| 128 }`. Streams 8 stages (`candidate`, `prime-p`, `prime-q`, `modulus`, `totient`, `public-e`, `private-d`, `done`) and returns `{ p, q, n, phi, e, d, steps, meta }`. |
| `POST` | `/api/encrypt` | Body `{ jobId, n, e, message }`. Encodes UTF-8 to `m`, validates `m < n`, streams `encode` -> `pow` -> `done`, and returns `{ m, c, trace, steps }`. |
| `POST` | `/api/decrypt` | Body `{ jobId, n, d, c }`. Computes `m = c^d mod n`, decodes UTF-8, streams `pow` -> `decode` -> `done`, and returns `{ c, m, message, trace }`. |

---

## Mathematical Mechanism

1. **Prime Generation (`randomPrime`, `isPrime`):** Random odd `k`-bit candidates with the top bit set are drawn from `crypto.randomBytes`, filtered against small prime divisors, and tested with Miller–Rabin (`[2, 3, 5, 7, 11, 13, 17]` for 64-bit candidates; 12 random witness bases for 128-bit candidates).
2. **Modulus & Totient:** `n = p * q` and `phi(n) = (p - 1)(q - 1)`.
3. **Key Exponents (`egcd`, `modInverse`):** Public exponent `e` starts at `65537` and increments by `2` until `gcd(e, phi(n)) = 1`. Private trapdoor `d` is computed via the iterative Extended Euclidean Algorithm such that `e * d ≡ 1 (mod phi(n))`.
4. **Exponentiation (`modPow`):** Encryption (`c = m^e mod n`) and decryption (`m = c^d mod n`) use right-to-left binary square-and-multiply, recording the first 16 iterations `{ i, bit, acc, base }` for inspection.
