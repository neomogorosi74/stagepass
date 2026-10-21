# StagePass — Deployment Status

**Last updated:** end of session 1
**Repo:** https://github.com/neomogorosi74/stagepass (branch `main`)
**Region:** `us-east-1` (DynamoDB tables originally created in `eu-north-1` — verify)

---

## 1. What StagePass is

Visitor attendance tracking for free events. Not a ticketing system — "showing up is the connection."

**Black Labone** is a weekly event (every Thursday). Slogan: *Showing up is showing love*.

### Visitor flow (live on `Home.jsx`)
1. Black Labone splash (4s) → StagePass splash (4s)
2. Check-in form (first name, surname, mobile)
3. Welcome message (2.5s) — "Welcome to Black Labone" / "The Regular Shadow has returned." / rare variant
4. Today's Connection — everyone sees the same question, answer and conversation prompt. Cycles every 5 check-ins. No confirmation, no tracking, no completion.
5. Done → visit count screen: "Nth Thursday. You are most welcome." + **DONE** button → resets to splash

### Admin dashboard (`/admin`)
Password-gated (see §5). Live activity feed, Thursday traffic charts (8 weeks), first-time vs returning, growth trend, visitor journey, loyal visitors, search, visitor distribution, PDF report download.

---

## 2. AWS structure

```
┌─ Browser (React 18 + Vite 5, mobile-first SPA) ───────────────┐
│    hosted on AWS Amplify Hosting                              │
│    https://main.d1i8259hynrz6h.amplifyapp.com                 │
│    env: VITE_API_URL, VITE_ADMIN_KEY                          │
└───────────────────────────────┬───────────────────────────────┘
                                │ HTTPS
┌─ API Gateway HTTP API "stagepass-api" ────────────────────────┐
│    https://vb2l7923be.execute-api.us-east-1.amazonaws.com     │
│    CORS: localhost:5173 + https://main.d1i8259hynrz6h.amplifyapp.com
│    Allow-Headers: Content-Type, x-api-key                     │
│                                                                  │
│    GET  /members        public  → stagepass-checkin            │
│    POST /checkin        public  → stagepass-checkin            │
│    GET  /admin/members  ADMIN (x-api-key) → stagepass-checkin │
│    GET  /admin/visits   ADMIN (x-api-key) → stagepass-checkin │
└───────────────────────────────┬───────────────────────────────┘
                                │ invoke
┌─ Lambda "stagepass-checkin" (Python 3.12) ────────────────────┐
│    code: backend/lambda_function.py                           │
│    env: MEMBERS_TABLE, VISITS_TABLE, ADMIN_KEY                │
│    role: stagepass-lambda-role                                │
│    logs: CloudWatch                                            │
└───────────────────────────────┬───────────────────────────────┘
                                │ boto3
┌─ DynamoDB (on-demand) ───────────────────────────────────────┐
│    stagepass-members  PK phoneNumber (String)                 │
│        firstName, lastName, totalVisits, createdAt,           │
│        lastVisitAt, lastVisitDate (SAST day)                  │
│    stagepass-visits   PK visitId (String)                     │
│        memberId (= phoneNumber), timestamp                    │
└───────────────────────────────────────────────────────────────┘
```

**Business rules in the Lambda:**
- Same-day scan cap judged in **SAST (UTC+2)**, not UTC
- Milestones: 5 = Supporter, 10 = Patron, 20 = Founding Member
- Phone numbers normalised (spaces/dashes/brackets stripped) so `071 234 5678` === `0712345678`
- Public routes only ever touch the record whose PK equals the supplied phone number
- Public `/members` returns only `exists`, `firstName`, `totalVisits` (+ `alreadyCheckedInToday`)

---

## 3. What is DONE ✅

| Item | Status |
|---|---|
| DynamoDB tables `stagepass-members` + `stagepass-visits` | ✅ created, on-demand |
| IAM role `stagepass-lambda-role` | ✅ created |
| IAM policy `STAGEPASS_POLICY` | ✅ created, scoped to the two tables (GetItem/PutItem + logs only) |
| `AmazonDynamoDBFullAccess` removed from role | ✅ |
| Lambda `stagepass-checkin` | ✅ deployed, Python 3.12, env vars set, correct role |
| API Gateway HTTP API `stagepass-api` | ✅ created, 1 integration to the Lambda |
| Frontend on AWS Amplify | ✅ live at `https://main.d1i8259hynrz6h.amplifyapp.com/` |
| Amplify env vars `VITE_API_URL` + `VITE_ADMIN_KEY` | ✅ set (40-char key) |
| SPA rewrite `/*` → `/index.html` (200) | ✅ rule created — **needs a hosting redeploy to activate** |
| Lambda admin handlers + `x-api-key` check | ✅ code deployed, returns 403 without key |
| Git: 5 commits pushed to `main` | ✅ `f0aa19d` is HEAD |
| Same-day detection fix | ✅ phone normalisation + `alreadyCheckedInToday` handled in UI |
| DONE button on final screen | ✅ resets to opening splash, clears cached phone |
| `/stagepass` base path removed | ✅ (was causing blank page on Amplify) |

---

## 4. What is LEFT ❌ (state as of end of session)

### 🔴 URGENT — public check-in is currently returning 404
Last status check:
```
GET  /members?phoneNumber=123  -> 404   (BROKEN)
POST /checkin                  -> 404   (BROKEN)
GET  /admin/members            -> 403   (route ok, key rejected)
GET  /admin/visits             -> 404   (route missing)
live /login                    -> 404   (rewrite not deployed)
```
The `/members` and `/checkin` routes were lost from API Gateway while editing the Routes page.

