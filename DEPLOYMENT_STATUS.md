# StagePass — Deployment Status

**Last updated:** end of session 4 (code follow-ups complete; awaiting AWS deployment)
**Repo:** https://github.com/neomogorosi74/stagepass (branch `main`)
**Region:** `us-east-1` (DynamoDB tables originally created in `eu-north-1` — verify all tables are in the same region as the Lambda)

---

## 1. What StagePass is

Visitor attendance tracking for free events. Not a ticketing system — "showing up is the connection."

**Black Labone** is a weekly event (every Thursday). Slogan: *Showing up is showing love*.

### Visitor flow (`Home.jsx`)
1. Black Labone splash (4s) → StagePass splash (4s)
2. Check-in form (first name, surname, mobile)
3. Welcome message (2.5s) — "Welcome to Black Labone" / "The Regular Shadow has returned." / rare variant
4. Today's Connection — everyone sees the same question, answer and conversation prompt. Cycles every 5 check-ins.
5. Done → visit count screen → **DONE** button resets to splash

### Event QR flow
- Admin creates an **event** (`status: draft/open/closed/cancelled`), sets a validity window, and generates a **QR code**.
- `validFrom`/`validTo` are required. The dashboard converts `datetime-local` input to an explicit UTC ISO timestamp using the **Africa/Johannesburg (UTC+2, no DST)** offset; the Lambda also treats naive timestamps as Johannesburg wall time and preserves explicit offsets/`Z`.
- The API rejects missing or malformed windows and requires `validTo > validFrom`.
- The QR encodes `https://<frontend>/?eventId=<id>&t=<token>`.
- Scanning it opens the normal check-in form with `eventId` + `token` attached.
- Event check-in is only accepted when: event exists, `status === "open"`, today is **Thursday in Africa/Johannesburg**, now is inside `validFrom`/`validTo`, the SHA-256 of the token matches `qrTokenHash`, and the token is not revoked.
- The event write is one `TransactWriteItems` call: atomically update the member (`ADD totalVisits 1`), insert the visit, and insert the attendance item with `attribute_not_exists(eventIdMember)`. A failed write cannot leave an attendance reservation that blocks retries, and concurrent duplicates are resolved by the conditional attendance put.
- Duplicate event check-in returns HTTP 200 with `alreadyCheckedInToday: true` and `alreadyCheckedInToEvent: true` (friendly UI, no visit increment).
- Generating a new QR replaces `qrTokenHash` and removes `revokedAt`; all older tokens stop matching.

### Admin dashboard (`/admin`)
Server-authenticated (see §5). Live activity feed, charts, visitor journey, search, PDF report, **Event Manager** (create events, open/close, generate/replace QR + download poster PDF).

---

## 2. AWS structure

```
┌─ Browser (React 18 + Vite 5, mobile-first SPA) ───────────────┐
│    hosted on AWS Amplify Hosting                              │
│    https://main.d1i8259hynrz6h.amplifyapp.com                 │
│    env: VITE_API_URL  (VITE_ADMIN_KEY no longer used)         │
└───────────────────────────────┬───────────────────────────────┘
                                │ HTTPS + Bearer token
┌─ API Gateway HTTP API "stagepass-api" ────────────────────────┐
│    https://vb2l7923be.execute-api.us-east-1.amazonaws.com     │
│    CORS owner: Lambda (returns Access-Control-Allow-Origin *) │
│    Allow-Headers: Content-Type, Authorization                 │
│    Allow-Methods: GET, POST, PATCH, OPTIONS                   │
│                                                                │
│    GET   /members              public   → stagepass-checkin   │
│    POST  /checkin              public   → stagepass-checkin   │
│    GET   /events/{id}          public   → stagepass-checkin   │
│    POST  /admin/login          public   → stagepass-checkin   │
│    GET   /admin/members        Bearer   → stagepass-checkin   │
│    GET   /admin/visits         Bearer   → stagepass-checkin   │
│    GET   /admin/events         Bearer   → stagepass-checkin   │
│    POST  /admin/events         Bearer   → stagepass-checkin   │
│    PATCH /admin/events/{id}    Bearer   → stagepass-checkin   │
│    POST  /admin/events/{id}/qr Bearer   → stagepass-checkin   │
└───────────────────────────────┬───────────────────────────────┘
                                │ invoke
┌─ Lambda "stagepass-checkin" (Python 3.12) ────────────────────┐
│    code: backend/lambda_function.py                           │
│    env: MEMBERS_TABLE, VISITS_TABLE, EVENTS_TABLE,            │
│         EVENT_ATTENDANCE_TABLE, ADMIN_SESSIONS_TABLE,         │
│         ADMIN_PASSWORD, ADMIN_SESSION_SECRET (optional),      │
│         FRONTEND_BASE_URL                                     │
│    role: stagepass-lambda-role                                │
│    logs: CloudWatch                                           │
└───────────────────────────────┬───────────────────────────────┘
                                │ boto3
┌─ DynamoDB (on-demand) ───────────────────────────────────────┐
│    stagepass-members            PK phoneNumber (String)       │
│        firstName, lastName, totalVisits, createdAt,           │
│        lastVisitAt, lastVisitDate                             │
│    stagepass-visits             PK visitId (String)           │
│        memberId, timestamp, eventId (optional)                │
│    stagepass-events             PK eventId (String)           │
│        eventName, eventDate, venue, status, validFrom,        │
│        validTo, qrTokenHash, revokedAt, createdAt, updatedAt  │
│    stagepass-event-attendance   PK eventIdMember (String)     │
│        = "<eventId>#<phoneNumber>"; memberId, visitId,        │
│        checkedInAt                                            │
│    stagepass-admin-sessions     PK token (String)             │
│        expiresAt, createdAt  (used when no JWT secret)        │
└───────────────────────────────────────────────────────────────┘
```

