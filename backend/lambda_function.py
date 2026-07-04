import json
import os
import uuid
from datetime import datetime, timezone, timedelta

import boto3

dynamodb = boto3.resource("dynamodb")
members_table = dynamodb.Table(os.environ.get("MEMBERS_TABLE", "stagepass-members"))
visits_table = dynamodb.Table(os.environ.get("VISITS_TABLE", "stagepass-visits"))

# South Africa Standard Time (UTC+2) — "today" for the same-day scan cap
# is judged in this timezone, not the Lambda's UTC clock.
SAST = timezone(timedelta(hours=2))

MILESTONES = [
    {"count": 5, "label": "Supporter"},
    {"count": 10, "label": "Patron"},
    {"count": 20, "label": "Founding Member"},
]

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
}


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


def handle_lookup(event):
    params = event.get("queryStringParameters") or {}
    phone_number = (params.get("phoneNumber") or "").strip()
    if not phone_number:
        return respond(400, {"error": "phoneNumber is required"})

    existing = members_table.get_item(Key={"phoneNumber": phone_number}).get("Item")
    if not existing:
        return respond(200, {"exists": False})

    return respond(200, {
        "exists": True,
        "firstName": existing["firstName"],
        "totalVisits": int(existing["totalVisits"]),
    })


def handle_checkin(event):
    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return respond(400, {"error": "Invalid JSON body"})

    phone_number = (payload.get("phoneNumber") or "").strip()
    first_name = (payload.get("firstName") or "").strip()

    if not phone_number:
        return respond(400, {"error": "phoneNumber is required"})

    existing = members_table.get_item(Key={"phoneNumber": phone_number}).get("Item")
    now = datetime.now(timezone.utc)
    today_sast = now.astimezone(SAST).date().isoformat()

    if existing:
        if existing.get("lastVisitDate") == today_sast:
            milestone = next_milestone(int(existing["totalVisits"]))
            return respond(200, {
                "firstName": existing["firstName"],
                "totalVisits": int(existing["totalVisits"]),
                "isReturning": True,
                "alreadyCheckedInToday": True,
                "milestone": milestone,
            })
        total_visits = int(existing["totalVisits"]) + 1
        resolved_first_name = existing["firstName"]
        created_at = existing["createdAt"]
    else:
        total_visits = 1
        resolved_first_name = first_name or "Friend"
        created_at = now.isoformat()

    members_table.put_item(Item={
        "phoneNumber": phone_number,
        "firstName": resolved_first_name,
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

    milestone = next_milestone(total_visits)

    return respond(200, {
        "firstName": resolved_first_name,
        "totalVisits": total_visits,
        "isReturning": bool(existing),
        "alreadyCheckedInToday": False,
        "milestone": milestone,
    })


def lambda_handler(event, context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "")

    if method == "OPTIONS":
        return respond(200, {})
    if method == "GET":
        return handle_lookup(event)
    if method == "POST":
        return handle_checkin(event)

    return respond(405, {"error": "Method not allowed"})