### Task list
1. **Restore API Gateway routes** — `Develop > Routes`. Ensure all 4 exist:
   - `GET /members` → Lambda `stagepass-checkin`, payload 2.0
   - `POST /checkin` → Lambda `stagepass-checkin`, payload 2.0
   - `GET /admin/members` → Lambda `stagepass-checkin`, payload 2.0
   - `GET /admin/visits` → Lambda `stagepass-checkin`, payload 2.0
   Then **Deploy** the API.
2. **Set Lambda `ADMIN_KEY` env var** — must match Amplify's `VITE_ADMIN_KEY` character-for-character. Without it, `admin_authorised()` always returns False → 403.
3. **Redeploy Amplify hosting** — `Hosting > Deployments > Redeploy` to activate the rewrite rule. Verify `https://main.d1i8259hynrz6h.amplifyapp.com/login` returns 200.
4. **Verify CORS** — `Develop > CORS > Configure CORS`:
   - Allow-Origin: `http://localhost:5173` + `https://main.d1i8259hynrz6h.amplifyapp.com`
   - Allow-Headers: `Content-Type`, `x-api-key`
   - Allow-Methods: `GET`, `POST`, `OPTIONS`
5. **Verify the admin dashboard** — `/login` (password below) → header should read **"Live • Cloud"**.
6. **Rotate the leaked API key** — the key was pasted into chat. Create a new one in API Gateway (`Develop > API keys`), then update BOTH:
   - Lambda env var `ADMIN_KEY`
   - Amplify env var `VITE_ADMIN_KEY` (triggers a rebuild)
7. **Generate the permanent QR code** — see §6. Not yet done. **Blocked on a stable live URL.**

---

## 5. Credentials & secrets

| What | Value | Where |
|---|---|---|
| Admin dashboard password | `blacklabone2024` | hardcoded in `src/pages/Login.jsx` (frontend only — see §7) |
| API key | *(in Amplify `VITE_ADMIN_KEY` + Lambda `ADMIN_KEY`)* | rotate — was exposed in chat |
| GitHub repo | `neomogorosi74/stagepass` | public repo; `.env` is gitignored ✅ |
| AWS account ID | needed for the IAM policy ARNs | check IAM policy uses correct region + account ID |

---

## 6. Permanent QR code (for the physical order)

**Status: NOT STARTED — blocked on item 3 (Amplify rewrite must be live and the app verified working).**

Once the live URL is stable, generate the QR pointing at:
```
https://main.d1i8259hynrz6h.amplifyapp.com/
```

**How to generate:**
```powershell
npx qrcode -o stagepass-qr.png -w 1000 "https://main.d1i8259hynrz6h.amplifyapp.com/"
```
or use qr-code-generator.com / qrcode-monkey.com.

**Print specs:**
- Error correction: **H (High)** — survives smudges and curved surfaces
- Generate as **SVG** (vector, scales to any size) or PNG at 1000px+
- Test-print 1 sample, scan with 2–3 different phones, THEN order in bulk
- Put the plaintext URL under the QR as a fallback

**⚠️ Do not print before the live URL is verified working on a real phone.** A QR pointing at a broken URL is dead print money. If a custom domain is wanted later, set it up on Amplify BEFORE printing — changing the URL after printing invalidates every printed code.

---

## 7. Known security gaps (acceptable for R0, plan for post-event)

1. **Admin password is in the frontend bundle** — `AUTH_PASSWORD` is a JS constant. Anyone can read it via view-source. Fix: Cognito, or a server-side check.
2. **API key is in the frontend bundle** — `VITE_ADMIN_KEY` is inlined by Vite. It's obfuscation, not real security. Fix: move admin calls behind a server-side proxy that holds the key.
3. **API Gateway HTTP API has no rate limiting** — fine for an event, but a bot could hammer `/checkin`. Fix: WAF or a usage plan with throttling.
4. **Admin `scan` reads the whole table** — fine for one event, but add pagination if the table grows large.
5. **No DynamoDB PITR / backups** — enable point-in-time recovery if the data matters.
6. **Cognito organiser login** — listed as still-open in the original README.

---

## 8. Local development

```powershell
cd C:\Users\Dell\Downloads\stagepass
npm install
npm run dev          # http://localhost:5173/  (basename removed — root now)
npx vite build       # production build to dist/
```

`.env` (gitignored):
```
VITE_API_URL=https://vb2l7923be.execute-api.us-east-1.amazonaws.com
VITE_ADMIN_KEY=<key>
```

**Note:** `src/pages/StagePassFlow.jsx` is dead code — `App.jsx` routes `/` to `Home.jsx`. Can be deleted.

---

## 9. Reference: test commands

```powershell
$u = "https://vb2l7923be.execute-api.us-east-1.amazonaws.com"
$k = "<your-api-key>"

# public lookup (should be 200)
Invoke-RestMethod "$u/members?phoneNumber=123"

# public checkin (should be 200)
Invoke-RestMethod "$u/checkin" -Method POST -Body '{"firstName":"Test","lastName":"A","phoneNumber":"0712345678"}' -ContentType "application/json"

# admin without key (should be 403)
try { Invoke-WebRequest "$u/admin/members" -UseBasicParsing -ErrorAction Stop } catch { $_.Exception.Response.StatusCode.value__ }

# admin with key (should be 200)
Invoke-RestMethod "$u/admin/members" -Headers @{"x-api-key"=$k}
Invoke-RestMethod "$u/admin/visits"  -Headers @{"x-api-key"=$k}

# SPA routes (should be 200)
Invoke-WebRequest "https://main.d1i8259hynrz6h.amplifyapp.com/login" -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest "https://main.d1i8259hynrz6h.amplifyapp.com/admin" -UseBasicParsing | Select-Object StatusCode
```
