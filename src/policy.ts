import { createOfflineTransport, recommendedPolicyRules } from '@c15t/core';

export const policyRevision = 'demo-measurement-1';
const countryCode = /^[A-Z]{2}$/;
const regionCode = /^[A-Z0-9]{1,3}$/;

export function location(country?: string, region?: string) {
  // Cloudflare uses XX for unknown locations and T1 for Tor.
  if (!country || country === 'XX' || !countryCode.test(country)) return {};
  return { country, region: region && regionCode.test(region) ? region : undefined };
}

export const policy = createOfflineTransport({
  policyRules: recommendedPolicyRules().map((rule) => ({
    ...rule,
    copyRevision: policyRevision,
    proof: { storeIp: false, storeLanguage: false, storeUserAgent: false },
    // Keep the no-prompt rule while allowing choices from Cookie settings.
    ...(rule.model === 'none' ? { model: 'opt-out', rights: ['preferences'] } : {}),
  })),
});

type Receipt = {
  subjectId: string;
  actionAt: number;
  measurement: boolean;
  policyId: string;
  fingerprint: string;
  country: string | null;
  region: string | null;
};

function isCode(value: unknown, pattern: RegExp) {
  return value === null || (typeof value === 'string' && pattern.test(value));
}

export async function validateReceipt(value: unknown, now = Date.now()) {
  if (!value || typeof value !== 'object') return null;
  const receipt = value as Partial<Receipt>;
  const { subjectId, actionAt, measurement, policyId, fingerprint, country, region } =
    receipt;

  // The c15t outbox can retry a choice for up to seven days.
  if (
    typeof subjectId !== 'string' ||
    !/^sub_[1-9A-HJ-NP-Za-km-z]{20,32}$/.test(subjectId) ||
    typeof actionAt !== 'number' ||
    !Number.isSafeInteger(actionAt) ||
    actionAt < now - 8 * 24 * 60 * 60 * 1000 ||
    actionAt > now + 5 * 60 * 1000 ||
    typeof measurement !== 'boolean' ||
    typeof policyId !== 'string' ||
    typeof fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(fingerprint) ||
    !isCode(country, countryCode) ||
    !isCode(region, regionCode)
  ) return null;

  // A retry may reach the Worker from a different location.
  const { policyResolution } = await policy.init({
    overrides: location(country ?? undefined, region ?? undefined),
    user: null,
  });
  if (
    policyResolution?.status !== 'matched' ||
    policyResolution.policyId !== policyId ||
    policyResolution.fingerprints.choice !== fingerprint
  ) return null;

  return { subjectId, actionAt, measurement, policyId, fingerprint };
}
