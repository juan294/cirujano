# Phase 1: conditional reads and quota hold

## Contract

1. Cache GET 200 representations with ETags using complete endpoint and sorted query identity. Revalidate every read; never serve cached evidence after a failed request. Cache bounds: 128 entries, 8 MiB serialized representation bytes; evict oldest entries.
2. Accept empty 304 only with a matching validator-backed representation. Merge 304 metadata over cached metadata, preserving omitted pagination Link. New 200 replaces all metadata. Keep pagination completeness and all repository, job and ownership guards.
3. Accept gh exit 1 only for the expected 304 response; successful-looking 200 from a failed process remains an error. Orphan 304, malformed data and HTTP errors fail closed. Mutations stay uncached and successful runner mutations invalidate runner-list cache.
4. Observe fresh quota headers, including on 304. At Core remaining <=2000 hold subsequent reads until a future reset, or 60 seconds if no usable reset. Honor 403/429 Retry-After/reset and use an exponential fallback starting at 60 seconds and capped at 15 minutes when neither is usable; reset the fallback after a valid successful response. Later responses cannot shorten an active hold. Expose public readHold() returning null or {reason,retryAfterMs,retryAtMs}; no credentials or raw response bodies. Expiry allows fresh revalidation. Cache eviction/restart forces unconditional reads.
5. During a hold, queue evidence is incomplete with zero eligible jobs; preserve known busy state and normal provider/guest accounting. CLI tick output includes the active GitHub hold and queue completeness/reason/retry fields. Do not change watch delay, config hash, permit or state schemas.

## Pseudocode

READ(request): if readHold exists, fail incomplete without subprocess; otherwise attach cached ETag, dispatch, observe quota headers, reject invalid process status, revalidate or replace bounded cache, parse domain data normally.
OBSERVE: perform existing provider/guest/accounting flow; if adapter hold exists, mark queue incomplete and disclose retry; retain known busy protections.

## Behavioral oracles

Use fake external process and clock. Test 200 -> 304 for repository/runs/jobs/runners, status/page/attempt key separation, mixed page revalidation, replaced Link/ETag, eviction and oversized representations, failure without stale fallback, uncached mutations, reserve/backoff expiry, concurrent responses and hold disclosure. Assert held observations cannot acquire a VM and preserve accounting/known-busy safety. No live APIs.

## Verification and activation boundary

Capture TDD red before implementation, green after. Independent plan-compliance review required. Simplify uses separate reuse, quality and efficiency passes. Run sequentially: pnpm run typecheck; pnpm run lint; pnpm run verify:bundle; pnpm test. Inspect diff, generated outputs and public visibility. Local acceptance does not certify rate savings or authorize live replacement. Activation requires quiescent controller/VM ownership proof and fresh permit/candidate migration; never edit only a permit or rewrite ownership labels to force a match.
