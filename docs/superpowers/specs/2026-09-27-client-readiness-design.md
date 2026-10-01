# Client readiness: authentication, recovery and bounded dashboard reads

Approved in conversation: implement all three audited remediations before onboarding another client. Work locally; no production configuration or push is implied.

## Authentication
Protect the unauthenticated identifier resolver before database lookups with an atomic, shared server-side limiter. Canonical account limits cover nickname/email aliases. Store keyed hashes, not passwords or plaintext identifiers. Native Supabase CAPTCHA must also protect direct Auth access. Return 429 for throttling; fail closed on missing security configuration. Browser integration supports Turnstile and explains configuration/loading failures.

## Recovery
Provide an opt-in scheduled backup runner with encrypted external storage, retention and failure notification. Include application/Auth database data, actual Storage objects, and n8n database, binaries and encryption key. A successful archive is not evidence of a successful restore. Document an isolated restore drill and record external settings still required; never claim production backups are active from repository changes alone.

## Dashboard
Default reception interval: 90 calendar days, inclusive of today in Europe/Bucharest. Reception and delivery intervals are independent, inclusive, visibly editable and removable. Selecting historical dates queries the database, without a hidden recent-history cutoff. Undated reception falls back to creation time; otherwise a reception interval excludes undated records.

New read API returns at most 200 work orders (UI page size 100), total count, server-side totals and filter choices. Apply tenant/role/date conditions before detailed item expansion. Preserve financial masking. Filters and stable sort apply across the complete selected dataset, not just loaded rows. Ignore responses superseded by another filter, view, lab or login.

Existing operational cards remain usable per page. Totals must explicitly describe the complete filtered interval; page-specific grouped details must be labeled. Full reports fetch bounded batches only on explicit export and must never silently export one page as the whole report. Dates/filters should be included in exported report descriptions.

## Release gates
Offline tests cover limit enforcement, date boundaries/history, tenant isolation, page totals and stale requests, plus backup failure paths. Live gate: configure secrets/CAPTCHA, apply SQL and Edge deployment, prove login throttling in staging, run and restore an external backup, measure queries on representative data. No new-client readiness claim until these external gates pass.
