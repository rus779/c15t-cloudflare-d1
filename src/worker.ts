import { location, policy, policyRevision, validateReceipt } from './policy.ts';

interface Env {
  ASSETS: Fetcher;
  CONSENT_DB: D1Database;
  DEMO_COUNTRY?: string;
}

const headers = { 'Cache-Control': 'private, no-store' };
const maxBodyBytes = 2048;

function empty(status: number, extraHeaders?: Record<string, string>) {
  return new Response(null, { status, headers: { ...headers, ...extraHeaders } });
}

async function readReceipt(request: Request) {
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBodyBytes) {
          await reader.cancel();
          return { status: 413 } as const;
        }
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  }

  try {
    return { value: JSON.parse(text + decoder.decode()) as unknown };
  } catch {
    return { status: 400 } as const;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/consent') return env.ASSETS.fetch(request);

    if (request.method === 'GET') {
      const country = env.DEMO_COUNTRY || request.cf?.country;
      const region = env.DEMO_COUNTRY ? undefined : request.cf?.regionCode;
      const result = await policy.init({ overrides: location(country, region), user: null });
      return Response.json({
        location: result.location,
        policyResolution: result.policyResolution,
        ...(request.headers.get('Sec-GPC') === '1'
          ? { resolvedPrivacySignals: { gpc: true } }
          : {}),
      }, { headers });
    }

    if (request.method !== 'POST') return empty(405, { Allow: 'GET, POST' });
    if (request.headers.get('Origin') !== url.origin) return empty(403);
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !==
        'application/json') return empty(415);

    const body = await readReceipt(request);
    if (body.status !== undefined) return empty(body.status);
    const receipt = await validateReceipt(body.value);
    if (!receipt) return empty(422);

    try {
      await env.CONSENT_DB.prepare(`
        INSERT INTO consent_receipts (
          subject_id, action_at_ms, measurement, policy_id, policy_revision,
          policy_fingerprint, received_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (subject_id, action_at_ms, measurement, policy_fingerprint) DO NOTHING
      `).bind(
        receipt.subjectId,
        receipt.actionAt,
        receipt.measurement ? 1 : 0,
        receipt.policyId,
        policyRevision,
        receipt.fingerprint,
        Date.now(),
      ).run();
    } catch {
      console.warn('consent_receipt_storage_unavailable');
      return empty(503);
    }
    return empty(204);
  },
} satisfies ExportedHandler<Env>;
