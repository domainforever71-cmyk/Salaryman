/* ===========================================================================
 * astra_stage12_taskbar.js - Stage 12.
 *
 * The WinOS desktop (astra_winos.js) has, up to now, been a shell wrapping
 * "the game" - every app including the trading-desk one (view-game) sat
 * behind its own icon/window like any other program. This is the first
 * piece of making the desktop itself BE the game rather than a launcher for
 * it: your current job - unemployed, working an NPC firm, working for
 * another real operator's company, or running your own - is shown directly
 * in the taskbar tray, always visible, the way a real OS shows the clock.
 * You don't open an app to check whether you have a job; the OS just
 * knows.
 *
 * Reuses /api/game/state exactly as pollGameState() (index.html) already
 * polls it - no new backend, no new fields. Read-only: this never writes
 * game state, only reflects it. Loads after astra_winos.js (needs
 * #winosTray, built by buildDesktop()) and waits on the same astrax:ready
 * contract as every other phase file.
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var pillEl = null;
  var lastLabel = null;

  function labelFor(d) {
    if (!d || !d.active) return { text: 'START A CAREER', cls: 'ws-job-none' };
    switch (d.job_status) {
      case 'business_owner':
        return { text: 'FOUNDER \u00B7 ' + (d.company_name || 'your company'), cls: 'ws-job-owner' };
      case 'employed_player':
        return { text: (d.job_title || 'Employed') + ' (PLAYER CO.)', cls: 'ws-job-player' };
      case 'employed':
        return { text: d.job_title || 'Employed', cls: 'ws-job-npc' };
      default:
        return { text: 'UNEMPLOYED \u00B7 open CAREER', cls: 'ws-job-none' };
    }
  }

  function targetView(d) {
    if (!d || !d.active) return 'game';
    return d.job_status === 'unemployed' || !d.job_status ? 'career' : 'game';
  }

  function ensurePill() {
    var tray = $('winosTray');
    if (!tray) return null;
    if (pillEl && pillEl.isConnected) return pillEl;
    pillEl = document.createElement('button');
    pillEl.type = 'button';
    pillEl.id = 'wsJobStatus';
    pillEl.className = 'ws-job-status';
    tray.insertBefore(pillEl, tray.firstChild);
    return pillEl;
  }

  function render(d) {
    var el = ensurePill();
    if (!el) return; // desktop not built yet - try again next poll
    var meta = labelFor(d);
    var text = esc(meta.text);
    if (text !== lastLabel) {
      lastLabel = text;
      el.textContent = meta.text;
      el.className = 'ws-job-status ' + meta.cls;
    }
    el.onclick = function () {
      if (window.switchView) window.switchView(targetView(d));
    };
  }

  function poll() {
    fetch('/api/game/state').then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) render(d); })
      .catch(function () { /* offline - leave last-known pill on screen */ });
  }

  function waitAndBoot(triesLeft) {
    if ($('winosTray')) { poll(); setInterval(poll, 10000); return; }
    if (triesLeft <= 0) return; // no WinOS desktop this session - nothing to attach to
    setTimeout(function () { waitAndBoot(triesLeft - 1); }, 200);
  }

  window.addEventListener('astrax:ready', function () { waitAndBoot(60); });
  setTimeout(function () { waitAndBoot(1); }, 9000); // last-resort fallback
})();
