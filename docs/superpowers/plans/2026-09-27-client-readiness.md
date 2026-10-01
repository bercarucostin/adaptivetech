# Client readiness implementation plan

**Goal:** implement the approved login, recovery and dashboard remediations.
**Spec:** ../specs/2026-09-27-client-readiness-design.md
**Architecture:** dedicated authentication limiter and backup runner; bounded dashboard RPC consumed by a small browser data controller and existing views.
**Tech stack:** Supabase PostgreSQL/Edge Functions, vanilla browser JavaScript, Python/shell backup tools.

## Global constraints
- No push or live database/infrastructure mutation.
- Preserve tenant permissions, price masking and existing tooth editing.
- 90 calendar days by reception; independently optional delivery dates.
- 100 rows/page, API maximum 200; full-filter totals independent of page.

## Tasks and verification
- [x] Authentication: failing request/limiter tests, implementation, offline Node/SQL tests; document Turnstile and required secrets.
- [x] Backup: failing pagination/failure-path tests, automated encrypted backup runner and isolated recovery instructions; offline tests without real data.
- [x] SQL read API: historical/boundary/tenant/page/aggregate tests against disposable PostgreSQL, implement get_work_orders_page, repeat tests.
- [x] Browser: pure data-controller tests for defaults, pagination, stale responses and export batching; integrate filters, views, full-filter totals, login controller and responsive controls.
- [x] Integration: regenerate schema bundles, run affected and baseline suites, inspect diff, independent final review, record live deployment steps.

## Review focus
1. Historical delivery filters combined with visible reception defaults.
2. Rapid filter changes, logout and lab changes while requests are pending.
3. Reports spanning more than one page and masked finances for restricted roles.
4. Missing CAPTCHA/limiter configuration and attempted header spoofing.
5. Partial Storage export or offsite upload failure must fail the backup job.

## Execution ledger
User explicitly authorized implementation after the conversational design. Continue without repeating approval requests, per session instructions. Independent auth/backup/SQL work delegated under dispatching-parallel-agents; parent owns frontend and integration. Existing shared checkout retained to preserve the established local-review/push workflow. No commits until verification; no automatic push.

Independent review found unknown-price coercion and technician facet pagination; both fixed. Additional regression guards cover hidden technician inference, production status filtering and historical salary totals. Backup scope corrected to discover every Storage bucket, including chat-files. No deferred code findings.

Deployment dependencies: user confirms no Turnstile and no external backup destination yet. Public site key intentionally remains empty; login fails closed until configured. No production rollout or push performed.

Final verification: 164 Node tests passed; 42 Python SQL/integration tests passed (including 26 JSC billing cases); 13 backup tests passed. Dashboard PGlite regression passed. Offline browser passed pagination, historical filters, complete 305-row PDF export, technician facets and viewport checks. Schema bundles current; git diff --check clean. Docker/image build, real CAPTCHA, external backup and restoration remain explicit environment gates, not claimed complete.
