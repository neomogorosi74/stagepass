"""Focused tests for backend/lambda_function.py.

The tests stub boto3/botocore so the Lambda module can be imported without AWS
credentials or network access. They cover timezone handling, event validation,
conditional updates, session issuance, and transactional event check-in.
"""

import hashlib
import importlib.util
import json
import os
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse


class FakeClientError(Exception):
    def __init__(self, code, message="", reasons=None):
        self.response = {"Error": {"Code": code, "Message": message}}
        if reasons is not None:
            self.response["CancellationReasons"] = reasons
        super().__init__(message)


KEY_NAMES = ("eventIdMember", "phoneNumber", "eventId", "visitId", "token")


def key_name_for(item):
    for name in KEY_NAMES:
        if name in item:
            return name
    raise AssertionError(f"could not determine key for {item!r}")


class FakeTable:
    def __init__(self, name):
        self.name = name
        self.store = {}
        self.raise_on_put = False
        self.updated = []

    def get_item(self, Key):
        key = next(iter(Key.values()))
        item = self.store.get(key)
        return {"Item": dict(item)} if item is not None else {}

    def scan(self):
        return {"Items": [dict(item) for item in self.store.values()]}

    def put_item(self, Item, ConditionExpression=None, **kwargs):
        if self.raise_on_put:
            raise FakeClientError("InternalServerError")
        name = key_name_for(Item)
        key = Item[name]
        if ConditionExpression == f"attribute_not_exists({name})" and key in self.store:
            raise FakeClientError("ConditionalCheckFailedException")
        self.store[key] = dict(Item)
        return {}

    def update_item(self, Key, UpdateExpression="", ExpressionAttributeNames=None,
                    ExpressionAttributeValues=None, ConditionExpression=None, **kwargs):
        key = next(iter(Key.values()))
        if ConditionExpression == "attribute_exists(eventId)" and key not in self.store:
            raise FakeClientError("ConditionalCheckFailedException")
        item = self.store.setdefault(key, dict(Key))
        values = ExpressionAttributeValues or {}
        names = ExpressionAttributeNames or {}
        for name_ref, attr in names.items():
            value_ref = ":" + name_ref.lstrip("#")
            if value_ref in values:
                item[attr] = values[value_ref]
        if ":h" in values:
            item["qrTokenHash"] = values[":h"]
        if ":u" in values:
            item["updatedAt"] = values[":u"]
        if ":r" in values:
            item["revokedAt"] = values[":r"]
        if "REMOVE revokedAt" in UpdateExpression:
            item.pop("revokedAt", None)
        self.updated.append((key, UpdateExpression, ConditionExpression))
        return {}


class FakeDynamo:
    def __init__(self):
        self.tables = {}
        self.meta = types.SimpleNamespace(client=self)
        self.transaction_calls = 0
        self.fail_transaction_with = None
        self.fail_transaction_times = 0

    def Table(self, name):
        return self.tables.setdefault(name, FakeTable(name))

    def transact_write_items(self, TransactItems):
        self.transaction_calls += 1
        if self.fail_transaction_with is not None and self.fail_transaction_times > 0:
            self.fail_transaction_times -= 1
            raise self.fail_transaction_with

        pending = []
        for op in TransactItems:
            if "Put" in op:
                spec = op["Put"]
                table = self.tables[spec["TableName"]]
                item = spec["Item"]
                name = key_name_for(item)
                key = item[name]
                condition = spec.get("ConditionExpression")
                if condition == f"attribute_not_exists({name})" and key in table.store:
                    raise FakeClientError(
                        "TransactionCanceledException",
                        reasons=[{"Code": "ConditionalCheckFailed"}],
                    )
                pending.append((table, key, dict(item)))
            elif "Update" in op:
                spec = op["Update"]
                table = self.tables[spec["TableName"]]
                key = next(iter(spec["Key"].values()))
                values = spec.get("ExpressionAttributeValues", {})
                item = dict(table.store[key]) if key in table.store else dict(spec["Key"])
                if ":firstName" in values:
                    item.setdefault("firstName", values[":firstName"])
                if ":lastName" in values:
                    item.setdefault("lastName", values[":lastName"])
                if ":createdAt" in values:
                    item.setdefault("createdAt", values[":createdAt"])
                if ":now" in values:
                    item["lastVisitAt"] = values[":now"]
                if ":today" in values:
                    item["lastVisitDate"] = values[":today"]
                if ":one" in values:
                    item["totalVisits"] = int(item.get("totalVisits", 0)) + int(values[":one"])
                pending.append((table, key, item))
            else:
                raise AssertionError(f"unexpected transaction operation: {op!r}")

        for table, key, item in pending:
            table.store[key] = item
        return {}


