/* ===========================================================================
 * astra_stage14_appstore.js - Stage 14.
 *
 * Up to now every app that existed at all was visible on the desktop the
 * moment its own phase file finished building it. This adds an install
 * gate: a brand-new operator's desktop only ever shows the handful of apps
 * that make sense pre-installed on any PC (SETTINGS, PROFILE, MINING CALC,
 * TASK MANAGER, MESSAGES, BANK), plus NEW GAME/BROWSER/FILES, which nothing
 * else works without. Every other app - MYNT, OMNICHAT, MARKETS, CAREER,
 * BUSINESS, POSTIFY, all of it - starts locked, and only becomes a real
 * desktop icon once the operator finds and installs it through the browser
 * (astra_stage15_browser.js is the storefront; this file only owns the
 * install/lock bookkeeping so the browser, and anything else later, can
 * share one source of truth instead of each keeping its own list).
 *
 * Locking is done with a CSS class (.ws-app-locked, display:none !important
 * in astra_winos.css), not style.display - astra_fragment.js's own
 * syncFundsVisibility already toggles #nav-funds's style.display for its own
 * unrelated reason (married or not), and two independent scripts racing to
 * set the same inline property on the same element would flicker depending
 * on poll order. A class-based gate always wins over that regardless of
 * timing (discoverApps() in astra_winos.js checks for this class too).
 *
 * Account-backed desktop state stores installs, recent/open apps, downloads,
 * and the basic notepad text. localStorage remains a fast cache and a source
 * for migrating installs and notes that were saved by older builds.
 *
 * Loads after astra_winos.js (needs nav-<id> buttons to exist, which is
 * everything else's job) - order doesn't matter much beyond that, since
 * this only classifies buttons and calls winosRescanApps(), it doesn't
 * build any UI of its own.
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // Ships pre-installed. Nothing here is a value judgement about which apps
  // matter - it's literally just "what a normal PC comes with out of the
  // box" (system settings, an ID/profile panel, a calculator, a task
  // manager, mail, and your bank) plus the three pieces of OS chrome
  // (character creation, the browser, and the file manager) nothing else
  // can bootstrap without.
  // appstore/workdesk/admin/adminplus build their own nav buttons and gate themselves
  // (job status / is_admin); leaving them out of this list made applyLocks() hide them forever.
  var SYSTEM_APPS = ['game', 'browser', 'files', 'settings', 'profile', 'calc', 'tasks', 'messages', 'bank',
    'terminal', 'reader', 'news', 'appstore', 'workdesk', 'admin', 'adminplus', 'maps'];

  // The full catalog the App Store can offer. Kept as a static list (rather
  // than derived by scanning the DOM for nav-<id> buttons) because most of
  // these are built asynchronously by their own phase file off the same
  // astrax:ready event this file also waits on, so the DOM isn't guaranteed
  // to have all of them yet by the time a player opens the store. Each
  // entry's own view still has to actually exist for it to ever appear on
  // the desktop (discoverApps() checks that independently) - this list can
  // safely include apps that, in a given build, were never wired up; they
  // just won't do anything if "installed".
  // Stage 17 (astra_stage17_appstore2.js) needs two more fields per entry to
  // run a real store UI instead of a flat list: `category` (for browsing by
  // section) and `sizeMB` (a fictional download size that decides how long
  // the download animation takes - bigger app, longer bar, exactly like a
  // real store). Both are additive - nothing before Stage 17 reads either
  // field, so this stays backward compatible with astra_stage15_browser.js's
  // existing inline list, which still only uses id/name/blurb.
  var CATALOG = [
    { id: 'dashboard', name: 'MYNT', blurb: 'Net worth and portfolio, at a glance.', category: 'finance', sizeMB: 42 },
    { id: 'markets', name: 'MARKETS & SEARCH', blurb: 'Live stock/crypto feed and your trading desk.', category: 'finance', sizeMB: 118 },
    { id: 'bots', name: 'OMNICHAT', blurb: 'Talk to an AI about anything on your terminal.', category: 'utility', sizeMB: 340 },
    { id: 'casino', name: 'LUCKYSPIN', blurb: 'Games of chance. The house always wins eventually.', category: 'entertainment', sizeMB: 76 },
    { id: 'employees', name: 'STAFFR', blurb: 'Manage your business\u2019s employee roster.', category: 'office', sizeMB: 54 },
    { id: 'career', name: 'CAREER', blurb: 'Job board - apply to NPC firms or real player companies.', category: 'office', sizeMB: 61 },
    { id: 'business', name: 'BUSINESS', blurb: 'Found your own company and hire real players.', category: 'office', sizeMB: 88 },
    { id: 'profit', name: 'PROFIT REPORT', blurb: 'Your business\u2019s daily / weekly / monthly earnings.', category: 'finance', sizeMB: 22 },
    { id: 'funds', name: 'JOINT ACCOUNT', blurb: 'Shared finances, once you\u2019re married.', category: 'finance', sizeMB: 18 },
    { id: 'clients', name: 'CLIENT DIRECTORY', blurb: 'Cold-call 50+ bot clients and pitch them shares.', category: 'office', sizeMB: 65 },
    { id: 'notes', name: 'NOTEPAD', blurb: 'A blank notepad. Nothing fancy.', category: 'utility', sizeMB: 4 },
    { id: 'investors', name: 'INVESTOR INBOX', blurb: 'Messages from people who want to invest with you.', category: 'office', sizeMB: 33 },
    { id: 'exchange', name: 'SWAPMART', blurb: 'Trade cash and shares directly with other players.', category: 'finance', sizeMB: 95 },
    { id: 'studio', name: 'POSTIFY', blurb: 'Write, produce and release tracks for royalties.', category: 'entertainment', sizeMB: 210 },
    { id: 'coop', name: 'SYNDICATE', blurb: 'Team up with other operators in a shared room.', category: 'social', sizeMB: 58 },
    { id: 'credits', name: 'CREDITS', blurb: 'Your reputation score around the terminal.', category: 'social', sizeMB: 12 },
    { id: 'network', name: 'LINKEDUP', blurb: 'Professional networking with other operators.', category: 'social', sizeMB: 71 },
    { id: 'politics', name: 'POLICY WATCH', blurb: 'Policy news that moves the market.', category: 'utility', sizeMB: 29 },
    { id: 'vpn', name: 'GHOST-VPN', blurb: 'Route through a bot relay for a little cover.', category: 'security', sizeMB: 145 },
    { id: 'arbitrage', name: 'VEX SCANNER', blurb: 'An AI that watches exchange spreads for you.', category: 'finance', sizeMB: 190 },
    // Stage 17 additions - the two apps astra_stage17_appstore2.js actually
    // builds a view for. Same rule as every entry above: listed here, but
    // useless as an install target until something wires up view-<id>.
    { id: 'streamtube', name: 'STREAMTUBE', blurb: 'Endless video. Some of it is even useful.', category: 'entertainment', sizeMB: 512 },
    { id: 'blognet', name: 'BLOGNET', blurb: 'Longform takes, hot takes, and the occasional real lead.', category: 'social', sizeMB: 37 },
    // Stage 20 (astra_stage20_world.js)
    { id: 'stockdesk', name: 'STOCK DESK', blurb: 'Five stocks, four currencies, fees, dividends and inflation.', category: 'finance', sizeMB: 96 },
    { id: 'civics', name: 'CIVICS', blurb: 'Vote the regime. Or break the law and find out.', category: 'social', sizeMB: 41 },
    { id: 'blabber', name: 'BLABBER', blurb: 'Say it out loud, or anonymously. Everyone can report you.', category: 'social', sizeMB: 27 },
    { id: 'notespro', name: 'NOTEPAD PRO', blurb: 'Paid notes: search, tags, import/export, share codes.', category: 'utility', sizeMB: 19 },
    { id: 'law', name: 'LAW & COURTS', blurb: 'Read the law, hire counsel, manage appeals and take cases to court.', category: 'utility', sizeMB: 64 }
  ].filter(function (e) { return SYSTEM_APPS.indexOf(e.id) === -1; });

  // Stage 19 (astra_stage19_workshift.js) adds a `requires` field: null
  // (always purchasable) or 'employed' - gated on GameSave.job_status !==
  // "unemployed" (any job, player-employed, or running your own business
  // all count). Nothing before Stage 19 reads this field, same
  // backward-compatible pattern as `category`/`sizeMB` above.
  var REQUIRES = {
    stockdesk: 'employed', dashboard: 'employed', markets: 'employed', network: 'employed',
    exchange: 'employed', business: 'employed', arbitrage: 'employed',
    employees: 'employed', profit: 'employed', investors: 'employed',
    clients: 'employed', coop: 'employed'
  };
  CATALOG.forEach(function (e) { e.requires = REQUIRES[e.id] || null; });

  var scopeKey = null;
  function storageKey() {
    if (!scopeKey) {
      var el = $('setupPlayerName');
      scopeKey = 'astra_installed_apps:' + (el && el.value ? el.value : 'guest');
    }
    return scopeKey;
  }

  var installed = null;
  var desktopState = { installed_apps: [], recent_apps: [], open_apps: [], downloads: [] };
  function unique(items) { return items.filter(function (item, i) { return items.indexOf(item) === i; }); }
  function updateDesktopState(patch) {
    Object.keys(patch).forEach(function (key) { desktopState[key] = patch[key]; });
    return fetch('/api/desktop/state', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    }).then(function (r) { return r.json(); }).catch(function () { return null; });
  }
  var desktopStateReady = fetch('/api/desktop/state').then(function (r) {
    return r.ok ? r.json() : null;
  }).then(function (result) {
    var saved = result && result.success && result.state ? result.state : {};
    Object.keys(saved).forEach(function (key) { desktopState[key] = saved[key]; });
    var merged = unique((desktopState.installed_apps || []).concat(installed || loadInstalled()));
    var changed = merged.length !== (desktopState.installed_apps || []).length;
    installed = merged;
    desktopState.installed_apps = merged;
    if (changed) updateDesktopState({ installed_apps: merged });
    applyLocks();
    if (window.winosRescanApps) window.winosRescanApps();
    window.dispatchEvent(new CustomEvent('astra:desktop-state', { detail: desktopState }));
    return desktopState;
  }).catch(function () {
    installed = loadInstalled();
    desktopState.installed_apps = installed;
    return desktopState;
  });

  window.AstraDesktopState = {
    ready: desktopStateReady,
    get: function () { return desktopState; },
    update: updateDesktopState
  };

  function loadInstalled() {
    try {
      var raw = localStorage.getItem(storageKey());
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) { /* ignore - fall through to defaults */ }
    return [];
  }
  function ensureLoaded() { if (!installed) installed = loadInstalled(); return installed; }
  function persist() {
    try { localStorage.setItem(storageKey(), JSON.stringify(installed)); } catch (e) { /* ignore */ }
    return updateDesktopState({ installed_apps: installed.slice() });
  }

  function isInstalled(id) {
    return SYSTEM_APPS.indexOf(id) !== -1 || ensureLoaded().indexOf(id) !== -1;
  }

  function install(id) {
    ensureLoaded();
    if (installed.indexOf(id) === -1) installed.push(id);
    var saved = persist();
    applyLocks();
    if (window.winosRescanApps) window.winosRescanApps();
    return saved;
  }

  function applyLocks() {
    var nav = document.querySelector('.header-nav');
    if (!nav) return false;
    var buttons = nav.querySelectorAll('.terminal-btn[id^="nav-"]');
    var changed = false;
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var id = btn.id.replace('nav-', '');
      var shouldLock = !isInstalled(id);
      if (btn.classList.contains('ws-app-locked') !== shouldLock) changed = true;
      btn.classList.toggle('ws-app-locked', shouldLock);
    }
    return changed;
  }

  // Public surface for astra_stage15_browser.js (the App Store UI) and
  // astra_stage16_files.js (which needs to know what's actually reachable).
  window.AstraAppStore = {
    catalog: function () { return CATALOG.slice(); },
    isInstalled: isInstalled,
    install: install,
    systemApps: function () { return SYSTEM_APPS.slice(); }
  };

  // Other phase files build their nav-<id> buttons asynchronously, each on
  // its own astrax:ready-triggered retry loop, so there's no single moment
  // "every button now exists" to wait for. Rather than guess at one,
  // reapply locks aggressively for the first ~9s (matching every other
  // stage file's own settle window) and rescan whenever a lock actually
  // changed, so a not-yet-installed app's button never has more than one
  // poll's worth of window to flash visible as a desktop icon before this
  // catches it. Settles into a slow background poll after that, both to
  // catch anything later than 9s and to self-heal if something else's
  // style.display churn ever momentarily disagreed with the class.
  function tick(triesLeft) {
    if (applyLocks() && window.winosRescanApps) window.winosRescanApps();
    if (triesLeft > 0) setTimeout(function () { tick(triesLeft - 1); }, 200);
  }

  window.addEventListener('astrax:ready', function () { tick(45); });
  setInterval(function () { if (applyLocks() && window.winosRescanApps) window.winosRescanApps(); }, 4000);
})();
