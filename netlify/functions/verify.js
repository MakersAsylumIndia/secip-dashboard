// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Maker's Asylum
const { sign, verify } = require('../../lib/util');
const DAYS = 14;

exports.handler = async event => {
  const p = verify(event.queryStringParameters && event.queryStringParameters.token);
  if (!p || p.t !== 'link') return { statusCode: 302, headers: { Location: '/?signin=expired' } };
  const session = sign({ email: p.email, role: p.role, t: 'session' }, DAYS * 86400);
  return {
    statusCode: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `secip_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`,
      'Cache-Control': 'no-store',
    },
  };
};
