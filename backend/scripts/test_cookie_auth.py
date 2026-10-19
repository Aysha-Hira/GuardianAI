from __future__ import annotations

import http.cookiejar
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
EMAIL = sys.argv[1] if len(sys.argv) > 1 else "operator@guardian.ai"
PASSWORD = sys.argv[2] if len(sys.argv) > 2 else "Guardian1!"
ok = True


def check(label, cond, extra=""):
    global ok
    ok &= bool(cond)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}{(' — ' + str(extra)) if extra else ''}")


def call(opener, method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers or {})
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with opener.open(req) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


anon = urllib.request.build_opener()
jar = http.cookiejar.CookieJar()
user = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

print("Without login:")
for p in ("/frame", "/cameras/1/frame", "/alerts", "/watchlist/images/WL-0001.jpg"):
    st, _, _ = call(anon, "GET", p)
    check(f"{p} blocked", st == 401, st)

print("Login:")
st, body, hdrs = call(user, "POST", "/auth/login", {"email": EMAIL, "password": PASSWORD, "remember": True})
check("login succeeds", st == 200, st)
payload = json.loads(body or b"{}")
check("token NOT in response body", "access_token" not in payload)
cookies = hdrs.get_all("Set-Cookie") or []
sess = next((c for c in cookies if c.startswith("guardian_session=")), "")
csrf_hdr = next((c for c in cookies if c.startswith("guardian_csrf=")), "")
check("session cookie is HttpOnly", "httponly" in sess.lower())
check("CSRF cookie readable by the page (not HttpOnly)", csrf_hdr and "httponly" not in csrf_hdr.lower())
check("SameSite=strict", "samesite=strict" in sess.lower())
csrf = next((c.value for c in jar if c.name == "guardian_csrf"), None)
old_session = next((c.value for c in jar if c.name == "guardian_session"), None)
check("CSRF cookie present", bool(csrf))

print("Logged in:")
st, _, _ = call(user, "GET", "/auth/me")
check("/auth/me works with cookie", st == 200, st)
st, _, _ = call(user, "GET", "/frame")
check("/frame allowed with cookie", st != 401, st)
name = json.loads(call(user, "GET", "/auth/me")[1]).get("name", "Test Operator")
st, _, _ = call(user, "PATCH", "/auth/me", {"name": name})
check("write WITHOUT CSRF header rejected", st == 403, st)
st, _, _ = call(user, "PATCH", "/auth/me", {"name": name}, {"X-CSRF-Token": "wrong"})
check("write with WRONG CSRF rejected", st == 403, st)
st, _, _ = call(user, "PATCH", "/auth/me", {"name": name}, {"X-CSRF-Token": csrf or ""})
check("write with correct CSRF allowed", st == 200, st)

print("Logout:")
st, _, _ = call(user, "POST", "/auth/logout", headers={"X-CSRF-Token": csrf or ""})
check("logout succeeds", st == 200, st)
stolen = urllib.request.build_opener()
st, _, _ = call(stolen, "GET", "/auth/me", headers={"Cookie": f"guardian_session={old_session}"})
check("old (stolen) cookie rejected after logout", st == 401, st)

print("\nALL TESTS PASSED" if ok else "\nSOME TESTS FAILED — paste this output to Claude")
sys.exit(0 if ok else 1)
