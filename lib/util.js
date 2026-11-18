// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Maker's Asylum
const crypto = require('crypto');

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return s;
};
const hmac = body => crypto.createHmac('sha256', secret()).update(body).digest('base64url');

// Signed token: base64url(json).signature
function sign(payload, ttlSeconds) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${hmac(body)}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = hmac(body);
  if (!sig || sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

function readCookie(headers, name = 'secip_session') {
  const raw = headers.cookie || headers.Cookie || '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

// Fetch every record in a table (follows pagination). Returns [{id, ...fields}]
async function airtable(table, params = {}) {
  const url = new URL(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let out = [], offset;
  do {
    if (offset) url.searchParams.set('offset', offset);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } });
    if (!r.ok) throw new Error(`Airtable ${table} returned ${r.status}`);
    const j = await r.json();
    out = out.concat(j.records.map(x => ({ id: x.id, ...x.fields })));
    offset = j.offset;
  } while (offset);
  return out;
}

// Escape a value for use inside an Airtable formula string literal
const formulaString = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ...headers },
  body: JSON.stringify(body),
});

module.exports = { sign, verify, readCookie, airtable, formulaString, json };