def load_module():
    boto3_mod = types.ModuleType("boto3")
    botocore_mod = types.ModuleType("botocore")
    exceptions_mod = types.ModuleType("botocore.exceptions")
    exceptions_mod.ClientError = FakeClientError
    botocore_mod.exceptions = exceptions_mod

    holder = {}

    def resource(_name):
        holder["dynamo"] = FakeDynamo()
        return holder["dynamo"]

    boto3_mod.resource = resource
    sys.modules["boto3"] = boto3_mod
    sys.modules["botocore"] = botocore_mod
    sys.modules["botocore.exceptions"] = exceptions_mod

    here = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location(
        "stagepass_lambda_under_test", os.path.join(here, "lambda_function.py")
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["stagepass_lambda_under_test"] = module
    spec.loader.exec_module(module)
    module._fake_dynamo = holder["dynamo"]
    return module


def fixed_datetime(fixed_utc):
    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_utc if tz is None else fixed_utc.astimezone(tz)

    return FixedDateTime


class LambdaTestCase(unittest.TestCase):
    def setUp(self):
        self.mod = load_module()
        self.dynamo = self.mod._fake_dynamo
        self.members = self.mod.members_table
        self.visits = self.mod.visits_table
        self.events = self.mod.events_table
        self.attendance = self.mod.attendance_table
        self.sessions = self.mod.sessions_table
        self.mod.ADMIN_PASSWORD = "test-password"
        self.mod.ADMIN_SESSION_SECRET = ""
        self.sessions.store["valid-token"] = {
            "token": "valid-token",
            "expiresAt": int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp()),
        }

    def api_event(self, method, path, body=None, token=None):
        headers = {}
        if token:
            headers["authorization"] = f"Bearer {token}"
        return {
            "headers": headers,
            "body": json.dumps(body) if body is not None else "",
            "rawPath": path,
            "path": path,
            "requestContext": {"http": {"method": method, "path": path}},
        }

    def parse(self, response):
        return response["statusCode"], json.loads(response["body"])

    def seed_event(self, **overrides):
        event = {
            "eventId": "evt-1",
            "eventName": "Black Labone",
            "eventDate": "2026-10-29",
            "venue": "Labone",
            "status": "open",
            "validFrom": "2026-10-29T10:00:00+02:00",
            "validTo": "2026-10-29T23:00:00+02:00",
            "qrTokenHash": hashlib.sha256(b"tok").hexdigest(),
            "createdAt": "2026-10-29T00:00:00Z",
            "updatedAt": "2026-10-29T00:00:00Z",
        }
        event.update(overrides)
        self.events.store[event["eventId"]] = event
        return event

    def thursday(self):
        # 2026-10-29 18:00 Africa/Johannesburg == 16:00 UTC (a Thursday).
        return fixed_datetime(datetime(2026, 10, 29, 16, 0, tzinfo=timezone.utc))


class TimezoneTests(LambdaTestCase):
    def test_naive_winter_is_johannesburg(self):
        parsed = self.mod.parse_event_datetime("2026-06-15T18:00", "validFrom")
        self.assertEqual(parsed.utcoffset(), timedelta(hours=2))
        self.assertEqual(parsed.astimezone(timezone.utc), datetime(2026, 6, 15, 16, 0, tzinfo=timezone.utc))

    def test_naive_summer_is_johannesburg(self):
        parsed = self.mod.parse_event_datetime("2026-12-15T18:00", "validTo")
        self.assertEqual(parsed.utcoffset(), timedelta(hours=2))
        self.assertEqual(parsed.astimezone(timezone.utc), datetime(2026, 12, 15, 16, 0, tzinfo=timezone.utc))

    def test_explicit_offset_is_preserved(self):
        parsed = self.mod.parse_event_datetime("2026-06-15T18:00:00+02:00", "validFrom")
        self.assertEqual(parsed.astimezone(timezone.utc), datetime(2026, 6, 15, 16, 0, tzinfo=timezone.utc))
        utc = self.mod.parse_event_datetime("2026-06-15T12:00:00Z", "validFrom")
        self.assertEqual(utc.hour, 14)

    def test_malformed_is_rejected(self):
        with self.assertRaises(ValueError):
            self.mod.parse_event_datetime("not-a-date", "validFrom")
        with self.assertRaises(ValueError):
            self.mod.parse_event_datetime("", "validTo")


