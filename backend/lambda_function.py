import json
import os
import re
import secrets
import uuid
import hashlib
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")
members_table = dynamodb.Table(os.environ.get("MEMBERS_TABLE", "stagepass-members"))
visits_table = dynamodb.Table(os.environ.get("VISITS_TABLE", "stagepass-visits"))
events_table = dynamodb.Table(os.environ.get("EVENTS_TABLE", "stagepass-events"))
attendance_table = dynamodb.Table(os.environ.get("EVENT_ATTENDANCE_TABLE", "stagepass-event-attendance"))
sessions_table = dynamodb.Table(os.environ.get("ADMIN_SESSIONS_TABLE", "stagepass-admin-sessions"))

SAST = timezone(timedelta(hours=2))
try:
    JHB = ZoneInfo("Africa/Johannesburg")
except Exception:
    # South Africa has no DST, so UTC+2 is exact if tzdata is unavailable.
    JHB = timezone(timedelta(hours=2))

MILESTONES = [
    {"count": 5, "label": "Supporter"},
    {"count": 10, "label": "Patron"},
    {"count": 20, "label": "Founding Member"},
]

VALID_EVENT_STATUSES = {"draft", "open", "closed", "cancelled"}

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PATCH",
}

PHONE_RE = re.compile(r"^\+?[0-9]{7,15}$")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
ADMIN_SESSION_SECRET = os.environ.get("ADMIN_SESSION_SECRET", "")


def get_headers(event):
    headers = event.get("headers") or {}
    # API Gateway HTTP API lowercases headers
    return {k.lower(): v for k, v in headers.items()}


def verify_admin_token(event):
    headers = get_headers(event)
    auth = headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return False
    token = auth.split(" ", 1)[1].strip()
    if not token:
        return False
    # Try JWT validation if secret present
    if ADMIN_SESSION_SECRET:
        try:
            import jwt
            payload = jwt.decode(token, ADMIN_SESSION_SECRET, algorithms=["HS256"])
            if payload.get("role") == "admin" or payload.get("sub"):
                exp = payload.get("exp")
                if exp:
                    if datetime.now(timezone.utc).timestamp() > exp:
                        return False
                return True
        except Exception:
            pass
    # Fallback to sessions table
    try:
        item = sessions_table.get_item(Key={"token": token}).get("Item")
        if not item:
            return False
        exp = item.get("expiresAt")
        if exp and int(exp) < int(datetime.now(timezone.utc).timestamp()):
            return False
        return True
    except Exception:
        return False


def issue_token():
    exp = int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp())
    if ADMIN_SESSION_SECRET:
        try:
            import jwt
            token = jwt.encode({"role": "admin", "exp": exp}, ADMIN_SESSION_SECRET, algorithm="HS256")
            # PyJWT returns str; never hand out an unverifiable token.
            if isinstance(token, str) and token:
                return token, exp
        except Exception:
            # Fall through to the sessions table.
            pass
    token = secrets.token_urlsafe(32)
    try:
        sessions_table.put_item(Item={
            "token": token,
            "expiresAt": exp,
            "createdAt": int(datetime.now(timezone.utc).timestamp()),
        })
    except Exception as exc:
        # Caller must fail the login instead of returning an unusable token.
        raise RuntimeError("session store unavailable") from exc
    return token, exp


def next_milestone(total_visits):
    for m in MILESTONES:
        if total_visits < m["count"]:
            return m
    return {"count": total_visits, "label": "Founding Member"}


def respond(status, body):
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps(body),
    }


def sanitize_phone(value):
    if not value:
        return ""
    return re.sub(r"[\s\-\(\)]", "", str(value)).strip()


def valid_phone(phone):
    return bool(phone) and bool(PHONE_RE.match(phone))


def parse_event_datetime(value, field):
    """Parse an event timestamp and return an aware Johannesburg datetime.

    Naive values are interpreted as Africa/Johannesburg wall time (as sent by
    the browser's datetime-local inputs). Explicit offsets and Z are preserved.
    Raises ValueError with a safe message for missing or malformed values.
    """
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required")
    raw = value.strip()
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(f"{field} must be a valid ISO-8601 date/time")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=JHB)
    return parsed.astimezone(JHB)


