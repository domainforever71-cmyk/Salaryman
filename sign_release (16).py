"""sign_release.py - lock this project to YOUR version. Run on your own machine only.

    python sign_release.py init     makes your key pair (safe to re-run; reuses an existing key)
    python sign_release.py sign     after ANY code change: re-signs the release
    python sign_release.py verify   check this folder against its signature

The PRIVATE key is stored OUTSIDE the project (~/.astra_release/astra_private.key,
or wherever ASTRA_SIGNING_KEY points) so it can never end up in a zip, an exe,
a git repo or a deployment. Back it up somewhere safe: if you lose it you can
still run `init` again, but every old build will refuse the new release.
Never send that file to anyone (including an AI assistant).
"""
import base64
import json
import os
import stat
import sys

import integrity

KEY_PATH = os.environ.get("ASTRA_SIGNING_KEY") or os.path.join(
    os.path.expanduser("~"), ".astra_release", "astra_private.key")
BASE = integrity.BASE_DIR


def _crypto():
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    except ImportError:
        sys.exit("The 'cryptography' package isn't installed. Run:\n    python -m pip install cryptography")
    return serialization, Ed25519PrivateKey


def _write_pubkey(pub):
    with open(os.path.join(BASE, "astra_pubkey.py"), "w", encoding="utf-8", newline="\n") as f:
        f.write("# Written by `python sign_release.py init`. PUBLIC half of your release key - safe to ship.\n"
                f'PUBLIC_KEY = "{pub}"\n')


def init():
    serialization, Ed25519PrivateKey = _crypto()
    if os.path.exists(KEY_PATH):
        # Already set up (e.g. you copied a fresh update over the project, which
        # resets astra_pubkey.py). Keep your identity; just restore the public half.
        with open(KEY_PATH, "rb") as f:
            priv = serialization.load_pem_private_key(f.read(), password=None)
        pub = base64.b64encode(priv.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
        _write_pubkey(pub)
        print(f"Using your existing key ({KEY_PATH}).")
        return
    priv = Ed25519PrivateKey.generate()
    os.makedirs(os.path.dirname(KEY_PATH), exist_ok=True)
    with open(KEY_PATH, "wb") as f:
        f.write(priv.private_bytes(serialization.Encoding.PEM,
                                   serialization.PrivateFormat.PKCS8,
                                   serialization.NoEncryption()))
    try:
        os.chmod(KEY_PATH, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    pub = base64.b64encode(priv.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    _write_pubkey(pub)
    print(f"NEW private key saved to {KEY_PATH}  <-- keep it secret, back it up.")
    print("Public key written to astra_pubkey.py.")


def sign():
    serialization, _ = _crypto()
    if not integrity._public_key_b64():
        sys.exit("No public key yet - run:  python sign_release.py init")
    try:
        with open(KEY_PATH, "rb") as f:
            priv = serialization.load_pem_private_key(f.read(), password=None)
    except OSError:
        sys.exit(f"Private key not found at {KEY_PATH}. Sign from the machine that ran 'init'.")
    mine = base64.b64encode(priv.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    if mine != integrity._public_key_b64():
        sys.exit("This private key does not match astra_pubkey.py. Wrong key file?")

    manifest = {"version": 1, "files": integrity.collect_files(BASE)}
    blob = integrity.canonical(manifest)
    with open(os.path.join(BASE, integrity.MANIFEST_NAME), "wb") as f:
        f.write(json.dumps(manifest, sort_keys=True, indent=1).encode("utf-8"))
    with open(os.path.join(BASE, integrity.SIG_NAME), "wb") as f:
        f.write(base64.b64encode(priv.sign(blob)))
    print(f"Signed {len(manifest['files'])} files. Release id: {integrity.release_id(manifest)}")
    ok, problems, _ = integrity.verify(BASE)
    print("Self-check:", "OK" if ok else "FAILED " + "; ".join(problems))


def verify():
    ok, problems, rid = integrity.verify(BASE)
    if not integrity._public_key_b64():
        print("Unsigned dev mode (no public key).")
    elif ok:
        print(f"OK - exact signed release {rid}.")
    else:
        print("NOT the signed release:")
        for p in problems:
            print("  -", p)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    {"init": init, "sign": sign, "verify": verify}.get(cmd, lambda: sys.exit(__doc__))()
