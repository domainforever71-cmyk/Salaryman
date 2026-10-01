/* ===========================================================================
 * astra_stage27_law.js - Stage 27. Frontend for law.py.
 *
 *  LAW (view-law)  [LAW] tab next to CIVICS: the law code, your record, lawyers and court.
 *                  The pages live at /law (served by law.py) and are shown inside the game.
 *                  Summons and settlement offers raise a toast and a badge on the tab.
 *
 * Same boot contract as every other stage: wait for astrax:ready, build the view,
 * add a nav button, call winosRescanApps().
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function api(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .catch(function () { return { success: false }; });
  }
  function sfx(n) { try { if (window.SFX && window.SFX.play) window.SFX.play(n); } catch (e) { } }
  function active() { var v = $('view-law'); return v && v.classList.contains('active-view'); }

  function addNavButton() {
    var nav = document.querySelector('.header-nav');
    if (!nav || $('nav-law')) return;
    var b = document.createElement('button');
    b.className = 'terminal-btn'; b.id = 'nav-law';
    b.innerHTML = '[LAW]<span id="lawBadge" style="display:none;background:#ff5b6b;color:#fff;border-radius:9px;padding:0 6px;font-size:10px;margin-left:3px;"></span>';
    b.onclick = function () { window.switchView('law'); loadFrame(); };
    var s = $('nav-settings');
    if (s) nav.insertBefore(b, s); else nav.appendChild(b);
  }

  function addView() {
    if ($('view-law')) return;
    var host = $('view-dashboard'), wrap = (host && host.parentNode) || $('mainAppWrapper');
    if (!host || !wrap) return;
    var v = document.createElement('div');
    v.id = 'view-law'; v.className = 'app-view';
    v.innerHTML = '<div class="terminal-panel"><div class="panel-header"><div class="panel-heading-title">LAW &amp; COURTS ' +
      '<span style="color:#8a97ad;font-size:10.5px;">read the code, check your record, hire counsel, sue</span></div></div>' +
      '<iframe id="lawFrame" title="Astra law" style="width:100%;height:100%;min-height:520px;border:0;background:#0b0f14;"></iframe></div>';
    wrap.insertBefore(v, host);
  }

  function loadFrame() {
    var f = $('lawFrame');
    if (f && !f.getAttribute('src')) f.setAttribute('src', '/law');
  }

  function toast(text) {
    var host = $('axLiveToasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'axLiveToasts';
      host.style.cssText = 'position:fixed;right:14px;bottom:56px;z-index:99999;display:flex;flex-direction:column;gap:6px;pointer-events:none;';
      document.body.appendChild(host);
    }
    var t = document.createElement('div');
    t.textContent = text;
    t.style.cssText = 'pointer-events:auto;cursor:pointer;max-width:280px;padding:9px 12px;font-size:12px;background:#1a0a0d;' +
      'color:#ffd24a;border:1px solid #ffd24a;box-shadow:0 0 10px rgba(255,210,74,.25);font-family:inherit;';
    t.onclick = function () { t.remove(); window.switchView('law'); loadFrame(); };
    host.appendChild(t);
    sfx('confirm');
    setTimeout(function () { if (t.parentNode) t.remove(); }, 9000);
  }

  var lastTotal = 0;
  function poll() {
    api('/api/law/inbox').then(function (r) {
      if (!r || !r.success) return;
      var b = $('lawBadge');
      if (b) { b.textContent = r.total; b.style.display = r.total ? 'inline' : 'none'; }
      if (r.total > lastTotal) {
        toast(r.summons > 0 ? 'You have been SUED. Open LAW > COURT and answer before the deadline.' :
          'A settlement offer is waiting in LAW > COURT.');
      }
      lastTotal = r.total;
    });
  }

  var done = false;
  function build() {
    if (done || !document.querySelector('.header-nav') || !$('view-dashboard')) return;
    done = true;
    addView();
    addNavButton();
    if (window.winosRescanApps) window.winosRescanApps();
    // The window system has no law glyph; use the section sign for its app and taskbar icons.
    var tries = 0, fix = setInterval(function () {
      document.querySelectorAll('.ws-icon[data-app="law"] .ws-icon-glyph, #wstask-law, [data-app="law"] .ws-title-icon').forEach(function (n) {
        if (n.id === 'wstask-law') { if (n.textContent !== '\u00A7') n.textContent = '\u00A7'; } else n.textContent = '\u00A7';
      });
      if (++tries > 40) clearInterval(fix);
    }, 750);
    setInterval(function () { poll(); }, 15000);
    poll();
  }
  function waitAndRun(n) {
    if (($('view-dashboard') && document.querySelector('.header-nav')) || n <= 0) { build(); return; }
    setTimeout(function () { waitAndRun(n - 1); }, 150);
  }
  window.addEventListener('astrax:ready', function () { waitAndRun(45); });
  setTimeout(function () { waitAndRun(1); }, 10400);
})();