def to_utc_iso(value, field):
    parsed = parse_event_datetime(value, field)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def handle_admin_login(event):
    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return respond(400, {"error": "Invalid JSON body"})
    if not isinstance(payload, dict):
        return respond(400, {"error": "Invalid JSON body"})
    password = payload.get("password") or ""
    if not ADMIN_PASSWORD:
        return respond(503, {"error": "Auth not configured"})
    if not secrets.compare_digest(str(password), ADMIN_PASSWORD):
        return respond(401, {"error": "Unauthorized"})
    try:
        token, exp = issue_token()
    except Exception:
        return respond(503, {"error": "Authentication temporarily unavailable"})
    return respond(200, {"token": token, "expiresAt": exp})


def handle_lookup(event):
    params = event.get("queryStringParameters") or {}
    phone_number = sanitize_phone(params.get("phoneNumber"))
    if not valid_phone(phone_number):
        return respond(400, {"error": "valid phoneNumber is required"})
    try:
        existing = members_table.get_item(Key={"phoneNumber": phone_number}).get("Item")
    except ClientError:
        return respond(500, {"error": "lookup failed"})
    if not existing:
        return respond(200, {"exists": False})
    now = datetime.now(timezone.utc)
    today_sast = now.astimezone(SAST).date().isoformat()
    return respond(200, {
        "exists": True,
        "firstName": existing.get("firstName", ""),
        "totalVisits": int(existing.get("totalVisits", 0)),
        "alreadyCheckedInToday": existing.get("lastVisitDate") == today_sast,
    })


def handle_checkin(event):
    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return respond(400, {"error": "Invalid JSON body"})
    if not isinstance(payload, dict):
        return respond(400, {"error": "Invalid JSON body"})

    phone_number = sanitize_phone(payload.get("phoneNumber"))
    first_name = str(payload.get("firstName") or "").strip()[:40]
    last_name = str(payload.get("lastName") or "").strip()[:40]
    event_id = str(payload.get("eventId") or "").strip()
    token = payload.get("token") or ""
    if not isinstance(token, str):
        token = ""

    if not valid_phone(phone_number):
        return respond(400, {"error": "valid phoneNumber is required"})

    if event_id:
        return handle_event_checkin(event_id, token, phone_number, first_name, last_name)
    return handle_legacy_checkin(phone_number, first_name, last_name)


def member_already_checked_in_response(member, fallback_first_name="Friend", event=False):
    total_visits = int(member.get("totalVisits", 0))
    body = {
        "firstName": member.get("firstName", fallback_first_name),
        "totalVisits": total_visits,
        "isReturning": True,
        "alreadyCheckedInToday": True,
        "milestone": next_milestone(total_visits),
    }
    if event:
        body["alreadyCheckedInToEvent"] = True
    return respond(200, body)


