"""Exercise the compiled Qt bridge against an isolated HTTPS fixture."""
import json
import os
import hashlib
import base64
import pathlib
import ssl
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SERVER_ID = "b" * 64
UPDATE_BYTES = b"!<arch>\nSynthetic DEB package for transport tests"
UPDATE_RELEASE = {"available":True,"platform":"linux","version":"3.13.0", "sha256":hashlib.sha256(UPDATE_BYTES).hexdigest(),"size_bytes":len(UPDATE_BYTES),"filename":"SOLVIA-3.13.0-Linux-x64.deb","release_notes":"Тестова версія"}


class FixtureServer(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        if not isinstance(sys.exception(), (BrokenPipeError, ConnectionResetError)):
            super().handle_error(request, client_address)


class Center(BaseHTTPRequestHandler):
    requests = []

    def log_message(self, *_):
        pass

    def respond(self, value, status=200):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        role = self.headers.get("Authorization", "").removeprefix("Bearer ")
        path = self.path.split("?", 1)[0]
        if path == "/api/desktop-updates/package":
            self.send_response(200)
            self.send_header("Content-Length", str(len(UPDATE_BYTES)))
            self.end_headers()
            self.wfile.write(UPDATE_BYTES)
            return
        update_release = dict(UPDATE_RELEASE)
        if path == "/api/desktop-updates" and "?" in self.path:
            self.server.update_checks = getattr(self.server, "update_checks", 0) + 1
            if self.server.update_checks > 1:
                update_release["sha256"] = "0" * 64
        responses = {
            "/api/desktop-updates": update_release if "?" in self.path else [UPDATE_RELEASE],
            "/api/mobile-update": {"available":True,"version_name":"3.13.0","version_code":182046,"sha256":"a"*64,"size_bytes":1024},
            "/api/health": {"ok": True, "server_id": SERVER_ID},
            "/api/me": {"role": role, "name": "Synthetic account"},
            "/api/settings/center": {"center_name":"Тестовий центр","address":"Synthetic address"},
            "/api/consent-policy": {"required":True,"revision":1,"templates":[{"document_type":kind,"title":kind,"content":"Synthetic approved consent text for native workflow checks.","version":1,"required":True} for kind in ["informed_consent","data_processing"]]},
            "/api/center/modules": {"license":{"status":"unmanaged","write_allowed":True,"server_id":SERVER_ID},"modules":[{"id":"patients","name":"Картки","version":"1.0.0","core":True,"enabled":True,"licensed":True,"depends":[]}]},
            "/api/operations/handover": [{"id":5,"summary":"Завдання наступній зміні","state":"open","priority":"important","created_by":"Реєстратор","shift_date":"2026-11-11"}],
            "/api/shift-day": {"open":True,"shift_date":"2026-11-11"},
            "/api/patient-directory": {"items":[{"id":19,"name":"Тестовий пацієнт","patient_no":"0019","psychologist_id":7,"status":"active"}],"total":1},
            "/api/supervisions": [{"id":8,"psychologist":"Тестовий психолог","psychologist_id":7,"scheduled_at":"2026-11-11T12:00","duration_minutes":60,"status":"scheduled","topic":"Підтримка команди"}],
            "/api/staff/messages": [{"id":3,"body":"Зустріч команди","recipient":"Психолог","created":"2026-11-11T10:00"}],
            "/api/admin/devices": [{"name":"Тестовий психолог","device_name":"Android test","fresh":True,"pending_count":2,"blocked_count":0}],
            "/api/admin/recovery": [{"id":12,"patient":"Тестовий пацієнт","psychologist":"Тестовий психолог","state":"open","kind":"consultation","revision":2}],
            "/api/admin/recovery/12": {"id":12,"patient":"Тестовий пацієнт","state":"open","revision":2,"draft_version":3,"payload":{"note":"Запис із телефона","patient_id":19,"appointment_id":4,"client_key":"test-key-123456789"},"existing":[],"server_draft":None},
            "/api/patients/19/documents": [{"id":1,"title":"Згода","status":"signed","content":"Текст згоди","signed_by_name":"Пацієнт"}],
            "/api/waiting-list": [{"id":6,"version":3,"patient_id":19,"psychologist_id":7,"status":"waiting"}],
            "/api/patients/19": {"id":19,"name":"Synthetic patient","psychologist_id":7,"status":"active","courses":[{"id":4,"course_no":1,"started_at":"2026-11-01","status":"active","psychologist":"Тестовий психолог"}],"documents":[{"id":1,"title":"Згода","status":"signed"}],
                                 "referrals":[{"id":7,"destination_type":"Психотерапія","destination_name":"Тестовий спеціаліст","status":"recommended","reason":"Планова консультація"}]},
            "/api/families": [{"id":2,"name":"Synthetic family","member_count":2}],
            "/api/meta": {"psychologists":[{"id":7,"name":"Synthetic psychologist"}],"rooms":[{"id":2,"name":"Room 2"}]},
            "/api/slots": ["10:15", "14:15"],
            "/api/users": [{"id": 4, "name": "Synthetic staff", "active": True}],
            "/api/services": [{"id": 2, "code": "art", "name": "Арттерапія", "category": "creative", "active": True}],
            "/api/admin/module-permissions": [{"id":4,"name":"Synthetic staff","role":"reception","blocked_modules":[]}],
            "/api/discharges": [{"id": 9, "revision": 2, "workflow_status": "review"}],
            "/api/stats": {"total_patients": 15},
            "/api/my-module-permissions": {"role":role,"blocked_modules": ["messages"] if role == "reception" else []},
            "/api/mobile-config": {
                "format": "quremed.solvia.mobile", "version": 2, "server_id": SERVER_ID,
                "api_url": f"https://127.0.0.1:{self.server.server_port}",
            },
        }
        if path == "/api/patients/19/appointments":
            from urllib.parse import parse_qs, urlsplit
            params = parse_qs(urlsplit(self.path).query)
            period = params.get("period", ["upcoming"])[0]
            page = int(params.get("page", ["1"])[0])
            if period not in ("upcoming", "history") or page < 1:
                return self.respond({"error":"Invalid visit request"},400)
            items = [{"id": 400+page, "start":"2026-11-12T10:00" if period=="upcoming" else "2026-10-12T10:00",
                      "psychologist":"Тестовий психолог", "room":"Кабінет 2",
                      "status":"scheduled" if period=="upcoming" else "completed",
                      "visit_status":"" if period=="upcoming" else "completed"}]
            return self.respond({"items":items,"total":11 if period=="upcoming" else 1,
                                 "page":page,"page_size":10})
        if path == "/api/patient-directory":
            from urllib.parse import parse_qs, urlsplit
            params = parse_qs(urlsplit(self.path).query)
            page = int(params.get("page", ["1"])[0])
            if page not in (1, 2):
                return self.respond({"error": "Unexpected register page"}, 400)
            return self.respond({
                "items": [{"id":19 if "--ui" in sys.argv[2:] else page,"name":"Пацієнт "+str(page),"patient_no":"TEST"+str(page),"psychologist_id":7,"status":"active"}],
                "total": 41, "page": page, "page_size": 25,
            })
        if path in {"/api/users", "/api/mobile-config"} and role != "admin":
            return self.respond({"error": "Forbidden"}, 403)
        self.respond(responses.get(path, {}))

    def body(self):
        return json.loads(self.rfile.read(int(self.headers["Content-Length"])))

    def do_POST(self):
        body = self.body()
        if self.path == "/api/login":
            return self.respond({"token": body["login"]})
        self.requests.append((self.path, body))
        self.respond({"ok": True, "id": 21})

    def do_PATCH(self):
        self.requests.append((self.path, self.body()))
        self.respond({"ok": True})

    def do_DELETE(self):
        self.requests.append((self.path, {}))
        self.respond({"ok": True})


with tempfile.TemporaryDirectory() as temporary:
    tmp = pathlib.Path(temporary)
    cert, key = tmp / "cert.pem", tmp / "key.pem"
    subprocess.run([
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
        "-keyout", str(key), "-out", str(cert),
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    public_key, private_key = tmp / "publisher-public.pem", tmp / "publisher-private.pem"
    subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(private_key)],check=True)
    subprocess.run(["openssl","pkey","-in",str(private_key),"-pubout","-out",str(public_key)],check=True)
    with FixtureServer(("127.0.0.1", 0), Center) as server:
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(cert, key)
        server.socket = tls.wrap_socket(server.socket, server_side=True)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            subprocess.run([sys.argv[1], f"https://127.0.0.1:{server.server_port}", str(cert)],
                           check=True, timeout=40, env={**os.environ,"LEMVORI_TEST_PUBLIC_KEY":str(public_key),"LEMVORI_TEST_PRIVATE_KEY":str(private_key)})
        finally:
            server.shutdown()
            worker.join()

if "--ui" in sys.argv[2:]:
    print("PASS: native role navigation, dialogs and responsive layout")
    sys.exit(0)

published = next(body for path,body in Center.requests if path == "/api/desktop-updates")
assert base64.b64decode(published["package_base64"]) == UPDATE_BYTES
assert published["sha256"] == UPDATE_RELEASE["sha256"] and published["version"] == "3.13.0"
assert published["platform"] == "linux"
print("PASS: native administrator publication, bounded package validation and verified DEB download")
bookings = [body for path, body in Center.requests if path == "/api/appointments"]
assert len(bookings) == 2, "Double submit must create only one booking"
assert bookings[1]["patient_ids"] == [19,20] and bookings[1]["kind"] == "group"
assert bookings[0]["patient_ids"] == [19] and bookings[0]["client_key"]
assert bookings[0]["start"] == "2026-11-11T10:15" and bookings[0]["end"] == "2026-11-11T11:00"
assert ("/api/discharges/9/workflow", {"action": "return", "revision": 2, "reason": "Уточнити рекомендації"}) in Center.requests
assert ("/api/users/4", {"name": "Test Staff", "role": "reception", "active": True, "primary_service_code": "art"}) in Center.requests
print("PASS: native HTTPS and profile binding, distinct staff/admin roles, slot booking with duplicate-submit protection, director review, and team editing")

assert ("/api/waiting-list/6", {"version":3,"status":"offered"}) in Center.requests
assert any(path=="/api/waiting-list/6/book" and body["version"]==4 for path,body in Center.requests)
handovers=[body for path,body in Center.requests if path=="/api/operations/handover"]
assert len(handovers)==1 and handovers[0]["client_key"]
assert any(path=="/api/patients/19" and body["family_id"]==2 for path,body in Center.requests)
assert any(path=="/api/supervisions" for path,body in Center.requests)
assert len([1 for path,body in Center.requests if path=="/api/staff/messages"])==1
assert all(body.get("body")!="FORBIDDEN" for path,body in Center.requests)
print("PASS: operational roles, version-checked waiting booking, handover double-submit lock, patient family edit, supervision, messaging and logout data cleanup")

document=next(body for path,body in Center.requests if path=="/api/patients/19/documents")
assert document["original_data"].startswith("data:image/png;base64,")
assert document["scan_data"].startswith("data:image/jpeg;base64,")
assert document["paper_signed"] is True
recovery=next(body for path,body in Center.requests if path=="/api/admin/recovery/12")
assert recovery["revision"]==2 and recovery["draft_version"]==3
print("PASS: group participants, signed paper scan with preserved original, and recovery revision guards")
if "--ui" in sys.argv[2:]:
    assert ("/api/referrals/7", {"status":"sent"}) in Center.requests, "Referral follow-up status was not saved by Qt Native"
assert ("/api/users/4/sessions", {}) in Center.requests, "Admin did not revoke selected employee sessions"
assert ("/api/admin/module-permissions", {"user_id":4,"blocked_modules":["documents","clinical"]}) in Center.requests, "Qt access editor did not send selected restrictions"
