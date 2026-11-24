import {
  buildSetCookieHeader,
  createSessionToken,
  readJsonBody,
  sendJson,
  timingSafePasscodeEqual,
  verifySessionCookie,
} from './_session.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return sendJson(res, 200, { authenticated: verifySessionCookie(req) });
  }

  if (req.method === 'DELETE') {
    return sendJson(
      res,
      200,
      { ok: true, authenticated: false },
      { 'Set-Cookie': buildSetCookieHeader('', true) }
    );
  }

  if (req.method === 'POST') {
    try {
      const expected = process.env.KEYGEN_ADMIN_PASSCODE?.trim();
      if (!expected) {
        return sendJson(res, 503, { error: 'Admin passcode is not configured on the server.' });
      }
      const body = await readJsonBody(req);
      const passcode = String(body.passcode || '').trim();
      if (!passcode || !timingSafePasscodeEqual(passcode, expected)) {
        return sendJson(res, 401, { error: 'Incorrect passcode.' });
      }
      const token = createSessionToken();
      return sendJson(
        res,
        200,
        { ok: true, authenticated: true },
        { 'Set-Cookie': buildSetCookieHeader(token, false) }
      );
    } catch {
      return sendJson(res, 400, { error: 'Invalid request.' });
    }
  }

  return sendJson(res, 405, { error: 'Method not allowed.' });
}