def handle_event_checkin(event_id, token, phone_number, first_name, last_name):
    try:
        ev = events_table.get_item(Key={"eventId": event_id}).get("Item")
    except ClientError:
        return respond(500, {"error": "checkin failed"})
    if not ev:
        return respond(400, {"error": "Invalid event"})
    if ev.get("status") != "open":
        return respond(400, {"error": "Event not open"})

    now_jhb = datetime.now(JHB)
    if now_jhb.weekday() != 3:  # Thursday only
        return respond(400, {"error": "Check-in only allowed on Thursday"})

    try:
        valid_from = parse_event_datetime(ev.get("validFrom"), "validFrom")
        valid_to = parse_event_datetime(ev.get("validTo"), "validTo")
    except ValueError:
        return respond(400, {"error": "Event has an invalid validity window"})
    if valid_to <= valid_from:
        return respond(400, {"error": "Event has an invalid validity window"})
    if now_jhb < valid_from:
        return respond(400, {"error": "Event not yet open"})
    if now_jhb > valid_to:
        return respond(400, {"error": "Event expired"})

    if not token:
        return respond(400, {"error": "Invalid token"})
    token_hash = hashlib.sha256(token.encode('utf-8')).hexdigest()
    if ev.get("qrTokenHash") != token_hash:
        return respond(400, {"error": "Invalid token"})
    if ev.get("revokedAt"):
        return respond(400, {"error": "Token revoked"})

    try:
        existing = members_table.get_item(Key={"phoneNumber": phone_number}).get("Item")
    except ClientError:
        return respond(500, {"error": "checkin failed"})

    now = datetime.now(timezone.utc)
    today_sast = now.astimezone(SAST).date().isoformat()
    attendance_key = f"{event_id}#{phone_number}"

    transact_items = [
        {
            "Update": {
                "TableName": members_table.name,
                "Key": {"phoneNumber": phone_number},
                "UpdateExpression": (
                    "SET firstName = if_not_exists(firstName, :firstName), "
                    "lastName = if_not_exists(lastName, :lastName), "
                    "createdAt = if_not_exists(createdAt, :createdAt), "
                    "lastVisitAt = :now, lastVisitDate = :today "
                    "ADD totalVisits :one"
                ),
                "ExpressionAttributeValues": {
                    ":firstName": first_name or "Friend",
                    ":lastName": last_name,
                    ":createdAt": now.isoformat(),
                    ":now": now.isoformat(),
                    ":today": today_sast,
                    ":one": 1,
                },
            }
        },
        {
            "Put": {
                "TableName": visits_table.name,
                "Item": {
                    "visitId": str(uuid.uuid4()),
                    "memberId": phone_number,
                    "timestamp": now.isoformat(),
                    "eventId": event_id,
                },
            }
        },
        {
            "Put": {
                "TableName": attendance_table.name,
                "Item": {
                    "eventIdMember": attendance_key,
                    "eventId": event_id,
                    "memberId": phone_number,
                    "checkedInAt": now.isoformat(),
                    "visitId": str(uuid.uuid4()),
                },
                "ConditionExpression": "attribute_not_exists(eventIdMember)",
            }
        },
    ]

    for attempt in range(3):
        try:
            dynamodb.meta.client.transact_write_items(TransactItems=transact_items)
            break
        except ClientError as exc:
            response = getattr(exc, "response", {}) or {}
            reasons = response.get("CancellationReasons") or []
            codes = {reason.get("Code") for reason in reasons}
            if "ConditionalCheckFailed" in codes:
                try:
                    current = members_table.get_item(Key={"phoneNumber": phone_number}).get("Item") or existing or {}
                except ClientError:
                    current = existing or {}
                return member_already_checked_in_response(current, first_name or "Friend", event=True)
            # A conflicting concurrent transaction can be retried safely.
            error_code = response.get("Error", {}).get("Code")
            if ("TransactionConflict" in codes or error_code == "TransactionConflictException") and attempt < 2:
                continue
            return respond(500, {"error": "checkin failed"})
    else:
        return respond(503, {"error": "Check-in is busy, please try again"})

    try:
        member = members_table.get_item(Key={"phoneNumber": phone_number}).get("Item") or {}
        total_visits = int(member.get("totalVisits", 0))
        resolved_first_name = member.get("firstName", first_name or "Friend")
    except ClientError:
        total_visits = int((existing or {}).get("totalVisits", 0)) + 1
        resolved_first_name = (existing or {}).get("firstName", first_name or "Friend")

    return respond(200, {
        "firstName": resolved_first_name,
        "totalVisits": total_visits,
        "isReturning": bool(existing),
        "alreadyCheckedInToday": False,
        "milestone": next_milestone(total_visits),
    })


