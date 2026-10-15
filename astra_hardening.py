"""astra_hardening.py - request-level safety, speed and error handling.

Everything here is generic plumbing that sits *around* the game rules:

* a tiny in-memory rate limiter (login brute force, chat spam, LLM-cost abuse)
* security headers (nosniff, no framing by other sites, HSTS when hosted)
* sane caching: versioned /static files are cached for a year, API answers never are
* gzip for text responses when nothing in front of the app already does it
* JSON error answers for /api routes (a stack trace page can't be parsed by the game UI)

Nothing in here changes game balance or data.
"""
import gzip
import logging
import os
import threading
import time
from collections import deque

from flask import jsonify, request, session
from werkzeug.exceptions import HTTPException

log = logging.getLogger("astra.hardening")

BEHIND_PROXY = os.environ.get("ASTRA_BEHIND_PROXY", "").strip() == "1"
# When Cloudflare (or another CDN) fronts the app it compresses for the browser itself, and
# double compression through a Worker is a classic source of "content decoding failed" errors.
GZIP_ENABLED = os.environ.get("ASTRA_GZIP", "0" if BEHIND_PROXY else "1").strip() == "1"

_COMPRESSIBLE = ("text/", "application/json", "application/javascript", "application/manifest+json",
                 "image/svg+xml", "application/xml")
_GZIP_MIN_BYTES = 700


# --------------------------------------------------------------------------
# rate limiter
# --------------------------------------------------------------------------