**Business rules in the Lambda:**
- Legacy check-in same-day cap is judged in **SAST (UTC+2)**. Event check-in is judged in **Africa/Johannesburg** and only on **Thursday**.
- Milestones: 5 = Supporter, 10 = Patron, 20 = Founding Member.
- Phone numbers normalised (spaces/dashes/brackets stripped) so `071 234 5678` === `0712345678`.
- Admin routes require `Authorization: Bearer <token>` from `POST /admin/login`. There is no longer a hardcoded frontend password or `x-api-key` admin check.
- `ADMIN_SESSION_SECRET` set + `PyJWT` available → stateless HS256 JWT. Otherwise the Lambda falls back to the `stagepass-admin-sessions` table. **PyJWT is not in the default Python 3.12 runtime**, so without a layer/bundle leave `ADMIN_SESSION_SECRET` empty and rely on the sessions table. If the sessions write fails and no JWT was issued, login returns **503** and never hands out an unusable token.
- `ZoneInfo("Africa/Johannesburg")` falls back to a fixed UTC+2 timezone if tzdata is missing, so cold starts cannot fail on a missing zone.

**CORS ownership (important):** the Lambda returns `Access-Control-Allow-Origin: *` (plus `Content-Type, Authorization` and `GET, POST, PATCH, OPTIONS`) on every response, including OPTIONS. This is a wildcard policy, **not** origin-restricted. Do **not** also enable API Gateway CORS for these routes unless you first remove the Lambda's CORS headers — two `Access-Control-Allow-Origin` headers break browsers. Recommended: leave API Gateway CORS disabled and ensure an `OPTIONS /{proxy+}` route (or per-path OPTIONS routes) reaches the Lambda; alternatively let API Gateway own CORS and delete `CORS_HEADERS` from `respond()`. Verify with `curl -i` that only one ACAO header is returned.

---

## 3. What is DONE ✅

### Session 1
| Item | Status |
|---|---|
| DynamoDB `stagepass-members` + `stagepass-visits` | ✅ created |
| IAM role `stagepass-lambda-role` + `STAGEPASS_POLICY` | ✅ created |
| Lambda `stagepass-checkin` | ✅ deployed, Python 3.12 |
| API Gateway HTTP API `stagepass-api` | ✅ created |
| Frontend on AWS Amplify | ✅ live |
| SPA rewrite `/*` → `/index.html` (200) | ✅ rule created |
| Same-day detection + DONE button | ✅ |

### Session 2 (code complete, **not yet deployed**)
| Item | Status |
|---|---|
| Server-side admin login (`POST /admin/login`, token issued) | ✅ code |
| Replaced hardcoded frontend password / `x-api-key` with Bearer tokens | ✅ code |
| Event CRUD (`GET/POST /admin/events`, `PATCH /admin/events/{id}`) | ✅ code |
| QR token generation (`POST /admin/events/{id}/qr`) + poster PDF | ✅ code |
| Public event lookup (`GET /events/{id}`) | ✅ code |
| Event-aware `/checkin` (Thursday/window/token/one-per-event) | ✅ code |
| `EventManager` UI wired into `/admin` | ✅ code |
| QR URL read from query params in `Home.jsx` | ✅ code |
| `qrcode` installed | ✅ |
| `npm run build` passing | ✅ (1.15 MB JS chunk warning only) |
| `backend/lambda_function.py` syntax check | ✅ |

