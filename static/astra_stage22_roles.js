/* ===========================================================================
 * astra_stage22_roles.js - Stage 22: life paths.
 *
 * Your role (from /api/role) decides three things:
 *   1. which apps are on your desktop        (.ws-role-hidden on nav buttons)
 *   2. how the desktop looks                 (body.role-<role> theme + watermark)
 *   3. which role-only apps exist for you    (GIGBOARD, HR PORTAL, BOARDROOM,
 *                                             UNDERWORLD; LIFE PATH is for all)
 *
 * Roles: unemployed | employee | boss | criminal | kingpin (criminal + boss).
 * Custody (jail) is a banner on top of any role, not a role.
 *
 * Same boot contract as every other stage: wait for astrax:ready, build views,
 * add nav buttons, call winosRescanApps(). All server text goes through esc().
 * Hiding is purely cosmetic; the server enforces every role rule itself.
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function api(url, opts) { return fetch(url, opts).then(function (r) { return r.json(); }).catch(function () { return { success: false, msg: 'Network error.' }; }); }
  function post(url, body) { return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); }
  function say(id, msg, ok) { var e = $(id); if (e) { e.textContent = msg || ''; e.style.color = ok ? '#39d353' : '#ff7b7b'; } }
  function open(id) { if (window.switchView) window.switchView(id); }

  /* ---- role profiles ---------------------------------------------------- */
  var ALWAYS = ['game', 'settings', 'profile', 'files', 'browser', 'appstore', 'messages', 'bank', 'calc', 'notes',
    'terminal', 'reader', 'news', 'lifepath', 'admin', 'adminplus'];
  var SOCIAL = ['blognet', 'streamtube', 'notespro', 'credits', 'politics', 'civics', 'coop'];
  var BOSS_APPS = ['business', 'employees', 'profit', 'funds', 'boardroom', 'staff', 'tasks', 'investors', 'clients',
    'dashboard', 'markets', 'stockdesk', 'network', 'exchange', 'coop', 'arbitrage', 'casino'];
  var CRIM_APPS = ['underworld', 'vpn', 'blabber', 'casino', 'arbitrage', 'exchange', 'coop', 'dashboard'];

  function union() {
    var out = [];
    Array.prototype.slice.call(arguments).forEach(function (a) { a.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); }); });
    return out;
  }

  var ROLES = {
    unemployed: {
      label: 'JOB SEEKER', mark: 'JOBLESS', accent: '#9db4d6', yellow: '#cfd8e3', hue: 'saturate(0.2)',
      wall: 'radial-gradient(ellipse at 50% 110%, rgba(157,180,214,.16), transparent 60%), #05070b',
      tag: 'No income, no boss. Take gigs, claim benefits, find a job.',
      apps: union(['career', 'gigboard', 'blabber', 'casino'], SOCIAL)
    },
    employee: {
      label: 'EMPLOYEE', mark: 'CORPORATE', accent: '#4aa3ff', yellow: '#ffbb00', hue: 'hue-rotate(30deg)',
      wall: 'linear-gradient(180deg, #08172a 0%, #030810 100%)',
      tag: 'A salary, a boss with moods, and shifts to work.',
      apps: union(['workdesk', 'hrportal', 'career', 'tasks', 'dashboard', 'markets', 'stockdesk', 'network', 'clients',
        'investors', 'exchange', 'coop', 'arbitrage', 'blabber', 'casino'], SOCIAL)
    },
    boss: {
      label: 'BOSS', mark: 'EXECUTIVE', accent: '#ffc83d', yellow: '#ffe08a', hue: 'hue-rotate(-135deg) saturate(1.4)',
      wall: 'radial-gradient(ellipse at 50% 0%, rgba(255,200,61,.14), transparent 55%), linear-gradient(180deg, #120d03, #050301)',
      tag: 'You own the company. Hire players, watch payroll, run the show.',
      apps: union(BOSS_APPS, ['blabber'], SOCIAL)
    },
    criminal: {
      label: 'CRIMINAL', mark: 'UNDERWORLD', accent: '#ff4d4d', yellow: '#ff9d5c', hue: 'hue-rotate(180deg) saturate(1.6)',
      wall: 'radial-gradient(ellipse at 50% 100%, rgba(255,40,40,.16), transparent 55%), #060102',
      tag: 'Off the books. Risk, heat, and a fixer on speed dial.',
      apps: union(CRIM_APPS, SOCIAL)
    },
    kingpin: {
      label: 'KINGPIN', mark: 'THE FIRM', accent: '#ff6a3d', yellow: '#ffc83d', hue: 'hue-rotate(160deg) saturate(1.5)',
      wall: 'radial-gradient(ellipse at 50% 0%, rgba(255,200,61,.10), transparent 50%), radial-gradient(ellipse at 50% 100%, rgba(255,40,40,.16), transparent 55%), #070203',
      tag: 'A legitimate company and an illegitimate one. Same books.',
      apps: union(BOSS_APPS, CRIM_APPS, SOCIAL)
    }
  };
  var ORDER = ['unemployed', 'employee', 'boss', 'criminal', 'kingpin'];
  var GATED = union.apply(null, ORDER.map(function (r) { return ROLES[r].apps; }));
  var ROLE_ONLY = { gigboard: ['unemployed'], hrportal: ['employee'], boardroom: ['boss', 'kingpin'], underworld: ['criminal', 'kingpin'] };

  var state = null, currentRole = null, jailLeft = 0, jailStamp = 0;

  /* ---- theme + gating ---------------------------------------------------- */
  function injectStyles() {
    if ($('astra22Styles')) return;
    var css = [
      '.a22-row{display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:6px 0;}',
      '.a22-box{border:1px solid var(--border-color); padding:6px 10px; min-width:110px; text-align:center; font-size:11px;}',
      '.a22-box b{display:block; font-size:15px; color:var(--pixel-yellow);}',
      '.a22-card{border:1px solid var(--border-color); padding:10px; flex:1; min-width:190px;}',
      '.a22-card.me{border-color:var(--pixel-cyan);}',
      '.a22-dim{color:#8a97ad; font-size:10.5px;}',
      '.a22-bar{height:8px; background:#000; border:1px solid var(--border-color);} .a22-bar i{display:block; height:100%; background:var(--pixel-cyan);}',
      '.a22-tbl{width:100%; border-collapse:collapse; font-size:11px;} .a22-tbl td,.a22-tbl th{border-bottom:1px solid var(--border-color); padding:5px 6px; text-align:left;}',
      '.ws-role-hidden{display:none !important;}',
      '#roleWatermark{position:absolute; right:26px; bottom:70px; font-size:clamp(34px,7vw,96px); letter-spacing:.18em; font-weight:700; color:var(--pixel-cyan); opacity:.07; pointer-events:none; user-select:none; z-index:1;}',
      '#roleBadge{cursor:pointer; margin-right:10px; padding:1px 8px; border:1px solid var(--pixel-cyan); color:var(--pixel-cyan); font-size:10.5px; letter-spacing:.08em;}',
      '#roleBadge:hover{background:var(--pixel-cyan); color:#000;}',
      '#roleCustody{position:fixed; top:0; left:0; right:0; z-index:100600; display:none; align-items:center; justify-content:center; gap:14px; padding:8px; color:#fff; font-size:12px;',
      '  background:repeating-linear-gradient(90deg,#1a0000 0 22px,#3a0000 22px 26px); border-bottom:2px solid #ff4d4d;}',
      'body.role-custody #winosWallpaper{filter:grayscale(.85) brightness(.7);}',
      '#a22Toast{position:fixed; top:16px; left:50%; transform:translateX(-50%); z-index:100700; padding:10px 18px; background:#000; border:1px solid var(--pixel-cyan); color:var(--pixel-cyan); display:none; letter-spacing:.08em;}'
    ];
    ORDER.forEach(function (r) {
      var p = ROLES[r];
      css.push('body.role-' + r + '{--pixel-cyan:' + p.accent + '; --pixel-yellow:' + p.yellow + ';}');
      css.push('body.role-' + r + ' #winosWallpaper{background:' + p.wall + ' !important;}');
      css.push('body.role-' + r + ' #winosWallpaper::before{filter:' + p.hue + ' drop-shadow(0 0 40px ' + p.accent + '55) !important;}');
    });
    var s = document.createElement('style'); s.id = 'astra22Styles'; s.textContent = css.join('\n');
    document.head.appendChild(s);
  }

  function toast(msg) {
    var t = $('a22Toast');
    if (!t) { t = document.createElement('div'); t.id = 'a22Toast'; document.body.appendChild(t); }
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.style.display = 'none'; }, 3500);
  }

  function applyGating(role) {
    var allowed = ROLES[role].apps;
    var nav = document.querySelector('.header-nav');
    if (!nav) return false;
    var changed = false;
    Array.prototype.slice.call(nav.querySelectorAll('.terminal-btn[id^="nav-"]')).forEach(function (btn) {
      var id = btn.id.replace('nav-', '');
      var hide = false;
      if (ROLE_ONLY[id]) hide = ROLE_ONLY[id].indexOf(role) < 0;
      else if (ALWAYS.indexOf(id) < 0 && GATED.indexOf(id) >= 0) hide = allowed.indexOf(id) < 0;
      if (btn.classList.contains('ws-role-hidden') !== hide) changed = true;
      btn.classList.toggle('ws-role-hidden', hide);
    });
    return changed;
  }

  function applyRole(role, announce) {
    var p = ROLES[role]; if (!p) return;
    var changedRole = role !== currentRole;
    ORDER.forEach(function (r) { document.body.classList.remove('role-' + r); });
    document.body.classList.add('role-' + role);
    var wall = $('winosWallpaper');
    if (wall) {
      var w = $('roleWatermark');
      if (!w) { w = document.createElement('div'); w.id = 'roleWatermark'; wall.appendChild(w); }
      w.textContent = p.mark;
    }
    var tray = $('winosTray');
    if (tray) {
      var b = $('roleBadge');
      if (!b) {
        b = document.createElement('span'); b.id = 'roleBadge'; b.title = 'Open LIFE PATH';
        b.onclick = function () { open('lifepath'); };
        tray.insertBefore(b, tray.firstChild);
      }
      b.textContent = '\u25C6 ' + p.label;
    }
    currentRole = role;
    if (applyGating(role) || changedRole) { if (window.winosRescanApps) window.winosRescanApps(); }
    if (changedRole && announce) toast('NEW LIFE PATH: ' + p.label);
  }

  /* ---- custody banner ---------------------------------------------------- */
  function renderCustody() {
    var bar = $('roleCustody');
    if (!bar) { bar = document.createElement('div'); bar.id = 'roleCustody'; document.body.appendChild(bar); }
    var left = Math.max(0, jailLeft - Math.floor((Date.now() - jailStamp) / 1000));
    document.body.classList.toggle('role-custody', left > 0);
    if (left <= 0) { bar.style.display = 'none'; return; }
    var m = Math.floor(left / 60), s = left % 60;
    bar.style.display = 'flex';
    bar.innerHTML = '<b>IN CUSTODY</b><span>' + esc((state && state.jail_reason) || '') + '</span><span>release in ' + m + ':' + (s < 10 ? '0' : '') + s +
      '</span><button class="terminal-btn" id="roleBailBtn">PAY BAIL</button>';
    var btn = $('roleBailBtn');
    if (btn) btn.onclick = function () {
      post('/api/world/bail').then(function (d) { toast(d.msg || (d.success ? 'Free.' : 'Failed.')); refresh(); });
    };
  }

  /* ---- role apps --------------------------------------------------------- */
  function addNavButton(id, label) {
    var nav = document.querySelector('.header-nav');
    if (!nav || $('nav-' + id)) return;
    var b = document.createElement('button');
    b.className = 'terminal-btn ws-role-hidden'; b.id = 'nav-' + id; b.textContent = label;
    b.onclick = function () { window.switchView(id); };
    var s = $('nav-settings');
    if (s) nav.insertBefore(b, s); else nav.appendChild(b);
  }
  function addView(id, html) {
    if ($('view-' + id)) return;
    var host = $('view-dashboard'), wrap = (host && host.parentNode) || $('mainAppWrapper');
    if (!host || !wrap) return;
    var v = document.createElement('div');
    v.id = 'view-' + id; v.className = 'app-view'; v.innerHTML = html;
    wrap.insertBefore(v, host);
  }
  function panel(title, inner) {
    return '<div class="terminal-panel"><div class="panel-header"><div class="panel-heading-title">' + title + '</div></div>' + inner + '</div>';
  }
  function active(id) { var v = $('view-' + id); return v && v.classList.contains('active-view'); }
  function cd(sec) { sec = Math.max(0, sec | 0); return sec >= 60 ? Math.ceil(sec / 60) + 'm' : sec + 's'; }

  // LIFE PATH (everyone)
  function renderLifepath() {
    var el = $('a22LifeBody'); if (!el || !state) return;
    var me = ROLES[state.role];
    var cards = ORDER.map(function (r) {
      var p = ROLES[r];
      return '<div class="a22-card' + (r === state.role ? ' me' : '') + '" style="border-color:' + (r === state.role ? p.accent : '') + '">' +
        '<b style="color:' + p.accent + '">' + p.label + '</b>' + (r === state.role ? ' <span class="a22-dim">(you)</span>' : '') +
        '<div class="a22-dim" style="margin:4px 0;">' + esc(p.tag) + '</div></div>';
    }).join('');
    var how = {
      unemployed: 'Find a job in CAREER or found a company in BUSINESS to change path.',
      employee: 'Start your own company to become a boss.',
      boss: 'Go underground to become a kingpin.',
      criminal: 'Get a job or found a company to run a front.',
      kingpin: 'You have it all. Watch the heat.'
    }[state.role];
    el.innerHTML =
      '<div class="a22-row"><div class="a22-box">ROLE<b style="color:' + me.accent + '">' + me.label + '</b></div>' +
      '<div class="a22-box">JOB<b>' + esc(state.job_status === 'unemployed' ? 'none' : (state.job_title || state.job_status)) + '</b></div>' +
      '<div class="a22-box">HEAT<b>' + state.wanted.toFixed(1) + '</b></div>' +
      '<div class="a22-box">REGIME<b style="font-size:12px">' + esc(state.regime_label) + '</b></div></div>' +
      '<div class="a22-dim" style="margin:6px 0;">' + esc(how) + '</div>' +
      '<div class="a22-row">' + cards + '</div>' +
      '<div class="a22-row">' + (state.underworld
        ? '<button class="terminal-btn" onclick="AstraRoles.path(\'legit\')">[\u2713] LEAVE THE LIFE</button><span class="a22-dim">Needs heat below 2.</span>'
        : '<button class="terminal-btn" onclick="AstraRoles.path(\'underworld\')">[\u2620] GO UNDERGROUND</button><span class="a22-dim">Unlocks UNDERWORLD and hides the legit apps that do not fit.</span>') +
      '</div><div id="a22LifeMsg" class="a22-dim"></div>';
  }

  // GIGBOARD (unemployed)
  function renderGig() {
    var el = $('a22GigBody'); if (!el || !state) return;
    var c = state.cooldowns;
    var rows = Object.keys(state.gigs).map(function (k) {
      var g = state.gigs[k];
      return '<tr><td>' + esc(g.label) + '<div class="a22-dim">' + esc(g.note) + '</div></td><td>' + money(g.pay[0]) + ' - ' + money(g.pay[1]) +
        '</td><td><button class="terminal-btn" onclick="AstraRoles.gig(\'' + k + '\')">DO GIG</button></td></tr>';
    }).join('');
    el.innerHTML =
      '<div class="a22-row"><div class="a22-box">GIGS DONE<b>' + state.gigs_done + '</b></div>' +
      '<div class="a22-box">BALANCE<b>' + money(state.balance) + '</b></div>' +
      '<div class="a22-box">NEXT GIG<b>' + (c.gig ? cd(c.gig) : 'ready') + '</b></div></div>' +
      '<table class="a22-tbl"><tr><th>GIG</th><th>PAY</th><th></th></tr>' + rows + '</table>' +
      '<div class="a22-row"><button class="terminal-btn" onclick="AstraRoles.benefit()"' + (c.benefit ? ' disabled' : '') + '>CLAIM BENEFIT</button>' +
      '<span class="a22-dim">' + (c.benefit ? 'next in ' + cd(c.benefit) : 'Amount depends on the regime (' + esc(state.regime_label) + ').') + '</span>' +
      '<button class="terminal-btn" onclick="window.switchView(\'career\')">FIND A REAL JOB \u2192</button></div>' +
      '<div id="a22GigMsg" class="a22-dim"></div>';
  }

  // HR PORTAL (employee)
  function renderHr() {
    var el = $('a22HrBody'); if (!el || !state) return;
    var mood = Math.max(0, Math.min(100, state.boss_mood));
    var canAsk = state.job_status === 'employed';
    el.innerHTML =
      '<div class="a22-row"><div class="a22-box">TITLE<b style="font-size:12px">' + esc(state.job_title) + '</b></div>' +
      '<div class="a22-box">EMPLOYER<b style="font-size:12px">' + esc(state.company || 'n/a') + '</b></div>' +
      '<div class="a22-box">SALARY<b>' + money(state.salary) + '</b></div></div>' +
      '<div class="a22-dim">BOSS MOOD ' + mood + '/100</div><div class="a22-bar"><i style="width:' + mood + '%"></i></div>' +
      '<div class="a22-row"><button class="terminal-btn" onclick="AstraRoles.raise()"' + (state.cooldowns.raise_ || !canAsk ? ' disabled' : '') + '>REQUEST A RAISE</button>' +
      '<span class="a22-dim">' + (!canAsk ? 'Player-run companies set pay themselves.' : state.cooldowns.raise_ ? 'again in ' + cd(state.cooldowns.raise_) : 'Odds rise with boss mood. A denial costs you 10 mood.') + '</span>' +
      '<button class="terminal-btn" onclick="window.switchView(\'workdesk\')">OPEN WORK DESK \u2192</button></div>' +
      '<div id="a22HrMsg" class="a22-dim"></div>';
  }

  // BOARDROOM (boss, kingpin)
  function renderBoard() {
    var el = $('a22BoardBody'); if (!el) return;
    api('/api/role/boardroom').then(function (d) {
      if (!d.success) { el.textContent = d.msg || 'Unavailable.'; return; }
      var staff = d.staff.length ? d.staff.map(function (s) { return '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.title) + '</td><td>' + money(s.salary) + '</td></tr>'; }).join('')
        : '<tr><td colspan="3" class="a22-dim">No player staff yet.</td></tr>';
      var racket = state && state.role === 'kingpin'
        ? '<button class="terminal-btn" onclick="AstraRoles.racket()"' + (d.racket_left ? ' disabled' : '') + '>[\u2620] COLLECT TRIBUTE</button><span class="a22-dim">' + (d.racket_left ? 'again in ' + cd(d.racket_left) : 'Pays per head on payroll. Adds heat.') + '</span>' : '';
      el.innerHTML =
        '<div class="a22-row"><div class="a22-box">CASH<b>' + money(d.cash) + '</b></div><div class="a22-box">DAILY PROFIT<b>' + money(d.daily_profit) + '</b></div>' +
        '<div class="a22-box">PAYROLL<b>' + money(d.payroll) + '</b></div><div class="a22-box">HIRING<b>' + (d.hiring_open ? esc(d.hiring_role) : 'closed') + '</b></div></div>' +
        '<table class="a22-tbl"><tr><th>STAFF</th><th>TITLE</th><th>SALARY</th></tr>' + staff + '</table>' +
        '<div class="a22-row"><button class="terminal-btn" onclick="window.switchView(\'business\')">BUSINESS</button>' +
        '<button class="terminal-btn" onclick="window.switchView(\'employees\')">STAFF</button>' +
        '<button class="terminal-btn" onclick="window.switchView(\'profit\')">PROFIT REPORT</button>' + racket + '</div>' +
        '<div id="a22BoardMsg" class="a22-dim"></div>';
    });
  }

  // UNDERWORLD (criminal, kingpin)
  function renderUnder() {
    var el = $('a22UnderBody'); if (!el || !state) return;
    var heat = Math.min(10, state.wanted);
    var rows = Object.keys(state.crimes).map(function (k) {
      var c = state.crimes[k];
      return '<tr><td>' + esc(c.label) + '</td><td>' + money(c.reward[0]) + ' - ' + money(c.reward[1]) + '</td><td>' + Math.round(c.catch * 100) + '%+</td><td>' +
        (c.jail_min ? c.jail_min + 'm' : '-') + '</td><td><button class="terminal-btn" onclick="AstraRoles.crime(\'' + k + '\')"' + (state.jailed ? ' disabled' : '') + '>RUN</button></td></tr>';
    }).join('');
    var hist = state.offenses.length ? state.offenses.map(function (o) {
      return '<div class="a22-dim">' + esc(o.at) + ' &middot; ' + esc(o.crime) + ' &middot; ' + esc(o.outcome) + ' &middot; ' + money(o.amount) + '</div>';
    }).join('') : '<div class="a22-dim">Clean sheet.</div>';
    el.innerHTML =
      '<div class="a22-row"><div class="a22-box">HEAT<b>' + state.wanted.toFixed(1) + '</b></div><div class="a22-box">CONVICTIONS<b>' + state.convictions + '</b></div>' +
      '<div class="a22-box">CASH<b>' + money(state.balance) + '</b></div></div>' +
      '<div class="a22-bar"><i style="width:' + (heat * 10) + '%"></i></div>' +
      '<div class="a22-dim" style="margin:4px 0;">Catch odds shown are the base rate. ' + esc(state.regime_label) + ' policing and your heat raise them.</div>' +
      '<table class="a22-tbl"><tr><th>JOB</th><th>LOOT</th><th>CATCH</th><th>SENTENCE</th><th></th></tr>' + rows + '</table>' +
      '<div class="a22-row"><button class="terminal-btn" onclick="AstraRoles.fixer()">PAY THE FIXER</button>' +
      '<span class="a22-dim">Buys heat down' + (state.role === 'kingpin' ? ' (half price for a kingpin)' : '') + '.</span></div>' +
      '<div id="a22UnderMsg" class="a22-dim"></div>' +
      '<div style="margin-top:8px;">' + hist + '</div>';
  }

  function buildApps() {
    addNavButton('lifepath', 'LIFE PATH');
    addNavButton('gigboard', 'GIGBOARD');
    addNavButton('hrportal', 'HR PORTAL');
    addNavButton('boardroom', 'BOARDROOM');
    addNavButton('underworld', 'UNDERWORLD');
    addView('lifepath', panel('LIFE PATH', '<div id="a22LifeBody">Loading...</div>'));
    addView('gigboard', panel('GIGBOARD &mdash; ODD JOBS &amp; BENEFITS', '<div id="a22GigBody">Loading...</div>'));
    addView('hrportal', panel('HR PORTAL', '<div id="a22HrBody">Loading...</div>'));
    addView('boardroom', panel('BOARDROOM', '<div id="a22BoardBody">Loading...</div>'));
    addView('underworld', panel('UNDERWORLD', '<div id="a22UnderBody">Loading...</div>'));
  }

  function renderActive() {
    if (active('lifepath')) renderLifepath();
    if (active('gigboard')) renderGig();
    if (active('hrportal')) renderHr();
    if (active('boardroom')) renderBoard();
    if (active('underworld')) renderUnder();
  }

  function refresh() {
    return api('/api/role').then(function (d) {
      if (!d || !d.success) return;
      state = d; jailLeft = d.jail_seconds_left || 0; jailStamp = Date.now();
      applyRole(d.role, currentRole !== null);
      renderCustody();
      renderActive();
    });
  }

  function act(url, body, msgId) {
    return post(url, body).then(function (d) {
      say(msgId, d.msg || (d.success ? 'Done.' : 'Failed.'), d.success);
      return refresh().then(function () { say(msgId, d.msg || '', d.success); return d; });
    });
  }

  window.AstraRoles = {
    refresh: refresh,
    path: function (choice) { act('/api/role/path', { choice: choice }, 'a22LifeMsg'); },
    gig: function (g) { act('/api/role/gig', { gig: g }, 'a22GigMsg'); },
    benefit: function () { act('/api/role/benefit', {}, 'a22GigMsg'); },
    raise: function () { act('/api/role/raise', {}, 'a22HrMsg'); },
    crime: function (c) { act('/api/world/crime', { crime: c }, 'a22UnderMsg'); },
    fixer: function () { act('/api/role/fixer', {}, 'a22UnderMsg'); },
    racket: function () { post('/api/role/racket', {}).then(function (d) { refresh().then(function () { say('a22BoardMsg', d.msg, d.success); }); }); },
    role: function () { return currentRole; }
  };

  window.addEventListener('astrax:ready', function () {
    injectStyles();
    var tries = 0;
    (function boot() {
      buildApps();
      if ($('winosTray') && $('nav-lifepath')) { refresh(); return; }
      if (++tries < 60) setTimeout(boot, 250);
    })();
    setInterval(function () { if (!document.hidden) refresh(); }, 8000);
    setInterval(function () { if (jailLeft > 0) renderCustody(); }, 1000);
    // Gating races other stage files that add nav buttons late; re-apply for a while.
    var t = 0, iv = setInterval(function () {
      if (currentRole && applyGating(currentRole) && window.winosRescanApps) window.winosRescanApps();
      if (++t > 45) clearInterval(iv);
    }, 400);
  });
})();