def handle_legacy_checkin(phone_number, first_name, last_name):
    try:
        existing = members_table.get_item(Key={"phoneNumber": phone_number}).get("Item")
    except ClientError:
        return respond(500, {"error": "checkin failed"})

    now = datetime.now(timezone.utc)
    today_sast = now.astimezone(SAST).date().isoformat()

    if existing and existing.get("lastVisitDate") == today_sast:
        return member_already_checked_in_response(existing, first_name or "Friend")

    total_visits = int((existing or {}).get("totalVisits", 0)) + 1
    resolved_first_name = (existing or {}).get("firstName", first_name or "Friend")
    resolved_last_name = (existing or {}).get("lastName", last_name or "")
    created_at = (existing or {}).get("createdAt", now.isoformat())

    try:
        members_table.put_item(Item={
            "phoneNumber": phone_number,
            "firstName": resolved_first_name,
            "lastName": resolved_last_name,
            "totalVisits": total_visits,
            "createdAt": created_at,
            "lastVisitAt": now.isoformat(),
            "lastVisitDate": today_sast,
        })
        visits_table.put_item(Item={
            "visitId": str(uuid.uuid4()),
            "memberId": phone_number,
            "timestamp": now.isoformat(),
        })
    except ClientError:
        return respond(500, {"error": "checkin failed"})

    return respond(200, {
        "firstName": resolved_first_name,
        "totalVisits": total_visits,
        "isReturning": bool(existing),
        "alreadyCheckedInToday": False,
        "milestone": next_milestone(total_visits),
    })


def handle_admin_members(event):
    if not verify_admin_token(event):
        return respond(401, {"error": "Unauthorized"})
    try:
        resp = members_table.scan()
        members = []
        for item in resp.get("Items", []):
            members.append({
                "phoneNumber": item.get("phoneNumber"),
                "firstName": item.get("firstName"),
                "lastName": item.get("lastName"),
                "totalVisits": int(item.get("totalVisits", 0)),
                "createdAt": item.get("createdAt"),
                "lastVisitAt": item.get("lastVisitAt"),
                "lastVisitDate": item.get("lastVisitDate"),
            })
        return respond(200, {"members": members})
    except ClientError:
        return respond(500, {"error": "admin members failed"})


def handle_admin_visits(event):
    if not verify_admin_token(event):
        return respond(401, {"error": "Unauthorized"})
    try:
        resp = visits_table.scan()
        visits = []
        for item in resp.get("Items", []):
            visits.append({
                "visitId": item.get("visitId"),
                "memberId": item.get("memberId"),
                "timestamp": item.get("timestamp"),
                **({"eventId": item.get("eventId")} if item.get("eventId") else {})
            })
        return respond(200, {"visits": visits})
    except ClientError:
        return respond(500, {"error": "admin visits failed"})


def handle_list_events(event):
    if not verify_admin_token(event):
        return respond(401, {"error": "Unauthorized"})
    try:
        resp = events_table.scan()
        events = resp.get("Items", [])
        return respond(200, {"events": events})
    except ClientError:
        return respond(500, {"error": "events failed"})


def handle_create_event(event):
    if not verify_admin_token(event):
        return respond(401, {"error": "Unauthorized"})
    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return respond(400, {"error": "Invalid JSON body"})
    if not isinstance(payload, dict):
        return respond(400, {"error": "Invalid JSON body"})

    event_name = str(payload.get("eventName") or "").strip()
    if not event_name:
        return respond(400, {"error": "eventName is required"})
    if len(event_name) > 120:
        return respond(400, {"error": "eventName is too long"})

    event_date = str(payload.get("eventDate") or "").strip()
    if not event_date:
        return respond(400, {"error": "eventDate is required"})
    try:
        datetime.strptime(event_date, "%Y-%m-%d")
    except ValueError:
        return respond(400, {"error": "eventDate must be a valid YYYY-MM-DD date"})

    venue = str(payload.get("venue") or "").strip()[:200]
    status = str(payload.get("status") or "draft").strip()
    if status not in VALID_EVENT_STATUSES:
        return respond(400, {"error": "status must be one of draft, open, closed, cancelled"})

    try:
        valid_from = to_utc_iso(payload.get("validFrom"), "validFrom")
        valid_to = to_utc_iso(payload.get("validTo"), "validTo")
        if parse_event_datetime(valid_to, "validTo") <= parse_event_datetime(valid_from, "validFrom"):
            return respond(400, {"error": "validTo must be later than validFrom"})
    except ValueError as exc:
        return respond(400, {"error": str(exc)})

    event_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    item = {
        "eventId": event_id,
        "eventName": event_name,
        "eventDate": event_date,
        "venue": venue,
        "status": status,
        "validFrom": valid_from,
        "validTo": valid_to,
        "createdAt": now,
        "updatedAt": now,
    }
    try:
        events_table.put_item(Item=item)
        return respond(200, {"event": item})
    except ClientError:
        return respond(500, {"error": "create event failed"})


