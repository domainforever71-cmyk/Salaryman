/* ===========================================================================
 * astra_phase8.js - Phase 8 surface: UI reorganization + politics/economy +
 * a visible AI rival + real player-to-player hiring + a black-market credit
 * store + "make it feel like a game" animation pass.
 *
 * Loads last (after astra_consolidate.js) and waits for `astrax:ready`, same
 * contract as every other phase file: does not touch executeTrade,
 * advanceGameDay, or sendOmniConsole, and never removes any element other
 * phase files depend on - only hides/reparents via CSS and adds new views.
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function sfx(n) { if (window.SFX) window.SFX.play(n); }
  function money(n) {
    return '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  async function api(url, opts) {
    var res = await fetch(url, opts);
    if (!res.ok && res.status !== 400 && res.status !== 403 && res.status !== 404) throw new Error(res.status);
    return res.json();
  }
  function post(url, body) {
    return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  }

  function addView(id, html) {
    var host = $('view-dashboard');
    if (!host || $('view-' + id)) return;
    var div = document.createElement('div');
    div.id = 'view-' + id;
    div.className = 'app-view';
    div.innerHTML = html;
    host.parentNode.appendChild(div);
  }

  function addNavButton(id, label) {
    var nav = document.querySelector('.header-nav');
    if (!nav || $('nav-' + id)) return;
    var btn = document.createElement('button');
    btn.className = 'terminal-btn';
    btn.id = 'nav-' + id;
    btn.setAttribute('data-i18n', 'nav_' + id);
    btn.textContent = label;
    btn.onclick = function () { window.switchView(id); };
    var settings = $('nav-settings');
    if (settings) nav.insertBefore(btn, settings); else nav.appendChild(btn);
  }

  /* =====================================================================
   * Global visual pass: CSS injected once, used by every widget below.
   * ===================================================================== */
  function injectStyles() {
    var css = document.createElement('style');
    css.textContent = [
      /* ---- generic motion utility, reused everywhere below ---- */
      '@keyframes p8fadeIn{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:translateY(0);}}',
      '@keyframes p8pop{0%{transform:scale(.85);opacity:.4;}60%{transform:scale(1.08);opacity:1;}100%{transform:scale(1);}}',
      '@keyframes p8flash{0%{box-shadow:0 0 0 rgba(0,255,204,0);}30%{box-shadow:0 0 22px rgba(0,255,204,.55);}100%{box-shadow:0 0 0 rgba(0,255,204,0);}}',
      '@keyframes p8flashLose{0%{box-shadow:0 0 0 rgba(255,51,102,0);}30%{box-shadow:0 0 22px rgba(255,51,102,.55);}100%{box-shadow:0 0 0 rgba(255,51,102,0);}}',
      '@keyframes p8slideIn{from{transform:translateX(24px);opacity:0;}to{transform:translateX(0);opacity:1;}}',
      '.app-view.active-view{animation:p8fadeIn .18s ease-out;}',
      'body.reduce-motion .app-view.active-view,body.reduce-motion .p8-reel-pop,body.reduce-motion .p8-flash{animation:none !important;}',
      '.terminal-btn,.p6-chip{transition:transform .08s ease-out;}',
      '.terminal-btn:active,.p6-chip:active{transform:scale(.95);}',
      '.p8-reel-pop{animation:p8pop .38s ease-out;}',
      '.p8-flash{animation:p8flash .7s ease-out;}',
      '.p8-flash-lose{animation:p8flashLose .7s ease-out;}',

      /* ---- toast notifications ---- */
      '#p8Toasts{position:fixed;top:14px;right:14px;z-index:400000;display:flex;flex-direction:column;gap:6px;max-width:300px;}',
      '.p8-toast{background:#050810;border:1px solid var(--pixel-cyan);color:var(--text-main);font-size:11px;',
      'padding:8px 12px;animation:p8slideIn .22s ease-out;box-shadow:0 2px 10px rgba(0,0,0,.5);}',
      '.p8-toast b{color:var(--pixel-cyan);}',

      /* ---- Windows-XP-inspired taskbar + start menu ---- */
      'body.p8-xp-mode{padding-bottom:46px;}',
      '#p8Taskbar{position:fixed;left:0;right:0;bottom:0;height:38px;z-index:200000;display:none;align-items:center;gap:6px;',
      'padding:0 6px;background:linear-gradient(180deg,#3f7fe0 0%,#245edb 4%,#1941a5 94%,#0f2f7a 100%);',
      'border-top:1px solid #7fb0ff;font-family:Tahoma,Verdana,sans-serif;}',
      'body.p8-xp-mode #p8Taskbar{display:flex;}',
      '#p8StartBtn{background:linear-gradient(180deg,#5fe05f,#1e9e1e);border:1px solid #0c5c0c;border-radius:4px 10px 10px 4px;',
      'color:#fff;font-weight:bold;font-size:13px;padding:6px 16px;cursor:pointer;text-shadow:1px 1px 1px rgba(0,0,0,.45);}',
      '#p8StartBtn:hover{filter:brightness(1.08);}',
      '#p8TaskItems{display:flex;gap:4px;overflow-x:auto;flex:1;}',
      '.p8-task-item{background:#2a52b8;border:1px solid #6c94e8;color:#eef3ff;font-size:11px;padding:5px 10px;',
      'border-radius:3px;white-space:nowrap;cursor:pointer;font-family:inherit;}',
      '.p8-task-item.active-nav{background:#12306e;border-color:#9fc0ff;}',
      '#p8Clock{margin-left:auto;color:#fff;font-size:12px;background:#12306e;border:1px solid #6699ff;',
      'border-radius:3px;padding:5px 10px;white-space:nowrap;}',
      '#p8HideTaskbar{background:none;border:1px solid #6699ff;color:#dbe6ff;font-size:10px;padding:5px 7px;cursor:pointer;}',
      '#p8StartMenu{position:fixed;left:4px;bottom:42px;width:270px;background:#ece9d8;',
      'border:2px solid #0831d9;border-radius:6px 6px 0 0;box-shadow:4px 4px 16px rgba(0,0,0,.55);',
      'display:none;overflow:hidden;z-index:200001;font-family:Tahoma,Verdana,sans-serif;color:#111;max-height:70vh;overflow-y:auto;}',
      '#p8StartMenu.open{display:block;animation:p8fadeIn .12s ease-out;}',
      '.p8-menu-header{background:linear-gradient(180deg,#3f7fe0,#1941a5);color:#fff;padding:10px 12px;',
      'font-weight:bold;font-size:13px;display:flex;align-items:center;gap:8px;}',
      '.p8-menu-header .p8-emblem{width:22px;height:22px;border-radius:50%;background:#0a1a3d;color:#6ef0c8;',
      'display:flex;align-items:center;justify-content:center;font-size:12px;border:1px solid #6ef0c8;}',
      '.p8-menu-group{font-size:10px;letter-spacing:1px;color:#3355aa;background:#dce4f7;padding:4px 10px;',
      'margin-top:2px;font-weight:bold;}',
      '.p8-menu-item{display:block;width:100%;text-align:left;background:#fff;border:none;',
      'border-bottom:1px solid #e2e2e2;padding:7px 14px;font-size:12px;cursor:pointer;color:#111;font-family:inherit;}',
      '.p8-menu-item:hover{background:#2255dd;color:#fff;}',
      '.p8-menu-footer{padding:8px 12px;background:#dce4f7;font-size:10px;color:#3355aa;cursor:pointer;text-align:center;}',

      /* ---- casino floor: bigger, animated ---- */
      '.p6-reel{transition:transform .1s;}',
      '.p6-chip.sel{animation:p8pop .2s ease-out;}',

      /* ---- politics / AI rival / hire panels ---- */
      '.p8-news-row{border-bottom:1px solid var(--border-color);padding:7px 0;font-size:11.5px;animation:p8fadeIn .2s ease-out;}',
      '.p8-news-row .p8-time{color:#5c7a99;margin-right:6px;}',
      '.p8-rival-card{border:1px solid var(--pixel-cyan);background:rgba(0,255,204,.04);padding:10px 12px;}',
      '.p8-tax-badge{display:inline-block;border:1px solid var(--pixel-yellow);color:var(--pixel-yellow);',
      'padding:2px 8px;font-size:11px;margin-left:6px;}',
      '.p8-hire-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;',
      'border-bottom:1px solid var(--border-color);font-size:11.5px;}',
    ].join('');
    document.head.appendChild(css);
  }

  /* =====================================================================
   * Toasts
   * ===================================================================== */
  function toastHost() {
    var h = $('p8Toasts');
    if (h) return h;
    h = document.createElement('div');
    h.id = 'p8Toasts';
    document.body.appendChild(h);
    return h;
  }
  function toast(html) {
    var host = toastHost();
    var t = document.createElement('div');
    t.className = 'p8-toast';
    t.innerHTML = html;
    host.appendChild(t);
    setTimeout(function () { t.remove(); }, 6000);
  }

  /* =====================================================================
   * Windows-XP-inspired taskbar + categorized Start Menu.
   * Purely a navigation reorganization - every item still calls the exact
   * same window.switchView(id) the original header buttons use, so nothing
   * about how views actually work changes.
   * ===================================================================== */
  var NAV_GROUPS = [
    { label: 'CAREER', ids: ['dashboard', 'game', 'staff', 'tasks', 'investors', 'bank'] },
    { label: 'MARKETS & TRADING', ids: ['markets', 'bots', 'calc', 'casino'] },
    { label: 'SOCIAL & SYNDICATE', ids: ['messages', 'coop', 'exchange', 'network'] },
    { label: 'ECONOMY', ids: ['politics', 'credits'] },
    { label: 'PROFILE & STUDIO', ids: ['profile', 'studio'] },
    { label: 'SYSTEM', ids: ['settings'] },
  ];

  function labelFor(id) {
    var btn = $('nav-' + id);
    if (btn) return btn.textContent.trim();
    return '[' + id.toUpperCase() + ']';
  }

  function buildStartMenu() {
    var menu = document.createElement('div');
    menu.id = 'p8StartMenu';
    var html = '<div class="p8-menu-header"><span class="p8-emblem">%</span> ASTRA OPERATOR MENU</div>';
    NAV_GROUPS.forEach(function (grp) {
      var items = grp.ids.filter(function (id) { return $('nav-' + id); });
      if (!items.length) return;
      html += '<div class="p8-menu-group">' + esc(grp.label) + '</div>';
      items.forEach(function (id) {
        html += '<button class="p8-menu-item" data-view="' + id + '">' + esc(labelFor(id)) + '</button>';
      });
    });
    html += '<div class="p8-menu-footer" id="p8LogoutMenu">[LOG OFF TERMINAL]</div>';
    menu.innerHTML = html;
    document.body.appendChild(menu);

    menu.querySelectorAll('.p8-menu-item').forEach(function (btn) {
      btn.onclick = function () {
        sfx('click');
        window.switchView(btn.getAttribute('data-view'));
        menu.classList.remove('open');
        updateTaskItems();
      };
    });
    $('p8LogoutMenu').onclick = function () { window.location.href = '/logout'; };
    return menu;
  }

  function updateTaskItems() {
    var host = $('p8TaskItems');
    if (!host) return;
    var active = document.querySelector('.header-nav .terminal-btn.active-nav');
    var activeId = active ? active.id.replace('nav-', '') : 'dashboard';
    var pinned = ['dashboard', 'game', 'markets', 'casino', 'messages'];
    host.innerHTML = pinned.filter(function (id) { return $('nav-' + id); }).map(function (id) {
      return '<button class="p8-task-item' + (id === activeId ? ' active-nav' : '') + '" data-view="' + id + '">' +
        esc(labelFor(id).replace(/\[|\]/g, '')) + '</button>';
    }).join('');
    host.querySelectorAll('.p8-task-item').forEach(function (btn) {
      btn.onclick = function () { window.switchView(btn.getAttribute('data-view')); updateTaskItems(); };
    });
  }

  function tickClock() {
    var el = $('p8Clock');
    if (!el) return;
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, '0');
    var mm = String(now.getMinutes()).padStart(2, '0');
    el.textContent = hh + ':' + mm;
  }

  function buildTaskbar() {
    if ($('p8Taskbar')) return;
    var bar = document.createElement('div');
    bar.id = 'p8Taskbar';
    bar.innerHTML =
      '<button id="p8StartBtn">\u229e START</button>' +
      '<div id="p8TaskItems"></div>' +
      '<span id="p8Clock">--:--</span>' +
      '<button id="p8HideTaskbar" title="Hide classic taskbar">[HIDE]</button>';
    document.body.appendChild(bar);

    var menu = buildStartMenu();
    $('p8StartBtn').onclick = function (e) {
      e.stopPropagation();
      sfx('click');
      menu.classList.toggle('open');
    };
    document.addEventListener('click', function (e) {
      if (!menu.contains(e.target) && e.target.id !== 'p8StartBtn') menu.classList.remove('open');
    });
    $('p8HideTaskbar').onclick = function () {
      localStorage.setItem('p8_taskbar_off', '1');
      document.body.classList.remove('p8-xp-mode');
    };

    updateTaskItems();
    tickClock();
    setInterval(tickClock, 15000);

    // Keep the taskbar's active item and the Start Menu in sync with
    // whatever switchView() the rest of the app already calls.
    var origSwitch = window.switchView;
    if (typeof origSwitch === 'function' && !window.__p8SwitchWrapped) {
      window.__p8SwitchWrapped = true;
      window.switchView = function (name) {
        origSwitch(name);
        updateTaskItems();
      };
    }

    if (localStorage.getItem('p8_taskbar_off') !== '1') {
      document.body.classList.add('p8-xp-mode');
    }
  }

  /* =====================================================================
   * Casino animation pass - purely observational, never touches AstraP6's
   * own betting logic. Watches the DOM nodes it already updates and layers
   * a spin/flash animation on top of whatever result just landed.
   * ===================================================================== */
  function watchCasino() {
    var reels = $('p6SlotReels');
    if (reels && !reels.__p8watched) {
      reels.__p8watched = true;
      new MutationObserver(function () {
        reels.querySelectorAll('.p6-reel').forEach(function (r, i) {
          r.classList.remove('p8-reel-pop');
          void r.offsetWidth; // restart the animation
          setTimeout(function () { r.classList.add('p8-reel-pop'); }, i * 60);
        });
      }).observe(reels, { childList: true });
    }
    ['p6SlotResult', 'p6CoinResult', 'p6DiceResult', 'p6BjResult'].forEach(function (id) {
      var el = $(id);
      if (!el || el.__p8watched) return;
      el.__p8watched = true;
      new MutationObserver(function () {
        var panel = el.closest('.terminal-panel');
        if (!panel) return;
        var won = !!el.querySelector('.p6-win');
        var lost = !!el.querySelector('.p6-lose');
        if (!won && !lost) return;
        panel.classList.remove('p8-flash', 'p8-flash-lose');
        void panel.offsetWidth;
        panel.classList.add(won ? 'p8-flash' : 'p8-flash-lose');
        sfx(won ? 'win' : 'lose');
      }).observe(el, { childList: true, subtree: true });
    });
  }

  /* =====================================================================
   * Politics & Economy view - tariffs/subsidies/corruption/tax law, plus
   * OMNI-QUANT (the AI rival) and the black-market credit store additions.
   * ===================================================================== */
  var lastPoliticsSeen = null;

  function politicsView() {
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">ECONOMY & POLITICS</div>' +
        '<span style="font-size:11px;">Monthly capital tax: <span id="p8TaxRate" class="p8-tax-badge">--%</span></span></div>' +
        '<div style="font-size:11px;color:#5c7a99;line-height:1.7;">' +
          'Tariffs, subsidies, trade deals, corruption probes and tax law all move the market for every ' +
          'operator at once - nobody is exempt, including OMNI-QUANT below.' +
        '</div>' +
      '</div>' +
      '<div class="terminal-panel p8-rival-card">' +
        '<div class="panel-header"><div class="panel-heading-title">OMNI-QUANT \u2014 AUTONOMOUS TRADING MODEL</div></div>' +
        '<div id="p8RivalBody" style="font-size:11.5px;line-height:1.9;">Loading...</div>' +
      '</div>' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">POLITICAL & MARKET NEWS</div></div>' +
        '<div id="p8NewsList" style="max-height:280px;overflow-y:auto;"></div>' +
      '</div>' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">BLACK MARKET</div>' +
        '<span style="font-size:11px;color:var(--pixel-cyan);">Credits: <span id="p8BmCredits">0</span></span></div>' +
        '<div style="font-size:10.5px;color:#5c7a99;margin-bottom:6px;">Cosmetic/one-shot spends. Credits never convert to cash.</div>' +
        '<div id="p8BmList"></div>' +
      '</div>';
  }

  async function loadPolitics() {
    try {
      var d = await api('/api/game/politics');
      if (!d.success) return;
      var badge = $('p8TaxRate');
      if (badge) badge.textContent = (d.tax_rate * 100).toFixed(1) + '%';
      var list = $('p8NewsList');
      if (list) {
        list.innerHTML = d.log.length ? d.log.map(function (e) {
          return '<div class="p8-news-row"><span class="p8-time">[' + esc(e.time) + ']</span>' + esc(e.headline) + '</div>';
        }).join('') : '<div style="color:#5c7a99;font-size:11px;">No political events yet - the market has been quiet.</div>';
      }
      if (d.log.length && (!lastPoliticsSeen || d.log[0].time !== lastPoliticsSeen)) {
        if (lastPoliticsSeen !== null) { toast('<b>POLITICS</b><br>' + esc(d.log[0].headline)); sfx('news'); }
        lastPoliticsSeen = d.log[0].time;
      }
    } catch (e) {}
  }

  async function loadRival() {
    try {
      var d = await api('/api/game/ai_rival');
      if (!d.success) return;
      var r = d.rival;
      var body = $('p8RivalBody');
      if (body) {
        var holdings = Object.keys(r.holdings || {}).filter(function (s) { return r.holdings[s] > 0; })
          .map(function (s) { return s + ' x' + r.holdings[s]; }).join(', ') || 'none';
        body.innerHTML =
          '<div>' + esc(r.bio) + '</div>' +
          '<div style="margin-top:8px;">Equity: <b style="color:var(--pixel-cyan);">' + money(r.equity) + '</b>' +
          ' &nbsp; Cash: ' + money(r.balance) + '</div>' +
          '<div>Holdings: ' + esc(holdings) + '</div>' +
          '<div style="color:var(--pixel-green);margin-top:4px;">Last move: ' + esc(r.last_move) + '</div>';
      }
    } catch (e) {}
  }

  function buyBlackMarket(sinkId, extra) {
    return post('/api/credits/buy_sink', Object.assign({ sink_id: sinkId }, extra || {}));
  }

  async function loadBlackMarket() {
    try {
      var d = await api('/api/credits');
      if (!d.success) return;
      var creditsEl = $('p8BmCredits');
      if (creditsEl) creditsEl.textContent = d.credits;
      var ids = ['priority_execution', 'sentiment_boost', 'rival_taunt'];
      var list = $('p8BmList');
      if (!list) return;
      list.innerHTML = ids.map(function (id) {
        var s = d.sinks[id];
        if (!s) return '';
        return '<div class="p8-hire-row"><div><b>' + esc(s.name) + '</b><br>' +
          '<span style="color:#5c7a99;">' + esc(s.blurb) + '</span></div>' +
          '<button class="terminal-btn btn-start" data-sink="' + id + '">' + s.cost + ' [\u00a4]</button></div>';
      }).join('');
      list.querySelectorAll('[data-sink]').forEach(function (btn) {
        btn.onclick = async function () {
          var sinkId = btn.getAttribute('data-sink');
          var extra = {};
          if (sinkId === 'rival_taunt') {
            extra.text = window.prompt('Taunt OMNI-QUANT (it will not respond):', '') || '';
            if (!extra.text) return;
          }
          try {
            var r = await buyBlackMarket(sinkId, extra);
            if (!r.success) { sfx('deny'); toast('<b>BLACK MARKET</b><br>' + esc(r.msg || 'Purchase failed.')); return; }
            sfx('cash');
            toast('<b>BLACK MARKET</b><br>' + esc(r.msg));
            loadBlackMarket();
          } catch (e) {}
        };
      });
    } catch (e) {}
  }

  /* =====================================================================
   * Real player-to-player hiring - the "network" view. Restricted to
   * friends server-side (see app.hire_offer); this just presents it.
   * ===================================================================== */
  function networkView() {
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">OPERATOR NETWORK</div></div>' +
        '<div style="font-size:11px;color:#5c7a99;line-height:1.7;">' +
          'Hire a friend as a contract operator: a daily salary moves from your balance to theirs every time ' +
          'you advance a day. They keep playing their own solo career - you just fund a cut of it.' +
        '</div>' +
      '</div>' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">SEND A HIRE OFFER</div></div>' +
        '<input type="text" id="p8HireUser" class="d-input" placeholder="Friend\'s username" style="margin-bottom:6px;">' +
        '<input type="text" id="p8HireRole" class="d-input" placeholder="Role (e.g. Junior Analyst)" style="margin-bottom:6px;">' +
        '<input type="number" id="p8HireSalary" class="d-input" placeholder="Daily salary ($)" value="100" style="margin-bottom:6px;">' +
        '<button class="terminal-btn btn-start" id="p8HireSend" style="width:100%;">[SEND OFFER]</button>' +
        '<div id="p8HireMsg" style="font-size:11px;margin-top:6px;"></div>' +
      '</div>' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">YOUR NETWORK</div></div>' +
        '<div id="p8HireList" style="font-size:11.5px;"></div>' +
      '</div>';
  }

  async function loadHires() {
    var list = $('p8HireList');
    if (!list) return;
    try {
      var d = await api('/api/hire/list');
      if (!d.success) return;
      if (!d.hires.length) { list.innerHTML = '<div style="color:#5c7a99;">Nobody hired, nobody hiring you - yet.</div>'; return; }
      list.innerHTML = d.hires.map(function (h) {
        var counterpart = h.as === 'employer' ? h.employee : h.employer;
        var role = h.as === 'employer' ? ('employing as ' + h.role) : ('employed as ' + h.role);
        var actions = '';
        if (h.as === 'employee' && h.status === 'pending') {
          actions = '<button class="terminal-btn" data-accept="' + h.id + '">[ACCEPT]</button> ' +
            '<button class="terminal-btn btn-warning" data-decline="' + h.id + '">[DECLINE]</button>';
        } else if (h.status === 'active') {
          actions = '<button class="terminal-btn btn-warning" data-end="' + h.id + '">[END]</button>';
        } else {
          actions = '<span style="color:#5c7a99;">' + esc(h.status.toUpperCase()) + '</span>';
        }
        return '<div class="p8-hire-row"><div><b>' + esc(counterpart) + '</b> - ' + esc(role) +
          '<br><span style="color:#5c7a99;">$' + h.salary.toFixed(2) + '/day, paid ' + money(h.total_paid) + ' total</span></div>' +
          '<div>' + actions + '</div></div>';
      }).join('');
      list.querySelectorAll('[data-accept]').forEach(function (b) {
        b.onclick = function () { respondHire(b.getAttribute('data-accept'), true); };
      });
      list.querySelectorAll('[data-decline]').forEach(function (b) {
        b.onclick = function () { respondHire(b.getAttribute('data-decline'), false); };
      });
      list.querySelectorAll('[data-end]').forEach(function (b) {
        b.onclick = async function () { await post('/api/hire/end', { hire_id: b.getAttribute('data-end') }); loadHires(); };
      });
    } catch (e) {}
  }

  async function respondHire(id, accept) {
    try {
      var r = await post('/api/hire/respond', { hire_id: id, accept: accept });
      sfx(r.success && accept ? 'hire' : 'click');
      loadHires();
    } catch (e) {}
  }

  function wireNetworkForm() {
    var btn = $('p8HireSend');
    if (!btn || btn.__p8wired) return;
    btn.__p8wired = true;
    btn.onclick = async function () {
      var msg = $('p8HireMsg');
      var body = {
        username: $('p8HireUser').value.trim(),
        role: $('p8HireRole').value.trim(),
        salary: parseFloat($('p8HireSalary').value) || 0,
      };
      try {
        var r = await post('/api/hire/offer', body);
        if (msg) msg.innerHTML = '<span class="' + (r.success ? 'p6-win' : 'p6-lose') + '">' + esc(r.msg || (r.success ? 'Offer sent.' : 'Failed.')) + '</span>';
        sfx(r.success ? 'cash' : 'deny');
        if (r.success) loadHires();
      } catch (e) {}
    };
  }

  /* =====================================================================
   * Messages tab: an "UPDATES" sub-feed alongside the existing DM view,
   * pulling from the same political/market news the Politics view shows.
   * ===================================================================== */
  function setupMessagesUpdates() {
    var view = $('view-messages');
    if (!view || $('p8UpdatesPanel')) return;
    var wrap = document.createElement('div');
    wrap.id = 'p8MessagesOriginal';
    while (view.firstChild) wrap.appendChild(view.firstChild);
    view.appendChild(wrap);

    var tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;';
    tabs.innerHTML =
      '<button class="terminal-btn active-nav" id="p8TabDM">[\u2709] DIRECT MESSAGES</button>' +
      '<button class="terminal-btn" id="p8TabUpdates">[\u26a1] UPDATES</button>';
    view.insertBefore(tabs, wrap);

    var updates = document.createElement('div');
    updates.id = 'p8UpdatesPanel';
    updates.className = 'terminal-panel';
    updates.style.display = 'none';
    updates.innerHTML =
      '<div class="panel-header"><div class="panel-heading-title">SYSTEM UPDATES</div></div>' +
      '<div style="font-size:10.5px;color:#5c7a99;margin-bottom:6px;">Tariffs, subsidies, corruption, trade deals and tax law - same feed as the Economy tab.</div>' +
      '<div id="p8UpdatesList"></div>';
    view.appendChild(updates);

    $('p8TabDM').onclick = function () {
      wrap.style.display = '';
      updates.style.display = 'none';
      this.classList.add('active-nav');
      $('p8TabUpdates').classList.remove('active-nav');
    };
    $('p8TabUpdates').onclick = function () {
      wrap.style.display = 'none';
      updates.style.display = '';
      this.classList.add('active-nav');
      $('p8TabDM').classList.remove('active-nav');
      loadUpdatesFeed();
    };
  }

  async function loadUpdatesFeed() {
    var list = $('p8UpdatesList');
    if (!list) return;
    try {
      var d = await api('/api/game/politics');
      if (!d.success) return;
      list.innerHTML = d.log.length ? d.log.map(function (e) {
        return '<div class="p8-news-row"><span class="p8-time">[' + esc(e.time) + ']</span>' + esc(e.headline) + '</div>';
      }).join('') : '<div style="color:#5c7a99;font-size:11px;">No updates yet.</div>';
    } catch (e) {}
  }

  /* =====================================================================
   * Boot
   * ===================================================================== */
  var pollingStarted = false;
  function startPolling() {
    if (pollingStarted) return;
    pollingStarted = true;
    loadPolitics();
    loadRival();
    setInterval(loadPolitics, 12000);
    setInterval(loadRival, 15000);
    setInterval(watchCasino, 4000); // covers the casino view mounting after boot
  }

  function boot() {
    injectStyles();
    buildTaskbar();

    addView('politics', politicsView());
    addNavButton('politics', '[\u26a1] ECONOMY');
    addView('network', networkView());
    addNavButton('network', '[\u2694] NETWORK');

    setupMessagesUpdates();
    watchCasino();
    startPolling();

    var origSwitch = window.switchView;
    window.switchView = function (name) {
      origSwitch(name);
      if (name === 'politics') { loadPolitics(); loadRival(); loadBlackMarket(); }
      if (name === 'network') { wireNetworkForm(); loadHires(); }
      if (name === 'messages') { setupMessagesUpdates(); }
      if (name === 'casino') { setTimeout(watchCasino, 50); }
      updateTaskItems();
    };
  }

  window.addEventListener('astrax:ready', boot);
})();
