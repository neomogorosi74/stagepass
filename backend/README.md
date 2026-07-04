# StagePass — Phase 2 backend

Console-based deployment (no CLI/SAM) — matches the same approach used for
the other Cloud Neo projects. Region: eu-north-1, unless you swap it for
af-south-1.

## 1. DynamoDB tables
- `stagepass-members` — partition key `phoneNumber` (String)
- `stagepass-visits` — partition key `visitId` (String)
- On-demand capacity mode for both (no need to guess RCU/WCU at this stage).

## 2. IAM role for the Lambda
- Trusted entity: Lambda
- Permissions: `AmazonDynamoDBFullAccess` for MVP speed (tighten to a scoped
  policy on just these two tables before this goes anywhere near production)
- Attach `AWSLambdaBasicExecutionRole` too, for CloudWatch logs

## 3. Lambda function
- Runtime: Python 3.12
- Name: `stagepass-checkin`
- Paste in `lambda_function.py` from this folder
- Environment variables: `MEMBERS_TABLE=stagepass-members`,
  `VISITS_TABLE=stagepass-visits`
- Attach the IAM role from step 2

## 4. API Gateway (HTTP API)
- Create HTTP API named `stagepass-api`
- Routes, both integrated to `stagepass-checkin`:
  - `GET /members`
  - `POST /checkin`
- CORS: allow origin `http://localhost:5173` for now (add the production
  Amplify domain once that's live), methods `GET, POST, OPTIONS`, headers
  `Content-Type`
- Note the Invoke URL — that's what goes into the frontend's `.env`

## 5. Frontend wiring
- `src/utils/storage.js` swaps its `localStorage` reads/writes for `fetch`
  calls to the Invoke URL
- `localStorage` keeps exactly one job: caching this device's phone number
  so the field can be pre-filled — the API is the source of truth for
  visit counts
