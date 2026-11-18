// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Maker's Asylum
const { verify, readCookie, airtable, json } = require('../../lib/util');

const days = rec => [...Array(10)].map((_, i) => !!rec[`Day ${i + 1}`]);
const photo = att => (att && att[0] && ((att[0].thumbnails && att[0].thumbnails.large && att[0].thumbnails.large.url) || att[0].url)) || null;

exports.handler = async event => {
  const s = verify(readCookie(event.headers));
  if (!s || s.t !== 'session') return json(401, { error: 'signed-out' });

  try {
    const [students, mentors, links, agenda, partners, universities] = await Promise.all([
      airtable('Students'),
      airtable('Mentors'),
      airtable('Important Links'),
      airtable('Agenda', { 'sort[0][field]': 'Start time' }),
      airtable('Partners'),
      airtable('Universities'),
    ]);
    const isSC = s.role === 'sc';

    // What every signed-in person may see about other students (no emails)
    const pub = x => ({
      name: x.Name || '', uni: x.University || '', country: x.Country || '', city: x.City || '',
      team: x['Team number'] || '', sdg: x['SDG interests'] || [],
    });

    const data = {
      role: s.role,
      students: students.filter(x => x.Name).map(pub),
      mentors: mentors.filter(m => m.Name).map(m => ({
        name: m.Name, photo: photo(m.Photo), org: m.Organisation || '', role: m.Role || '',
        type: m['Mentor type'] || '', expertise: m.Expertise || [], sessions: m.Sessions || [],
        teams: m['Assigned teams'] || [], bio: m['Short bio'] || '', linkedin: m.LinkedIn || '',
        confirmed: !!m.Confirmed,
      })),
      links: links.filter(l => l.Name && (isSC || (l.Audience || 'Everyone') !== 'Steering Committee'))
        .map(l => ({ name: l.Name, note: l.Remarks || '', url: l.URL || '', due: l['Event Date/Deadline'] || null, sc: l.Audience === 'Steering Committee' })),
      agenda: agenda.filter(a => a.Session && a.Date).map(a => ({
        session: a.Session, day: a['Day number'], date: a.Date, start: a['Start time'], end: a['End time'],
        phase: a.Phase || '', format: a.Format || '', facilitator: a.Facilitator || '',
        studentTodo: a['Students to-do'] || '', zoom: a['Zoom link'] || '', slides: a.Slides || '', recording: a.Recording || '',
        ...(isSC ? { scTodo: a['Steering Committee to-do'] || '', notes: a.Notes || '' } : {}),
      })),
      partners: partners.filter(p => p.Name).map(p => ({ name: p.Name, logo: photo(p.Logo), url: p.Website || '' })),
      universities: universities.filter(u => u.Name).map(u => ({ name: u.Name, country: u.Country || '', lat: u.Latitude, lng: u.Longitude })),
    };

    if (!isSC) {
      const me = students.find(x => (x['Email address'] || '').trim().toLowerCase() === s.email);
      if (!me) return json(401, { error: 'signed-out' });
      data.me = { ...pub(me), degree: me.Degree || '', year: me['Year of study'] || '', skills: me.Skills || '', profile: me['Professional profile'] || '', att: days(me) };
    } else {
      const [committee, tasks, updates] = await Promise.all([
        airtable('Steering Committee'),
        airtable('SC Tasks', { 'sort[0][field]': 'Due date' }),
        airtable('Updates', { 'sort[0][field]': 'Date', 'sort[0][direction]': 'desc' }),
      ]);
      const me = committee.find(x => (x.Email || '').trim().toLowerCase() === s.email);
      if (!me) return json(401, { error: 'signed-out' });
      data.me = { name: me.Name || '', uni: me.University || '', role: me.Role || '', teams: me['Assigned teams'] || [] };
      data.committee = committee.filter(x => x.Name).map(x => ({ name: x.Name, uni: x.University || '', role: x.Role || '' }));
      data.tasks = tasks.filter(t => t.Task).map(t => ({ id: t.id, task: t.Task, notes: t.Notes || '', due: t['Due date'] || null, milestone: !!t.Milestone }));
      data.updates = updates.filter(u => u.Title).map(u => ({ title: u.Title, date: u.Date || null, summary: u.Summary || '' }));
      data.universityStatus = universities.filter(u => u.Name).map(u => ({
        name: u.Name, rep: u['SC representative'] || '', participation: u.Participation || 'Not started',
        studentList: u['Student list'] || 'Not started', mentorList: u['Mentor list'] || 'Not started',
      }));
      data.attendance = students.filter(x => x.Name).map(x => ({ name: x.Name, uni: x.University || '', team: x['Team number'] || '', att: days(x) }));
    }
    return json(200, data);
  } catch (err) {
    console.error(err);
    return json(502, { error: 'Could not load data from Airtable' });
  }
};