class EventValidationTests(LambdaTestCase):
    def create(self, body):
        return self.mod.handle_create_event(
            self.api_event("POST", "/admin/events", body, token="valid-token")
        )

    def test_missing_event_name(self):
        status, body = self.parse(self.create({"eventDate": "2026-10-29"}))
        self.assertEqual(status, 400)
        self.assertIn("eventName", body["error"])

    def test_non_object_body_is_rejected(self):
        status, body = self.parse(self.create(["not", "an", "object"]))
        self.assertEqual(status, 400)
        self.assertIn("Invalid JSON", body["error"])

    def test_missing_valid_to_is_rejected(self):
        status, body = self.parse(self.create({
            "eventName": "Black Labone",
            "eventDate": "2026-10-29",
            "validFrom": "2026-10-29T10:00",
        }))
        self.assertEqual(status, 400)
        self.assertIn("validTo", body["error"])

    def test_malformed_window_is_rejected(self):
        status, body = self.parse(self.create({
            "eventName": "Black Labone",
            "eventDate": "2026-10-29",
            "validFrom": "banana",
            "validTo": "2026-10-29T23:00",
        }))
        self.assertEqual(status, 400)
        self.assertIn("validFrom", body["error"])

    def test_window_must_be_ordered(self):
        status, body = self.parse(self.create({
            "eventName": "Black Labone",
            "eventDate": "2026-10-29",
            "validFrom": "2026-10-29T23:00",
            "validTo": "2026-10-29T23:00",
        }))
        self.assertEqual(status, 400)
        self.assertIn("later", body["error"])

    def test_bad_event_date_and_status(self):
        status, _ = self.parse(self.create({
            "eventName": "Black Labone",
            "eventDate": "29 October",
            "validFrom": "2026-10-29T10:00",
            "validTo": "2026-10-29T23:00",
        }))
        self.assertEqual(status, 400)
        status, _ = self.parse(self.create({
            "eventName": "Black Labone",
            "eventDate": "2026-10-29",
            "validFrom": "2026-10-29T10:00",
            "validTo": "2026-10-29T23:00",
            "status": "live",
        }))
        self.assertEqual(status, 400)

    def test_valid_event_is_stored_as_utc(self):
        status, body = self.parse(self.create({
            "eventName": "Black Labone",
            "eventDate": "2026-10-29",
            "venue": "Labone",
            "validFrom": "2026-06-15T18:00",
            "validTo": "2026-12-15T23:00",
            "status": "open",
        }))
        self.assertEqual(status, 200)
        event = body["event"]
        self.assertEqual(event["validFrom"], "2026-06-15T16:00:00Z")
        self.assertEqual(event["validTo"], "2026-12-15T21:00:00Z")


