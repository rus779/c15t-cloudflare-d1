import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import worker from '../src/worker.ts';

const origin = 'https://example.test';
const endpoint = origin + '/api/consent';

async function resolve(country, headers) {
  const request = new Request(endpoint, { headers });
  const response = await worker.fetch(request, { DEMO_COUNTRY: country });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  return response.json();
}

test('a fresh visit prompts in Germany and falls back to opt-in for unknown locations', async () => {
  for (const country of ['DE', 'XX', 'T1']) {
    const { policyResolution } = await resolve(country);
    assert.equal(policyResolution.policy.model, 'opt-in');
    assert.notEqual(policyResolution.policy.prompt, 'none');
  }
});

test('a fresh visit in Georgia has no automatic prompt and still allows preferences', async () => {
  const { policyResolution, resolvedPrivacySignals } = await resolve('GE', { 'Sec-GPC': '1' });
  assert.equal(policyResolution.policy.prompt, 'none');
  assert.ok(policyResolution.policy.rights.includes('preferences'));
  assert.equal(resolvedPrivacySignals.gpc, true);
});

test('valid choices are durable, and retrying an identical receipt adds no row', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(readFileSync(new URL('../migrations/0001_consent_receipts.sql', import.meta.url), 'utf8'));
    const env = {
      CONSENT_DB: {
        prepare: (sql) => ({
          bind: (...params) => ({ run: async () => sqlite.prepare(sql).run(...params) }),
        }),
      },
    };
    const { policyResolution } = await resolve('DE');
    const receipt = {
      subjectId: 'sub_123456789ABCDEFGHJKLMN',
      actionAt: Date.now(),
      measurement: true,
      policyId: policyResolution.policyId,
      fingerprint: policyResolution.fingerprints.choice,
      country: 'DE',
      region: null,
    };
    const send = (body, sender = origin) => worker.fetch(new Request(endpoint, {
      method: 'POST',
      headers: { Origin: sender, 'Content-Type': 'application/json' },
      body,
    }), env);

    assert.equal((await send(JSON.stringify(receipt), 'https://other.test')).status, 403);
    assert.equal((await send(' '.repeat(2049))).status, 413);
    assert.equal((await send(JSON.stringify({ ...receipt, fingerprint: '0'.repeat(64) }))).status, 422);
    const withdrawal = { ...receipt, measurement: false, actionAt: receipt.actionAt + 1 };
    for (const choice of [withdrawal, receipt, receipt]) {
      assert.equal((await send(JSON.stringify(choice))).status, 204);
    }
    const rows = sqlite.prepare('SELECT measurement FROM consent_receipts ORDER BY action_at_ms').all();
    assert.deepEqual(rows.map((row) => row.measurement), [1, 0]);
  } finally {
    sqlite.close();
  }
});
