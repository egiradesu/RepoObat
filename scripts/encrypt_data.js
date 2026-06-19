#!/usr/bin/env node
/*
 * Encrypt the plaintext data.json into web/data.enc.json so the deployed app
 * can decrypt it in the browser with a password (Web Crypto AES-GCM).
 *
 * Params (PBKDF2-SHA256 + AES-256-GCM) match the browser's crypto.subtle so
 * the file produced here is decryptable client-side with no server.
 *
 * Password: read from env REPOOBAT_PASSWORD, or a strong one is generated and
 * printed once (it is NOT written to the repo).
 *
 *   REPOOBAT_PASSWORD="mysecret" node scripts/encrypt_data.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data.json');
const OUT = path.join(ROOT, 'web', 'data.enc.json');
const ITER = 150000;

if (!fs.existsSync(SRC)) {
  console.error('Missing data.json — run: python scripts/build_data.py');
  process.exit(1);
}

let pass = process.env.REPOOBAT_PASSWORD;
let generated = false;
if (!pass) {
  pass = crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, '').slice(0, 14);
  generated = true;
}

const plaintext = fs.readFileSync(SRC);
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(pass, salt, ITER, 32, 'sha256');
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();

const payload = {
  v: 1,
  kdf: 'PBKDF2-SHA256',
  iter: ITER,
  salt: salt.toString('base64'),
  iv: iv.toString('base64'),
  ct: Buffer.concat([enc, tag]).toString('base64'), // ciphertext || 16-byte tag
};
fs.writeFileSync(OUT, JSON.stringify(payload));

// Self-check: decrypt our own output to be sure it round-trips.
(() => {
  const k = crypto.pbkdf2Sync(pass, salt, ITER, 32, 'sha256');
  const d = crypto.createDecipheriv('aes-256-gcm', k, iv);
  d.setAuthTag(tag);
  const out = Buffer.concat([d.update(enc), d.final()]);
  if (out.length !== plaintext.length) throw new Error('round-trip size mismatch');
})();

console.log(`Wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB) — round-trip OK`);
if (generated) {
  console.log('\n  ====================================================');
  console.log('   ACCESS PASSWORD (save it — NOT stored in the repo):');
  console.log('       ' + pass);
  console.log('  ====================================================\n');
  console.log('  To set your own instead:');
  console.log('   REPOOBAT_PASSWORD="your password" node scripts/encrypt_data.js');
}
