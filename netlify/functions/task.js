// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Maker's Asylum Foundation
const { verify, readCookie, json } = require('../../lib/util');
const { snapshot } = require('../../lib/store');

// Ticks a lead-up task for the signed-in committee member's university, by adding the
// university to (or removing it from) the task's "Done by" field in Airtable.
// Needs an AIRTABLE_TOKEN that may write records; with a read-only token it answers
// 403 "read-only" and the dashboard keeps the tick on that device instead.
exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });
  const s = verify(readCookie(event.headers));
  if (!s || s.t !== 'session') return json(401, { error: 'signed-out' });
  if (s.role !== 'sc') return json(403, { error: 'committee-only' });

  let id = '', done = false;
  try { const b = JSON.parse(event.body || '{}'); id = String(b.id || ''); done = b.done === true; } catch {}
  if (!/^rec\w{14}$/.test(id)) return json(400, { error: 'bad-task' });

  try {
    // The university always comes from the member's own record, never from the request.
    const { value: T } = await snapshot(event);
    const member = T['Steering Committee'].find(x => (x.Email || '').trim().toLowerCase() === s.email);
    if (!member) return json(401, { error: 'signed-out' });
    const uni = (member.University || '').trim();
    if (!uni) return json(400, { error: 'no-university' });

    const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent('SC Tasks')}/${id}`;
    const headers = { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' };
    // Read the task again just before writing: the write replaces the whole list.
    const cur = await fetch(url, { headers });
    if (cur.status === 404) return json(404, { error: 'bad-task' });
    if (!cur.ok) throw new Error(`Airtable read returned ${cur.status}`);
    const before = (await cur.json()).fields['Done by'] || [];
    const after = done ? [...new Set([...before, uni])] : before.filter(x => x !== uni);

    const w = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ fields: { 'Done by': after }, typecast: true }) });
    if (w.status === 401 || w.status === 403) return json(403, { error: 'read-only' });
    if (!w.ok) throw new Error(`Airtable write returned ${w.status}`);
    return json(200, { ok: true, doneBy: (await w.json()).fields['Done by'] || [] });
  } catch (err) {
    if (err.busy) return json(503, { error: 'busy' });
    console.error(err);
    return json(502, { error: 'Could not save to Airtable' });
  }
};