### Session 3 (pre-deployment fixes, **not yet deployed**)
| Item | Status |
|---|---|
| `datetime-local` → explicit Johannesburg/UTC conversion (frontend) | ✅ |
| Backend treats naive timestamps as JHB; preserves explicit offsets | ✅ |
| Reject malformed/reversed validity windows (400) | ✅ |
| Event creation requires name, valid date, explicit ordered window, valid status | ✅ |
| `attribute_exists(eventId)` on event update and QR generation; 404 for unknown events | ✅ |
| Login returns 503 if no usable token can be persisted | ✅ |
| Event check-in uses `TransactWriteItems` (member + visit + attendance atomic) | ✅ |
| Duplicate/concurrent event check-in returns friendly 200; visit not incremented twice | ✅ |
| Admin session expiry/rejection redirects to `/login`; explicit Log out button | ✅ |
| Friendly event duplicate screen in the visitor flow | ✅ |
| QR poster includes event date and venue | ✅ |
| CORS headers corrected (no legacy `x-api-key`); doc now states wildcard policy | ✅ |
| Tests: `backend/test_lambda_function.py` (27 tests) + `tests/datetime.test.mjs` (6 tests) | ✅ passing locally |
| `npm run build` | ✅ |
| `python` syntax validation of `backend/lambda_function.py` | ✅ |

### Session 4 (follow-ups, **not yet deployed**)
| Item | Status |
|---|---|
| `PATCH /admin/events/{id}` updates name, date, venue, status and either/both window bounds | ✅ |
| Partial event edits validate the merged validity window before writing | ✅ |
| Event editing UI in `EventManager` (Edit/Cancel, UTC ↔ Johannesburg conversion) | ✅ |
| `/events/{id}` pre-fetched in `Home.jsx`; event name/venue/date shown before check-in | ✅ |
| Admin API errors now surface the Lambda's `error` message instead of a generic failure | ✅ |
| QR response no longer duplicates the plaintext token; it is only inside `qrUrl` | ✅ |
| Removed dead `StagePassFlow.jsx`/`.css` and unused `aws-amplify` deps | ✅ |
| `stagepass-lambda.zip` rebuilt from `backend/lambda_function.py` (gitignored artifact) | ✅ |
| `npm test` / `npm run test:backend` scripts | ✅ |
| Tests: 32 backend + 8 datetime | ✅ passing |
| `npm run build` | ✅ |

---

## 4. What is LEFT ❌ — deploy the fixed backend + frontend

All session-2 to session-4 code changes are complete and locally verified, but **not yet deployed**. Do not deploy the frontend before the API routes exist.

### Task list (in order)
1. **Create the 3 new DynamoDB tables** (on-demand, same region as the Lambda):
   - `stagepass-events` — PK `eventId` (String)
   - `stagepass-event-attendance` — PK `eventIdMember` (String)
   - `stagepass-admin-sessions` — PK `token` (String), enable TTL on `expiresAt` (optional)
2. **Update IAM policy** `STAGEPASS_POLICY`. Actions actually used:
   - `stagepass-members`: `GetItem`, `PutItem`, `UpdateItem`, `Scan`
   - `stagepass-visits`: `PutItem`, `Scan`
   - `stagepass-events`: `GetItem`, `PutItem`, `UpdateItem`, `Scan`
   - `stagepass-event-attendance`: `PutItem`
   - `stagepass-admin-sessions`: `GetItem`, `PutItem`
   - CloudWatch Logs
   `TransactWriteItems` is authorised through those per-item actions (`UpdateItem` on members, `PutItem` on visits/attendance); there is no separate `dynamodb:TransactWriteItems` action.
3. **Set Lambda env vars**:
   - `EVENTS_TABLE=stagepass-events`
   - `EVENT_ATTENDANCE_TABLE=stagepass-event-attendance`
   - `ADMIN_SESSIONS_TABLE=stagepass-admin-sessions`
   - `ADMIN_PASSWORD=<new strong password>`
   - `ADMIN_SESSION_SECRET=` (leave empty unless PyJWT is bundled/available)
   - `FRONTEND_BASE_URL=https://main.d1i8259hynrz6h.amplifyapp.com`
   - `ADMIN_KEY` can be deleted once Bearer auth is live.
