// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Maker's Asylum Foundation
const { sign, escapeHtml, json } = require('../../lib/util');
const { snapshot, allowLink } = require('../../lib/store');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Always answers the same way, so nobody can use this form to test who is registered.
exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });
  const done = json(200, { ok: true });

  let email = '';
  try { email = String(JSON.parse(event.body || '{}').email || '').trim().toLowerCase(); } catch {}
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return done;

  try {
    // Looked up in the shared snapshot, so a whole cohort signing in costs Airtable nothing extra.
    const find = T => ({
      sc: T['Steering Committee'].find(x => (x.Email || '').trim().toLowerCase() === email),
      student: T.Students.find(x => (x['Email address'] || '').trim().toLowerCase() === email),
    });
    let who = find((await snapshot(event)).value);
    if (!who.sc && !who.student) who = find((await snapshot(event, { since: Date.now() - 5000 })).value);
    const role = who.sc ? 'sc' : who.student ? 'student' : null;
    if (!role) return done;
    // Two links per half hour per address is plenty; more than that is a mistake or a nuisance.
    if (!(await allowLink(event, email))) { console.warn('Sign-in link limit reached for one address'); return done; }

    const first = ((who.sc || who.student).Name || '').split(' ')[0] || 'there';
    const link = `${process.env.SITE_URL}/api/verify?token=${sign({ email, role, t: 'link' }, 15 * 60)}`;

    const send = () => fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: email,
        subject: 'Your SECIP 2027 sign-in link',
        text: `Hi ${first},\n\nOpen this link to sign in to your SECIP 2027 dashboard:\n${link}\n\nThe link works for 15 minutes. If you didn't ask for it, you can ignore this email.`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1B1035">
          <h2 style="color:#1B1035;margin:0 0 16px">SECIP 2027</h2>
          <p>Hi ${escapeHtml(first)},</p>
          <p>Tap the button to sign in to your dashboard.</p>
          <p style="margin:28px 0"><a href="${link}" style="background:#FF6A13;color:#1B1035;border:2px solid #1B1035;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:700">Sign in to SECIP</a></p>
          <p style="font-size:13px;color:#5B5370">The link works for 15 minutes. If you didn't ask for it, you can ignore this email.</p></div>`,
      }),
    });
    let r = await send();
    // Resend allows only a few emails a second, so wait a moment and try once more if it is busy.
    if (r.status === 429 || r.status >= 500) { await sleep(1200); r = await send(); }
    if (!r.ok) console.error('Resend error', r.status, await r.text());
  } catch (err) {
    console.error(err);
  }
  return done;
};
