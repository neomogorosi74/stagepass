import json
import os
import re
import secrets
import uuid
from datetime import datetime, timezone, timedelta

import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")
members_table = dynamodb.Table(os.environ.get("MEMBERS_TABLE", "stagepass-members"))
visits_table = dynamodb.Table(os.environ.get("VISITS_TABLE", "stagepass-visits"))

# South Africa Standard Time (UTC+2) - "today" for the same-day scan cap
# is judged in this timezone, not the Lambda's UTC clock.
SAST = timezone(timedelta(hours=2))

MILESTONES = [
    {"count": 5, "label": "Supporter"},
    {"count": 10, "label": "Patron"},
    {"count": 20, "label": "Founding Member"},
]

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,x-api-key",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
}

# E.164-ish. Accepts optional leading +, 7-15 digits, no spaces/dashes.
PHONE_RE = re.compile(r"^\+?[0-9]{7,15}$")

# Shared secret for admin routes. Set as a Lambda environment variable.
ADMIN_KEY = os.environ.get("ADMIN_KEY", "")


def admin_authorised(event):
    """Admin routes require the x-api-key header to match ADMIN_KEY."""
    if not ADMIN_KEY:
        return False
    headers = event.get("headers") or {}
    supplied = headers.get("x-api-key") or headers.get("X-Api-Key") or ""
    return secrets.compare_digest(str(supplied), ADMIN_KEY)


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
    """Normalise so 071 234 5678 and 0712345678 are the same member."""
    if not value:
        return ""
    return re.sub(r"[\s\-\(\)]", "", str(value)).strip()


def valid_phone(phone):
    return bool(phone) and bool(PHONE_RE.match(phone))


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

    phone_number = sanitize_phone(payload.get("phoneNumber"))
    first_name = (payload.get("firstName") or "").strip()[:40]
    last_name = (payload.get("lastName") or "").strip()[:40]

    if not valid_phone(phone_number):
        return respond(400, {"error": "valid phoneNumber is required"})

    try:
        existing = members_table.get_item(Key={"phoneNumber": phone_number}).get("Item")
    except ClientError:
        return respond(500, {"error": "checkin failed"})

    now = datetime.now(timezone.utc)
    today_sast = now.astimezone(SAST).date().isoformat()

    # Same-day cap: the member's own record only, keyed by their own number.
    if existing:
        if existing.get("lastVisitDate") == today_sast:
            milestone = next_milestone(int(existing.get("totalVisits", 0)))
            return respond(200, {
                "firstName": existing.get("firstName", ""),
                "totalVisits": int(existing.get("totalVisits", 0)),
                "isReturning": True,
                "alreadyCheckedInToday": True,
                "milestone": milestone,
            })
        total_visits = int(existing.get("totalVisits", 0)) + 1
        resolved_first_name = existing.get("firstName", first_name or "Friend")
        resolved_last_name = existing.get("lastName", last_name or "")
        created_at = existing.get("createdAt", now.isoformat())
    else:
        total_visits = 1
        resolved_first_name = first_name or "Friend"
        resolved_last_name = last_name or ""
        created_at = now.isoformat()

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

    milestone = next_milestone(total_visits)

    return respond(200, {
        "firstName": resolved_first_name,
        "totalVisits": total_visits,
        "isReturning": bool(existing),
        "alreadyCheckedInToday": False,
        "milestone": milestone,
    })


def handle_admin_members(event):
    if not admin_authorised(event):
        return respond(403, {"error": "Forbidden"})
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
    if not admin_authorised(event):
        return respond(403, {"error": "Forbidden"})
    try:
        resp = visits_table.scan()
        visits = []
        for item in resp.get("Items", []):
            visits.append({
                "visitId": item.get("visitId"),
                "memberId": item.get("memberId"),
                "timestamp": item.get("timestamp"),
            })
        return respond(200, {"visits": visits})
    except ClientError:
        return respond(500, {"error": "admin visits failed"})


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
    if method == "GET" and path == "/admin/members":
        return handle_admin_members(event)
    if method == "GET" and path == "/admin/visits":
        return handle_admin_visits(event)

    return respond(405, {"error": "Method not allowed"})
