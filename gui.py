import os
import sys
import threading

import integrity

_SELFTEST = '--selftest' in sys.argv      # used by Build_EXE.bat to test the freshly built exe
if not _SELFTEST:
    integrity.enforce()

_WEBVIEW_ERR = ''
try:
    import webview
except Exception as _e:
    if not _SELFTEST:
        raise
    webview = None
    _WEBVIEW_ERR = repr(_e)

try:
    from astra_server import SERVER_URL as BAKED_SERVER_URL
except Exception:
    BAKED_SERVER_URL = ''

config_dir = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, 'frozen', False) else __file__))
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(config_dir, '.env'))
except ImportError:
    pass

HOST_PORT = int(os.environ.get('ASTRA_HOST_PORT', '3000'))
user_dir = os.path.join(os.environ.get('APPDATA') or os.path.expanduser('~'), 'Astra')
os.makedirs(user_dir, exist_ok=True)


def _msgbox(text, title='Astra', flags=0x10):
    try:
        import ctypes
        return ctypes.windll.user32.MessageBoxW(0, text, title, flags)
    except Exception:
        sys.stderr.write(text + '\n')
        return 0


def _is_private_host(url):
    import ipaddress
    from urllib.parse import urlparse
    host = (urlparse(url).hostname or '').lower()
    if host in ('localhost',) or host.endswith('.local'):
        return True
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback
    except ValueError:
        return False


def _normalise_url(url):
    url = (url or '').strip().rstrip('/')
    if url and '://' not in url:
        url = ('http://' if _is_private_host('http://' + url) else 'https://') + url
    if url.lower().startswith('http://') and not _is_private_host(url):
        raise RuntimeError('Internet servers must use HTTPS (http:// is only allowed on your own network).')
    if not url.lower().startswith(('http://', 'https://')):
        raise RuntimeError('Server address must start with https://')
    return url


def _lan_ip():
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        return s.getsockname()[0]
    except Exception:
        return '127.0.0.1'
    finally:
        s.close()


def _pick_fastest_server(raw):
    import time
    import urllib.request
    best_url, best_ms = None, None
    for chunk in (raw or '').split(','):
        parts = [p.strip() for p in chunk.split('|')]
        if len(parts) != 3 or not parts[2].lower().startswith('https://'):
            continue
        url = parts[2].rstrip('/')
        samples = []
        for _ in range(3):
            try:
                t0 = time.perf_counter()
                urllib.request.urlopen(_ping_request(url), timeout=3).read()
                samples.append((time.perf_counter() - t0) * 1000)
            except Exception:
                break
        if len(samples) > 1:
            ms = sorted(samples[1:])[len(samples[1:]) // 2]
            if best_ms is None or ms < best_ms:
                best_url, best_ms = url, ms
    return best_url


def _ping_request(url):
    import urllib.request
    # Cloudflare / Render's edge can answer 403 to the default "Python-urllib" agent.
    return urllib.request.Request(url + '/api/ping', headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AstraClient/1.0',
        'Accept': 'application/json,*/*'})


def _reachable(url, timeout=25, detail=None):
    import urllib.request
    try:
        urllib.request.urlopen(_ping_request(url), timeout=timeout).read()
        return True
    except Exception as e:
        if detail is not None:
            detail.append(repr(e))
        return False


def decide_mode():
    """MMO client: always joins the one official server. No menu for players.
    Dev-only overrides: --host, --solo, --join <url>, or ASTRA_SERVER_URL / ASTRA_SERVERS."""
    argv = sys.argv[1:]
    if '--host' in argv:
        return 'host', None
    if '--solo' in argv:
        return 'solo', None
    if '--join' in argv and argv.index('--join') + 1 < len(argv):
        return 'join', _normalise_url(argv[argv.index('--join') + 1])

    if os.environ.get('ASTRA_SERVERS', '').strip():
        best = _pick_fastest_server(os.environ['ASTRA_SERVERS'])
        if best:
            return 'join', best
    if os.environ.get('ASTRA_SERVER_URL', '').strip():
        return 'join', _normalise_url(os.environ['ASTRA_SERVER_URL'])
    if BAKED_SERVER_URL.strip():
        return 'join', _normalise_url(BAKED_SERVER_URL)

    # No server address anywhere (no flag, no .env, nothing baked in): run the game locally, as before.
    return 'solo', None


