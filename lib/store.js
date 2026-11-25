// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Maker's Asylum Foundation
//
// Shared cache. When many people open the dashboard at once, Netlify starts many copies
// of each function, and each copy would otherwise read every Airtable table for itself
// (Airtable allows 5 requests a second per base). So the tables are read once, kept in
// Netlify Blobs, and every copy serves that one snapshot:
//
//   1. this copy's memory, if it is recent enough
//   2. the shared snapshot in Netlify Blobs
//   3. Airtable, by whichever copy wins a short lock; the others keep serving the
//      previous snapshot meanwhile
//
// If Netlify Blobs is unavailable (local development, an outage), everything still works
// from memory and Airtable, just without the sharing.
const { airtable, digest } = require('./util');
const { shape, EPORTFOLIO, LESSONS, QUIZ, QUIZ_RESULTS } = require('./schema');

let blobs = null;
try { blobs = require('@netlify/blobs'); } catch { /* not installed: memory only */ }
let injected = null; // tests put a fake store here
let warned = false;

function stores(event) {
  if (injected) return [injected];
  if (!blobs) return [];
  try { blobs.connectLambda(event); } catch { /* environment variables may already be set */ }
  const out = [];
  // Strong consistency so a fresh snapshot is seen everywhere at once; plain store as a fallback.
  for (const consistency of ['strong', 'eventual']) {
    try { out.push(blobs.getStore({ name: 'secip-cache', consistency })); } catch { /* try the next one */ }
  }
  return out;
}

// Runs one storage operation. Never throws: { ok: false } means "carry on without the shared store".
async function blobOp(event, fn) {
  let err = new Error('Netlify Blobs is not available');
  for (const store of stores(event)) {
    try { return { ok: true, value: await fn(store) }; } catch (e) { err = e; }
  }
  if (!warned && (blobs || injected)) { warned = true; console.error('Shared cache unavailable, using memory only:', err.message); }
  return { ok: false };
}

const LOCK_MS = 20 * 1000, RETRY_MS = 20 * 1000, WAIT_MS = 7 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mem = new Map(), failedAt = new Map(), loading = new Map();

