/* ===========================================================================
 * astra_winos.js - Phase 9 surface: real Vista-style window manager.
 *
 * Loads last (after astra_phase8.js) and waits for `astrax:ready`, same
 * contract as every other phase file: does not touch executeTrade,
 * advanceGameDay, or sendOmniConsole, and never removes any element other
 * phase files depend on - only hides/reparents via CSS/JS and adds new UI.
 *
 * What this actually changes: every existing .app-view (dashboard, broker
 * simulator, markets, omni-bots, settings, plus anything phase8 adds later
 * like politics/network) gets reparented, once, into its own draggable,
 * resizable, minimize/close/reopen-able window instead of being one of a
 * set of views that exclusively swap in and out. window.switchView(name) -
 * which every other phase file already calls to navigate - keeps working
 * under the hood; it's just re-pointed to open/focus a real window instead
 * of flatly toggling a single active view. Phase 8's flat "XP taskbar"
 * reskin (#p8Taskbar / #p8StartMenu) is superseded and hidden.
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function sfx(n) { if (window.SFX) window.SFX.play(n); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var ICONS = {
    dashboard: '\u25A6', game: '\u25B6', markets: '\u2382', bots: '\u25C8',
    settings: '\u2699', politics: '\u2696', network: '\u25C9', credits: '\u25C7',
    profile: '\u25A4', messages: '\u2709', coop: '\u2317', exchange: '\u21C4',
    casino: '\u2660', calc: '\u25A3', studio: '\u266B', staff: '\u25A5',
    tasks: '\u2611', investors: '\u26A0', bank: '\u25B3',
    terminal: '\u2328', sysinfo: '\u24D8',
    // Stage 11 (astra_fragment.js): the five ex-drawer tabs and the new
    // VPN app. Without entries here these all fell back to the generic
    // '\u25A2' box glyph - functional, but indistinguishable from each
    // other and from any future unrecognized app.
    employees: '\u2261', career: '\u270E', business: '\u2302',
    profit: '\u2197', funds: '\u25C6', vpn: '\u26BF',
    // Stage 13 (astra_stage13_split.js) and Stage 14 (browser/app store/
    // files, astra_stage14_appstore.js / astra_stage15_browser.js /
    // astra_stage16_files.js).
    clients: '\u260E', notes: '\u270D', browser: '\u25C9', files: '\u2637',
    // Stage 17 (astra_stage17_appstore2.js): the dedicated store app and the
    // two apps it actually lets you install.
    appstore: '\u25A7', streamtube: '\u25B7', blognet: '\u2637',
    workdesk: '\u23F1', admin: '\u2606',
    stockdesk: '$', civics: '\u2696', blabber: '\u263A', notespro: '\u2712', adminplus: '\u2605',
    // Stage 25 (astra_stage25_desk.js / _mail.js / _privacy.js): the real
    // brokerage desk (dashboard/MYNT reworked in place), mail and privacy.
    mail: '\u2709', privacy: '\u26E8'
  };
  function iconFor(id) { return ICONS[id] || '\u25A2'; }

  // ---- per-app "native identity" -------------------------------------------
  // Every app gets a category (drives a shared accent colour + chrome
  // treatment) and a handful of flagship apps get a deeper, distinct skin on
  // top of that (see the ws-app-* rules in astra_winos.css). Nothing here
  // changes what an app DOES - it only decides the colour/label glyph on the
  // window frame, taskbar pill, desktop icon and Start-menu tile that already
  // exist, via a CSS variable (--app-accent) and a couple of class names.
  var APP_META = {
    dashboard: { cat: 'finance' }, game: { cat: 'finance' }, markets: { cat: 'finance' },
    arbitrage: { cat: 'finance' }, bank: { cat: 'finance' },
    exchange: { cat: 'office' }, staff: { cat: 'office' }, tasks: { cat: 'office' },
    investors: { cat: 'office' }, credits: { cat: 'office' },
    messages: { cat: 'social' }, coop: { cat: 'social' }, profile: { cat: 'social' },
    casino: { cat: 'fun' }, studio: { cat: 'creative' }, calc: { cat: 'utility' },
    bots: { cat: 'system', flag: 'terminal' }, terminal: { cat: 'system', flag: 'terminal' },
    files: { cat: 'system', flag: 'files' }, sysinfo: { cat: 'system', flag: 'files' },
    settings: { cat: 'system', flag: 'settings' },
    politics: { cat: 'info' }, network: { cat: 'info' },
    // Stage 11 (astra_fragment.js) apps - same gap as ICONS above: these
    // fell back to metaFor()'s default { cat: 'finance' }, which happened
    // to look right for business/profit/funds by accident but was wrong
    // for employees/career (office, like staff/tasks) and vpn (system,
    // like bots/terminal).
    employees: { cat: 'office' }, career: { cat: 'office' },
    business: { cat: 'finance' }, profit: { cat: 'finance' },
    funds: { cat: 'finance' }, vpn: { cat: 'system' },
    clients: { cat: 'office' }, notes: { cat: 'utility' },
    browser: { cat: 'system' },
    appstore: { cat: 'system', flag: 'files' }, streamtube: { cat: 'fun' }, blognet: { cat: 'info' },
    workdesk: { cat: 'office' }, admin: { cat: 'system' },
    stockdesk: { cat: 'finance' }, civics: { cat: 'info' }, blabber: { cat: 'social' }, notespro: { cat: 'utility' }, adminplus: { cat: 'system' },
    mail: { cat: 'social' }, privacy: { cat: 'system', flag: 'settings' }
  };
  var CAT_ACCENT = {
    finance: '#00ffcc', office: '#ffbb00', social: '#4aa3ff',
    fun: '#39d353', creative: '#c77dff', utility: '#cfd8e3',
    system: '#8fd6ff', info: '#9aa7c7'
  };
  function metaFor(id) { return APP_META[id] || { cat: 'finance' }; }
  function accentFor(id) { var m = metaFor(id); return CAT_ACCENT[m.cat] || '#00ffcc'; }
  function catFor(id) { return metaFor(id).cat; }
  function flagshipClass(id) {
    var m = metaFor(id);
    return m.flag ? 'ws-app-' + m.flag : (APP_META[id] ? 'ws-app-' + id : '');
  }
  // Applies the identity vars/classes to any element representing app `id`
  // (a desktop icon, taskbar pill, Start-menu tile or the window frame
  // itself) without touching its existing classes or children.
  function tagIdentity(el, id) {
    if (!el) return;
    el.style.setProperty('--app-accent', accentFor(id));
    el.classList.add('ws-cat-' + catFor(id));
    var flag = flagshipClass(id);
    if (flag) el.classList.add(flag);
  }

  // The "game" app is the odd one out: everything else on this desktop
  // (dashboard, markets, bots, casino, staff...) IS the broker simulator,
  // so a peer icon literally named "BROKER SIMULATOR" doesn't make sense.
  // view-game is really the new-career form until a save exists, then the
  // trading desk - so it's labeled as that launcher instead, and updated
  // once we actually know whether there's a career to resume.
  var gameLabel = 'NEW GAME';
  function refreshGameLabel() {
    fetch('/api/game/state').then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        gameLabel = (d && d.active && d.day) ? 'CONTINUE CAREER' : 'NEW GAME';
        applyGameLabel();
      }).catch(function () { /* keep default */ });
  }
  function applyGameLabel() {
    var iconLbl = document.querySelector('.ws-icon[data-app="game"] .ws-icon-label');
    if (iconLbl) iconLbl.textContent = gameLabel;
    var menuLbl = document.querySelector('.ws-menu-item[data-app="game"] .ws-menu-item-label');
    if (menuLbl) menuLbl.textContent = gameLabel;
    var tb = $('wstask-game');
    if (tb) tb.title = gameLabel;
    var winTitle = document.querySelector('#wswin-game .ws-title-text');
    if (winTitle) winTitle.textContent = gameLabel;
  }


  var win = {};      // appId -> { el, opened, min, max, z, _prev }
  var zTop = 1000;
  var LAYER, TASKITEMS, STARTMENU;

  function labelFor(id) {
    if (id === 'game') return gameLabel;
    var btn = $('nav-' + id);
    if (btn) return btn.textContent.replace(/[\[\]]/g, '').trim();
    return id.toUpperCase();
  }

  function killPhase8Taskbar() {
    // Phase 9 supersedes phase 8's flat single-view "XP taskbar" reskin.
    try { localStorage.setItem('p8_taskbar_off', '1'); } catch (e) { /* ignore */ }
    document.body.classList.remove('p8-xp-mode');
    var oldBar = $('p8Taskbar'); if (oldBar) oldBar.style.display = 'none';
    var oldMenu = $('p8StartMenu'); if (oldMenu) oldMenu.style.display = 'none';
  }

  function discoverApps() {
    var nav = document.querySelector('.header-nav');
    if (!nav) return [];
    return Array.prototype.slice.call(nav.querySelectorAll('.terminal-btn[id^="nav-"]'))
      // astra_consolidate.js folds staff/tasks/investors/bank/exchange/calc/
      // dashboard/markets/bots/casino into sub-tabs of BROKER SIMULATOR and
      // hides their top-level nav buttons (style.display = 'none') rather
      // than removing them. Without this filter every one of those still
      // gets its own redundant desktop icon and window on top of the real
      // "game" one, which is what was flooding the desktop with ~17 icons
      // instead of the intended ~7.
      .filter(function (btn) { return btn.style.display !== 'none'; })
      // Stage 14 (astra_stage14_appstore.js): apps the operator hasn't
      // "installed" yet get this class instead of style.display, so they
      // don't fight astra_fragment.js's own style.display toggle for
      // #nav-funds (two independent scripts racing to set the same inline
      // property would flicker depending on poll timing). A class-based gate
      // here means install-state always wins regardless of that race.
      .filter(function (btn) { return !btn.classList.contains('ws-app-locked'); })
      .map(function (btn) { return btn.id.replace('nav-', ''); })
      .filter(function (id) { return $('view-' + id); });
  }

  /* ---- desktop shell ------------------------------------------------------ */

  function buildDesktop() {
    var wrapper = $('mainAppWrapper');
    if (!wrapper || $('winosDesktop')) return;

    var header = wrapper.querySelector('header');
    if (header) header.style.display = 'none';

    var desk = document.createElement('div');
    desk.id = 'winosDesktop';
    desk.innerHTML =
      '<div id="winosWallpaper"></div>' +
      '<div id="winosIcons"></div>' +
      '<div id="winosLayer"></div>' +
      '<div id="winosStartMenu"></div>' +
      '<div id="winosTaskbar">' +
        '<div id="winosTaskLeft"></div>' +
        '<div id="winosTaskCenter">' +
          '<button id="winosStartBtn" type="button" title="Start"><span class="ws-emblem">%</span><span class="ws-start-label">start</span></button>' +
          '<div id="winosSearch"><input id="winosSearchInput" placeholder="Ask O.S. anything..." /></div>' +
          '<div id="winosTaskItems"></div>' +
        '</div>' +
        '<div id="winosTray"><span id="winosClock">--:--</span></div>' +
      '</div>';
    wrapper.insertBefore(desk, wrapper.firstChild);

    LAYER = $('winosLayer');
    TASKITEMS = $('winosTaskItems');
    STARTMENU = $('winosStartMenu');

    buildIcons();
    buildStartMenu();
    wireTaskbar();
    tickClock();
    setInterval(tickClock, 15000);
  }

  // Lets a later-loading script (or a nav button whose visibility changes
  // after boot, e.g. FUNDS unlocking on marriage) ask for icons/Start-menu
  // tiles to be recomputed from discoverApps() without a full page reload.
  window.winosRescanApps = function () {
    if (!$('winosIcons')) return; // desktop not built yet - nothing to refresh
    buildIcons();
    buildStartMenu();
  };

  function iconPosKey(id) { return 'winos_icon_pos_' + id; }

  function savedIconPos(id) {
    try {
      var raw = localStorage.getItem(iconPosKey(id));
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (typeof p.x === 'number' && typeof p.y === 'number') return p;
    } catch (e) { /* ignore */ }
    return null;
  }

  var ICON_ROW_H = 92;   // vertical spacing per icon
  var ICON_COL_W = 88;   // horizontal spacing per column
  var ICON_TOP = 16;     // top inset before the first row

  function defaultIconPos(host, i) {
    // Wrap into columns based on the desktop's real available height, so
    // icons never run off the bottom of the screen and force a scrollbar -
    // a real OS desktop lays icons out top-to-bottom THEN left-to-right,
    // never in one single endless column.
    var availH = Math.max(ICON_ROW_H, (host.clientHeight || window.innerHeight) - ICON_TOP);
    var perCol = Math.max(1, Math.floor(availH / ICON_ROW_H));
    var col = Math.floor(i / perCol);
    var row = i % perCol;
    return { x: 14 + col * ICON_COL_W, y: ICON_TOP + row * ICON_ROW_H };
  }

  function buildIcons() {
    var host = $('winosIcons');
    var apps = discoverApps();
    host.innerHTML = apps.map(function (id, i) {
      var pos = savedIconPos(id) || defaultIconPos(host, i);
      return '<button class="ws-icon" type="button" data-app="' + id + '" ' +
        'style="left:' + pos.x + 'px; top:' + pos.y + 'px;">' +
        '<span class="ws-icon-glyph">' + iconFor(id) + '</span>' +
        '<span class="ws-icon-label">' + esc(labelFor(id)) + '</span></button>';
    }).join('');
    host.querySelectorAll('.ws-icon').forEach(function (btn) {
      tagIdentity(btn, btn.getAttribute('data-app'));
      makeIconDraggable(btn, host);
    });
  }

  // Desktop icons are freely draggable anywhere on the desktop, like a real
  // OS, instead of being pinned to a fixed list. A short movement threshold
  // tells a drag apart from a plain click-to-open.
  function makeIconDraggable(btn, host) {
    var id = btn.getAttribute('data-app');
    var sx, sy, ox, oy, dragging = false, moved = false;
    function down(e) {
      var p = e.touches ? e.touches[0] : e;
      sx = p.clientX; sy = p.clientY;
      ox = btn.offsetLeft; oy = btn.offsetTop;
      dragging = true; moved = false;
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('touchend', up);
    }
    function move(e) {
      if (!dragging) return;
      var p = e.touches ? e.touches[0] : e;
      var dx = p.clientX - sx, dy = p.clientY - sy;
      if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      if (e.touches) e.preventDefault();
      moved = true;
      btn.classList.add('ws-dragging');
      var hostRect = host.getBoundingClientRect();
      var nx = Math.max(0, Math.min(hostRect.width - btn.offsetWidth, ox + dx));
      var ny = Math.max(0, Math.min(hostRect.height - btn.offsetHeight, oy + dy));
      btn.style.left = nx + 'px';
      btn.style.top = ny + 'px';
    }
    function up() {
      dragging = false;
      btn.classList.remove('ws-dragging');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      if (moved) {
        try {
          localStorage.setItem(iconPosKey(id), JSON.stringify({ x: btn.offsetLeft, y: btn.offsetTop }));
        } catch (e) { /* ignore */ }
      } else {
        sfx('click');
        openApp(id);
      }
    }
    btn.addEventListener('mousedown', down);
    btn.addEventListener('touchstart', down, { passive: true });
  }

  var PINNED_ROWS_COLLAPSED = 2; // 4 cols x 2 rows, matches the reference image
  var PINNED_COLS = 4;
  var pinnedExpanded = false;

  function recentKey() { return 'winos_recent'; }

  function getRecent() {
    try {
      var raw = localStorage.getItem(recentKey());
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return [];
  }

  function recordRecent(id) {
    var list = getRecent().filter(function (r) { return r.id !== id; });
    list.unshift({ id: id, ts: Date.now() });
    if (list.length > 6) list = list.slice(0, 6);
    try { localStorage.setItem(recentKey(), JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  function timeAgo(ts) {
    var mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.round(hrs / 24) + 'd ago';
  }

  function renderRecent() {
    var host = $('winosMenuRecent');
    if (!host) return;
    var recent = getRecent().filter(function (r) { return $('view-' + r.id); });
    if (!recent.length) {
      host.parentNode.style.display = 'none';
      return;
    }
    host.parentNode.style.display = '';
    host.innerHTML = recent.map(function (r) {
      return '<button class="ws-menu-recent-item ws-cat-' + catFor(r.id) + '" type="button" data-app="' + r.id +
        '" style="--app-accent:' + accentFor(r.id) + '">' +
        '<span class="ws-menu-recent-icon">' + iconFor(r.id) + '</span>' +
        '<span class="ws-menu-recent-text"><span class="ws-menu-recent-title">' + esc(labelFor(r.id)) +
        '</span><span class="ws-menu-recent-sub">Opened \u00B7 ' + timeAgo(r.ts) + '</span></span></button>';
    }).join('');
    host.querySelectorAll('.ws-menu-recent-item').forEach(function (btn) {
      btn.onclick = function () {
        sfx('click');
        openApp(btn.getAttribute('data-app'));
        closeStartMenu();
      };
    });
  }

  function closeStartMenu() {
    STARTMENU.classList.remove('open');
    var sb = $('winosStartBtn'); if (sb) sb.classList.remove('open');
  }

  function applyPinnedCollapse() {
    var grid = $('winosMenuGrid');
    var toggle = $('winosMenuToggle');
    if (!grid || !toggle) return;
    var limit = PINNED_ROWS_COLLAPSED * PINNED_COLS;
    var tiles = Array.prototype.slice.call(grid.children);
    if (tiles.length <= limit) { toggle.style.display = 'none'; return; }
    toggle.style.display = '';
    tiles.forEach(function (tile, i) {
      tile.style.display = (pinnedExpanded || i < limit) ? 'flex' : 'none';
    });
    toggle.textContent = pinnedExpanded ? 'Show less \u25B4' : 'Show more \u25BE';
  }

  function currentUsername() {
    var sub = $('txtHeaderSub');
    if (sub) {
      var span = sub.querySelector('span');
      if (span && span.textContent.trim()) return span.textContent.trim();
    }
    return 'OPERATOR';
  }

  function buildStartMenu() {
    // Structured like the reference Windows-11 Start menu - a search pill,
    // a "Pinned" tile grid with a show more/less toggle, a "Recent" list of
    // recently-launched apps, and an account + power strip along the
    // bottom - rendered in the game's own XP-glossy cyan/black chrome
    // rather than flat Win11 material colors.
    var apps = discoverApps();
    var html =
      '<div class="ws-menu-searchwrap"><span class="ws-menu-search-icon">\u2315</span>' +
      '<input class="ws-menu-search" id="winosMenuSearch" placeholder="Search apps and settings..." /></div>';

    html += '<div class="ws-menu-section-header"><span class="ws-menu-label">PINNED</span>' +
      '<button class="ws-menu-toggle" id="winosMenuToggle" type="button"></button></div>';
    html += '<div class="ws-menu-grid" id="winosMenuGrid">';
    apps.forEach(function (id) {
      html += '<button class="ws-menu-item ws-cat-' + catFor(id) + '" type="button" data-app="' + id +
        '" data-label="' + esc(labelFor(id).toLowerCase()) + '" style="--app-accent:' + accentFor(id) + '">' +
        '<span class="ws-menu-item-glyph">' + iconFor(id) + '</span>' +
        '<span class="ws-menu-item-label">' + esc(labelFor(id)) + '</span></button>';
    });
    html += '</div>';

    html += '<div class="ws-menu-recent-wrap"><div class="ws-menu-label">RECENT</div>' +
      '<div class="ws-menu-recent" id="winosMenuRecent"></div></div>';

    html += '<div class="ws-menu-footer">' +
      '<div class="ws-menu-account"><span class="ws-emblem">%</span><span>' + esc(currentUsername()) + '</span></div>' +
      '<button class="ws-menu-power" id="winosLogout" type="button" title="Log off">\u23FB</button>' +
    '</div>';
    STARTMENU.innerHTML = html;

    STARTMENU.querySelectorAll('.ws-menu-item').forEach(function (btn) {
      btn.onclick = function () {
        sfx('click');
        openApp(btn.getAttribute('data-app'));
        closeStartMenu();
      };
    });
    var logout = $('winosLogout');
    if (logout) logout.onclick = function () { window.location.href = '/logout'; };

    var toggle = $('winosMenuToggle');
    if (toggle) toggle.onclick = function () { pinnedExpanded = !pinnedExpanded; applyPinnedCollapse(); };
    applyPinnedCollapse();
    renderRecent();

    var search = $('winosMenuSearch');
    if (search) {
      search.addEventListener('input', function () {
        var q = search.value.trim().toLowerCase();
        if (q) { pinnedExpanded = true; }
        STARTMENU.querySelectorAll('.ws-menu-item').forEach(function (btn) {
          var match = !q || btn.getAttribute('data-label').indexOf(q) !== -1;
          btn.style.display = match ? 'flex' : 'none';
        });
        if (!q) applyPinnedCollapse();
      });
    }
  }

  function wireTaskbar() {
    var startBtn = $('winosStartBtn');
    startBtn.onclick = function (e) {
      e.stopPropagation(); sfx('click');
      STARTMENU.classList.toggle('open');
      var isOpen = STARTMENU.classList.contains('open');
      startBtn.classList.toggle('open', isOpen);
      if (isOpen) {
        renderRecent();
        pinnedExpanded = false;
        applyPinnedCollapse();
        var search = $('winosMenuSearch');
        if (search) { search.value = ''; setTimeout(function () { search.focus(); }, 10); }
      }
    };
    document.addEventListener('click', function (e) {
      if (STARTMENU && !STARTMENU.contains(e.target) && !startBtn.contains(e.target)) {
        STARTMENU.classList.remove('open');
        startBtn.classList.remove('open');
      }
    });
    var searchInput = $('winosSearchInput');
    if (searchInput) {
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && searchInput.value.trim()) {
          // Placeholder hook for the in-game AI search engine planned next -
          // for now it opens the closest existing surface (crypto search).
          openApp('markets');
          searchInput.value = '';
        }
      });
    }
  }

  function tickClock() {
    var el = $('winosClock');
    if (!el) return;
    var now = new Date();
    el.textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  }

  /* ---- window lifecycle ---------------------------------------------------- */

  function isNarrow() { return window.innerWidth < 760; }

  function nextCascade() {
    var n = Object.keys(win).filter(function (id) { return win[id].opened; }).length;
    return { x: 40 + (n % 6) * 28, y: 26 + (n % 6) * 22 };
  }

  function openApp(id) {
    var view = $('view-' + id);
    if (!view) return; // unknown app id, nothing to do

    if (!win[id]) createWindow(id, view);
    var w = win[id];
    w.el.style.display = 'flex';
    w.opened = true;
    w.min = false;
    focusWindow(id);
    ensureTaskItem(id);
    recordRecent(id);

    // Keep every existing side effect (active-view bookkeeping, the
    // settings view's own loader, phase8's now-hidden taskbar refresh,
    // etc.) running exactly as before this file loaded.
    if (typeof window.__winosOrigSwitch === 'function') window.__winosOrigSwitch(id);
  }

  function createWindow(id, view) {
    var frame = document.createElement('div');
    frame.className = 'ws-window';
    frame.id = 'wswin-' + id;
    frame.setAttribute('data-app', id);
    tagIdentity(frame, id);
    var pos = nextCascade();
    frame.style.left = pos.x + 'px';
    frame.style.top = pos.y + 'px';
    frame.innerHTML =
      '<div class="ws-titlebar">' +
        '<span class="ws-title-icon">' + iconFor(id) + '</span>' +
        '<span class="ws-title-text">' + esc(labelFor(id)) + '</span>' +
        '<div class="ws-title-btns">' +
          '<button class="ws-btn ws-min" type="button" title="Minimize">\u2013</button>' +
          '<button class="ws-btn ws-max" type="button" title="Maximize">\u25A1</button>' +
          '<button class="ws-btn ws-close" type="button" title="Close">\u00D7</button>' +
        '</div>' +
      '</div>' +
      '<div class="ws-body"></div>' +
      '<div class="ws-resize"></div>';
    LAYER.appendChild(frame);

    var body = frame.querySelector('.ws-body');
    body.appendChild(view); // reparent the real view node - ids/state untouched
    view.classList.add('active-view');

    win[id] = { el: frame, opened: false, min: false, max: false, z: 0 };

    frame.addEventListener('mousedown', function () { focusWindow(id); });
    frame.addEventListener('touchstart', function () { focusWindow(id); }, { passive: true });
    frame.querySelector('.ws-close').onclick = function (e) { e.stopPropagation(); sfx('click'); closeApp(id); };
    frame.querySelector('.ws-min').onclick = function (e) { e.stopPropagation(); sfx('click'); minimizeApp(id); };
    frame.querySelector('.ws-max').onclick = function (e) { e.stopPropagation(); sfx('click'); toggleMaximize(id); };
    var titlebar = frame.querySelector('.ws-titlebar');
    titlebar.addEventListener('dblclick', function () { toggleMaximize(id); });
    makeDraggable(frame, titlebar, id);
    makeResizable(frame, frame.querySelector('.ws-resize'), id);

    if (isNarrow()) toggleMaximize(id);
  }

  function focusWindow(id) {
    if (!win[id]) return;
    zTop += 1;
    win[id].el.style.zIndex = zTop;
    document.querySelectorAll('.ws-window').forEach(function (w) { w.classList.remove('active'); });
    win[id].el.classList.add('active');
    document.querySelectorAll('.ws-task-item').forEach(function (b) { b.classList.remove('active'); });
    var tb = $('wstask-' + id);
    if (tb) tb.classList.add('active');
    window.__winosActiveId = id;
  }

  function minimizeApp(id) {
    if (!win[id]) return;
    win[id].el.style.display = 'none';
    win[id].min = true;
    if (window.__winosActiveId === id) window.__winosActiveId = null;
    var tb = $('wstask-' + id);
    if (tb) tb.classList.remove('active');
  }

  function closeApp(id) {
    if (!win[id]) return;
    win[id].el.style.display = 'none';
    win[id].opened = false;
    win[id].min = false;
    if (window.__winosActiveId === id) window.__winosActiveId = null;
    var tb = $('wstask-' + id);
    if (tb) tb.remove();
  }

  function toggleMaximize(id) {
    var w = win[id]; if (!w) return;
    var frame = w.el;
    if (!w.max) {
      w._prev = { left: frame.style.left, top: frame.style.top, width: frame.style.width, height: frame.style.height };
      frame.classList.add('ws-maxed');
      w.max = true;
    } else {
      frame.classList.remove('ws-maxed');
      if (w._prev) {
        frame.style.left = w._prev.left; frame.style.top = w._prev.top;
        frame.style.width = w._prev.width; frame.style.height = w._prev.height;
      }
      w.max = false;
    }
    focusWindow(id);
  }

  function taskOrderKey() { return 'winos_task_order'; }

  function savedTaskOrder() {
    try {
      var raw = localStorage.getItem(taskOrderKey());
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return [];
  }

  function persistTaskOrder() {
    var order = Array.prototype.map.call(TASKITEMS.children, function (el) {
      return el.id.replace('wstask-', '');
    });
    try { localStorage.setItem(taskOrderKey(), JSON.stringify(order)); } catch (e) { /* ignore */ }
  }

  function ensureTaskItem(id) {
    if ($('wstask-' + id)) return;
    var btn = document.createElement('button');
    btn.className = 'ws-task-item';
    btn.id = 'wstask-' + id;
    btn.type = 'button';
    btn.title = labelFor(id);
    btn.draggable = true;
    btn.innerHTML = iconFor(id);
    btn.setAttribute('data-app', id);
    tagIdentity(btn, id);
    btn.onclick = function () {
      sfx('click');
      if (win[id].min || window.__winosActiveId !== id) {
        win[id].el.style.display = 'flex';
        win[id].min = false;
        focusWindow(id);
      } else {
        minimizeApp(id);
      }
    };
    wireTaskItemDrag(btn);

    // Respect a previously saved order: insert before the first existing
    // item that comes later in the saved order, otherwise append.
    var order = savedTaskOrder();
    var myRank = order.indexOf(id);
    var inserted = false;
    if (myRank !== -1) {
      for (var i = 0; i < TASKITEMS.children.length; i++) {
        var otherId = TASKITEMS.children[i].id.replace('wstask-', '');
        var otherRank = order.indexOf(otherId);
        if (otherRank !== -1 && otherRank > myRank) {
          TASKITEMS.insertBefore(btn, TASKITEMS.children[i]);
          inserted = true;
          break;
        }
      }
    }
    if (!inserted) TASKITEMS.appendChild(btn);
  }

  // Lets you pick up a running app's taskbar icon and drop it in a new spot
  // to reorder the taskbar, like Windows 11's pinned-icon reordering.
  function wireTaskItemDrag(btn) {
    btn.addEventListener('dragstart', function (e) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', btn.id);
    });
    btn.addEventListener('dragover', function (e) {
      e.preventDefault();
      btn.classList.add('ws-drag-over');
    });
    btn.addEventListener('dragleave', function () { btn.classList.remove('ws-drag-over'); });
    btn.addEventListener('drop', function (e) {
      e.preventDefault();
      btn.classList.remove('ws-drag-over');
      var draggedId = e.dataTransfer.getData('text/plain');
      var dragged = document.getElementById(draggedId);
      if (!dragged || dragged === btn) return;
      var rect = btn.getBoundingClientRect();
      var before = (e.clientX - rect.left) < rect.width / 2;
      TASKITEMS.insertBefore(dragged, before ? btn : btn.nextSibling);
      persistTaskOrder();
    });
  }

  function makeDraggable(frame, handle, id) {
    var sx, sy, ox, oy, dragging = false;
    function down(e) {
      if (win[id].max) return;
      var p = e.touches ? e.touches[0] : e;
      dragging = true; sx = p.clientX; sy = p.clientY;
      ox = frame.offsetLeft; oy = frame.offsetTop;
      focusWindow(id);
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('touchend', up);
    }
    function move(e) {
      if (!dragging) return;
      if (e.touches) e.preventDefault();
      var p = e.touches ? e.touches[0] : e;
      var nx = ox + (p.clientX - sx);
      var ny = Math.max(0, oy + (p.clientY - sy));
      frame.style.left = nx + 'px';
      frame.style.top = ny + 'px';
    }
    function up() {
      dragging = false;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
    }
    handle.addEventListener('mousedown', down);
    handle.addEventListener('touchstart', down, { passive: true });
  }

  function makeResizable(frame, handle, id) {
    var sx, sy, ow, oh, resizing = false;
    function down(e) {
      if (win[id].max) return;
      var p = e.touches ? e.touches[0] : e;
      resizing = true; sx = p.clientX; sy = p.clientY;
      ow = frame.offsetWidth; oh = frame.offsetHeight;
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('touchend', up);
    }
    function move(e) {
      if (!resizing) return;
      if (e.touches) e.preventDefault();
      var p = e.touches ? e.touches[0] : e;
      var nw = Math.max(320, ow + (p.clientX - sx));
      var nh = Math.max(220, oh + (p.clientY - sy));
      frame.style.width = nw + 'px';
      frame.style.height = nh + 'px';
    }
    function up() {
      resizing = false;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
    }
    handle.addEventListener('mousedown', down);
    handle.addEventListener('touchstart', down, { passive: true });
  }

  /* ---- boot ------------------------------------------------------------------ */

  function boot() {
    if (window.__winosBooted) return;
    window.__winosBooted = true;

    killPhase8Taskbar();
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    buildDesktop();
    refreshGameLabel();

    // Wrap whatever window.switchView currently is (phase8 already wraps the
    // original once) so every existing call site - nav buttons, other phase
    // files, "back to dashboard" links, etc - now opens/focuses a real
    // window instead of flatly swapping a single active view.
    window.__winosOrigSwitch = window.switchView;
    window.switchView = function (name) { openApp(name); };

    openApp('dashboard');
  }

  window.addEventListener('astrax:ready', function () {
    // Run after every other phase file's own astrax:ready handler so any
    // dynamically-added nav-<id> buttons (phase8's politics/network apps)
    // already exist before this scans for them.
    setTimeout(boot, 60);
  });
})();
