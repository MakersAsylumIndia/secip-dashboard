// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Maker's Asylum Foundation
exports.handler = async () => ({
  statusCode: 302,
  headers: { Location: '/', 'Set-Cookie': 'secip_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' },
});
