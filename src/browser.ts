import { custom, init } from '@c15t/browser';
import type { InitResponse } from '@c15t/core';
import { ConsentSaveRejectedError } from '@c15t/core/transports';
import { policy } from './policy.ts';

const consent = init({
  consentCategories: ['necessary', 'measurement'],
  reloadOnConsentRevoked: false,
  i18n: {
    locale: 'en',
    messages: {
      en: {
        cookieBanner: {
          description: 'Choose whether to allow the example measurement category. This demo loads no analytics scripts.',
        },
        consentManagerDialog: {
          description: 'Manage your choice for the example measurement category.',
        },
      },
    },
  },
  mode: custom({
    async init(context) {
      try {
        const response = await fetch('/api/consent', { cache: 'no-store' });
        if (response.ok) return (await response.json()) as InitResponse;
      } catch {
        // Fall back to the SDK policy for an unknown location.
      }
      return policy.init({ ...context, overrides: {} });
    },
    async save(payload) {
      const measurement = payload.confirmed.categories.measurement;
      if (measurement === undefined) return { ok: true };

      const basis = payload.choice.categories.measurement?.basis;
      const decision = payload.decisionInputs;
      if (basis?.kind !== 'choice-v1' || !decision?.policyId) {
        throw new ConsentSaveRejectedError({
          code: 'MISSING_CONSENT_BASIS',
          message: 'Consent choice has no supported policy basis',
          status: 422,
        });
      }

      const response = await fetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: payload.subjectId,
          measurement,
          actionAt: payload.confirmed.actionAt,
          policyId: decision.policyId,
          fingerprint: basis.fingerprint,
          country: decision.country,
          region: decision.region,
        }),
      });

      if (response.ok) return { ok: true, subjectId: payload.subjectId };
      if ([400, 403, 413, 415, 422].includes(response.status)) {
        throw new ConsentSaveRejectedError({
          code: 'INVALID_CONSENT_RECEIPT',
          message: 'Consent receipt was refused',
          status: response.status,
        });
      }
      throw new Error('Consent receipt storage is unavailable');
    },
  }),
});

document.querySelector('#cookie-settings')?.addEventListener('click', async () => {
  await consent.ready();
  consent.openDialog();
});