class ConditionalEventTests(LambdaTestCase):
    def test_update_unknown_event_returns_404_and_does_not_create(self):
        status, body = self.parse(self.mod.handle_update_event(
            self.api_event("PATCH", "/admin/events/missing", {"status": "open"}, token="valid-token")
        ))
        self.assertEqual(status, 404)
        self.assertIn("not found", body["error"].lower())
        self.assertNotIn("missing", self.events.store)

    def test_update_known_event(self):
        self.seed_event()
        status, body = self.parse(self.mod.handle_update_event(
            self.api_event("PATCH", "/admin/events/evt-1", {"status": "closed"}, token="valid-token")
        ))
        self.assertEqual(status, 200)
        self.assertEqual(self.events.store["evt-1"]["status"], "closed")

    def test_update_event_fields(self):
        self.seed_event()
        status, body = self.parse(self.mod.handle_update_event(
            self.api_event("PATCH", "/admin/events/evt-1", {
                "eventName": "Black Labone Reloaded",
                "eventDate": "2026-11-05",
                "venue": "Accra",
                "status": "closed",
                "validFrom": "2026-11-05T18:00",
                "validTo": "2026-11-05T23:00",
            }, token="valid-token")
        ))
        self.assertEqual(status, 200)
        event = self.events.store["evt-1"]
        self.assertEqual(event["eventName"], "Black Labone Reloaded")
        self.assertEqual(event["eventDate"], "2026-11-05")
        self.assertEqual(event["venue"], "Accra")
        self.assertEqual(event["status"], "closed")
        self.assertEqual(event["validFrom"], "2026-11-05T16:00:00Z")
        self.assertEqual(event["validTo"], "2026-11-05T21:00:00Z")
        self.assertEqual(body["eventName"], "Black Labone Reloaded")

    def test_update_partial_fields_keeps_other_window_bound(self):
        self.seed_event()
        status, _ = self.parse(self.mod.handle_update_event(
            self.api_event("PATCH", "/admin/events/evt-1", {
                "eventName": "Renamed",
                "validTo": "2026-10-29T22:00",
            }, token="valid-token")
        ))
        self.assertEqual(status, 200)
        event = self.events.store["evt-1"]
        self.assertEqual(event["eventName"], "Renamed")
        self.assertEqual(event["validFrom"], "2026-10-29T10:00:00+02:00")
        self.assertEqual(event["validTo"], "2026-10-29T20:00:00Z")

    def test_update_rejects_reversed_merged_window(self):
        self.seed_event()
        status, body = self.parse(self.mod.handle_update_event(
            self.api_event("PATCH", "/admin/events/evt-1", {
                "validTo": "2026-10-29T09:00",
            }, token="valid-token")
        ))
        self.assertEqual(status, 400)
        self.assertIn("later", body["error"])
        self.assertEqual(self.events.store["evt-1"]["validTo"], "2026-10-29T23:00:00+02:00")

    def test_update_rejects_empty_or_invalid_fields(self):
        self.seed_event()
        cases = [
            {},
            {"eventName": "   "},
            {"eventDate": "29 October"},
            {"status": "live"},
            {"validFrom": "banana"},
        ]
        for payload in cases:
            status, _ = self.parse(self.mod.handle_update_event(
                self.api_event("PATCH", "/admin/events/evt-1", payload, token="valid-token")
            ))
            self.assertEqual(status, 400, payload)

    def test_qr_unknown_event_returns_404_and_does_not_create(self):
        status, body = self.parse(self.mod.handle_generate_qr(
            self.api_event("POST", "/admin/events/missing/qr", token="valid-token")
        ))
        self.assertEqual(status, 404)
        self.assertIn("not found", body["error"].lower())
        self.assertNotIn("missing", self.events.store)

    def test_qr_replaces_hash_and_clears_revocation(self):
        self.seed_event(revokedAt="2026-01-01T00:00:00Z")
        status, body = self.parse(self.mod.handle_generate_qr(
            self.api_event("POST", "/admin/events/evt-1/qr", token="valid-token")
        ))
        self.assertEqual(status, 200)
        self.assertTrue(body["qrUrl"])
        self.assertNotIn("token", body)
        token = parse_qs(urlparse(body["qrUrl"]).query)["t"][0]
        self.assertNotIn("revokedAt", self.events.store["evt-1"])
        self.assertEqual(
            self.events.store["evt-1"]["qrTokenHash"],
            hashlib.sha256(token.encode("utf-8")).hexdigest(),
        )


class AdminSessionTests(LambdaTestCase):
    def test_login_rejects_wrong_password(self):
        status, body = self.parse(self.mod.handle_admin_login(
            self.api_event("POST", "/admin/login", {"password": "wrong"})
        ))
        self.assertEqual(status, 401)
        self.assertNotIn("token", body)

    def test_login_fails_when_session_cannot_persist(self):
        self.sessions.raise_on_put = True
        status, body = self.parse(self.mod.handle_admin_login(
            self.api_event("POST", "/admin/login", {"password": "test-password"})
        ))
        self.assertEqual(status, 503)
        self.assertNotIn("token", body)
        self.assertNotIn("InternalServerError", body["error"])

    def test_login_issues_a_working_token(self):
        status, body = self.parse(self.mod.handle_admin_login(
            self.api_event("POST", "/admin/login", {"password": "test-password"})
        ))
        self.assertEqual(status, 200)
        token = body["token"]
        self.assertIn(token, self.sessions.store)
        status, _ = self.parse(self.mod.handle_admin_members(
            self.api_event("GET", "/admin/members", token=token)
        ))
        self.assertEqual(status, 200)

    def test_admin_routes_require_a_valid_token(self):
        status, _ = self.parse(self.mod.handle_admin_members(
            self.api_event("GET", "/admin/members")
        ))
        self.assertEqual(status, 401)
        status, _ = self.parse(self.mod.handle_admin_members(
            self.api_event("GET", "/admin/members", token="bogus")
        ))
        self.assertEqual(status, 401)

    def test_expired_session_is_rejected(self):
        self.sessions.store["old"] = {
            "token": "old",
            "expiresAt": int((datetime.now(timezone.utc) - timedelta(minutes=1)).timestamp()),
        }
        status, _ = self.parse(self.mod.handle_admin_members(
            self.api_event("GET", "/admin/members", token="old")
        ))
        self.assertEqual(status, 401)