class RateLimiter:
    """Sliding-window counter. Thread-safe, bounded memory, no dependencies."""

    def __init__(self, max_keys=20000):
        self._hits = {}
        self._lock = threading.Lock()
        self._max_keys = max_keys
        self._last_gc = time.time()

    def _gc(self, now):
        if now - self._last_gc < 60 and len(self._hits) < self._max_keys:
            return
        self._last_gc = now
        for key in [k for k, dq in self._hits.items() if not dq or dq[-1] < now - 3600]:
            self._hits.pop(key, None)
        if len(self._hits) >= self._max_keys:          # still huge: drop the oldest half
            for key in list(self._hits)[: len(self._hits) // 2]:
                self._hits.pop(key, None)

    def hit(self, key, limit, window):
        """Record one event. Returns (allowed, retry_after_seconds)."""
        now = time.time()
        with self._lock:
            self._gc(now)
            dq = self._hits.setdefault(key, deque())
            while dq and dq[0] <= now - window:
                dq.popleft()
            if len(dq) >= limit:
                return False, max(1, int(dq[0] + window - now) + 1)
            dq.append(now)
            return True, 0

    def count(self, key, window):
        now = time.time()
        with self._lock:
            dq = self._hits.get(key)
            if not dq:
                return 0
            while dq and dq[0] <= now - window:
                dq.popleft()
            return len(dq)

    def oldest_age(self, key):
        with self._lock:
            dq = self._hits.get(key)
            return (time.time() - dq[0]) if dq else 0.0

    def add(self, key):
        with self._lock:
            self._hits.setdefault(key, deque()).append(time.time())

    def clear(self, key):
        with self._lock:
            self._hits.pop(key, None)


limiter = RateLimiter()


def client_ip():
    """Best guess at the real player address.

    Behind the Cloudflare Worker the first X-Forwarded-For entry is the player (the Worker
    overwrites whatever the client sent); the last entry is just a Cloudflare/Render hop, so using
    it would make every player share one address and trip the limits together.
    """
    if BEHIND_PROXY:
        forwarded = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        if forwarded:
            return forwarded[:64]
    return request.remote_addr or "?"


def rate_key(prefix):
    uid = session.get("user_id")
    return f"{prefix}:u{uid}" if uid else f"{prefix}:ip{client_ip()}"


def too_many(retry_after, msg=None):
    resp = jsonify(success=False, error="rate_limited", retry_after=retry_after,
                   msg=msg or f"Slow down - try again in {retry_after}s.")
    resp.status_code = 429
    resp.headers["Retry-After"] = str(retry_after)
    return resp


# path -> (limit, window seconds, per "ip" or "user")
RATE_RULES = {
    "/login": (30, 300, "ip"),
    "/register": (8, 600, "ip"),
    "/api/messages/send": (45, 60, "user"),
    "/api/blabber/post": (12, 60, "user"),
    "/api/reports": (10, 600, "user"),
    "/api/coop/chat": (40, 60, "user"),
    # endpoints that can spend LLM credits
    "/api/ai/command": (30, 60, "user"),
    "/api/bots/dial": (30, 60, "user"),
    "/api/game/convince_client": (30, 60, "user"),
    "/api/game/call_client": (30, 60, "user"),
    "/api/game/employees/talk": (30, 60, "user"),
    "/api/game/privacy/consult": (20, 60, "user"),
    "/api/game/investors/reply": (30, 60, "user"),
    "/api/game/interview_answer": (30, 60, "user"),
}


def init_hardening(app, hosted=False):
    @app.before_request
    def _rate_limit():
        if request.method != "POST":
            return None
        rule = RATE_RULES.get(request.path)
        if not rule:
            return None
        limit, window, scope = rule
        key = f"rl:{request.path}:" + (f"ip{client_ip()}" if scope == "ip" else rate_key("x"))
        allowed, retry = limiter.hit(key, limit, window)
        return None if allowed else too_many(retry)

    @app.after_request
    def _finish(resp):
        headers = resp.headers
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        headers.setdefault("Permissions-Policy", "camera=(), geolocation=(), payment=()")
        headers.setdefault("Content-Security-Policy", "frame-ancestors 'self'; base-uri 'self'; object-src 'none'")
        if hosted:
            headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")

        path = request.path
        if path.startswith("/static/"):
            if resp.status_code in (200, 304):
                if request.args.get("v"):
                    headers["Cache-Control"] = "public, max-age=31536000, immutable"
                else:
                    headers["Cache-Control"] = "public, max-age=300, must-revalidate"
        elif path.startswith("/api/") and "Cache-Control" not in headers:
            headers["Cache-Control"] = "no-store"
        elif resp.mimetype == "text/html":
            headers.setdefault("Cache-Control", "no-cache")
            headers.setdefault("Vary", "Cookie")

        if GZIP_ENABLED:
            _maybe_gzip(resp)
        return resp

    _gz_cache = {}

    def _maybe_gzip(resp):
        if (resp.status_code != 200 or "Content-Encoding" in resp.headers or request.method == "HEAD"
                or "gzip" not in (request.headers.get("Accept-Encoding") or "").lower()):
            return
        if not any((resp.mimetype or "").startswith(t) for t in _COMPRESSIBLE):
            return
        is_static = request.path.startswith("/static/")
        if resp.direct_passthrough:
            if not is_static:
                return
        elif resp.is_streamed:
            return
        cache_key = None
        if is_static:
            cache_key = (request.path, resp.headers.get("ETag"))
            hit = _gz_cache.get(cache_key) if cache_key[1] else None
            if hit is not None:
                body = hit
            else:
                resp.direct_passthrough = False
                raw = resp.get_data()
                if len(raw) < _GZIP_MIN_BYTES:
                    return
                body = gzip.compress(raw, compresslevel=6, mtime=0)
                if cache_key[1]:
                    if len(_gz_cache) > 300:
                        _gz_cache.clear()
                    _gz_cache[cache_key] = body
        else:
            raw = resp.get_data()
            if len(raw) < _GZIP_MIN_BYTES:
                return
            body = gzip.compress(raw, compresslevel=5, mtime=0)
        resp.direct_passthrough = False
        resp.set_data(body)
        resp.headers["Content-Encoding"] = "gzip"
        resp.headers["Content-Length"] = str(len(body))
        resp.headers.add("Vary", "Accept-Encoding")
        etag = resp.headers.get("ETag")
        if etag and not etag.startswith("W/"):
            resp.headers["ETag"] = "W/" + etag

    # ---- errors: always JSON for the game's API, never a stack-trace page ----
    def _wants_json():
        return request.path.startswith("/api/") or request.is_json or request.path in ("/login", "/register")

    @app.errorhandler(HTTPException)
    def _http_error(exc):
        if not _wants_json():
            return exc
        messages = {
            400: "That request wasn't understood.",
            401: "Please log in again.",
            403: "You're not allowed to do that.",
            404: "Not found.",
            405: "That action isn't supported here.",
            413: "That upload is too large.",
            429: "Slow down a little.",
        }
        resp = jsonify(success=False, error=exc.name.lower().replace(" ", "_"),
                       msg=messages.get(exc.code, exc.description or "Request failed."))
        resp.status_code = exc.code or 500
        return resp

    @app.errorhandler(Exception)
    def _server_error(exc):
        if isinstance(exc, HTTPException):
            return _http_error(exc)
        try:
            from models import db
            db.session.rollback()
        except Exception:
            pass
        log.exception("Unhandled error on %s %s", request.method, request.path)
        bad_input = isinstance(exc, (ValueError, TypeError, KeyError, OverflowError)) \
            and request.method in ("POST", "PUT", "PATCH", "DELETE")
        if not _wants_json():
            return ("Something went wrong on the server. Please go back and try again.", 500)
        if bad_input:
            resp = jsonify(success=False, error="bad_request", msg="That request had invalid data.")
            resp.status_code = 400
            return resp
        resp = jsonify(success=False, error="server_error",
                       msg="Something went wrong on the server. Please try again.")
        resp.status_code = 500
        return resp
