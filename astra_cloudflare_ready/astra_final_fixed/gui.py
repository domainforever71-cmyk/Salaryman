import os
import sys
import threading

import integrity
integrity.enforce()   # modified copies refuse to start

import webview

config_dir = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, 'frozen', False) else __file__))
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(config_dir, '.env'))
except ImportError:
    pass

remote_url = os.environ.get('ASTRA_SERVER_URL', '').strip().rstrip('/')


def _pick_fastest_server(raw):
    """ASTRA_SERVERS=id|Name|https://url,...  ->  the URL with the lowest ping.

    All servers share one database, so any of them is correct; this just
    chooses the closest one. Falls back to ASTRA_SERVER_URL if none answer.
    """
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
                urllib.request.urlopen(url + '/api/ping', timeout=3).read()
                samples.append((time.perf_counter() - t0) * 1000)
            except Exception:
                break
        if len(samples) > 1:
            ms = sorted(samples[1:])[len(samples[1:]) // 2]
            if best_ms is None or ms < best_ms:
                best_url, best_ms = url, ms
    return best_url


if os.environ.get('ASTRA_SERVERS', '').strip():
    remote_url = _pick_fastest_server(os.environ['ASTRA_SERVERS']) or remote_url
if remote_url and not remote_url.lower().startswith('https://'):
    raise RuntimeError('ASTRA_SERVER_URL must use HTTPS.')


if __name__ == '__main__':
    server = None
    if remote_url:
        window_url = remote_url + '/intro'
    else:
        from werkzeug.serving import make_server
        from app import app

        if getattr(sys, 'frozen', False):
            base_dir = getattr(sys, '_MEIPASS', config_dir)
            app.template_folder = os.path.join(base_dir, 'templates')
            app.static_folder = os.path.join(base_dir, 'static')

        server = make_server('127.0.0.1', 0, app, threaded=True)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        window_url = f"http://127.0.0.1:{server.server_port}/intro"

    profile_dir = os.path.join(
        os.environ.get('APPDATA') or os.path.expanduser('~'),
        'Astra',
        'webview',
    )
    os.makedirs(profile_dir, exist_ok=True)
    try:
        webview.create_window(
            title="Astra",
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