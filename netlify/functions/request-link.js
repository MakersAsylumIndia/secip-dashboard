// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Maker's Asylum
const { sign, airtable, formulaString, json } = require('../../lib/util');

// Always answers the same way, so nobody can use this form to test who is registered.
exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });
  const done = json(200, { ok: true });

  let email = '';
  try { email = String(JSON.parse(event.body || '{}').email || '').trim().toLowerCase(); } catch {}
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return done;

  try {
    const f = field => `LOWER(TRIM({${field}}))='${formulaString(email)}'`;
    const [committee, students] = await Promise.all([
      airtable('Steering Committee', { filterByFormula: f('Email'), maxRecords: 1 }),
      airtable('Students', { filterByFormula: f('Email address'), maxRecords: 1 }),
    ]);
    const role = committee.length ? 'sc' : students.length ? 'student' : null;
    if (!role) return done;

    const first = ((committee[0] || students[0]).Name || '').split(' ')[0] || 'there';
    const link = `${process.env.SITE_URL}/api/verify?token=${sign({ email, role, t: 'link' }, 15 * 60)}`;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: email,
        subject: 'Your SECIP 2027 sign-in link',
        text: `Hi ${first},\n\nOpen this link to sign in to your SECIP 2027 dashboard:\n${link}\n\nThe link works for 15 minutes. If you didn't ask for it, you can ignore this email.`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#2a2a2a">
          <h2 style="color:#F26B1D;margin:0 0 16px">SECIP 2027</h2>
          <p>Hi ${first},</p>
          <p>Tap the button to sign in to your dashboard.</p>
          <p style="margin:28px 0"><a href="${link}" style="background:#F26B1D;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">Sign in to SECIP</a></p>
          <p style="font-size:13px;color:#8a6a55">The link works for 15 minutes. If you didn't ask for it, you can ignore this email.</p></div>`,
      }),
    });
    if (!r.ok) console.error('Resend error', r.status, await r.text());
  } catch (err) {
    console.error(err);
  }
  return done;
};
