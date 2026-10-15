"""build_prepare.py - run by Build_EXE.bat BEFORE signing.

Bakes the official server address (your Cloudflare Worker URL) into astra_server.py so the
built astra.exe always joins your online world and does NOT depend on a loose .env file
sitting next to it.

Where the address comes from (first one found wins):
    1. the first command-line argument            python build_prepare.py https://x.workers.dev
    2. the ASTRA_BUILD_SERVER_URL environment variable
    3. ASTRA_SERVER_URL in .env
    4. ASTRA_SERVER_URL in .env.example
    5. you are asked (leave empty to build an offline, solo-only exe)
"""
import os
import sys
from urllib.parse import urlparse

BASE = os.path.dirname(os.path.abspath(__file__))


def read_env_value(path, key):
    try:
        with open(path, encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() == key:
                    return v.strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


def clean(url):
    url = (url or "").strip().strip('"').strip("'").rstrip("/")
    if not url:
        return ""
    if "://" not in url:
        url = "https://" + url
    p = urlparse(url)
    if p.scheme not in ("https", "http") or not p.hostname:
        sys.exit(f"ERROR: '{url}' is not a valid server address (must look like https://name.account.workers.dev)")
    if p.scheme == "http" and p.hostname not in ("localhost", "127.0.0.1") and not p.hostname.startswith(("192.168.", "10.")):
        sys.exit("ERROR: internet servers must use https:// (http:// is only allowed on your own network).")
    if p.path not in ("", "/"):
        sys.exit(f"ERROR: use only the site address, without a path: {p.scheme}://{p.netloc}")
    return f"{p.scheme}://{p.netloc}"


def main():
    url, src = "", ""
    if len(sys.argv) > 1 and sys.argv[1].strip():
        url, src = sys.argv[1], "command line"
    elif os.environ.get("ASTRA_BUILD_SERVER_URL", "").strip():
        url, src = os.environ["ASTRA_BUILD_SERVER_URL"], "ASTRA_BUILD_SERVER_URL"
    else:
        for name in (".env", ".env.example"):
            v = read_env_value(os.path.join(BASE, name), "ASTRA_SERVER_URL")
            if v:
                url, src = v, name
                break
    if not url:
        try:
            url = input("Server address for the exe (e.g. https://astra.yourname.workers.dev), "
                        "empty = offline/solo exe: ").strip()
            src = "typed in"
        except EOFError:
            url = ""
    url = clean(url)

    with open(os.path.join(BASE, "astra_server.py"), "w", encoding="utf-8", newline="\n") as f:
        f.write("# The ONE official Astra server every player's astra.exe connects to (this is what makes it an MMO).\n"
                "# Written by build_prepare.py (run by Build_EXE.bat) from ASTRA_SERVER_URL in .env.\n"
                "# Empty = the exe runs the game locally (solo).\n"
                f'SERVER_URL = "{url}"\n')
    if url:
        print(f"Baked server address into the exe: {url}   (from {src})")
    else:
        print("WARNING: no server address - this exe will run SOLO/offline, not join your online world.")


if __name__ == "__main__":
    main()
