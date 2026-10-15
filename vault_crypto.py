"""Lightweight, dependency-free encryption for the operator credential vault.

Nothing in requirements.txt provides real crypto (no `cryptography` /
`pycryptodome`), so this is built from Python's stdlib only:

  1. PBKDF2-HMAC-SHA256 turns the operator's short PIN plus a per-user random
     salt into a 256-bit key. 200,000 iterations is deliberately expensive to
     brute-force per guess.
  2. A separate, salted hash of that key (pin_verification_hash) is what gets
     stored to check the PIN - it reveals nothing useful about the actual
     encryption key even if the database leaks.
  3. Encryption is HMAC-SHA256 used as a keystream generator in counter mode
     (the same idea as AES-CTR, just built from a hash instead of a block
     cipher), then authenticated with a second HMAC (encrypt-then-MAC) so a
     tampered ciphertext is rejected instead of silently decrypting to junk.

Honest framing, same as the rest of this project: this is solid
encryption-at-rest for a user's own saved secrets on this server. It is not
an audited cipher, and a 4-8 digit PIN has a small keyspace - that's why
app.py rate-limits and locks out repeated bad attempts (_vault_authenticate)
instead of relying on the PIN's length alone.
"""

import base64
import hashlib
import hmac
import os
import re

_PIN_RE = re.compile(r"^\d{4,8}$")
_PBKDF2_ITERATIONS = 200_000
_NONCE_LEN = 12
_MAC_LEN = 32


def valid_pin_format(pin):
    return bool(_PIN_RE.match(pin or ""))


def new_salt():
    return base64.b64encode(os.urandom(16)).decode()


def _derive_key(pin, salt_b64):
    salt = base64.b64decode(salt_b64)
    return hashlib.pbkdf2_hmac("sha256", (pin or "").encode(), salt, _PBKDF2_ITERATIONS)


def pin_verification_hash(pin, salt_b64):
    """A hash distinct from the encryption key itself, so verifying a PIN
    never exposes anything about the key used to encrypt vault entries."""
    key = _derive_key(pin, salt_b64)
    return hashlib.sha256(key + b"astra-vault-verify").hexdigest()


def check_pin(pin, salt_b64, expected_hash):
    if not pin or not salt_b64 or not expected_hash:
        return False
    try:
        return hmac.compare_digest(pin_verification_hash(pin, salt_b64), expected_hash)
    except Exception:
        return False


def _keystream(key, nonce, length):
    out = bytearray()
    counter = 0
    while len(out) < length:
        block = hmac.new(key, nonce + counter.to_bytes(4, "big"), hashlib.sha256).digest()
        out.extend(block)
        counter += 1
    return bytes(out[:length])


def encrypt(pin, salt_b64, plaintext):
    key = _derive_key(pin, salt_b64)
    nonce = os.urandom(_NONCE_LEN)
    data = plaintext.encode()
    stream = _keystream(key, nonce, len(data))
    ciphertext = bytes(a ^ b for a, b in zip(data, stream))
    mac = hmac.new(key, nonce + ciphertext, hashlib.sha256).digest()
    return base64.b64encode(nonce + mac + ciphertext).decode()


def decrypt(pin, salt_b64, blob_b64):
    """Returns the plaintext string, or None if the PIN is wrong or the
    payload was tampered with / corrupted."""
    try:
        payload = base64.b64decode(blob_b64)
        nonce = payload[:_NONCE_LEN]
        mac = payload[_NONCE_LEN:_NONCE_LEN + _MAC_LEN]
        ciphertext = payload[_NONCE_LEN + _MAC_LEN:]
        key = _derive_key(pin, salt_b64)
        expected_mac = hmac.new(key, nonce + ciphertext, hashlib.sha256).digest()
        if not hmac.compare_digest(mac, expected_mac):
            return None
        stream = _keystream(key, nonce, len(ciphertext))
        data = bytes(a ^ b for a, b in zip(ciphertext, stream))
        return data.decode()
    except Exception:
        return None