def handle_update_event(event):
    if not verify_admin_token(event):
        return respond(401, {"error": "Unauthorized"})
    path = event.get("rawPath") or event.get("path") or ""
    parts = path.strip('/').split('/')
    event_id = parts[2] if len(parts) >= 3 else None
    if not event_id:
        return respond(400, {"error": "eventId required"})
    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return respond(400, {"error": "Invalid JSON body"})
    if not isinstance(payload, dict):
        return respond(400, {"error": "Invalid JSON body"})

    updates = {}
    if "eventName" in payload:
        event_name = str(payload.get("eventName") or "").strip()
        if not event_name:
            return respond(400, {"error": "eventName is required"})
        if len(event_name) > 120:
            return respond(400, {"error": "eventName is too long"})
        updates["eventName"] = event_name
    if "eventDate" in payload:
        event_date = str(payload.get("eventDate") or "").strip()
        if not event_date:
            return respond(400, {"error": "eventDate is required"})
        try:
            datetime.strptime(event_date, "%Y-%m-%d")
        except ValueError:
            return respond(400, {"error": "eventDate must be a valid YYYY-MM-DD date"})
        updates["eventDate"] = event_date
    if "venue" in payload:
        updates["venue"] = str(payload.get("venue") or "").strip()[:200]
    if "status" in payload:
        status = str(payload.get("status") or "").strip()
        if status not in VALID_EVENT_STATUSES:
            return respond(400, {"error": "status must be one of draft, open, closed, cancelled"})
        updates["status"] = status
    if "validFrom" in payload:
        try:
            updates["validFrom"] = to_utc_iso(payload.get("validFrom"), "validFrom")
        except ValueError as exc:
            return respond(400, {"error": str(exc)})
    if "validTo" in payload:
        try:
            updates["validTo"] = to_utc_iso(payload.get("validTo"), "validTo")
        except ValueError as exc:
            return respond(400, {"error": str(exc)})

    if not updates:
        return respond(400, {"error": "No updatable fields provided"})

    try:
        existing = events_table.get_item(Key={"eventId": event_id}).get("Item")
    except ClientError:
        return respond(500, {"error": "update event failed"})
    if not existing:
        return respond(404, {"error": "Event not found"})

    if "validFrom" in updates or "validTo" in updates:
        merged_from = updates.get("validFrom", existing.get("validFrom"))
        merged_to = updates.get("validTo", existing.get("validTo"))
        try:
            if parse_event_datetime(merged_to, "validTo") <= parse_event_datetime(merged_from, "validFrom"):
                return respond(400, {"error": "validTo must be later than validFrom"})
        except ValueError as exc:
            return respond(400, {"error": str(exc)})

    now = datetime.now(timezone.utc).isoformat()
    names = {"#updatedAt": "updatedAt"}
    values = {":updatedAt": now}
    set_parts = ["#updatedAt = :updatedAt"]
    for field, value in updates.items():
        name_ref = f"#{field}"
        value_ref = f":{field}"
        names[name_ref] = field
        values[value_ref] = value
        set_parts.append(f"{name_ref} = {value_ref}")

    try:
        events_table.update_item(
            Key={"eventId": event_id},
            UpdateExpression="SET " + ", ".join(set_parts),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ConditionExpression="attribute_exists(eventId)",
        )
        return respond(200, {"eventId": event_id, **updates, "updatedAt": now})
    except ClientError as exc:
        code = (getattr(exc, "response", {}) or {}).get("Error", {}).get("Code")
        if code == "ConditionalCheckFailedException":
            return respond(404, {"error": "Event not found"})
        return respond(500, {"error": "update event failed"})


