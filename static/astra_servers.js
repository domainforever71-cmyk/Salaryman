/* astra_servers.js - pick the server with the best ping.
 *
 * Every server shares one database, so accounts, friends and messages are the
 * same everywhere; you just talk to the nearest copy of the app. This draws a
 * small "SERVER - 42 ms" badge. Click it to see every server's ping and hop to
 * a faster one (you stay logged in - the server hands your session across).
 */
(function () {
  'use strict';

  var servers = [], current = null, pings = {}, panelOpen = false, suggested = false;

  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  function pingColor(ms) {
    if (ms == null) return '#888';
    return ms < 80 ? '#3f6' : ms < 160 ? '#fd3' : '#f55';
  }

  async function pingOnce(base) {
    var t0 = performance.now();
    var res = await fetch(base + '/api/ping?_=' + Math.random().toString(36).slice(2),
                          { cache: 'no-store', mode: 'cors', credentials: 'omit' });
    await res.json();
    return performance.now() - t0;
  }

  // First sample pays for DNS/TLS, so it's thrown away; the median of the rest is the ping.
  async function measure(base, samples) {
    var out = [];
    for (var i = 0; i < samples; i++) {
      try { out.push(await pingOnce(base)); } catch (e) { /* unreachable */ }
    }
    if (out.length > 1) out.shift();
    if (!out.length) return null;
    out.sort(function (a, b) { return a - b; });
    return Math.round(out[Math.floor(out.length / 2)]);
  }

  /* ---------- UI ---------- */
  var pill, panel, bar;

  function build() {
    pill = el('div', 'position:fixed;top:6px;right:10px;z-index:99998;cursor:pointer;padding:3px 9px;' +
      'font:11px/1.4 monospace;letter-spacing:1px;background:#05121a;border:1px solid #1d3a4a;color:#9cc;' +
      'user-select:none;');
    pill.title = 'Server & ping';
    pill.onclick = function () { panelOpen = !panelOpen; render(); if (panelOpen) refreshAll(); };
    document.body.appendChild(pill);

    panel = el('div', 'position:fixed;top:30px;right:10px;z-index:99998;min-width:250px;display:none;' +
      'background:#05121a;border:1px solid #1d3a4a;color:#cde;font:12px monospace;padding:8px;' +
      'box-shadow:0 4px 18px rgba(0,0,0,.6);');
    document.body.appendChild(panel);
  }

  function render() {
    if (!pill) return;
    var mine = servers.find(function (s) { return s.id === current; }) || { name: 'Server' };
    var ms = pings[current];
    pill.innerHTML = '';
    var dot = el('span', 'color:' + pingColor(ms), '\u25CF ');
    pill.appendChild(dot);
    pill.appendChild(document.createTextNode(mine.name.toUpperCase() + ' \u00B7 ' + (ms == null ? '\u2026' : ms + ' ms')));

    panel.style.display = panelOpen ? 'block' : 'none';
    if (!panelOpen) return;
    panel.innerHTML = '';
    panel.appendChild(el('div', 'color:#6ab;letter-spacing:1px;margin-bottom:6px;', 'SERVERS'));

    var best = bestServer();
    servers.forEach(function (s) {
      var row = el('div', 'display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px solid #12293a;');
      row.appendChild(el('span', 'flex:1;', s.name + (s.id === best ? '  \u2605' : '')));
      var p = pings[s.id];
      row.appendChild(el('span', 'color:' + pingColor(p) + ';min-width:54px;text-align:right;',
        p === undefined ? '\u2026' : p === null ? 'offline' : p + ' ms'));
      if (s.id === current) {
        row.appendChild(el('span', 'color:#3f6;min-width:52px;text-align:center;', 'HERE'));
      } else {
        var b = el('button', 'min-width:52px;background:#0b2533;border:1px solid #1d5a6a;color:#0fc;' +
          'cursor:pointer;font:11px monospace;padding:2px 6px;', 'JOIN');
        b.disabled = p === null;
        b.onclick = function () { join(s); };
        row.appendChild(b);
      }
      panel.appendChild(row);
    });
    panel.appendChild(el('div', 'color:#567;font-size:10px;margin-top:6px;',
      '\u2605 = lowest ping. Everyone shares the same accounts and chats, whichever server they pick.'));
  }

  function bestServer() {
    var best = null, bestMs = Infinity;
    servers.forEach(function (s) {
      var p = pings[s.id];
      if (typeof p === 'number' && p < bestMs) { bestMs = p; best = s.id; }
    });
    return best;
  }

  async function join(s) {
    try { localStorage.setItem('astra_server_pref', s.id); } catch (e) {}
    try {
      var r = await fetch('/api/servers/handoff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ server: s.id })
      });
      if (r.ok) { var d = await r.json(); if (d.success) { location.href = d.url; return; } }
    } catch (e) {}
    location.href = s.url + '/login';     // not signed in here (login page) - just go
  }

  /* ---------- measuring ---------- */
  async function refreshAll() {
    await Promise.all(servers.map(async function (s) {
      var base = s.id === current ? '' : s.url;
      pings[s.id] = await measure(base, s.id === current ? 3 : 4);
    }));
    render();
    maybeSuggest();
  }

  // Once per browser session: if another server is clearly faster, say so.
  function maybeSuggest() {
    if (suggested || servers.length < 2) return;
    var best = bestServer(), here = pings[current];
    if (!best || best === current || here == null) return;
    if (here - pings[best] < 25 || pings[best] > here * 0.7) return;
    suggested = true;
    try { if (sessionStorage.getItem('astra_ping_hint')) return; sessionStorage.setItem('astra_ping_hint', '1'); } catch (e) {}
    var s = servers.find(function (x) { return x.id === best; });
    bar = el('div', 'position:fixed;top:30px;right:10px;z-index:99997;max-width:260px;cursor:pointer;padding:8px 10px;' +
      'background:#221a05;border:1px solid #fd3;color:#fd3;font:12px monospace;',
      '\u26A1 ' + s.name + ' is ' + (here - pings[best]) + ' ms faster for you. Click to switch.');
    bar.onclick = function () { bar.remove(); join(s); };
    document.body.appendChild(bar);
    setTimeout(function () { if (bar && bar.parentNode) bar.remove(); }, 15000);
  }

  async function quickPing() {
    if (document.hidden) return;
    var ms = await measure('', 2);
    pings[current] = ms;
    render();
  }

  async function start() {
    try {
      var r = await fetch('/api/servers', { cache: 'no-store' });
      var d = await r.json();
      servers = d.servers || []; current = d.current;
    } catch (e) { return; }
    if (!servers.length) return;
    build();
    render();
    refreshAll();
    setInterval(quickPing, 10000);
    document.addEventListener('click', function (e) {
      if (panelOpen && pill && !pill.contains(e.target) && !panel.contains(e.target)) { panelOpen = false; render(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
