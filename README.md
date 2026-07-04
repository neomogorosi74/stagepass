# StagePass — Phase 1 starter

Visitor loyalty + attendance tracking for free events. Not a ticketing system —
showing up is the reward.

## Run it

```bash
npm install
npm run dev
```

Open the local URL it prints (defaults to `http://localhost:5173`). Resize the
browser down to a phone width, or open dev tools' device toolbar, to see it as
intended — this is a mobile-first, post-QR-scan screen.

## What's built (Phase 1, plus a Phase-2 preview)

- **Landing** — the animated abstract face (`src/components/AbstractFace.jsx`),
  ambient drift + breathing loop, tagline, "Mark my register" CTA.
- **Register** — same-screen continuity: the face lifts and fades to ~20%
  opacity while the form fades in over it. Detects a returning visitor by
  phone number and swaps the copy to "Welcome back."
- **Confirmation** — "Visit recorded ✓", auto-advances to progress.
- **Progress** — circular ring + "X visits / Y more until [Supporter /
  Patron / Founding Member] status." The artwork itself unlocks extra brush
  strokes at 5 / 10 / 20 visits — the reward *is* the evolving artwork, per
  the spec's "art evolution, not badges" rule.

Visit/member data is currently kept in `localStorage`
(`src/utils/storage.js`), shaped to match the real data model so swapping in
API calls later is additive, not a rewrite.

## Wiring up Phase 2 (real backend)

Replace the three functions in `src/utils/storage.js` with calls to an API
Gateway endpoint backed by Lambda + DynamoDB:

```
Members   { memberId, firstName, phoneNumber, totalVisits, createdAt }
Events    { eventId, title, date }
Visits    { visitId, memberId, eventId, timestamp }
```

`recordVisit()` becomes a `POST /visits` call; the same-day scan cap and the
"is this a returning visitor" check both happen server-side at that point
instead of in `localStorage`.

## Still open (Phases 3–4)

- Persist the brush-stroke unlock state server-side so it survives across
  devices, not just `localStorage`.
- Organizer dashboard (event creation, QR generation, attendance analytics).
- Cognito for organizer login (member check-in itself stays anonymous/phone-based).
