'use strict';

const crypto = require('node:crypto');

const SMALL_PRIMES = [
  2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n,
  41n, 43n, 47n, 53n, 59n, 61n, 67n, 71n, 73n, 79n, 83n, 89n, 97n,
  101n, 103n, 107n, 109n, 113n, 127n, 131n, 137n, 139n, 149n, 151n,
  157n, 163n, 167n, 173n, 179n, 181n, 191n, 193n, 197n, 199n, 211n,
  223n, 227n, 229n, 233n, 239n, 241n, 251n
];

const DETERMINISTIC_64_BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n];
const MAX_64_BIT = (1n << 64n) - 1n;
const OVERSIZE_MESSAGE_ERROR = 'Message too long for this modulus — use a shorter message or a larger key.';

/**
 * Modular exponentiation via right-to-left square-and-multiply.
 * When `withTrace` is false (default), returns the resulting BigInt directly
 * (so `modPow(3n, 5n, 7n) === 5n`).
 * When `withTrace` is true, returns `{ result, trace }` where `trace` holds
 * up to the first 16 iterations `{ i, bit, acc, base }`.
 */
function modPow(base, exp, mod, withTrace = false) {
  let b = BigInt(base);
  let e = BigInt(exp);
  const m = BigInt(mod);

  if (m <= 0n) {
    throw new RangeError('Modulus must be a positive integer.');
  }
  if (e < 0n) {
    throw new RangeError('Exponent must be a non-negative integer.');
  }
  if (m === 1n) {
    return withTrace ? { result: 0n, trace: [] } : 0n;
  }

  b = ((b % m) + m) % m;
  let acc = 1n;
  let i = 0;
  const trace = withTrace ? [] : null;

  while (e > 0n) {
    const bit = Number(e & 1n);
    if (bit === 1) {
      acc = (acc * b) % m;
    }
    if (withTrace && trace.length < 16) {
      trace.push({ i, bit, acc, base: b });
    }
    b = (b * b) % m;
    e >>= 1n;
    i += 1;
  }

  return withTrace ? { result: acc, trace } : acc;
}

/**
 * Iterative Extended Euclidean Algorithm.
 * Returns `{ g, x, y }` such that `a * x + b * y === g` with `g >= 0n`.
 */
function egcd(a, b) {
  let oldR = BigInt(a);
  let r = BigInt(b);
  let oldS = 1n;
  let s = 0n;
  let oldT = 0n;
  let t = 1n;

  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }

  if (oldR < 0n) {
    return { g: -oldR, x: -oldS, y: -oldT };
  }
  return { g: oldR, x: oldS, y: oldT };
}

/**
 * Modular multiplicative inverse `d = e^-1 mod phi` via Extended Euclid.
 */
function modInverse(e, phi) {
  const eBig = BigInt(e);
  const phiBig = BigInt(phi);
  if (phiBig <= 1n) {
    throw new RangeError('Modulus phi must be greater than 1.');
  }
  const { g, x } = egcd(eBig, phiBig);
  if (g !== 1n) {
    throw new Error('Modular inverse does not exist (inputs are not coprime).');
  }
  return ((x % phiBig) + phiBig) % phiBig;
}

/**
 * Draw a uniform random BigInt in the inclusive range `[2n, maxInclusive]`.
 */
function randomWitnessBase(maxInclusive) {
  const range = maxInclusive - 1n; // count of values in [2, maxInclusive]
  const hexLen = range.toString(16).length;
  const byteLen = Math.max(1, Math.ceil(hexLen / 2));
  const bitLen = BigInt(range.toString(2).length);
  const mask = (1n << bitLen) - 1n;

  while (true) {
    const buf = crypto.randomBytes(byteLen);
    const candidate = BigInt('0x' + buf.toString('hex')) & mask;
    if (candidate < range) {
      return candidate + 2n;
    }
  }
}

/**
 * Primality test combining small-prime trial division with Miller-Rabin.
 * Uses deterministic bases `[2,3,5,7,11,13,17]` for <= 64-bit inputs and
 * 12 random bases for larger inputs.
 */
function isPrime(n) {
  const num = BigInt(n);
  if (num < 2n) return false;

  for (let i = 0; i < SMALL_PRIMES.length; i += 1) {
    const p = SMALL_PRIMES[i];
    if (num === p) return true;
    if (num % p === 0n) return false;
  }

  let d = num - 1n;
  let s = 0n;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s += 1n;
  }

  const checkWitness = (a) => {
    let x = modPow(a, d, num, false);
    if (x === 1n || x === num - 1n) return true;
    for (let r = 1n; r < s; r += 1n) {
      x = (x * x) % num;
      if (x === num - 1n) return true;
    }
    return false;
  };

  if (num <= MAX_64_BIT) {
    for (let i = 0; i < DETERMINISTIC_64_BASES.length; i += 1) {
      const a = DETERMINISTIC_64_BASES[i];
      if (a >= num - 1n) continue;
      if (!checkWitness(a)) return false;
    }
    return true;
  }

  for (let k = 0; k < 12; k += 1) {
    const a = randomWitnessBase(num - 2n);
    if (!checkWitness(a)) return false;
  }
  return true;
}

/**
 * Generate a random `bits`-bit odd prime with top bit set via `crypto.randomBytes`.
 */
