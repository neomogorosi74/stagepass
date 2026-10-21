# StagePass

Visitor attendance tracking for free events. Not a ticketing system — showing up is the connection.

**Black Labone** is a weekly event running under StagePass (every Thursday). Slogan: *Showing up is showing love*.

## Run it

```bash
npm install
npm run dev
```

Open the local URL it prints (defaults to `http://localhost:5173`). Resize the
browser down to a phone width, or open dev tools' device toolbar, to see it as
intended — this is a mobile-first, post-QR-scan screen.

## Visitor flow

1. **Check-in** — Enter first name, surname and mobile number.
2. **Welcome** — Brief greeting.
3. **Today's Connection** — Everyone sees the same question, answer and conversation prompt. The connection cycles every 5 check-ins. The app gives them the interaction and gets out of the way. No confirmation, no tracking, no completion.
4. **Visit Recorded** — Confirmation.
5. **Visit Count** — Shows visit number and milestone tier (Supporter / Patron / Founding Member).

Visit/member data is kept in `localStorage`
(`src/utils/storage.js`), shaped to match the real data model so swapping in
API calls later is additive, not a rewrite.

## Admin dashboard

The admin dashboard is at `/admin`. It's password-protected — only organizers
can log in. Current password is set in `src/pages/Login.jsx`.

## Wiring up the real backend

Replace the three functions in `src/utils/storage.js` with calls to an API
Gateway endpoint backed by Lambda + DynamoDB:

```
Members   { memberId, firstName, phoneNumber, lastName, totalVisits, createdAt }
Visits    { visitId, memberId, timestamp }
```

`recordVisit()` becomes a `POST /checkin` call; the same-day scan cap and the
"is this a returning visitor" check both happen server-side at that point
instead of in `localStorage`.

## Still open

- Cognito for organizer login (member check-in itself stays anonymous/phone-based).
