# phpMyAdmin session regression

HTTP/2 clients may send multiple Cookie fields. Before forwarding a request
to HTTP/1.1, OxideProxy joins them with `; ` (RFC 9113 section 8.2.2), preserving
their order and values. Response Set-Cookie fields must remain separate.

The `/pma/` route also forwards the actual public protocol and host so that
HTTPS uses secure cookies while local HTTP remains usable. phpMyAdmin must
remain behind the proxy; do not expose its internal HTTP port publicly.

Regression acceptance: obtain a fresh form token/session, then submit the same
form with cookies combined and with separate Cookie fields over HTTP/2.
Use a nonexistent diagnostic account, never real credentials in test output.
Both should reach authentication rejection without the session-cookie error.
Before this fix, only the separate-fields case failed. Both passed after the
production hotfix on 2026-09-14, and the user confirmed browser access.

Rust unit tests cover joining, no-cookie/single-cookie requests, idempotence,
header sensitivity and preserving Set-Cookie. Run `cargo test --locked` in
`oxideproxy/` before promotion; the GitLab pipeline remains mandatory.
