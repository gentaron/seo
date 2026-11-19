# UNDERCURRENT × QAIZ: read-only observation bridge

The systems remain independently deployable. UNDERCURRENT is a **trend/news candidate observer**; QAIZ is an **observational market and physical-world research system**. Neither system has evidence that trend popularity predicts returns.

## API contracts

- `GET /api/intelligence`: `gentaron.world-events/1`. Up to 30 unverified candidate events with publisher/source evidence, observation timestamp, editorial-importance score, and collection coverage. Never use `impact` as confidence, likelihood, or a trading feature.
- `GET /api/unified`: `gentaron.observation/1`. Returns the UNDERCURRENT event list and, when configured, QAIZ `GET /api/feed`. They remain in separate `undercurrent` and `qaiz` objects, without a synthesized score, causal claim, or prediction.
- QAIZ `GET /api/feed`: `gentaron.feed/1`, existing read-only market regime feed.
- QAIZ `GET /api/physical/export?after=<series_id>&limit=5`: bounded physical series archive. The original `firstSeenAt` and later revisions are distinct.

## Production configuration

In the `seoaiweb` Netlify site's **environment variables**, set `QAIZ_PUBLIC_URL` to the **verified HTTPS base URL** of the deployed QAIZ Cloudflare Worker; never copy a guessed hostname. The `/api/unified` handler constructs the fixed `/api/feed` path and does not accept a caller-supplied upstream URL. Until the QAIZ hostname is verified and the variable is deployed, `qaiz.status` is `not-configured`, while UNDERCURRENT continues to work.

If QAIZ responds with an error, a timeout, unexpected schema, or oversized JSON, `/api/unified` returns a visible status and null QAIZ feed instead of fake values. No QAIZ token or privileged endpoint is needed. This is a read-only integration. Never pass private portfolios through either public feed.

## Time & evidence contract

The UNDERCURRENT snapshot `generatedAt` is a *collection time*, not the original publication time. Each event's `at` is based on source timestamps and cannot be treated as authoritative publication time. QAIZ `generatedAt` describes its own snapshot, whose member prices may be from different as-of times. The two timestamps are **not synchronized**.

Only `qaiz.evidence=observed` items are included in the bridge; draft research does not become a market fact. The absence of a QAIZ feed is **missing data**, not zero risk or neutral sentiment. `underCurrent.impact` is an editorial priority heuristic and is not truth confidence.

## Validation

- UNDERCURRENT: `npm test && npm run build`.
- QAIZ: `npm run typecheck && npm test`, plus its research lab/parity CI.
- Verify `/api/intelligence` and `/api/unified` on the Netlify deploy preview before production.
- Verify the actual QAIZ production hostname, API schema and deployment SHA before configuring cross-site retrieval.
- Do not merge trend scores into QAIZ factors, outlook, or backtests without point-in-time hypothesis registration, source independence checks and strict out-of-sample testing.

## Still outside this implementation

Entity reconciliation across languages, causal attribution, independent fact-checking, full-news archives, market-reaction event studies, and a single visual dashboard require separate evidence and validation. They have **not** been implemented merely by exposing these APIs.
