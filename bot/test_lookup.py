"""Offline tests for lookup.py against a local fake x.com. Run: python3 bot/test_lookup.py"""
import http.server
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
SEEN = []


class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        SEEN.append({"path": self.path, "headers": dict(self.headers)})
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        sn = json.loads(q["variables"][0])["screenName"]
        if sn == "ratelimited":
            self.send_response(429); self.send_header("x-rate-limit-reset", "1800000000"); self.end_headers(); return
        if sn == "ghost":
            body = {"data": {"user_result_by_screen_name": {}}}
        else:
            body = {"data": {"user_result_by_screen_name": {"result": {
                "__typename": "User", "core": {"screen_name": sn}, "location": {"location": "Dallas, TX"},
                "about_profile": {"account_based_in": "Nigeria", "location_accurate": False,
                                  "source": "Nigeria Android App"}}}}}
        data = json.dumps(body).encode()
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers()
        self.wfile.write(data)


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = http.server.HTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.env = dict(os.environ, CF_X_BASE="http://127.0.0.1:%d" % cls.srv.server_port,
                       X_AUTH_TOKEN="tok", X_CT0="csrf123")

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def run_cli(self, *args, env=None):
        p = subprocess.run([sys.executable, os.path.join(HERE, "lookup.py"), *args],
                           env=env or self.env, capture_output=True, text=True, timeout=30)
        return p.returncode, json.loads(p.stdout)

    def test_lookup_ok_and_headers(self):
        SEEN.clear()
        code, out = self.run_cli("@SomeUser")
        self.assertEqual(code, 0)
        self.assertEqual(out, {"handle": "SomeUser", "based_in": "Nigeria", "location_accurate": False,
                               "source": "Nigeria Android App", "self_reported_location": "Dallas, TX"})
        h = {k.lower(): v for k, v in SEEN[0]["headers"].items()}
        self.assertEqual(h["x-csrf-token"], "csrf123")
        self.assertIn("auth_token=tok", h["cookie"])
        self.assertTrue(h["authorization"].startswith("Bearer "))
        self.assertIn("/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery?variables=", SEEN[0]["path"])

    def test_not_found(self):
        code, out = self.run_cli("ghost")
        self.assertEqual(code, 0)
        self.assertIsNone(out["based_in"]); self.assertIn("note", out)

    def test_rate_limit(self):
        code, out = self.run_cli("ratelimited")
        self.assertEqual(code, 3); self.assertIn("429", out["error"])

    def test_missing_cookies(self):
        env = {k: v for k, v in self.env.items() if k not in ("X_AUTH_TOKEN", "X_CT0")}
        code, out = self.run_cli("jack", env=env)
        self.assertEqual(code, 1); self.assertIn("auth_token", out["error"])

    def test_bad_handle(self):
        code, out = self.run_cli("not a handle!")
        self.assertEqual(code, 1)

    def test_cookie_formats(self):
        from lookup import parse_cookie_text as p
        self.assertEqual(p('{"auth_token":"a","ct0":"b"}'), {"auth_token": "a", "ct0": "b"})
        self.assertEqual(p('[{"name":"auth_token","value":"a"},{"name":"ct0","value":"b"},{"name":"x","value":"y"}]'),
                         {"auth_token": "a", "ct0": "b"})
        self.assertEqual(p("Cookie: guest_id=1; auth_token=a; ct0=b"), {"auth_token": "a", "ct0": "b"})
        txt = "# Netscape HTTP Cookie File\n#HttpOnly_.x.com\tTRUE\t/\tTRUE\t0\tauth_token\ta\n.x.com\tTRUE\t/\tTRUE\t0\tct0\tb\n"
        self.assertEqual(p(txt), {"auth_token": "a", "ct0": "b"})

    def test_cookie_file_flag(self):
        env = {k: v for k, v in self.env.items() if k not in ("X_AUTH_TOKEN", "X_CT0")}
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"auth_token": "tok", "ct0": "csrf123"}, f)
        try:
            code, out = self.run_cli("jack", "--cookies", f.name, env=env)
            self.assertEqual(code, 0); self.assertEqual(out["based_in"], "Nigeria")
        finally:
            os.unlink(f.name)


if __name__ == "__main__":
    unittest.main(verbosity=2)
