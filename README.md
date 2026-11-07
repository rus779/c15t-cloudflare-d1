# c15t v3 on Cloudflare Workers and D1

A runnable example that uses the c15t browser SDK, a same-origin Worker, and a
D1 database. The Worker resolves the regional policy and records explicit
measurement choices. Cookie settings stay available in every region.

The local example needs Node and npm. Cloudflare credentials are only needed to
deploy. The integration uses c15t's custom transport and needs no Inth account.

## Run locally

Use Node 26.13.0 from `.nvmrc` or a compatible newer Node version with npm 11.20
or later.

```sh
git clone https://github.com/rus779/c15t-cloudflare-d1.git
cd c15t-cloudflare-d1
npm ci
npx wrangler d1 migrations apply c15t-consent-demo --local
npm run dev -- --var DEMO_COUNTRY:DE
```

Open [http://localhost:8787](http://localhost:8787) in a fresh browser profile.
Germany (`DE`) triggers an opt-in banner. Accept, reload, and use **Cookie
settings** to reject. In the browser's network panel, each successful
`POST /api/consent` returns `204` after D1 writes the receipt.

Inspect the local database from a second terminal.

```sh
npx wrangler d1 execute c15t-consent-demo --local \
  --command 'SELECT measurement, policy_id, policy_revision FROM consent_receipts ORDER BY action_at_ms'
```

Look for `measurement = 1` after acceptance and `measurement = 0` after
rejection. Replaying the same receipt leaves a single row for that choice.

To see the no-banner case, stop the server, rerun it with
`npm run dev -- --var DEMO_COUNTRY:GE`, and open a fresh browser profile.
Georgia (`GE`) has no automatic prompt in the example policy. **Cookie
settings** still opens the dialog and lets you save a choice. Omitting the
override locally exercises the unknown-location fallback.

## Deploy to your Cloudflare account

```sh
npx wrangler login
npx wrangler d1 create c15t-consent-demo --update-config=false
```

Add the returned `database_id` to the existing `CONSENT_DB` entry in
[`wrangler.jsonc`](wrangler.jsonc). If you used a different database name, update
the entry and the following command to match.

```sh
npx wrangler d1 migrations apply c15t-consent-demo --remote
npm run deploy
```

Open the URL printed by Wrangler. The deployed Worker uses Cloudflare's
`request.cf.country` and `request.cf.regionCode`. Keep `DEMO_COUNTRY` unset when
deploying so each visitor gets their regional policy.

## How it works

- [`src/policy.ts`](src/policy.ts) starts from c15t's recommended regional rules.
  It keeps the SDK's no-prompt regions and allows visitors in those regions to
  record explicit choices from Cookie settings. Unknown locations use opt-in.
  Review the rules for your site and bump the policy revision when you change the
  purposes or consent copy.
- [`src/browser.ts`](src/browser.ts) mounts the c15t banner and settings dialog
  and sends explicit measurement choices to the Worker. c15t stores the active
  choice in the browser and retries temporary save failures. This example loads
  no trackers. If you add analytics, wire the script to your consent policy.
- [`src/worker.ts`](src/worker.ts) returns the resolved policy and relays the
  Global Privacy Control request signal. It validates receipt shape and policy
  fingerprint before appending a deduplicated receipt to D1. Each receipt
  includes a pseudonymous browser ID, choice, timestamps, and policy identifiers.
  The database stores no IP address, location, or user account ID.

The receipt endpoint is public, as visitors can choose before signing in. An
origin check blocks cross-origin browser writes. A direct HTTP client can still
construct a receipt, so these rows are a record of submitted choices. Set a
retention policy and consider request rate limits if you operate a public
instance.

## Checks

```sh
npm run check
npm run build
npx wrangler deploy --dry-run
```

`npm run check` type-checks the code and tests regional policy, origin and body
validation, choice history, and retry deduplication against SQLite.

## References

- [c15t custom transport](https://c15t.com/docs/frameworks/javascript/transports#custom)
- [c15t browser API](https://c15t.com/docs/frameworks/javascript/api/browser)
- [Cloudflare D1 quickstart](https://developers.cloudflare.com/d1/get-started/)
- [Workers static assets](https://developers.cloudflare.com/workers/static-assets/binding/)

[Apache License 2.0](LICENSE).
