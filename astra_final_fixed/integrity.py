"""integrity.py - only the release YOU signed will run.

How it works
------------
* `python sign_release.py sign` (run by you, on your machine) hashes every code
  file (.py .js .html .css images) into astra_manifest.json and signs that list
  with your PRIVATE key. The private key never ships with the project.
* Every copy of the app carries only your PUBLIC key (astra_pubkey.py). At
  startup, and again every minute while running, it re-hashes its own files and
  checks the signature. Edit a file, delete one, or drop a new one in and the
  app refuses to start (or, if already running, answers 503 to everything).

Honest limits (please read)
---------------------------
Nobody can stop a person from editing files on their own computer - this makes
a modified copy refuse to run, it does not make the files read-only. Someone
who rewrites *this file* and swaps in their own public key can defeat it in a
plain-Python copy, which is why you should hand out the built astra.exe (the
code is compiled into it) and keep anything that must be trustworthy (money,
accounts, admin) on YOUR server - which this project already does: players
only ever talk to the server's API, they never run its code.

With no public key configured the app runs in "unsigned dev mode" so nothing
breaks before you've done the one-time setup.
"""
import base64
import hashlib
import json
import os
import sys
import threading
import time

FROZEN = bool(getattr(sys, "frozen", False))
BASE_DIR = getattr(sys, "_MEIPASS", None) if FROZEN else os.path.dirname(os.path.abspath(__file__))
BASE_DIR = BASE_DIR or os.path.dirname(os.path.abspath(sys.executable))

MANIFEST_NAME = "astra_manifest.json"
SIG_NAME = "astra_manifest.sig"

# Files that are part of a release. Anything else (docs, databases, .env,
# build output, caches) is deliberately not covered.
CODE_EXTS = {".py", ".js", ".html", ".css", ".png", ".ico", ".svg"}
TEXT_EXTS = {".py", ".js", ".html", ".css", ".svg"}
SKIP_DIRS = {"__pycache__", ".git", ".venv", "venv", ".vscode", "build", "dist",
             "node_modules", ".pytest_cache", ".idea"}
# In the built exe only the data folders exist on disk; the .py files are
# compiled into the executable itself.
FROZEN_DIRS = ("templates/", "static/")

RECHECK_SECONDS = 60


def _public_key_b64():
    try:
        import astra_pubkey
        return (astra_pubkey.PUBLIC_KEY or "").strip()
    except Exception:
        return ""


def _hash_file(path):
    with open(path, "rb") as f:
        data = f.read()
    if os.path.splitext(path)[1].lower() in TEXT_EXTS:
        # Windows/Unix line endings must not count as an edit.
        data = data.replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def collect_files(base=None):
    """{relative/posix/path: sha256} for every release file under base."""
    base = base or BASE_DIR
    out = {}
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            if os.path.splitext(name)[1].lower() not in CODE_EXTS:
                continue
            full = os.path.join(root, name)
            rel = os.path.relpath(full, base).replace(os.sep, "/")
            out[rel] = _hash_file(full)
    return out


def canonical(manifest):
    return json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")


def release_id(manifest):
    return hashlib.sha256(canonical(manifest)).hexdigest()[:12]


def verify(base=None):
    """Returns (ok, problems, release_id). Never raises."""
    base = base or BASE_DIR
    key_b64 = _public_key_b64()
    if not key_b64:
        return True, [], None            # unsigned dev mode

    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    except Exception:
        return False, ["the 'cryptography' package is missing (pip install cryptography)"], None

    try:
        with open(os.path.join(base, MANIFEST_NAME), "rb") as f:
            manifest_bytes = f.read()
        with open(os.path.join(base, SIG_NAME), "rb") as f:
            sig = base64.b64decode(f.read().strip())
        manifest = json.loads(manifest_bytes)
    except Exception:
        return False, ["signed manifest is missing or unreadable"], None

    try:
        Ed25519PublicKey.from_public_bytes(base64.b64decode(key_b64)).verify(sig, canonical(manifest))
    except Exception:   # InvalidSignature, bad key bytes, anything else
        return False, ["manifest signature is not valid for this release"], None

    expected = manifest.get("files", {})
    actual = collect_files(base)
    problems = []

    for rel, digest in expected.items():
        if FROZEN and not rel.startswith(FROZEN_DIRS):
            continue                      # compiled into the exe; nothing on disk to compare
        if rel not in actual:
            problems.append(f"missing: {rel}")
        elif actual[rel] != digest:
            problems.append(f"modified: {rel}")
    for rel in actual:
        if rel not in expected:
            if FROZEN and not rel.startswith(FROZEN_DIRS):
                continue
            problems.append(f"unexpected file: {rel}")

    return (not problems), problems, release_id(manifest)


# --------------------------------------------------------------------------
# startup gate
# --------------------------------------------------------------------------

def _show_fatal(text):
    sys.stderr.write(text + "\n")
    if FROZEN and os.name == "nt":          # windowed exe has no console
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, text, "Astra", 0x10)
        except Exception:
            pass


def enforce():
    """Call first thing. Exits the process if this copy isn't the signed release."""
    ok, problems, _ = verify()
    if ok:
        if not _public_key_b64():
            sys.stderr.write("[integrity] unsigned dev mode - run 'python sign_release.py init' then 'sign' "
                             "to lock this release.\n")
        return
    shown = "\n".join(" - " + p for p in problems[:8])
    more = f"\n (+{len(problems) - 8} more)" if len(problems) > 8 else ""
    _show_fatal("This copy of Astra has been modified and will not run.\n\n" + shown + more +
                "\n\nInstall the official version.")
    sys.exit(3)


# --------------------------------------------------------------------------
# while running: keep checking, and lock the server if files change
# --------------------------------------------------------------------------

_state = {"ok": True, "problems": [], "release": None, "signed": False, "checked": 0.0}


def status():
    return dict(_state)


def init_app(app):
    from flask import jsonify, request

    signed = bool(_public_key_b64())
    ok, problems, rid = verify()
    _state.update(ok=ok, problems=problems, release=rid, signed=signed, checked=time.time())

    def loop():
        while True:
            time.sleep(RECHECK_SECONDS)
            try:
                o, p, r = verify()
                _state.update(ok=o, problems=p, release=r, checked=time.time())
                if not o:
                    sys.stderr.write("[integrity] FILES CHANGED - locking server: " + "; ".join(p[:5]) + "\n")
            except Exception:
                pass

    if signed:
        threading.Thread(target=loop, daemon=True, name="astra-integrity").start()

    @app.before_request
    def _lock_if_tampered():
        if _state["ok"] or request.path in ("/api/integrity", "/api/ping"):
            return None
        return jsonify(success=False, msg="This server's files were modified and it has been locked. "
                                          "Restore the official release."), 503

    @app.route("/api/integrity")
    def _integrity():
        # Public and harmless: tells you whether this server is running the signed release.
        return jsonify(signed=_state["signed"], ok=_state["ok"], release=_state["release"])