4. **Deploy the Lambda** from `backend/lambda_function.py` (or upload the rebuilt `stagepass-lambda.zip`), then confirm a clean cold start in CloudWatch (the `ZoneInfo` fallback prevents a tzdata failure).
5. **Add/verify API Gateway routes** (all payload 2.0 → `stagepass-checkin`), then **Deploy** the API:
   - `GET /members`, `POST /checkin`, `GET /events/{id}`, `POST /admin/login`
   - `GET /admin/members`, `GET /admin/visits`
   - `GET /admin/events`, `POST /admin/events`, `PATCH /admin/events/{id}`, `POST /admin/events/{id}/qr`
   - Add route parameters for `{id}` where required.
6. **CORS:** keep the Lambda as the single CORS owner (wildcard `*`). Leave API Gateway CORS **disabled** and ensure an `OPTIONS /{proxy+}` route (or per-path OPTIONS routes) reaches the Lambda; otherwise enable API Gateway CORS and remove `CORS_HEADERS` from `respond()`. Never have both. Verify only one `Access-Control-Allow-Origin` header.
7. **Amplify env**: ensure `VITE_API_URL` is set; remove `VITE_ADMIN_KEY`; redeploy so the rewrite rule and new bundle go live.
8. **Verify** end-to-end (see §9), including login, event CRUD, QR generation, duplicate check-in, and expiry redirect.
9. **Rotate/delete anything exposed in chat** (the old API key is unused now).

### Known code follow-ups (non-blocking)
- Confirm API Gateway sends `rawPath` (payload 2.0) — the event/QR handlers read it for `{id}`. The dashboard now prefetches events, so a broken path shows as an event-link error before submit.

---

## 5. Credentials & secrets

| What | Value | Where |
|---|---|---|
| Admin password | **moved server-side** → set `ADMIN_PASSWORD` Lambda env var | not in bundle anymore |
| Admin session token | issued by `/admin/login`, stored in `sessionStorage` (`stagepass.admin.token`), 1 h expiry | browser |
| API key | legacy, no longer used for admin | delete from API Gateway after deploy |
| GitHub repo | `neomogorosi74/stagepass` | public repo; `.env` is gitignored ✅ |
| AWS account ID | needed for IAM policy ARNs | verify region + account ID in `STAGEPASS_POLICY` |

**Never paste the real `ADMIN_PASSWORD` or tokens into chat or commit them.** Set them only in the Lambda console / Amplify console.

---

## 6. Permanent QR code (physical order)

**Status: superseded by per-event QR generation.** Each event now gets its own QR from the admin dashboard (`Generate/Replace QR & Download`), which downloads a branded A4 poster PDF. The old static "one QR forever" plan in session 1 is no longer required.

**Print specs:** error correction **H**, vector/SVG or PNG ≥ 1000 px, test-print one sample and scan with 2–3 phones before bulk printing. Do not print until the live URL and event flow are verified.

---

## 7. Known security gaps

1. ~~Admin password in frontend bundle~~ → **fixed**: password checked in Lambda, token issued server-side.
2. ~~API key in frontend bundle for admin~~ → **fixed**: Bearer tokens. (Legacy `x-api-key` may still exist in API Gateway config; remove.)
3. **Event QR token is a bearer credential** — anyone with the poster can check in. That is by design; closure is via `status` + `validFrom`/`validTo` + Thursday rule + token replacement. The plaintext token is no longer returned as a separate field, but it is necessarily embedded in `qrUrl`; treat the QR-generation response as sensitive and avoid logging it.
4. **No rate limiting on `/admin/login`** — the password can be brute-forced. Add WAF/API Gateway throttling or a usage plan before a public launch. Still open.
5. **No request-size limits** — JSON bodies are parsed without an explicit cap. Still open.
6. **CORS is wildcard (`*`)** — any origin can call the API. Admin routes still require a valid Bearer token, but this is not origin-restricted. Still open.
7. **Admin `scan` reads whole tables** without pagination — fine at current scale; revisit if data grows.
8. **No DynamoDB PITR / backups** — enable if the data matters.
9. **Session tokens stored in `sessionStorage`** — XSS would expose them. Expired/rejected sessions now redirect to `/login`; there is no refresh/rotation. Keep dependencies patched.
10. **Cognito organiser login** — still the long-term plan; the unused Amplify auth dependencies have been removed.

---

## 8. Local development

```powershell
cd C:\Users\Dell\Downloads\stagepass
npm install
npm run dev          # http://localhost:5173/  (root, no basename)
npm run build        # production build to dist/  (verified working)

# focused tests (no AWS credentials or network required)
npm test
npm run test:backend

# rebuild the Lambda upload artifact (gitignored)
Compress-Archive -Path backend/lambda_function.py -DestinationPath stagepass-lambda.zip -Force
```