// Only one copy of the function refreshes at a time. A lock older than LOCK_MS is taken over.
async function takeLock(event, key) {
  const name = `lock/${key}`;
  const r = await blobOp(event, async store => {
    const cur = await store.getWithMetadata(name, { type: 'text' });
    if (cur && Date.now() - Number(cur.data) < LOCK_MS) return false;
    const w = await store.set(name, String(Date.now()), cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    return !w || w.modified !== false;
  });
  return r.ok ? r.value : true;
}

// Returns { value, at, layer }. `load(previousValue)` fetches a new { value, ttl? }.
//   maxAge   how long a copy counts as current
//   staleAge how old a copy may be when nothing newer can be had
//   since    only accept a copy made at or after this time (used when someone who was
//            just added to Airtable is not in the current copy)
async function shared(event, key, { maxAge, staleAge, load, since = 0 }) {
  let copy = mem.get(key);
  const good = () => copy && (since ? copy.at >= since : Date.now() - copy.at < (copy.ttl || maxAge));
  const usable = () => copy && Date.now() - copy.at < staleAge;
  const give = layer => ({ value: copy.value, at: copy.at, layer });
  if (good()) return give('memory');

  const read = async () => {
    const r = await blobOp(event, store => store.get(key, { type: 'json' }));
    if (r.ok && r.value && (!copy || r.value.at > copy.at)) { copy = r.value; mem.set(key, copy); }
    return r.ok;
  };
  const sharedStore = await read();
  if (good()) return give('shared');

  // After a failed refresh, leave Airtable alone for a little while.
  if (Date.now() - (failedAt.get(key) || 0) < RETRY_MS) {
    if (usable()) return give('stale');
    throw new Error(`${key}: Airtable is unavailable, trying again shortly`);
  }

  if (sharedStore && !(await takeLock(event, key))) {
    // Another copy is refreshing. Serve what we have. With nothing usable (the very first
    // load), wait for that copy to finish rather than piling more reads onto Airtable;
    // if it still isn't there, ask the page to try again in a moment.
    if (usable() && !since) return give('stale');
    const start = Date.now();
    while (Date.now() - start < WAIT_MS) { await sleep(500); await read(); if (good()) return give('shared'); }
    if (usable()) return give('stale');
    if (!(await takeLock(event, key))) throw Object.assign(new Error(`${key}: still loading`), { busy: true });
  }

  if (!loading.has(key)) {
    loading.set(key, (async () => {
      try {
        const { value, ttl } = await load(copy && copy.value);
        copy = { at: Date.now(), ttl, value };
        mem.set(key, copy); failedAt.delete(key);
        await blobOp(event, store => store.setJSON(key, copy));
        return give('airtable');
      } catch (err) {
        failedAt.set(key, Date.now());
        if (usable()) { console.error(`Serving the previous copy of ${key}:`, err.message); return give('stale'); }
        throw err;
      } finally { loading.delete(key); }
    })());
  }
  return loading.get(key);
}

// Every table the dashboards read, fetched in groups of five with a pause between groups to stay
// inside Airtable's rate limit (5 requests a second per base).
// No server-side sorting: field names differ between bases and Airtable rejects a sort on a
// field that does not exist, so lib/schema.js sorts instead. An optional table that a base
// does not have (Airtable answers 403 or 404) is skipped; any other error still fails the load.
const optional = { optional: true };
const TABLES = [
  ['Students'], ['Mentors'], ['Important Links'], ['Agenda'], ['Partners'],
  ['Universities'], ['Steering Committee'], ['SC Tasks'], ['Updates'], ['Team Survey', optional],
  // Assessments page: the overview, and the forms that show what each student has handed in
  ['Assessment Overview', optional], [EPORTFOLIO, optional], ['Open House Submission', optional],
  ['Learning Reflection', optional], ['Self Evaluation - Week 1', optional], ['Self Evaluation - Week 2', optional],
  // Assessment 1A on the dashboard: lessons, quiz questions, and passed attempts
  [LESSONS, optional], [QUIZ, optional], [QUIZ_RESULTS, optional],
];
const missing = err => / returned (403|404)$/.test(err.message);
async function loadTables() {
  const raw = {};
  for (let i = 0; i < TABLES.length; i += 5) {
    if (i) await sleep(1100);
    const group = TABLES.slice(i, i + 5);
    const got = await Promise.all(group.map(([table, o = {}]) =>
      o.optional ? airtable(table).catch(err => { if (missing(err)) return []; throw err; }) : airtable(table)));
    group.forEach(([table], j) => { raw[table] = got[j]; });
  }
  return { value: shape(raw) };
}

// The snapshot is current for a minute. If Airtable cannot be reached, the last one is served
// for up to an hour (attachment links from Airtable stop working after about two hours).
// The key includes the base, so switching AIRTABLE_BASE_ID never serves the old base's copy.
const snapshot = (event, opts = {}) => shared(event, `tables/${process.env.AIRTABLE_BASE_ID || 'base'}`, { maxAge: 60 * 1000, staleAge: 60 * 60 * 1000, load: loadTables, ...opts });

// Sign-in links: at most LINK_MAX emails to one address per LINK_WINDOW. This caps emails,
// not devices: one link can be opened on a phone and a laptop. The address itself is not
// stored, only a fingerprint. Each request must win a conditional write, so a burst of
// requests cannot slip past the cap. If the store is unavailable, the email is allowed.
const LINK_MAX = 2, LINK_WINDOW = 30 * 60 * 1000;
async function allowLink(event, email) {
  const key = `links/${digest(email)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await blobOp(event, async store => {
      const cur = await store.getWithMetadata(key, { type: 'json' });
      const recent = (cur && Array.isArray(cur.data) ? cur.data : []).filter(t => Date.now() - t < LINK_WINDOW);
      if (recent.length >= LINK_MAX) return 'full';
      const w = await store.setJSON(key, [...recent, Date.now()], cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
      return !w || w.modified !== false ? 'ok' : 'retry';
    });
    if (!r.ok || r.value === 'ok') return true;
    if (r.value === 'full') return false;
  }
  return false; // kept losing to other requests for the same address: one of those sent the link
}

module.exports = { shared, snapshot, allowLink, _useStore: s => { injected = s; warned = false; } };
