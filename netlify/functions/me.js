// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Maker's Asylum Foundation
const { verify, readCookie, airtable, json } = require('../../lib/util');
const { snapshot } = require('../../lib/store');
const { shape } = require('../../lib/schema');

const days = rec => [...Array(10)].map((_, i) => !!rec[`Day ${i + 1}`]);
const photo = att => (att && att[0] && ((att[0].thumbnails && att[0].thumbnails.large && att[0].thumbnails.large.url) || att[0].url)) || null;
const same = (a, b) => (a || '').trim().toLowerCase() === b;

exports.handler = async event => {
  const s = verify(readCookie(event.headers));
  if (!s || s.t !== 'session') return json(401, { error: 'signed-out' });

  try {
    const isSC = s.role === 'sc';
    // Committee members may also open the student view. It is shaped below exactly as a
    // student's is, so nothing committee-only is sent. Students cannot ask for the committee view.
    const asStudent = !isSC || (event.queryStringParameters || {}).view === 'student';
    const whoIn = T => isSC ? T['Steering Committee'].find(x => same(x.Email, s.email)) : T.Students.find(x => same(x['Email address'], s.email));

    let snap = await snapshot(event), who = whoIn(snap.value);
    // Someone added to Airtable in the last minute may not be in the snapshot yet,
    // so look once more in a newer one before turning them away.
    if (!who) { snap = await snapshot(event, { since: Date.now() - 5000 }); who = whoIn(snap.value); }
    if (!who) return json(401, { error: 'signed-out' });

    // Maker's Asylum team rows sign in as committee (whoIn above uses the full table)
    // but are left out of the committee list and the contacts students see.
    const T = snap.value, students = T.Students, universities = T.Universities,
      committee = T['Steering Committee'].filter(x => !/maker.s asylum team/i.test(String(x.Role || '')));

    // What every signed-in person may see about other students (no emails)
    const pub = x => ({
      name: x.Name || '', uni: x.University || '', country: x.Country || '', city: x.City || '',
      team: x['Team number'] || '', sdg: x['SDG interests'] || [],
    });

    const data = {
      role: asStudent ? 'student' : 'sc',
      canSwitch: isSC,
      students: students.filter(x => x.Name).map(pub),
      mentors: T.Mentors.filter(m => m.Name).map(m => ({
        name: m.Name, photo: photo(m.Photo), org: m.Organisation || '', role: m.Role || '',
        type: m['Mentor type'] || '', expertise: m.Expertise || [], sessions: m.Sessions || [],
        teams: m['Assigned teams'] || [], bio: m['Short bio'] || '', linkedin: m.LinkedIn || '',
        confirmed: !!m.Confirmed,
      })),
      links: T['Important Links'].filter(l => l.Name && (!asStudent || (l.Audience || 'Everyone') !== 'Steering Committee'))
        .sort((a, b) => (a.Order ?? 9999) - (b.Order ?? 9999) || a.Name.localeCompare(b.Name))
        .map(l => ({ name: l.Name, note: l.Remarks || '', url: l.URL || '', due: l['Event Date/Deadline'] || null, sc: l.Audience === 'Steering Committee' })),
      agenda: T.Agenda.filter(a => a.Session && a.Date).map(a => ({
        session: a.Session, day: a['Day number'], date: a.Date, start: a['Start time'], end: a['End time'],
        phase: a.Phase || '', format: a.Format || '', facilitator: a.Facilitator || '',
        studentTodo: a['Students to-do'] || '', zoom: a['Zoom link'] || '', slides: a.Slides || '', recording: a.Recording || '',
        ...(asStudent ? {} : { scTodo: a['Steering Committee to-do'] || '', notes: a.Notes || '' }),
      })),
      partners: T.Partners.filter(p => p.Name).map(p => ({ name: p.Name, logo: photo(p.Logo), url: p.Website || '' })),
      universities: universities.filter(u => u.Name).map(u => ({ name: u.Name, country: u.Country || '', lat: u.Latitude, lng: u.Longitude })),
    };

    if (asStudent) {
      // A committee member who is also enrolled as a student sees their own student record;
      // any other committee member sees the student view with a stand-in profile.
      const me = isSC ? students.find(x => same(x['Email address'], s.email)) : who;
      data.preview = !me;
      data.me = me
        ? { ...pub(me), degree: me.Degree || '', year: me['Year of study'] || '', skills: me.Skills || '', profile: me['Professional profile'] || '', att: days(me) }
        : { name: who.Name || '', uni: who.University || '', country: '', city: '', team: '', sdg: [], degree: '', year: '', skills: '', profile: '', att: days({}) };
      // Steering Committee contacts so students can reach their university's representative.
      // Only name, university and work email; internal role notes stay hidden.
      const repOf = Object.fromEntries(universities.map(u => [(u.Name || '').trim().toLowerCase(), (u['SC representative'] || '').toLowerCase()]));
      const isRep = x => { const last = x.Name.trim().split(/\s+/).pop().toLowerCase(); return !!last && (repOf[(x.University || '').trim().toLowerCase()] || '').includes(last); };
      const seen = new Set();
      data.contacts = committee
        .filter(x => x.Name && x.Email)
        .filter(x => { const k = x.Email.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
        .map(x => ({ name: x.Name, uni: x.University || '', email: x.Email.trim(), rep: isRep(x) }));
    } else {
      // The checklist is read straight from Airtable so a tick saved a moment ago shows at once.
      const tasks = await airtable('SC Tasks').then(r => shape({ 'SC Tasks': r })['SC Tasks']).catch(() => T['SC Tasks']);
      data.me = { name: who.Name || '', uni: (who.University || '').trim(), role: who.Role || '', teams: who['Assigned teams'] || [] };
      data.committee = committee.filter(x => x.Name).map(x => ({ name: x.Name, uni: x.University || '', role: x.Role || '' }));
      data.tasks = tasks.filter(t => t.Task).map(t => ({ id: t.id, task: t.Task, notes: t.Notes || '', due: t['Due date'] || null, milestone: !!t.Milestone, doneBy: t['Done by'] || [] }));
      data.updates = T.Updates.filter(u => u.Title).map(u => ({ title: u.Title, date: u.Date || null, summary: u.Summary || '' }));
      data.universityStatus = universities.filter(u => u.Name).map(u => ({
        name: u.Name, rep: u['SC representative'] || '', participation: u.Participation || 'Not started',
        studentList: u['Student list'] || 'Not started', mentorList: u['Mentor list'] || 'Not started',
      }));
      data.attendance = students.filter(x => x.Name).map(x => ({ name: x.Name, uni: x.University || '', team: x['Team number'] || '', att: days(x) }));
    }
    // Which layer answered (memory, shared, stale or airtable): handy when checking the cache works.
    return json(200, data, { 'X-Data-Source': snap.layer });
  } catch (err) {
    // Another copy of this function is still fetching the very first snapshot: the page tries again.
    if (err.busy) return json(503, { error: 'busy' }, { 'Retry-After': '3' });
    console.error(err);
    return json(502, { error: 'Could not load data from Airtable' });
  }
};