`.env` (gitignored):
```
VITE_API_URL=https://vb2l7923be.execute-api.us-east-1.amazonaws.com
```

---

## 9. Reference: test commands

```powershell
$u = "https://vb2l7923be.execute-api.us-east-1.amazonaws.com"

# public lookup
Invoke-RestMethod "$u/members?phoneNumber=0712345678"

# legacy check-in
Invoke-RestMethod "$u/checkin" -Method POST -ContentType "application/json" `
  -Body '{"firstName":"Test","lastName":"A","phoneNumber":"0712345678"}'

# admin login -> token
$login = Invoke-RestMethod "$u/admin/login" -Method POST -ContentType "application/json" `
  -Body '{"password":"<ADMIN_PASSWORD>"}'
$h = @{ Authorization = "Bearer $($login.token)" }

# admin reads
Invoke-RestMethod "$u/admin/members" -Headers $h
Invoke-RestMethod "$u/admin/visits"  -Headers $h
Invoke-RestMethod "$u/admin/events"  -Headers $h

# create event (explicit offset is stored as UTC; naive values are treated as JHB)
$ev = Invoke-RestMethod "$u/admin/events" -Method POST -Headers $h -ContentType "application/json" `
  -Body '{"eventName":"Black Labone","eventDate":"2026-10-29","venue":"Labone","status":"open","validFrom":"2026-10-29T18:00:00+02:00","validTo":"2026-10-29T23:59:00+02:00"}'
$ev.event.eventId

# invalid window (should be 400)
try { Invoke-WebRequest "$u/admin/events" -Method POST -Headers $h -ContentType "application/json" `
  -Body '{"eventName":"Bad","eventDate":"2026-10-29","validFrom":"nope","validTo":"2026-10-29T23:00:00+02:00"}' -ErrorAction Stop } catch { $_.Exception.Response.StatusCode.value__ }

# open/close
Invoke-RestMethod "$u/admin/events/$($ev.event.eventId)" -Method PATCH -Headers $h -ContentType "application/json" -Body '{"status":"open"}'

# edit any event fields (partial updates are allowed; the merged window is validated)
Invoke-RestMethod "$u/admin/events/$($ev.event.eventId)" -Method PATCH -Headers $h -ContentType "application/json" `
  -Body '{"eventName":"Black Labone Reloaded","venue":"Accra","validFrom":"2026-10-29T18:00:00+02:00","validTo":"2026-10-29T23:59:00+02:00"}'

# generate QR (returns qrUrl; the token is only inside qrUrl)
$qr = Invoke-RestMethod "$u/admin/events/$($ev.event.eventId)/qr" -Method POST -Headers $h
$token = ([uri]$qr.qrUrl).Query.Split('&') | Where-Object { $_ -like 't=*' } | ForEach-Object { $_.Substring(2) }

# public event
Invoke-RestMethod "$u/events/$($ev.event.eventId)"

# event check-in (only succeeds on a Thursday in Africa/Johannesburg)
$body = '{"firstName":"Test","lastName":"A","phoneNumber":"0712345678","eventId":"' + $ev.event.eventId + '","token":"' + $token + '"}'
Invoke-RestMethod "$u/checkin" -Method POST -ContentType "application/json" -Body $body

# duplicate event check-in (should be 200 with alreadyCheckedInToday:true and alreadyCheckedInToEvent:true)
Invoke-RestMethod "$u/checkin" -Method POST -ContentType "application/json" -Body $body

# unknown event update / QR (should be 404)
try { Invoke-WebRequest "$u/admin/events/does-not-exist" -Method PATCH -Headers $h -ContentType "application/json" -Body '{"status":"open"}' -ErrorAction Stop } catch { $_.Exception.Response.StatusCode.value__ }
try { Invoke-WebRequest "$u/admin/events/does-not-exist/qr" -Method POST -Headers $h -ErrorAction Stop } catch { $_.Exception.Response.StatusCode.value__ }

# admin without token (should be 401)
try { Invoke-WebRequest "$u/admin/members" -UseBasicParsing -ErrorAction Stop } catch { $_.Exception.Response.StatusCode.value__ }

# CORS: preflight should return exactly one Access-Control-Allow-Origin header
(Invoke-WebRequest "$u/checkin" -Method OPTIONS -UseBasicParsing).Headers['Access-Control-Allow-Origin']

# SPA routes (should be 200)
Invoke-WebRequest "https://main.d1i8259hynrz6h.amplifyapp.com/login" -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest "https://main.d1i8259hynrz6h.amplifyapp.com/admin" -UseBasicParsing | Select-Object StatusCode
```