def run_selftest():
    """`astra.exe --selftest` : checks signature, webview and server, writes astra_selftest.txt, exits.
    Exit codes: 0 = all good, 3 = signature/integrity failed, 5 = webview missing, 4 = server unreachable."""
    lines, code = [], 0
    ok, problems, rid = integrity.verify()
    signed = bool(integrity._public_key_b64())
    lines.append(f"frozen exe        : {bool(getattr(sys, 'frozen', False))}")
    lines.append(f"signed release    : {signed}")
    lines.append(f"integrity         : {'OK' if ok else 'FAILED'}  (release {rid})")
    for p in problems[:15]:
        lines.append(f"   - {p}")
    if not ok:
        code = 3
    lines.append(f"webview (GUI)     : {'OK' if webview else 'FAILED ' + _WEBVIEW_ERR}")
    if not webview and code == 0:
        code = 5
    try:
        mode, url = decide_mode()
    except Exception as e:
        mode, url = 'error', None
        lines.append(f"server setting    : INVALID ({e})")
        code = code or 4
    lines.append(f"mode              : {mode}   server: {url or '-'}")
    if mode == 'join':
        detail = []
        reach = _reachable(url, timeout=60, detail=detail)
        lines.append(f"server reachable  : {'YES' if reach else 'NO ' + ' '.join(detail)}")
        if not reach and code == 0:
            code = 4
    lines.append(f"RESULT            : {'PASS' if code == 0 else 'PROBLEM (exit code %d)' % code}")
    try:
        with open(os.path.join(config_dir, 'astra_selftest.txt'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines) + '\n')
    except Exception:
        pass
    sys.stdout.write('\n'.join(lines) + '\n') if sys.stdout else None
    return code


if __name__ == '__main__':
    if _SELFTEST:
        sys.exit(run_selftest())
    mode, remote_url = decide_mode()
    server = None

    if mode == 'join':
        while not _reachable(remote_url):
            # 0x05 = Retry/Cancel, 4 = Retry. Free hosts (Render) sleep when idle, so retrying usually works.
            if _msgbox('Could not connect to the Astra servers.\n\nCheck your internet connection.\n'
                       '(If the server was idle it can take up to a minute to wake up.)',
                       'Astra', 0x05 | 0x10) != 4:
                sys.exit(1)
        window_url = remote_url + '/intro'
    else:
        from werkzeug.serving import make_server
        from app import app

        if getattr(sys, 'frozen', False):
            base_dir = getattr(sys, '_MEIPASS', config_dir)
            app.template_folder = os.path.join(base_dir, 'templates')
            app.static_folder = os.path.join(base_dir, 'static')

        if mode == 'host':
            try:
                server = make_server('0.0.0.0', HOST_PORT, app, threaded=True)
            except OSError:
                _msgbox(f'Port {HOST_PORT} is already in use (is Astra already running?).')
                sys.exit(1)
            _msgbox(f'You are hosting Astra.\n\nFriends on your network join with:\n'
                    f'    http://{_lan_ip()}:{HOST_PORT}\n\n'
                    f'(Windows may ask to allow the firewall - choose Allow.)\n'
                    f'Over the internet, use a tunnel (cloudflared / ngrok) or deploy the '
                    f'server - see MULTIPLAYER.md.\n\nKeep this window open while they play.',
                    'Astra - hosting', 0x40)
            window_url = f'http://127.0.0.1:{HOST_PORT}/intro'
        else:
            server = make_server('127.0.0.1', 0, app, threaded=True)
            window_url = f'http://127.0.0.1:{server.server_port}/intro'
        threading.Thread(target=server.serve_forever, daemon=True).start()

    profile_dir = os.path.join(user_dir, 'webview')
    os.makedirs(profile_dir, exist_ok=True)
    try:
        webview.create_window(
            title="Astra" + (" - HOST" if mode == 'host' else ""),
            url=window_url,
            width=1280,
            height=800,
            resizable=True
        )
        webview.start(private_mode=False, storage_path=profile_dir)
    finally:
        if server:
            server.shutdown()
            server.server_close()
