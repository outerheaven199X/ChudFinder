#!/usr/bin/env python3
"""Chud Finder bot lookup: where does X say an account is based?

Calls X's internal AboutAccountQuery GraphQL endpoint (the same one the x.com
"About this account" page uses) with the user's own logged-in session cookies.

Usage:
  python3 lookup.py <handle> [--cookies PATH] [--query-id ID]

Cookies (auth_token + ct0) come from, in order:
  --cookies PATH  a file in any of these formats:
                    JSON {"auth_token": "...", "ct0": "..."}  (or a list of {name, value} cookie objects)
                    Netscape cookies.txt
                    a raw Cookie header: "auth_token=...; ct0=..."
  env X_AUTH_TOKEN and X_CT0
  env X_COOKIES_FILE (a path, same formats as --cookies)

Prints JSON:
  {"handle", "based_in", "location_accurate", "source", "self_reported_location"}
self_reported_location is filled only if X includes it in this response. Otherwise it's null,
and the caller can fill it from the public X API (it's self-reported, not X's "based in").

Exit codes: 0 ok, 1 usage/auth problem, 2 HTTP/network error, 3 rate limited (429).
Standard library only. No data is sent anywhere except x.com.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_QUERY_ID = "XRqGa7EeokUU5kppkh13EA"
# Public bearer token embedded in X's web client (identical for every user).
BEARER = ("Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D"
          "1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA")
BASE = os.environ.get("CF_X_BASE", "https://x.com")  # override only for tests
HANDLE_RE = re.compile(r"^[A-Za-z0-9_]{1,15}$")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/141.0 Safari/537.36")


class LookupError_(Exception):
    def __init__(self, msg, code=2):
        super().__init__(msg)
        self.code = code


def parse_cookie_text(text):
    """Return {'auth_token':..., 'ct0':...} from JSON, cookies.txt, or a Cookie header."""
    text = text.strip()
    found = {}
    if text.startswith("{") or text.startswith("["):
        data = json.loads(text)
        if isinstance(data, dict):
            if "cookies" in data and isinstance(data["cookies"], list):
                data = data["cookies"]
            else:
                found = {k: str(v) for k, v in data.items() if k in ("auth_token", "ct0") and v}
        if isinstance(data, list):
            for c in data:
                if isinstance(c, dict) and c.get("name") in ("auth_token", "ct0") and c.get("value"):
                    found[c["name"]] = str(c["value"])
        return found
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#") and not line.startswith("#HttpOnly_"):
            continue
        parts = line.split("\t")
        if len(parts) >= 7:  # Netscape cookies.txt
            if parts[5] in ("auth_token", "ct0") and ("x.com" in parts[0] or "twitter.com" in parts[0]):
                found[parts[5]] = parts[6].strip()
            continue
        for kv in line.split(";"):  # Cookie header
            if "=" in kv:
                k, v = kv.split("=", 1)
                k = k.strip()
                if k.lower() == "cookie:" or k.lower().startswith("cookie:"):
                    k = k.split(":", 1)[1].strip()
                if k in ("auth_token", "ct0") and v.strip():
                    found[k] = v.strip()
    return found


def load_cookies(path=None):
    if path is None:
        path = os.environ.get("X_COOKIES_FILE")
    cookies = {}
    if path:
        with open(os.path.expanduser(path), encoding="utf-8") as fh:
            cookies = parse_cookie_text(fh.read())
    cookies.setdefault("auth_token", os.environ.get("X_AUTH_TOKEN", ""))
    cookies.setdefault("ct0", os.environ.get("X_CT0", ""))
    if not cookies.get("auth_token") or not cookies.get("ct0"):
        raise LookupError_("Need auth_token and ct0 cookies (use --cookies PATH or X_AUTH_TOKEN / X_CT0).", 1)
    return cookies


def parse_about(data, handle):
    user = (((data or {}).get("data") or {}).get("user_result_by_screen_name") or {}).get("result")
    if not user or user.get("__typename") == "UserUnavailable":
        return {"handle": handle, "based_in": None, "location_accurate": None, "source": None,
                "self_reported_location": None, "found": False}
    sn = (user.get("core") or {}).get("screen_name")
    if sn and sn.lower() != handle.lower():
        raise LookupError_("Response was for @%s, not @%s" % (sn, handle))
    about = user.get("about_profile") or {}
    loc = user.get("location")
    stated = loc.get("location") if isinstance(loc, dict) else None
    stated = stated or (user.get("legacy") or {}).get("location") or None
    acc = about.get("location_accurate")
    return {
        "handle": sn or handle,
        "based_in": about.get("account_based_in") or None,
        "location_accurate": acc if isinstance(acc, bool) else None,
        "source": about.get("source") or None,
        "self_reported_location": stated,
        "found": True,
    }


def lookup(handle, cookies, query_id=DEFAULT_QUERY_ID, timeout=20):
    handle = handle.strip().lstrip("@")
    if not HANDLE_RE.match(handle):
        raise LookupError_("Not a valid X handle: %r" % handle, 1)
    variables = json.dumps({"screenName": handle}, separators=(",", ":"))
    url = "%s/i/api/graphql/%s/AboutAccountQuery?%s" % (
        BASE, query_id, urllib.parse.urlencode({"variables": variables}))
    req = urllib.request.Request(url, headers={
        "authorization": BEARER,
        "x-csrf-token": cookies["ct0"],
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
        "content-type": "application/json",
        "user-agent": UA,
        "cookie": "auth_token=%s; ct0=%s" % (cookies["auth_token"], cookies["ct0"]),
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            data = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 429:
            reset = e.headers.get("x-rate-limit-reset")
            raise LookupError_("Rate limited by X (429)%s." % (", resets at unix %s" % reset if reset else ""), 3)
        if e.code in (401, 403):
            raise LookupError_("X rejected the session (HTTP %d): cookies expired or wrong." % e.code, 1)
        if e.code in (400, 404):
            raise LookupError_("HTTP %d: the AboutAccountQuery id may have changed (try --query-id)." % e.code)
        raise LookupError_("HTTP %d from X." % e.code)
    except urllib.error.URLError as e:
        raise LookupError_("Network error: %s" % e.reason)
    return parse_about(data, handle)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Where does X say an account is based?")
    ap.add_argument("handle")
    ap.add_argument("--cookies", help="path to cookies (JSON, cookies.txt, or Cookie header)")
    ap.add_argument("--query-id", default=os.environ.get("CF_QUERY_ID", DEFAULT_QUERY_ID))
    args = ap.parse_args(argv)
    try:
        result = lookup(args.handle, load_cookies(args.cookies), args.query_id)
    except LookupError_ as e:
        print(json.dumps({"handle": args.handle.lstrip("@"), "error": str(e)}))
        return e.code
    except (OSError, ValueError) as e:
        print(json.dumps({"handle": args.handle.lstrip("@"), "error": str(e)}))
        return 1
    if not result.pop("found", True):
        result["note"] = "account not found or unavailable"
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