function randomPrime(bits = 64) {
  const bitCount = Number(bits);
  if (!Number.isInteger(bitCount) || bitCount < 8 || bitCount > 2048) {
    throw new RangeError('Prime bit length must be an integer between 8 and 2048.');
  }

  const byteLen = Math.ceil(bitCount / 8);
  const topBit = 1n << BigInt(bitCount - 1);
  const mask = (1n << BigInt(bitCount)) - 1n;

  while (true) {
    const buf = crypto.randomBytes(byteLen);
    const raw = BigInt('0x' + buf.toString('hex'));
    const candidate = (raw & mask) | topBit | 1n;
    if (isPrime(candidate)) {
      return candidate;
    }
  }
}

/**
 * Generate a textbook RSA key pair `{ p, q, n, phi, e, d }`.
 */
function generateKeys(bits = 64) {
  const p = randomPrime(bits);
  let q = randomPrime(bits);
  while (q === p) {
    q = randomPrime(bits);
  }

  const n = p * q;
  const phi = (p - 1n) * (q - 1n);

  let e = 65537n;
  if (e >= phi) {
    e = 3n;
  }
  while (egcd(e, phi).g !== 1n) {
    e += 2n;
  }

  const d = modInverse(e, phi);
  return { p, q, n, phi, e, d };
}

/**
 * Encode a UTF-8 string into a big-endian BigInt.
 * If modulus `n` is supplied, validates `m < n`.
 */
function encodeMessage(str, n) {
  if (typeof str !== 'string' || str.length === 0) {
    throw new Error('Message must be a non-empty string.');
  }
  const bytes = Buffer.from(str, 'utf8');
  let m = 0n;
  for (let i = 0; i < bytes.length; i += 1) {
    m = (m << 8n) | BigInt(bytes[i]);
  }
  if (n !== undefined && m >= BigInt(n)) {
    throw new Error(OVERSIZE_MESSAGE_ERROR);
  }
  return m;
}

/**
 * Decode a non-negative big-endian BigInt back to a UTF-8 string.
 */
function decodeMessage(m) {
  let val = BigInt(m);
  if (val < 0n) {
    throw new RangeError('Decoded message integer must be non-negative.');
  }
  if (val === 0n) {
    return '';
  }

  const bytes = [];
  while (val > 0n) {
    bytes.push(Number(val & 0xffn));
    val >>= 8n;
  }
  bytes.reverse();
  return Buffer.from(bytes).toString('utf8');
}

/**
 * Textbook RSA encryption: `c = m^e mod n`.
 * Validates `0 <= m < n` and returns `{ c, trace }`.
 */
function encrypt(m, e, n) {
  const mBig = BigInt(m);
  const eBig = BigInt(e);
  const nBig = BigInt(n);

  if (nBig <= 0n || eBig <= 0n) {
    throw new RangeError('Public key parameters n and e must be positive.');
  }
  if (mBig < 0n) {
    throw new RangeError('Message integer m must be non-negative.');
  }
  if (mBig >= nBig) {
    throw new Error(OVERSIZE_MESSAGE_ERROR);
  }

  const { result: c, trace } = modPow(mBig, eBig, nBig, true);
  return { c, trace };
}

/**
 * Textbook RSA decryption: `m = c^d mod n`.
 * Validates `0 <= c < n` and returns `{ m, trace }`.
 */
function decrypt(c, d, n) {
  const cBig = BigInt(c);
  const dBig = BigInt(d);
  const nBig = BigInt(n);

  if (nBig <= 0n || dBig <= 0n) {
    throw new RangeError('Private key parameters n and d must be positive.');
  }
  if (cBig < 0n) {
    throw new RangeError('Ciphertext integer c must be non-negative.');
  }
  if (cBig >= nBig) {
    throw new Error('Ciphertext must be smaller than modulus n.');
  }

  const { result: m, trace } = modPow(cBig, dBig, nBig, true);
  return { m, trace };
}

/**
 * Verify textbook RSA reference vectors at startup:
 * p=61n, q=53n -> n=3233n, phi=3120n, e=17n, d=2753n;
 * encrypt(65n) -> 2790n; decrypt(2790n) -> 65n; modPow(3n,5n,7n)===5n.
 */
function selfTest() {
  const p = 61n;
  const q = 53n;

  if (!isPrime(p) || !isPrime(q) || isPrime(3233n)) {
    throw new Error('selfTest failed: primality check mismatch');
  }

  const n = p * q;
  const phi = (p - 1n) * (q - 1n);
  if (n !== 3233n || phi !== 3120n) {
    throw new Error(`selfTest failed: expected n=3233 phi=3120, got n=${n} phi=${phi}`);
  }

  const e = 17n;
  const d = modInverse(e, phi);
  if (d !== 2753n) {
    throw new Error(`selfTest failed: expected d=2753, got d=${d}`);
  }

  const { c } = encrypt(65n, e, n);
  if (c !== 2790n) {
    throw new Error(`selfTest failed: expected c=2790, got c=${c}`);
  }

  const { m } = decrypt(c, d, n);
  if (m !== 65n) {
    throw new Error(`selfTest failed: expected m=65, got m=${m}`);
  }

  if (modPow(3n, 5n, 7n) !== 5n) {
    throw new Error('selfTest failed: modPow(3n, 5n, 7n) !== 5n');
  }

  const roundTrip = decodeMessage(encodeMessage('hello'));
  if (roundTrip !== 'hello') {
    throw new Error('selfTest failed: UTF-8 encode/decode mismatch');
  }

  return { p, q, n, phi, e, d, m: 65n, c, plain: m };
}

module.exports = {
  isPrime,
  randomPrime,
  modPow,
  modInverse,
  egcd,
  generateKeys,
  encrypt,
  decrypt,
  encodeMessage,
  decodeMessage,
  selfTest
};