class EventCheckinTests(LambdaTestCase):
    def checkin(self):
        return self.mod.handle_checkin(self.api_event(
            "POST",
            "/checkin",
            {
                "firstName": "Test",
                "lastName": "A",
                "phoneNumber": "0712345678",
                "eventId": "evt-1",
                "token": "tok",
            },
        ))

    def test_event_checkin_succeeds_once(self):
        self.seed_event()
        with patch.object(self.mod, "datetime", self.thursday()):
            status, body = self.parse(self.checkin())
            self.assertEqual(status, 200)
            self.assertEqual(body["totalVisits"], 1)
            self.assertFalse(body["alreadyCheckedInToday"])
            self.assertIn("evt-1#0712345678", self.attendance.store)
            self.assertEqual(len(self.visits.store), 1)
            self.assertEqual(self.members.store["0712345678"]["totalVisits"], 1)

    def test_duplicate_event_checkin_is_friendly_and_does_not_increment(self):
        self.seed_event()
        with patch.object(self.mod, "datetime", self.thursday()):
            self.parse(self.checkin())
            status, body = self.parse(self.checkin())
        self.assertEqual(status, 200)
        self.assertTrue(body["alreadyCheckedInToday"])
        self.assertTrue(body["alreadyCheckedInToEvent"])
        self.assertEqual(body["totalVisits"], 1)
        self.assertEqual(len(self.visits.store), 1)
        self.assertEqual(self.members.store["0712345678"]["totalVisits"], 1)

    def test_failed_transaction_does_not_reserve_attendance(self):
        self.seed_event()
        self.dynamo.fail_transaction_with = FakeClientError("InternalServerError")
        self.dynamo.fail_transaction_times = 1
        with patch.object(self.mod, "datetime", self.thursday()):
            status, _ = self.parse(self.checkin())
            self.assertEqual(status, 500)
            self.assertEqual(self.attendance.store, {})
            self.assertEqual(self.visits.store, {})
            self.assertNotIn("0712345678", self.members.store)

            status, body = self.parse(self.checkin())
        self.assertEqual(status, 200)
        self.assertEqual(body["totalVisits"], 1)
        self.assertEqual(len(self.attendance.store), 1)
        self.assertEqual(len(self.visits.store), 1)

    def test_malformed_window_is_rejected(self):
        self.seed_event(validFrom="not-a-date", validTo="also-bad")
        with patch.object(self.mod, "datetime", self.thursday()):
            status, body = self.parse(self.checkin())
        self.assertEqual(status, 400)
        self.assertIn("invalid validity window", body["error"])

    def test_reversed_window_is_rejected(self):
        self.seed_event(
            validFrom="2026-10-29T23:00:00+02:00",
            validTo="2026-10-29T10:00:00+02:00",
        )
        with patch.object(self.mod, "datetime", self.thursday()):
            status, body = self.parse(self.checkin())
        self.assertEqual(status, 400)
        self.assertIn("invalid validity window", body["error"])

    def test_non_thursday_is_rejected(self):
        self.seed_event()
        monday = fixed_datetime(datetime(2026, 10, 26, 16, 0, tzinfo=timezone.utc))
        with patch.object(self.mod, "datetime", monday):
            status, body = self.parse(self.checkin())
        self.assertEqual(status, 400)
        self.assertIn("Thursday", body["error"])

    def test_bad_phone_is_rejected(self):
        status, _ = self.parse(self.mod.handle_checkin(
            self.api_event("POST", "/checkin", {"phoneNumber": "abc"})
        ))
        self.assertEqual(status, 400)


class LegacyCheckinTests(LambdaTestCase):
    def test_same_day_duplicate_is_friendly(self):
        now = datetime.now(timezone.utc)
        today_sast = now.astimezone(self.mod.SAST).date().isoformat()
        self.members.store["0712345678"] = {
            "phoneNumber": "0712345678",
            "firstName": "Test",
            "lastName": "A",
            "totalVisits": 3,
            "createdAt": now.isoformat(),
            "lastVisitAt": now.isoformat(),
            "lastVisitDate": today_sast,
        }
        status, body = self.parse(self.mod.handle_checkin(
            self.api_event("POST", "/checkin", {"phoneNumber": "0712345678"})
        ))
        self.assertEqual(status, 200)
        self.assertTrue(body["alreadyCheckedInToday"])
        self.assertNotIn("alreadyCheckedInToEvent", body)
        self.assertEqual(body["totalVisits"], 3)


if __name__ == "__main__":
    unittest.main()
