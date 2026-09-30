/* ===========================================================================
 * astra_stage15_browser.js - Stage 15.
 *
 * The BROWSER app: the one place an operator can search for a job ("job",
 * "hiring", "career", "work") and land on JobBoardNet (a thin skin over the
 * real /api/game/jobs feed and the real applyToJob() - no duplicate apply
 * logic, it just calls the same function CAREER's own list does), or search
 * for software ("app", "store", "install", "download", or any app's name)
 * and land on the OMNI APP STORE, backed by astra_stage14_appstore.js's
 * install bookkeeping.
 *
 * Also the requested risk: any install-flavoured search returns one too-
 * good-to-be-true decoy result alongside the real store link. Clicking the
 * decoy hits POST /api/game/browser/scam (app.py) and takes a real cut of
 * the player's real balance - it isn't a fake loss shown only in the
 * browser, the save actually changes, same as any other in-fiction risk
 * this codebase already prices in real money.
 *
 * SYSTEM app - astra_stage14_appstore.js's SYSTEM_APPS already includes
 * 'browser', so this always ships pre-installed; nothing else could ever
 * be installed otherwise.
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
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

  var SCAM_HOSTS = ['freeappzhub.ru', 'getitnow.top', 'appwarez.cc', 'totally-legit-downloads.xyz'];
  function scamHost() { return SCAM_HOSTS[Math.floor(Math.random() * SCAM_HOSTS.length)]; }

  function viewHtml() {
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">OMNI-BROWSER</div></div>' +
        '<div style="display:flex; gap:6px;">' +
          '<input type="text" id="browserAddrInput" placeholder="Search for a job, an app, or type a site..." ' +
          'style="flex-grow:1; background:#000; border:1px solid var(--border-color); color:#fff; padding:8px; font-family:var(--font-current); font-size:12px;" ' +
          'onkeydown="if(event.key===\'Enter\') AstraBrowser.go()">' +
          '<button class="terminal-btn btn-action" onclick="AstraBrowser.go()">GO</button>' +
          '<button class="terminal-btn" onclick="AstraBrowser.home()">HOME</button>' +
        '</div>' +
      '</div>' +
      '<div id="browserPage" class="terminal-panel" style="min-height:260px;"></div>';
  }

  function homePage() {
    return '' +
      '<div style="color:var(--pixel-cyan); margin-bottom:10px;">BOOKMARKS</div>' +
      '<div style="display:flex; flex-direction:column; gap:8px;">' +
        '<div class="d-list-item" style="cursor:pointer;" onclick="AstraBrowser.openJobBoard()">' +
          '<div><b style="color:var(--pixel-yellow);">JobBoardNet</b>' +
          '<div style="font-size:10px; color:#aaa;">jobboard.net &middot; find work, including at real operator-run companies</div></div>' +
          '<span class="terminal-btn">OPEN</span></div>' +
        '<div class="d-list-item" style="cursor:pointer;" onclick="AstraBrowser.openStore()">' +
          '<div><b style="color:var(--pixel-yellow);">OMNI App Store</b>' +
          '<div style="font-size:10px; color:#aaa;">omniapps.store &middot; download more software for your desktop</div></div>' +
          '<span class="terminal-btn">OPEN</span></div>' +
        '<div class="d-list-item" style="cursor:pointer;" onclick="AstraBrowser.openBlognet()">' +
          '<div><b style="color:var(--pixel-yellow);">BlogNet</b>' +
          '<div style="font-size:10px; color:#aaa;">blognet.feed &middot; news, takes, and the odd real lead - install required to read past the fold</div></div>' +
          '<span class="terminal-btn">OPEN</span></div>' +
      '</div>' +
      '<div style="font-size:10px; color:#556b85; margin-top:14px;">Try searching "job", "hiring", "apps", or an app\'s name above.</div>';
  }

  function jobBoardPage() {
    var host = $('browserPage');
    host.innerHTML =
      '<div class="panel-header"><div class="panel-heading-title">JOBBOARDNET</div></div>' +
      '<div id="browserJobList" style="display:flex; flex-direction:column; gap:8px;">Loading listings...</div>';
    loadJobBoard();
  }

  async function loadJobBoard() {
    var box = $('browserJobList');
    if (!box) return;
    try {
      var res = await fetch('/api/game/jobs');
      var data = await res.json();
      if (!data.success || !data.jobs || !data.jobs.length) {
        box.innerHTML = '<div style="color:#888;">No listings right now. Check back later.</div>';
        return;
      }
      var sorted = data.jobs.slice().sort(function (a, b) { return (b.player_company ? 1 : 0) - (a.player_company ? 1 : 0); });
      box.innerHTML = sorted.map(function (j) {
        var badge = j.player_company
          ? ' <span style="font-size:9px; color:var(--pixel-cyan); border:1px solid var(--pixel-cyan); padding:1px 4px; margin-left:4px;">PLAYER-OWNED &middot; ' + esc(j.founder) + '</span>'
          : '';
        return '<div class="d-list-item">' +
          '<div><div style="color:var(--pixel-yellow);">' + esc(j.name) + badge + '</div>' +
          '<div style="font-size:10px; color:#aaa;">Salary: $' + j.salary.toLocaleString() + '/wk | Target: $' + j.target.toLocaleString() + '/wk</div>' +
          '<div style="font-size:9.5px; color:#888;">' + esc(j.blurb) + '</div></div>' +
          '<button class="terminal-btn" onclick="applyToJob(\'' + j.id + '\'); if(window.switchView) window.switchView(\'career\');">APPLY</button></div>';
      }).join('');
    } catch (e) {
      box.innerHTML = '<div style="color:var(--pixel-red);">Connection failed.</div>';
    }
  }

  function storePage() {
    // Stage 17 built a real dedicated store app (categories, search, a
    // download->extract->run pipeline through FILES). If it's on the
    // desktop, that's the canonical store now - this inline list stays only
    // as a fallback for builds that don't have Stage 17 loaded.
    if ($('view-appstore') && window.switchView) { window.switchView('appstore'); return; }
    var host = $('browserPage');
    var store = window.AstraAppStore;
    if (!store) { host.innerHTML = '<div style="color:#888;">Store unavailable right now.</div>'; return; }
    var catalog = store.catalog();
    var locked = catalog.filter(function (e) { return !store.isInstalled(e.id); });
    var owned = catalog.filter(function (e) { return store.isInstalled(e.id); });
    host.innerHTML =
      '<div class="panel-header"><div class="panel-heading-title">OMNI APP STORE</div></div>' +
      '<div style="display:flex; flex-direction:column; gap:8px;">' +
        locked.map(function (e) {
          return '<div class="d-list-item">' +
            '<div><b style="color:var(--pixel-yellow);">' + esc(e.name) + '</b>' +
            '<div style="font-size:10px; color:#aaa;">' + esc(e.blurb) + '</div></div>' +
            '<button class="terminal-btn btn-start" onclick="AstraBrowser.install(\'' + e.id + '\')">[+] INSTALL</button></div>';
        }).join('') +
      '</div>' +
      (owned.length ? (
        '<div style="font-size:10px; color:#556b85; margin:14px 0 6px;">ALREADY INSTALLED</div>' +
        '<div style="display:flex; flex-wrap:wrap; gap:6px;">' +
          owned.map(function (e) { return '<span class="terminal-btn" style="cursor:default; opacity:.6;">' + esc(e.name) + '</span>'; }).join('') +
        '</div>'
      ) : '');
  }

  function resultsPage(query, results) {
    var host = $('browserPage');
    host.innerHTML =
      '<div class="panel-header"><div class="panel-heading-title">SEARCH RESULTS &mdash; "' + esc(query) + '"</div></div>' +
      '<div style="display:flex; flex-direction:column; gap:10px;">' +
        results.map(function (r) {
          if (r.kind === 'scam') {
            return '<div class="d-list-item" style="border-color:var(--pixel-red); cursor:pointer;" onclick="AstraBrowser.hitScam(this)">' +
              '<div><b style="color:var(--pixel-red);">' + esc(r.title) + '</b>' +
              '<div style="font-size:10px; color:var(--pixel-green);">' + esc(r.url) + '</div>' +
              '<div style="font-size:9.5px; color:#888;">' + esc(r.desc) + '</div></div>' +
              '<span class="terminal-btn btn-warning">DOWNLOAD</span></div>';
          }
          var onclick = r.kind === 'job' ? 'AstraBrowser.openJobBoard()' : 'AstraBrowser.openStore()';
          return '<div class="d-list-item" style="cursor:pointer;" onclick="' + onclick + '">' +
            '<div><b style="color:var(--pixel-yellow);">' + esc(r.title) + '</b>' +
            '<div style="font-size:10px; color:var(--pixel-green);">' + esc(r.url) + '</div>' +
            '<div style="font-size:9.5px; color:#888;">' + esc(r.desc) + '</div></div>' +
            '<span class="terminal-btn">OPEN</span></div>';
        }).join('') +
      '</div>';
  }

  function search(query) {
    var q = (query || '').toLowerCase().trim();
    if (!q) { home(); return; }
    var results = [];
    var wantsJob = /(job|hiring|hire|career|work|employ)/.test(q);
    var store = window.AstraAppStore;
    var catalog = store ? store.catalog() : [];
    var matchedApp = catalog.filter(function (e) {
      return e.id.indexOf(q) !== -1 || e.name.toLowerCase().indexOf(q) !== -1;
    })[0];
    var wantsStore = /(app|store|install|download|software|free|crack|hack)/.test(q) || !!matchedApp;

    if (wantsJob) {
      results.push({ kind: 'job', title: 'JobBoardNet \u2014 Open Positions Near You', url: 'jobboard.net',
        desc: 'Browse real openings, including roles at other operators\u2019 own companies.' });
    }
    if (wantsStore) {
      var appName = matchedApp ? matchedApp.name : 'Software';
      results.push({ kind: 'store', title: 'OMNI App Store \u2014 ' + appName, url: 'omniapps.store',
        desc: 'The official listing. One click, no catch.' });
      results.push({ kind: 'scam', title: 'GET ' + appName.toUpperCase() + ' FREE \u2014 CRACKED, NO SIGN-UP!!!', url: scamHost(),
        desc: 'Instant download, 100% safe, trusted by nobody in particular.' });
    }
    if (!results.length) {
      results.push({ kind: 'store', title: 'No results for "' + query + '"', url: '',
        desc: 'Try "job", "hiring", "apps", "store", or an app\'s name.' });
    }
    resultsPage(query, results);
  }

  async function hitScam(el) {
    if (el) { el.style.opacity = '.5'; el.style.pointerEvents = 'none'; }
    try {
      var res = await fetch('/api/game/browser/scam', { method: 'POST' });
      var data = await res.json();
      var host = $('browserPage');
      if (!host) return;
      if (data.success) {
        host.innerHTML =
          '<div class="panel-header"><div class="panel-heading-title" style="color:var(--pixel-red);">YOU'
          + '\u2019VE BEEN SCAMMED</div></div>' +
          '<div style="color:#fff; font-size:12px; line-height:1.6;">That "free download" was never an app. ' +
          'It took <b style="color:var(--pixel-red);">$' + data.loss.toLocaleString() + '</b> straight out of your account.' +
          '<br><br>Balance now: <b style="color:var(--pixel-green);">$' + data.balance.toLocaleString() + '</b></div>' +
          '<button class="terminal-btn" style="margin-top:12px;" onclick="AstraBrowser.home()">BACK TO HOME</button>';
      } else {
        host.innerHTML = '<div style="color:#888;">' + esc(data.msg || 'Nothing happened.') + '</div>' +
          '<button class="terminal-btn" style="margin-top:12px;" onclick="AstraBrowser.home()">BACK TO HOME</button>';
      }
    } catch (e) { /* offline - no consequence, no reward */ }
  }

  function home() {
    var host = $('browserPage');
    if (host) host.innerHTML = homePage();
    var addr = $('browserAddrInput');
    if (addr) addr.value = '';
  }

  function go() {
    var addr = $('browserAddrInput');
    search(addr ? addr.value : '');
  }

  function openBlognet() {
    var store = window.AstraAppStore;
    if (store && store.isInstalled('blognet') && window.switchView) { window.switchView('blognet'); return; }
    var host = $('browserPage');
    if (!host) return;
    host.innerHTML =
      '<div class="panel-header"><div class="panel-heading-title">BLOGNET</div></div>' +
      '<div style="color:#888; font-size:11px; line-height:1.6;">This site needs the BlogNet reader installed to load past the ' +
      'headline. <button class="terminal-btn btn-action" style="margin-left:6px;" onclick="AstraBrowser.openStore()">GET BLOGNET</button></div>';
  }

  window.AstraBrowser = {
    go: go,
    home: home,
    openJobBoard: jobBoardPage,
    openStore: storePage,
    openBlognet: openBlognet,
    install: function (id) { if (window.AstraAppStore) window.AstraAppStore.install(id); storePage(); },
    hitScam: hitScam
  };

  var done = false;
  function build() {
    if (done) return;
    var host = $('view-dashboard');
    var wrapper = (host && host.parentNode) || $('mainAppWrapper');
    if (!host || !wrapper) return;
    var view = document.createElement('div');
    view.id = 'view-browser';
    view.className = 'app-view';
    view.innerHTML = viewHtml();
    wrapper.insertBefore(view, host);
    addNavButton('browser', '[\u25C9] BROWSER');
    home();
    done = true;
    if (window.winosRescanApps) window.winosRescanApps();
  }

  function waitAndRun(triesLeft) {
    if (document.querySelector('.header-nav') || triesLeft <= 0) { build(); return; }
    setTimeout(function () { waitAndRun(triesLeft - 1); }, 150);
  }

  window.addEventListener('astrax:ready', function () { waitAndRun(40); });
  setTimeout(function () { waitAndRun(1); }, 8500);
})();