def handle_generate_qr(event):
    if not verify_admin_token(event):
        return respond(401, {"error": "Unauthorized"})
    path = event.get("rawPath") or event.get("path") or ""
    parts = path.strip('/').split('/')
    event_id = parts[2] if len(parts) >= 3 else None
    if not event_id:
        return respond(400, {"error": "eventId required"})
    try:
        ev = events_table.get_item(Key={"eventId": event_id}).get("Item")
    except ClientError:
        return respond(500, {"error": "qr failed"})
    if not ev:
        return respond(404, {"error": "Event not found"})

    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode('utf-8')).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    try:
        events_table.update_item(
            Key={"eventId": event_id},
            UpdateExpression="SET qrTokenHash = :h, updatedAt = :u REMOVE revokedAt",
            ExpressionAttributeValues={":h": token_hash, ":u": now},
            ConditionExpression="attribute_exists(eventId)",
        )
        base = os.environ.get("FRONTEND_BASE_URL") or "https://main.d1i8259hynrz6h.amplifyapp.com"
        qr_url = f"{base}/?eventId={event_id}&t={token}"
        return respond(200, {"eventId": event_id, "qrUrl": qr_url, "eventName": ev.get("eventName")})
    except ClientError as exc:
        code = (getattr(exc, "response", {}) or {}).get("Error", {}).get("Code")
        if code == "ConditionalCheckFailedException":
            return respond(404, {"error": "Event not found"})
        return respond(500, {"error": "qr failed"})


def handle_get_event_public(event):
    path = event.get("rawPath") or event.get("path") or ""
    parts = path.strip('/').split('/')
    event_id = parts[1] if len(parts) >= 2 else None
    if not event_id:
        return respond(400, {"error": "eventId required"})
    try:
        ev = events_table.get_item(Key={"eventId": event_id}).get("Item")
        if not ev:
            return respond(404, {"error": "Not found"})
        # Return public fields only
        public = {
            "eventId": ev.get("eventId"),
            "eventName": ev.get("eventName"),
            "eventDate": ev.get("eventDate"),
            "venue": ev.get("venue"),
            "status": ev.get("status"),
            "validFrom": ev.get("validFrom"),
            "validTo": ev.get("validTo"),
        }
        return respond(200, public)
    except ClientError:
        return respond(500, {"error": "event failed"})


def lambda_handler(event, context):
    request_context = event.get("requestContext") or {}
    http = request_context.get("http") or {}
    method = http.get("method", "")
    path = http.get("path") or event.get("rawPath") or event.get("path", "")

    if method == "OPTIONS":
        return respond(200, {})
    if method == "GET" and path == "/members":
        return handle_lookup(event)
    if method == "POST" and path == "/checkin":
        return handle_checkin(event)
    if method == "POST" and path == "/admin/login":
        return handle_admin_login(event)
    if method == "GET" and path == "/admin/members":
        return handle_admin_members(event)
    if method == "GET" and path == "/admin/visits":
        return handle_admin_visits(event)
    if method == "GET" and path == "/admin/events":
        return handle_list_events(event)
    if method == "POST" and path == "/admin/events":
        return handle_create_event(event)
    if method == "PATCH" and path.startswith("/admin/events/") and path.endswith("/qr") is False and "/qr" not in path:
        # check if it's /admin/events/{id} (update)
        parts = path.strip('/').split('/')
        if len(parts) == 3 and parts[0] == 'admin' and parts[1] == 'events':
            return handle_update_event(event)
    if method == "POST" and path.startswith("/admin/events/") and path.endswith("/qr"):
        return handle_generate_qr(event)
    if method == "GET" and path.startswith("/events/"):
        return handle_get_event_public(event)

    return respond(405, {"error": "Method not allowed"})
