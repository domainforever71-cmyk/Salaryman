"""build_obfuscate.py - make a copy of the project whose browser-facing code is minified and hard to read.

    python build_obfuscate.py <readable_source_dir> <output_dir>

* static/*.js, static/*.css, root *.js and every inline <script>/<style> in templates/*.html are
  minified (comments removed, whitespace removed, local variable names shortened).
* Python files are copied unchanged - they run on YOUR server (or inside astra.exe) and are never sent to browsers.
* Needs esbuild: `npm i -g esbuild` (or set ESBUILD=/path/to/esbuild).
* Keep your readable source somewhere private. Only ship the output folder.
* Afterwards run `python sign_release.py sign` inside the output folder (the signature covers the minified files).

Honest limit: anything a browser runs can be read by a determined person (it can be formatted again), but
names, comments and structure are gone, which stops casual reading and copy-pasting.
"""
import os
import re
import shutil
import subprocess
import sys

ESBUILD = os.environ.get("ESBUILD") or shutil.which("esbuild") or "esbuild"
SKIP = {"__pycache__", ".git", ".venv", "node_modules", "Salaryman-with-city", ".pytest_cache"}
SKIP_FILES = {"Salaryman-with-city.zip"}


def _run(code, loader):
    p = subprocess.run([ESBUILD, "--minify", f"--loader={loader}", "--legal-comments=none", "--charset=utf8"],
                       input=code.encode("utf-8"), capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode("utf-8", "replace")[:400])
    return p.stdout.decode("utf-8")


def _html(text):
    def js(m):
        attrs, body = m.group(1), m.group(2)
        if "{{" in body or "{%" in body or not body.strip() or "json" in attrs.lower():
            return m.group(0)
        return f"<script{attrs}>{_run(body, 'js').strip()}</script>"

    def css(m):
        body = m.group(2)
        if "{{" in body or "{%" in body or not body.strip():
            return m.group(0)
        return f"<style{m.group(1)}>{_run(body, 'css').strip()}</style>"
    text = re.sub(r"<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>", js, text, flags=re.S)
    return re.sub(r"<style([^>]*)>(.*?)</style>", css, text, flags=re.S)


def main(src, out):
    if os.path.exists(out):
        shutil.rmtree(out)
    done = 0
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in SKIP]
        rel = os.path.relpath(root, src)
        os.makedirs(os.path.join(out, rel), exist_ok=True)
        for name in files:
            if name in SKIP_FILES:
                continue
            s, d = os.path.join(root, name), os.path.join(out, rel, name)
            ext = os.path.splitext(name)[1].lower()
            if ext == ".js" and name != "worker.js" and "functions" not in rel.split(os.sep):
                open(d, "w", encoding="utf-8").write(_run(open(s, encoding="utf-8").read(), "js")); done += 1
            elif ext == ".css":
                open(d, "w", encoding="utf-8").write(_run(open(s, encoding="utf-8").read(), "css")); done += 1
            elif ext == ".html":
                open(d, "w", encoding="utf-8").write(_html(open(s, encoding="utf-8").read())); done += 1
            else:
                shutil.copy2(s, d)
    print(f"minified {done} files -> {out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
