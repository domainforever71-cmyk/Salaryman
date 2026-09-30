/* ===========================================================================
 * astra_fragment.js - Stage 11.
 *
 * astra_consolidate.js's Stage 10 already un-hid the phase5/6/7 top-level
 * nav buttons so discoverApps() could give each its own desktop window
 * again. This does the same job on the one place that consolidation never
 * touched: the base game's own "[SYS] MANAGEMENT OPERATIONS" side-drawer
 * inside the NEW GAME window (EMPLOYEES / CAREER / BUSINESS / PROFIT
 * REPORT / MANAGE FUNDS, plus the LIFE PROGRESSION marry box in the
 * drawer's footer). Those five tabs predate every phase file and were
 * never nav-<id>/view-<id> pairs to begin with, so discoverApps() could
 * never see them no matter what consolidate.js hid or un-hid.
 *
 * This is a pure DOM move, not a rewrite: every element that relocates
 * keeps its original id, so none of index.html's own hireEmployee(),
 * quitJob(), startOwnBusiness(), loadJobListings(), sendInterviewAnswer(),
 * giftSpouse(), marryPartnerDrawer(), or the game-state poller that fills
 * in employeeList/jobListingsBox/profitLogBars/etc. needs to change - they
 * all still just call document.getElementById() on ids that still exist,
 * now living in their own top-level window instead of a drawer tab.
 *
 * Loads after astra_phase8.js and before astra_winos.js, off the same
 * astrax:ready contract every other phase file uses. Has to run and finish
 * BEFORE astra_winos.js's own astrax:ready handler calls buildDesktop() -
 * script tags execute their addEventListener registrations in document
 * order, so as long as this file's <script> tag is above astra_winos.js's,
 * this listener fires first and the new nav-/view- pairs already exist
 * by the time discoverApps() runs.
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // tabId  - the drawer tab's existing container id (kept as-is)
  // appId  - becomes the new nav-<appId> / view-<appId>
  // title  - panel header inside the new standalone window
  // label  - nav button text
  var MOVES = [
    { tabId: 'd-tab-employee', appId: 'employees', title: 'EMPLOYEE ROSTER',       label: '[EMPLOYEES]' },
    { tabId: 'd-tab-career',   appId: 'career',     title: 'CAREER & INTERVIEWS',  label: '[CAREER]' },
    { tabId: 'd-tab-business', appId: 'business',   title: 'FOUND A BUSINESS',     label: '[BUSINESS]' },
    { tabId: 'd-tab-profit',   appId: 'profit',     title: 'PROFIT REPORT',        label: '[PROFIT REPORT]' },
    { tabId: 'd-tab-funds',    appId: 'funds',      title: 'JOINT ACCOUNT & LIFE', label: '[FUNDS]' }
  ];

  function addNavButton(id, label) {
    var nav = document.querySelector('.header-nav');
    if (!nav || $('nav-' + id)) return null;
    var btn = document.createElement('button');
    btn.className = 'terminal-btn';
    btn.id = 'nav-' + id;
    btn.textContent = label;
    btn.onclick = function () { window.switchView(id); };
    var settings = $('nav-settings');
    if (settings) nav.insertBefore(btn, settings); else nav.appendChild(btn);
    return btn;
  }

  function wrapInPanel(title, node) {
    var wrap = document.createElement('div');
    wrap.className = 'terminal-panel';
    var head = document.createElement('div');
    head.className = 'panel-header';
    head.innerHTML = '<div class="panel-heading-title">' + title + '</div>';
    wrap.appendChild(head);
    wrap.appendChild(node);
    return wrap;
  }

  /* =====================================================================
   * VPN app - new content (not a move). Front-end for the privacy/consult
   * routes in app.py, which wire the AI_CONSULTS buffs (declared in
   * game_data.py since Phase 8, never previously purchasable or consumed)
   * alive as a "ghost relay" service. Real mechanical effect - cuts your
   * audit-strike and random-event-loss odds while a relay is up - but the
   * same "fun deterrent, not real security/anonymity" framing this
   * codebase already uses for its devtools checks. This is a fictional
   * game mechanic; it doesn't anonymize or encrypt real network traffic.
   * ===================================================================== */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  async function api(url, opts) {
    var res = await fetch(url, opts);
    return res.json();
  }
  function post(url, body) {
    return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  }
  function sfx(n) { if (window.SFX) window.SFX.play(n); }

  function vpnPanelHtml() {
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">ASTRA GHOST-VPN</div>' +
        '<span id="vpnEncBadge" style="font-size:10.5px;color:var(--pixel-cyan);">ENCRYPTION: AES-256</span></div>' +
        '<div style="font-size:11px;color:#5c7a99;line-height:1.6;">' +
        'Routes your session through one of the four OMNI-BOTS as a paid relay. ' +
        'A live relay lowers your odds of drawing a compliance audit strike or eating a ' +
        'random-event loss for a few in-game days - it does not stop either outright, ' +
        'same as everything else in this terminal marked "deterrent, not real security."' +
        '</div>' +
      '</div>' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">ACTIVE RELAYS</div></div>' +
        '<div id="vpnActiveList" style="font-size:11.5px;">Checking connection...</div>' +
      '</div>' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">AVAILABLE RELAYS</div></div>' +
        '<div id="vpnCatalog" style="display:flex;flex-direction:column;gap:8px;"></div>' +
      '</div>';
  }

  function renderVpn(d) {
    var active = $('vpnActiveList');
    if (active) {
      var rows = Object.keys(d.active || {}).map(function (effect) {
        var left = Math.max(0, d.active[effect] - d.day);
        return '<div class="d-list-item"><span>' + esc(effect.replace(/_/g, ' ').toUpperCase()) + '</span>' +
          '<span style="color:var(--pixel-cyan);">' + left + ' day(s) left</span></div>';
      });
      active.innerHTML = rows.length ? rows.join('') :
        '<div style="color:#aaa;font-style:italic;">No relay connected. You are dialing in the clear.</div>';
    }
    var cat = $('vpnCatalog');
    if (cat) {
      cat.innerHTML = (d.catalog || []).map(function (c) {
        var blurb = (c.blurb || '').replace('{days}', c.duration_days);
        return '<div class="d-list-item" style="flex-direction:column;align-items:flex-start;gap:4px;">' +
          '<div style="display:flex;justify-content:space-between;width:100%;">' +
          '<b style="color:var(--pixel-cyan);">' + esc(c.bot.toUpperCase()) + '</b>' +
          '<button class="terminal-btn btn-action" data-bot="' + esc(c.bot) + '">CONNECT ($' + c.cost + ')</button></div>' +
          '<div style="font-size:10.5px;color:#5c7a99;">' + esc(blurb) + '</div></div>';
      }).join('');
      cat.querySelectorAll('[data-bot]').forEach(function (btn) {
        btn.onclick = async function () {
          try {
            var r = await post('/api/game/privacy/consult', { bot: btn.getAttribute('data-bot') });
            if (!r.success) { sfx('deny'); alert(r.msg || 'Connection failed.'); return; }
            sfx('cash');
            loadVpn();
          } catch (e) { sfx('deny'); }
        };
      });
    }
  }

  async function loadVpn() {
    try {
      var d = await api('/api/game/privacy/status');
      if (d.success) renderVpn(d);
    } catch (e) { /* offline - leave last-known state on screen */ }
  }

  function buildVpnApp() {
    if ($('view-vpn')) return;
    var host = $('view-dashboard');
    var wrapper = (host && host.parentNode) || $('mainAppWrapper');
    if (!host || !wrapper) return;
    var view = document.createElement('div');
    view.id = 'view-vpn';
    view.className = 'app-view';
    view.innerHTML = vpnPanelHtml();
    wrapper.insertBefore(view, host);
    addNavButton('vpn', '[VPN]');
    loadVpn();
    setInterval(loadVpn, 15000);
  }

  var done = false;

  function fragment() {
    if (done) return;
    var host = $('view-dashboard');
    var wrapper = (host && host.parentNode) || $('mainAppWrapper');
    if (!host || !wrapper) return;

    MOVES.forEach(function (m) {
      var tab = $(m.tabId);
      if (!tab || $('view-' + m.appId)) return;

      // Drop the drawer's own tab-switching classes - visibility is now
      // window-level (window.switchView), not drawer-tab-level.
      tab.classList.remove('d-tab-view', 'active-view');

      var view = document.createElement('div');
      view.id = 'view-' + m.appId;
      view.className = 'app-view';
      view.appendChild(wrapInPanel(m.title, tab));
      wrapper.insertBefore(view, host);

      addNavButton(m.appId, m.label);
    });

    // The LIFE PROGRESSION (marry) box lived in the drawer's footer, under
    // no d-tab at all. It's "money + relationship admin" same as the new
    // FUNDS app, so it folds in there instead of getting stranded or
    // becoming a sixth tiny window of its own.
    var marriage = $('marriageSection');
    var fundsView = $('view-funds');
    if (marriage && fundsView && marriage.parentNode !== fundsView) {
      fundsView.appendChild(marriage);
    }

    // Hide, don't remove, the now-empty drawer chrome - same rule every
    // other fragmentation pass in this codebase already follows, in case
    // anything still references #gameSideDrawer/#drawerContent directly.
    var drawer = $('gameSideDrawer');
    if (drawer) drawer.style.display = 'none';

    // BUG: this was defined above but never invoked, so the VPN app never
    // actually appeared - no nav-vpn button, no view-vpn window, ever.
    buildVpnApp();

    // index.html's marryPartnerDrawer() ends by opening the drawer's FUNDS
    // tab (toggleDrawer() + switchDrawerTab('funds')) so the player sees the
    // newly-unlocked tab right away. Both calls are now silent no-ops - the
    // drawer is display:none and its d-tab-view/active-view classes were
    // stripped off d-tab-funds above - so marrying used to leave the player
    // staring at the same screen with no visible confirmation that FUNDS
    // unlocked. Wrap the function once to open the real FUNDS window
    // instead, without touching index.html's own marriage logic.
    var origMarry = window.marryPartnerDrawer;
    if (typeof origMarry === 'function' && !origMarry._astraFragmentWrapped) {
      window.marryPartnerDrawer = function () {
        var r = origMarry.apply(this, arguments);
        if (window.switchView) window.switchView('funds');
        return r;
      };
      window.marryPartnerDrawer._astraFragmentWrapped = true;
    }

    done = true;

    // FUNDS only unlocks after marriage - index.html's own game-state
    // handler already flips #tabBtnFunds's display on every refresh (see
    // sysMarried in the base script). Mirror that same flag onto the new
    // nav button instead of duplicating the marriage-detection logic here,
    // and ask astra_winos.js to redraw its icons/Start-menu once it
    // changes, since discoverApps() only scans once at boot otherwise.
    var lastFundsVisible = null;
    function syncFundsVisibility() {
      var oldBtn = $('tabBtnFunds');
      var newBtn = $('nav-funds');
      if (!oldBtn || !newBtn) return;
      var visible = oldBtn.style.display !== 'none';
      newBtn.style.display = visible ? '' : 'none';
      if (visible !== lastFundsVisible) {
        lastFundsVisible = visible;
        if (window.winosRescanApps) window.winosRescanApps();
      }
    }
    syncFundsVisibility();
    setInterval(syncFundsVisibility, 4000);

    if (window.applyLanguage && window.currentLang) window.applyLanguage(window.currentLang);
    if (window.winosRescanApps) window.winosRescanApps();
  }

  function waitAndRun(triesLeft) {
    if ($('d-tab-career') || triesLeft <= 0) { fragment(); return; }
    setTimeout(function () { waitAndRun(triesLeft - 1); }, 150);
  }

  window.addEventListener('astrax:ready', function () { waitAndRun(40); });
  setTimeout(function () { waitAndRun(1); }, 8000); // last-resort fallback
})();
