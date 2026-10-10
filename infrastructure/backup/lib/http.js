'use strict';

const SESSION_COOKIE = 'rb_session';
const API_PREFIX = '/api/v1';

function extractSessionCookie(response) {
  const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const raw = setCookie.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!raw) return null;
  return raw.split(';')[0];
}

async function login(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}${API_PREFIX}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`Login failed against ${baseUrl}: ${response.status} ${await response.text()}`);
  }
  const cookie = extractSessionCookie(response);
  if (!cookie) {
    throw new Error(`Login against ${baseUrl} did not set a ${SESSION_COOKIE} cookie.`);
  }
  const body = await response.json();
  return { cookie, user: body.data.user };
}

async function getHealthReady(baseUrl) {
  const response = await fetch(`${baseUrl}${API_PREFIX}/health/ready`);
  return { status: response.status, body: await response.json() };
}

async function getTrialBalance(baseUrl, cookie, organizationId) {
  const response = await fetch(
    `${baseUrl}${API_PREFIX}/organizations/${organizationId}/reports/trial-balance`,
    { headers: { cookie } },
  );
  if (!response.ok) {
    throw new Error(`Trial balance fetch failed: ${response.status} ${await response.text()}`);
  }
  const body = await response.json();
  return body.data;
}

async function downloadAttachment(
  baseUrl,
  cookie,
  organizationId,
  entityType,
  entityId,
  attachmentId,
) {
  // The generic collaboration route handles attachment download for every entity type
  // (apps/api/src/collaboration/collaboration.controller.ts), so it works uniformly for
  // both INVOICE and BILL attachments without needing a per-entity-type route.
  const downloadRoute = `${baseUrl}${API_PREFIX}/organizations/${organizationId}/collaboration/${entityType}/${entityId}/attachments/${attachmentId}/download`;
  const response = await fetch(downloadRoute, { headers: { cookie } });
  if (!response.ok) {
    throw new Error(
      `Attachment download metadata failed: ${response.status} ${await response.text()}`,
    );
  }
  const body = await response.json();
  const fileResponse = await fetch(body.data.downloadUrl);
  const bytes = await fileResponse.arrayBuffer();
  return { status: fileResponse.status, bytes: bytes.byteLength };
}

module.exports = { login, getHealthReady, getTrialBalance, downloadAttachment, SESSION_COOKIE };
