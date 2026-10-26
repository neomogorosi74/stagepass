# StagePass — backend

Console-based deployment (no CLI/SAM). Use the same AWS region for the Lambda and every DynamoDB table. The current deployment is in `us-east-1`; see `../DEPLOYMENT_STATUS.md` for the live values.

## 1. DynamoDB tables

Create these on-demand tables:

- `stagepass-members` — partition key `phoneNumber` (String)
- `stagepass-visits` — partition key `visitId` (String)
- `stagepass-events` — partition key `eventId` (String)
- `stagepass-event-attendance` — partition key `eventIdMember` (String)
- `stagepass-admin-sessions` — partition key `token` (String); TTL on `expiresAt` is optional

## 2. IAM role for the Lambda

- Trusted entity: Lambda
- Permissions:
  - `stagepass-members`: `GetItem`, `PutItem`, `UpdateItem`, `Scan`
  - `stagepass-visits`: `PutItem`, `Scan`
  - `stagepass-events`: `GetItem`, `PutItem`, `UpdateItem`, `Scan`
  - `stagepass-event-attendance`: `PutItem`
  - `stagepass-admin-sessions`: `GetItem`, `PutItem`
  - CloudWatch Logs (`AWSLambdaBasicExecutionRole`)
- `TransactWriteItems` is authorised by the per-item actions above; there is no separate `dynamodb:TransactWriteItems` action.

## 3. Lambda function

- Runtime: Python 3.12
- Name: `stagepass-checkin`
- Code: `lambda_function.py` (or upload `../stagepass-lambda.zip`)
- Environment variables:
  - `MEMBERS_TABLE=stagepass-members`
  - `VISITS_TABLE=stagepass-visits`
  - `EVENTS_TABLE=stagepass-events`
  - `EVENT_ATTENDANCE_TABLE=stagepass-event-attendance`
  - `ADMIN_SESSIONS_TABLE=stagepass-admin-sessions`
  - `ADMIN_PASSWORD=<new strong password>`
  - `ADMIN_SESSION_SECRET=` (leave empty unless PyJWT is bundled)
  - `FRONTEND_BASE_URL=https://main.d1i8259hynrz6h.amplifyapp.com`
- Attach the IAM role from step 2.

Admin routes require `Authorization: Bearer <token>` from `POST /admin/login`. The Lambda owns CORS; do not also enable API Gateway CORS unless you remove the Lambda's `CORS_HEADERS`.

## 4. API Gateway (HTTP API)

Create an HTTP API named `stagepass-api`, integrate every route with `stagepass-checkin` (payload 2.0), then deploy the API:

- `GET /members`
- `POST /checkin`
- `GET /events/{id}`
- `POST /admin/login`
- `GET /admin/members`
- `GET /admin/visits`
- `GET /admin/events`
- `POST /admin/events`
- `PATCH /admin/events/{id}`
- `POST /admin/events/{id}/qr`

Add the `{id}` route parameter where required. Keep the Lambda as the CORS owner and ensure OPTIONS requests reach it.

## 5. Frontend wiring

Set `VITE_API_URL` to the Invoke URL in the frontend `.env` (and in Amplify). `VITE_ADMIN_KEY` is no longer used.

## 6. Local checks

```powershell
npm test
npm run test:backend
Compress-Archive -Path backend/lambda_function.py -DestinationPath stagepass-lambda.zip -Force
```

`stagepass-lambda.zip` is gitignored; rebuild it after any backend change.
