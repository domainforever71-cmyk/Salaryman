/* ===========================================================================
 * astra_stage8.js - Visual pass, no new game logic.
 *
 * Three purely-cosmetic upgrades, each wrapping something that already
 * works rather than replacing it:
 *
 *   1. INCOMING CALL SCREEN. callClientBot() and requestBossReview() used to
 *      just dump text straight into a box. Real phones - and the old office
 *      comms terminal this game is styled after - make you accept the call
 *      first. This adds one reusable amber CRT "incoming call" overlay
 *      (its own scoped color set, kept OFF the main cyan palette on
 *      purpose) with a portrait, a name, and an ACCEPT/DECLINE pair. Accept
 *      runs the exact same code that used to run immediately; decline just
 *      closes the overlay. Nothing about what call_client, convince_client
 *      or boss_review actually do on the server changes.
 *
 *   2. STAFF OFFICE, visually. The roster and candidate lists were a single
 *      stacked column of identical cards. This lays them out as a grid of
 *      desks (CSS only - renderRoster()/renderCandidates() in phase6.js are
 *      untouched) with a small "monitor" accent per card, closer to an
 *      actual open-plan office floor.
 *
 *   3. GRID MORALE READOUT. The morale bar (.p6-bar) was one continuous
 *      fill. Restyled as a segmented strip - purely a background-image
 *      change on the same element phase6.js already renders, same morale
 *      number driving the same width.
 *
 * Loads last, after astra_stage7.js.
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* =====================================================================
   * 1. INCOMING CALL OVERLAY
   * ===================================================================== */

  function injectCallStyles() {
    var css = document.createElement('style');
    css.textContent = [
      /* Scoped amber set - deliberately not the terminal's cyan vars, so it */
      /* reads as a different subsystem (the phone line) on the same rig.   */
      '.astra-call-overlay{position:fixed;inset:0;z-index:99999;display:flex;',
      'align-items:center;justify-content:center;background:rgba(0,0,0,.86);}',
      '.astra-call-screen{width:min(360px,86vw);background:#1a1206;',
      'border:3px solid #4a3a12;border-radius:4px;padding:18px 16px;text-align:center;',
      'box-shadow:0 0 0 1px #000,0 0 40px rgba(255,187,0,.15);position:relative;overflow:hidden;',
      'font-family:var(--font-current,monospace);}',
      '.astra-call-screen::before{content:"";position:absolute;inset:0;pointer-events:none;',
      'background:repeating-linear-gradient(0deg,rgba(0,0,0,.25) 0px,rgba(0,0,0,.25) 1px,transparent 1px,transparent 3px);}',
      '.astra-call-hud{display:flex;justify-content:space-between;font-size:9px;',
      'letter-spacing:1px;color:#c99a2e;margin-bottom:14px;}',
      '.astra-call-portrait{width:96px;height:96px;margin:0 auto 12px;border-radius:50%;',
      'border:2px solid #c99a2e;background:#241a08;display:flex;align-items:center;',
      'justify-content:center;overflow:hidden;color:#c99a2e;}',
      '.astra-call-portrait img{width:100%;height:100%;object-fit:cover;filter:sepia(1) saturate(2) hue-rotate(-10deg) brightness(.9);}',
      '.astra-call-name{color:#ffcc33;font-size:17px;letter-spacing:1px;margin-bottom:2px;',
      'text-shadow:0 0 6px rgba(255,204,51,.35);}',
      '.astra-call-sub{color:#9c7a2e;font-size:10.5px;letter-spacing:1.5px;margin-bottom:16px;}',
      '.astra-call-actions{display:flex;gap:10px;justify-content:center;}',
      '.astra-call-btn{border:1px solid #c99a2e;background:#241a08;color:#ffcc33;',
      'font-family:inherit;font-size:11px;letter-spacing:1px;padding:9px 16px;cursor:pointer;}',
      '.astra-call-btn:hover{background:#3a2a0c;}',
      '.astra-call-btn.decline{border-color:#7a4a3a;color:#c98a6a;}',
      '.astra-call-btn.decline:hover{background:#2a180e;}',
      '@keyframes astraCallRing{0%,100%{box-shadow:0 0 0 1px #000,0 0 40px rgba(255,187,0,.15);}',
      '50%{box-shadow:0 0 0 1px #000,0 0 56px rgba(255,187,0,.32);}}',
      '.astra-call-screen{animation:astraCallRing 1.4s ease-in-out infinite;}',

      /* --- staff office desk grid (section 2) --- */
      '#p6Roster,#p6Candidates{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;}',
      '#p6Roster .p6-card,#p6Candidates .p6-card{margin-bottom:0;position:relative;padding-top:16px;}',
      '#p6Roster .p6-card::before,#p6Candidates .p6-card::before{content:"";position:absolute;',
      'top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--pixel-cyan),transparent 70%);opacity:.55;}',
      '#p6Roster .p6-card::after,#p6Candidates .p6-card::after{content:"\\25A3";position:absolute;',
      'top:4px;right:8px;font-size:10px;color:var(--pixel-green);opacity:.7;}',
      '@media (max-width:600px){#p6Roster,#p6Candidates{grid-template-columns:1fr;}}',

      /* --- segmented grid-style morale bar (section 3) --- */
      '.p6-bar{background-image:repeating-linear-gradient(90deg,#111 0,#111 calc(10% - 2px),',
      '#000 calc(10% - 2px),#000 10%);background-color:transparent;}',
      '.p6-bar>i{background-image:repeating-linear-gradient(90deg,rgba(0,0,0,.55) 0,rgba(0,0,0,.55) 2px,transparent 2px,transparent 10%);}',
    ].join('');
    document.head.appendChild(css);
  }

  var GENERIC_PORTRAIT_SVG =
    '<svg viewBox="0 0 64 64" width="60%" height="60%" fill="none" stroke="#c99a2e" stroke-width="2.5">' +
    '<circle cx="32" cy="24" r="12"/>' +
    '<path d="M10 56c2-14 12-20 22-20s20 6 22 20" />' +
    '</svg>';

  var callState = { active: false };

  /* opts: { name, subtitle, avatarUrl, onAccept, onDecline } */
  function showIncomingCall(opts) {
    closeIncomingCall();
    var overlay = document.createElement('div');
    overlay.className = 'astra-call-overlay';
    overlay.id = 'astraCallOverlay';
    var portraitInner = opts.avatarUrl
      ? '<img src="' + esc(opts.avatarUrl) + '" alt="">'
      : GENERIC_PORTRAIT_SVG;
    overlay.innerHTML =
      '<div class="astra-call-screen">' +
        '<div class="astra-call-hud"><span>CHANNEL: SECURE</span><span>SIGNAL \u2588\u2588\u2588\u2591</span></div>' +
        '<div class="astra-call-portrait">' + portraitInner + '</div>' +
        '<div class="astra-call-name">' + esc(opts.name || 'UNKNOWN CALLER') + '</div>' +
        '<div class="astra-call-sub">' + esc(opts.subtitle || 'incoming call') + '</div>' +
        '<div class="astra-call-actions">' +
          '<button class="astra-call-btn accept">\u260E ACCEPT</button>' +
          '<button class="astra-call-btn decline">DECLINE</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    callState.active = true;
    if (window.SFX && window.SFX.play) { try { window.SFX.play('ring') || window.SFX.play('notify'); } catch (e) {} }

    overlay.querySelector('.accept').onclick = function () {
      closeIncomingCall();
      if (typeof opts.onAccept === 'function') opts.onAccept();
    };
    overlay.querySelector('.decline').onclick = function () {
      closeIncomingCall();
      if (typeof opts.onDecline === 'function') opts.onDecline();
    };
  }

  function closeIncomingCall() {
    var el = $('astraCallOverlay');
    if (el) el.remove();
    callState.active = false;
  }

  window.AstraCall = { show: showIncomingCall, close: closeIncomingCall };

  function wireCallScreens() {
    // callClientBot(botId) already fetches the client and populates the
    // transcript - the only change is to fetch first, then gate revealing
    // the transcript behind Accept, instead of revealing it immediately.
    var origCallClient = window.callClientBot;
    if (typeof origCallClient === 'function') {
      window.callClientBot = async function (botId) {
        window.activeCallClient = null;
        var client = null;
        var declineMsg = null;
        try {
          var res = await fetch('/api/game/call_client', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bot_id: botId })
          });
          var data = await res.json();
          if (data.success) client = data.client;
          else if (data.declined) declineMsg = data.msg;
        } catch (e) { /* fall through to mock in the reveal step below */ }

        if (declineMsg) {
          // No overlay for a declined call - nothing is "incoming" to
          // accept. Render the same decline state the base handler would,
          // without re-rolling the decline chance via a second fetch.
          var statusElD = $('activeCallStatus');
          var boxElD = $('callTranscriptBox');
          if (statusElD) statusElD.innerHTML = 'Status: Call declined';
          if (boxElD) boxElD.innerHTML = '<div style="color:var(--pixel-red);">' + esc(declineMsg) + '</div>';
          return;
        }

        var reveal = function () {
          window.activeCallClient = client || (window.mockGameState &&
            window.mockGameState.clients.find(function (c) { return c.id === botId; }));
          var ac = window.activeCallClient;
          if (!ac) return;
          var statusEl = $('activeCallStatus');
          var boxEl = $('callTranscriptBox');
          if (statusEl) statusEl.innerHTML =
            '<img src="' + esc(ac.avatar_url) + '" width="18" height="18" alt="" ' +
            'style="vertical-align:middle;border-radius:3px;margin-right:4px;">Active Call: ' + esc(ac.name);
          if (boxEl) boxEl.innerHTML =
            '<div style="display:flex;gap:6px;align-items:flex-start;margin-top:4px;">' +
            '<img src="' + esc(ac.avatar_url) + '" width="20" height="20" alt="" ' +
            'style="border-radius:3px;border:1px solid var(--border-color);flex-shrink:0;margin-top:1px;">' +
            '<div><strong>[' + esc(ac.name) + ']:</strong> "' + esc(ac.greeting) + '"</div></div>';
        };

        if (client) {
          showIncomingCall({
            name: client.name, subtitle: 'incoming client call',
            avatarUrl: client.avatar_url, onAccept: reveal
          });
        } else {
          reveal(); // offline fallback - keep the original no-call-screen behavior
        }
      };
    }

    var origBossReview = window.requestBossReview;
    if (typeof origBossReview === 'function') {
      window.requestBossReview = function () {
        showIncomingCall({
          name: 'GENERAL COMMANDER', subtitle: 'your boss is calling',
          onAccept: origBossReview
        });
      };
    }
  }

  /* =====================================================================
   * Boot - wait for the same functions astra_stage7 waits on, since these
   * wrap globals that extras/phase5/phase6/stage7 all touch in some order.
   * ===================================================================== */

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    injectCallStyles();
    wireCallScreens();
  }

  function ready() {
    return typeof window.callClientBot === 'function' &&
           typeof window.requestBossReview === 'function';
  }

  function waitAndBoot(triesLeft) {
    if (ready()) { boot(); return; }
    if (triesLeft <= 0) { boot(); return; }
    setTimeout(function () { waitAndBoot(triesLeft - 1); }, 150);
  }

  window.addEventListener('astrax:ready', function () { waitAndBoot(40); });
  setTimeout(function () { waitAndBoot(1); }, 8500);
})();
