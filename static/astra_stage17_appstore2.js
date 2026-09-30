/* ===========================================================================
 * astra_stage17_appstore2.js - Stage 17.
 *
 * Three things, all riding the same astrax:ready contract every other stage
 * file uses:
 *
 * 1) A real OMNI APP STORE app (nav-appstore / view-appstore) - browsable by
 *    category, searchable, replacing the flat "click INSTALL, done" list
 *    astra_stage15_browser.js used to render inline (that file now redirects
 *    here once it sees view-appstore exists; see the edit at the top of its
 *    storePage()).
 *
 * 2) A real install pipeline behind the GET button: download (a progress bar
 *    that takes longer for a bigger fictional sizeMB, sitting in FILES >
 *    DOWNLOADS the whole time) -> a .zip file you have to EXTRACT -> a folder
 *    holding a setup.exe you have to open and RUN -> only then does
 *    astra_stage14_appstore.js's install() actually flip the app's lock, the
 *    same moment a real installer would finish. Astra_stage16_files.js's
 *    pushDownload/updateDownload/removeDownload registry (added this stage)
 *    is what lets this file put real, clickable, stateful entries in a
 *    different app's window without either file knowing the other's internals
 *    beyond that one registry.
 *
 * 3) The two apps this store can actually unlock that didn't exist before:
 *    STREAMTUBE (view-streamtube) and BLOGNET (view-blognet). Both are ordinary
 *    content apps, not stubs - astra_stage14_appstore.js's own comment rule
 *    ("listed in the catalog is not the same as wired up") is satisfied by
 *    this file actually building both views.
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
  function addView(id, html) {
    if ($('view-' + id)) return $('view-' + id);
    var host = $('view-dashboard');
    var wrapper = (host && host.parentNode) || $('mainAppWrapper');
    if (!host || !wrapper) return null;
    var view = document.createElement('div');
    view.id = 'view-' + id;
    view.className = 'app-view';
    view.innerHTML = html;
    wrapper.insertBefore(view, host);
    return view;
  }

  function injectStyles() {
    if ($('astra17Styles')) return;
    var css = document.createElement('style');
    css.id = 'astra17Styles';
    css.textContent = [
      '.a17-toast{position:fixed; right:16px; bottom:56px; z-index:99999; background:var(--panel-bg,#001510);',
      'border:1px solid var(--pixel-cyan); color:var(--pixel-cyan); padding:10px 14px; font-size:11px;',
      'font-family:var(--font-current); max-width:260px; box-shadow:0 0 20px rgba(0,255,204,.25); opacity:0; transform:translateY(8px);',
      'transition:opacity .25s, transform .25s;}',
      '.a17-toast.show{opacity:1; transform:translateY(0);}',
      '.a17-card{border:1px solid var(--border-color); padding:10px; display:flex; flex-direction:column; gap:6px;}',
      '.a17-card-top{display:flex; justify-content:space-between; align-items:flex-start; gap:8px;}',
      '.a17-badge{font-size:9px; letter-spacing:.5px; padding:1px 5px; border:1px solid var(--border-color); color:#9aa7c7; white-space:nowrap;}',
      '.a17-cat-tab{cursor:pointer;}',
      '.a17-cat-tab.active-nav{color:var(--pixel-cyan); border-color:var(--pixel-cyan);}',
      '.a17-grid{display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:10px;}',
      '.a17-thumb{height:84px; border-radius:2px; display:flex; align-items:center; justify-content:center; font-size:26px;',
      'background:linear-gradient(135deg, #0a2230, #071018); border:1px solid var(--border-color); position:relative;}',
      '.a17-thumb .a17-dur{position:absolute; right:4px; bottom:4px; font-size:9px; background:rgba(0,0,0,.7); padding:1px 4px;}',
      '.a17-vid-grid{display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:12px;}'
    ].join('');
    document.head.appendChild(css);
  }

  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'a17-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 300);
    }, 3400);
  }

  /* =======================================================================
   * APP STORE
   * ===================================================================== */
  var CATS = [
    { id: 'all', label: 'ALL' },
    { id: 'finance', label: 'FINANCE' },
    { id: 'office', label: 'OFFICE' },
    { id: 'social', label: 'SOCIAL' },
    { id: 'entertainment', label: 'ENTERTAINMENT' },
    { id: 'utility', label: 'UTILITY' },
    { id: 'security', label: 'SECURITY' }
  ];

  var currentCat = 'all';
  var currentQuery = '';
  // appId -> 'idle' | 'downloading' | 'zip' | 'extracting' | 'folder' | 'installing' | 'installed'
  var pipeline = {};
  // Stage 19: whether the player currently has a job/business, refreshed
  // periodically from /api/game/state. Gates any catalog entry whose
  // `requires` field (set in astra_stage14_appstore.js) is 'employed'.
  var playerEmployed = false;
  function refreshEmploymentGate() {
    return fetch('/api/game/state').then(function (r) { return r.json(); }).then(function (d) {
      var next = !!(d && d.job_status && d.job_status !== 'unemployed');
      if (next !== playerEmployed) { playerEmployed = next; renderGrid(); }
    }).catch(function () { /* offline - leave last-known gate state */ });
  }

  function stateFor(id, store) {
    if (store.isInstalled(id)) return 'installed';
    return pipeline[id] || 'idle';
  }

  function storeViewHtml() {
    var tabs = CATS.map(function (c) {
      return '<button class="terminal-btn a17-cat-tab" id="a17cat-' + c.id + '" onclick="AstraStore2.setCat(\'' + c.id + '\')">' + c.label + '</button>';
    }).join('');
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">OMNI APP STORE</div>' +
        '<span style="font-size:10px; color:#5c7a99;">Downloads land in FILES &middot; DOWNLOADS</span></div>' +
        '<input type="text" id="a17Search" placeholder="Search the store..." ' +
          'style="width:100%; background:#000; border:1px solid var(--border-color); color:#fff; padding:8px; font-family:var(--font-current); font-size:12px; margin-bottom:10px;" ' +
          'oninput="AstraStore2.setQuery(this.value)">' +
        '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">' + tabs + '</div>' +
        '<div id="a17Grid" class="a17-grid"></div>' +
      '</div>';
  }

  function cardHtml(entry, store) {
    var state = stateFor(entry.id, store);
    var catLabel = (CATS.filter(function (c) { return c.id === entry.category; })[0] || {}).label || entry.category;
    var locked = entry.requires === 'employed' && !playerEmployed && state !== 'installed';
    var actionHtml;
    if (locked) {
      actionHtml = '<span class="terminal-btn" style="opacity:.45; cursor:default;">\uD83D\uDD12 LOCKED</span>';
    } else if (state === 'installed') {
      actionHtml = '<button class="terminal-btn" onclick="AstraStore2.openApp(\'' + entry.id + '\')">OPEN</button>';
    } else if (state === 'downloading') {
      var pct = pipeline[entry.id + ':pct'] || 0;
      actionHtml = '<span class="terminal-btn" style="opacity:.6; cursor:default;">' + pct + '%</span>';
    } else if (state === 'extracting' || state === 'installing') {
      actionHtml = '<span class="terminal-btn" style="opacity:.6; cursor:default;">' + (state === 'extracting' ? 'EXTRACTING\u2026' : 'INSTALLING\u2026') + '</span>';
    } else if (state === 'zip' || state === 'folder') {
      actionHtml = '<button class="terminal-btn btn-action" onclick="AstraStore2.goDownloads()">FINISH IN FILES</button>';
    } else {
      actionHtml = '<button class="terminal-btn btn-start" onclick="AstraStore2.get(\'' + entry.id + '\')">[+] GET</button>';
    }
    var footNote = locked ? '<div style="font-size:9px; color:var(--pixel-red); margin-top:2px;">Unlocks once you have a job or business.</div>' : '';
    return '' +
      '<div class="a17-card"' + (locked ? ' style="opacity:.6;"' : '') + '>' +
        '<div class="a17-card-top"><b style="color:var(--pixel-yellow); font-size:12px;">' + esc(entry.name) + '</b>' +
        '<span class="a17-badge">' + esc(catLabel) + '</span></div>' +
        '<div style="font-size:10.5px; color:#8a97ad; flex-grow:1;">' + esc(entry.blurb) + '</div>' + footNote +
        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
        '<span style="font-size:9.5px; color:#556b85;">' + entry.sizeMB + ' MB</span>' + actionHtml + '</div>' +
      '</div>';
  }

  function renderGrid() {
    var grid = $('a17Grid');
    var store = window.AstraAppStore;
    if (!grid || !store) return;
    CATS.forEach(function (c) {
      var tab = $('a17cat-' + c.id);
      if (tab) tab.classList.toggle('active-nav', c.id === currentCat);
    });
    var q = currentQuery.toLowerCase().trim();
    var list = store.catalog().filter(function (e) {
      if (currentCat !== 'all' && e.category !== currentCat) return false;
      if (q && e.name.toLowerCase().indexOf(q) === -1 && e.blurb.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    grid.innerHTML = list.length ? list.map(function (e) { return cardHtml(e, store); }).join('') :
      '<div style="color:#888; font-size:11px;">Nothing matches that search.</div>';
  }

  function entryById(id) {
    var store = window.AstraAppStore;
    return store ? store.catalog().filter(function (e) { return e.id === id; })[0] : null;
  }

  function persistDownload(appId, phase) {
    if (!window.AstraDesktopState) return Promise.resolve(null);
    var downloads = (window.AstraDesktopState.get().downloads || []).filter(function (item) {
      return item.id !== 'dl-' + appId;
    });
    downloads.push({ id: 'dl-' + appId, app_id: appId, phase: phase });
    return window.AstraDesktopState.update({ downloads: downloads.slice(-100) });
  }

  function restoreDownloads(state, triesLeft) {
    if (!state) return;
    if (!window.AstraFiles) {
      if (triesLeft === undefined) triesLeft = 30;
      if (triesLeft > 0) setTimeout(function () { restoreDownloads(state, triesLeft - 1); }, 200);
      return;
    }
    (state.downloads || []).forEach(function (saved) {
      if (saved.kind === 'export' && saved.phase === 'exported') {
        window.AstraFiles.pushDownload({
          id: saved.id, name: saved.name, kind: 'export', phase: 'exported',
          icon: '\u2197', hint: 'Exported file'
        });
        return;
      }
      var entry = entryById(saved.app_id);
      if (!entry || (saved.phase !== 'zip' && saved.phase !== 'folder')) return;
      pipeline[saved.app_id] = saved.phase;
      if (saved.phase === 'zip') {
        window.AstraFiles.pushDownload({
          id: saved.id, name: saved.app_id + '_setup.zip', icon: '\u25A3', progress: null,
          hint: 'Download complete \u2014 compressed, needs extracting.',
          action: { label: 'EXTRACT', run: function () { extractZip(saved.app_id, saved.id, entry); } }
        });
      } else {
        window.AstraFiles.pushDownload({
          id: saved.id, name: saved.app_id + '_setup', icon: '', isFolder: true,
          hint: 'Extracted \u2014 open the folder and run setup.exe',
          children: [{
            id: 'exe-' + saved.app_id, name: 'setup.exe', icon: '\u2699',
            hint: 'Run to install ' + entry.name,
            action: { label: 'RUN', run: function () { runInstaller(saved.app_id, saved.id, entry); } }
          }]
        });
      }
    });
    renderGrid();
  }

  function startDownload(appId) {
    var store = window.AstraAppStore;
    if (!store || store.isInstalled(appId)) return Promise.resolve('installed');
    var entry = entryById(appId);
    if (!entry) return Promise.resolve(null);
    if (entry.requires === 'employed' && !playerEmployed) { toast('Locked \u2014 get a job or start a business first.'); return Promise.resolve(null); }
    if (pipeline[appId] && pipeline[appId] !== 'idle') return Promise.resolve(pipeline[appId]);
    pipeline[appId] = 'downloading';
    pipeline[appId + ':pct'] = 0;
    renderGrid();
    var speedMBs = 8 + Math.random() * 22; // fictional OMNI-NET speed, varies per download
    var totalMs = Math.min(15000, Math.max(2200, (entry.sizeMB / speedMBs) * 1000));
    var start = Date.now();
    var dlId = 'dl-' + appId;
    if (window.AstraFiles) {
      window.AstraFiles.pushDownload({
        id: dlId, name: appId + '_setup.zip', icon: '\u2B07', progress: 0,
        hint: 'Downloading via OMNI-NET \u2014 0% of ' + entry.sizeMB + ' MB'
      });
    }
    return new Promise(function (resolve) {
      var timer = setInterval(function () {
        var pct = Math.min(100, Math.round(((Date.now() - start) / totalMs) * 100));
        pipeline[appId + ':pct'] = pct;
        if (window.AstraFiles) {
          window.AstraFiles.updateDownload(dlId, {
            progress: pct, hint: 'Downloading via OMNI-NET \u2014 ' + pct + '% of ' + entry.sizeMB + ' MB'
          });
        }
        renderGrid();
        if (pct >= 100) {
          clearInterval(timer);
          pipeline[appId] = 'zip';
          Promise.resolve(persistDownload(appId, 'zip')).then(function () {
            if (window.AstraFiles) {
              window.AstraFiles.updateDownload(dlId, {
                icon: '\u25A3', progress: null,
                hint: 'Download complete \u2014 compressed, needs extracting.',
                action: { label: 'EXTRACT', run: function () { extractZip(appId, dlId, entry); } }
              });
            }
            renderGrid();
            toast(entry.name + ' finished downloading.');
            resolve('zip');
          });
        }
      }, 180);
    });
  }

  function extractZip(appId, dlId, entry) {
    if (pipeline[appId] === 'folder') return Promise.resolve('folder');
    pipeline[appId] = 'extracting';
    if (window.AstraFiles) window.AstraFiles.updateDownload(dlId, { hint: 'Extracting archive\u2026', action: null });
    renderGrid();
    return new Promise(function (resolve) {
      setTimeout(function () {
        pipeline[appId] = 'folder';
        Promise.resolve(persistDownload(appId, 'folder')).then(function () {
          if (window.AstraFiles) {
            window.AstraFiles.updateDownload(dlId, {
              name: appId + '_setup', icon: '', isFolder: true,
              hint: 'Extracted \u2014 open the folder and run setup.exe',
              children: [{
                id: 'exe-' + appId, name: 'setup.exe', icon: '\u2699',
                hint: 'Run to install ' + entry.name,
                action: { label: 'RUN', run: function () { runInstaller(appId, dlId, entry); } }
              }]
            });
          }
          renderGrid();
          toast(entry.name + ' extracted.');
          resolve('folder');
        });
      }, 1000 + Math.random() * 700);
    });
  }

  function runInstaller(appId, dlId, entry) {
    if (window.AstraAppStore && window.AstraAppStore.isInstalled(appId)) return Promise.resolve('installed');
    pipeline[appId] = 'installing';
    var exeId = 'exe-' + appId;
    if (window.AstraFiles) window.AstraFiles.updateDownload(exeId, { hint: 'Installing ' + entry.name + '\u2026', action: null });
    renderGrid();
    return new Promise(function (resolve) {
      setTimeout(function () {
        var installed = window.AstraAppStore ? window.AstraAppStore.install(appId) : null;
        Promise.resolve(installed).then(function () {
          pipeline[appId] = 'installed';
          var removed = window.AstraFiles ? window.AstraFiles.removeDownload(dlId) : null;
          return Promise.resolve(removed);
        }).then(function () {
          renderGrid();
          sfx('cash');
          toast(entry.name + ' installed.');
          if (window.switchView) window.switchView(appId);
          resolve('installed');
        });
      }, 1300 + Math.random() * 900);
    });
  }

  function terminalCatalog() {
    var store = window.AstraAppStore;
    if (!store) return Promise.resolve([]);
    return refreshEmploymentGate().then(function () {
      return store.catalog().filter(function (entry) {
        var button = $('nav-' + entry.id);
        return !!$('view-' + entry.id) && (!button || !button.classList.contains('ws-role-hidden')) &&
          (entry.requires !== 'employed' || playerEmployed);
      });
    });
  }

  function terminalEntry(appId) {
    var entry = entryById(appId);
    var button = $('nav-' + appId);
    if (!entry || !$('view-' + appId) || (button && button.classList.contains('ws-role-hidden')) ||
        (entry.requires === 'employed' && !playerEmployed)) {
      return null;
    }
    return entry;
  }

  function terminalDownload(appId) {
    var entry = terminalEntry(appId);
    if (!entry) return Promise.reject(new Error('app is unavailable for this operator'));
    if (window.AstraAppStore.isInstalled(appId)) return Promise.resolve('installed');
    var state = pipeline[appId] || 'idle';
    if (state === 'zip' || state === 'folder') return Promise.resolve(state);
    if (state !== 'idle') return Promise.reject(new Error(entry.name + ' is already ' + state));
    return startDownload(appId);
  }

  function terminalExtract(appId) {
    var entry = terminalEntry(appId);
    if (!entry) return Promise.reject(new Error('app is unavailable for this operator'));
    var state = pipeline[appId] || 'idle';
    if (state === 'folder') return Promise.resolve('folder');
    if (state !== 'zip') return Promise.reject(new Error(entry.name + ' has no downloaded archive'));
    return extractZip(appId, 'dl-' + appId, entry);
  }

  function terminalInstall(appId) {
    var entry = terminalEntry(appId);
    if (!entry) return Promise.reject(new Error('app is unavailable for this operator'));
    if (window.AstraAppStore.isInstalled(appId)) return Promise.resolve('installed');
    if (pipeline[appId] !== 'folder') return Promise.reject(new Error(entry.name + ' has not been extracted'));
    return runInstaller(appId, 'dl-' + appId, entry);
  }

  function terminalRemove(appId) {
    if (window.AstraAppStore.isInstalled(appId)) return Promise.resolve(false);
    delete pipeline[appId];
    return Promise.resolve(window.AstraFiles ? window.AstraFiles.removeDownload('dl-' + appId) : null)
      .then(function () {
        if (!window.AstraDesktopState) return true;
        var downloads = (window.AstraDesktopState.get().downloads || []).filter(function (item) {
          return item.id !== 'dl-' + appId;
        });
        return window.AstraDesktopState.update({ downloads: downloads }).then(function () { return true; });
      });
  }

  window.AstraStore2 = {
    setCat: function (c) { currentCat = c; renderGrid(); },
    setQuery: function (q) { currentQuery = q; renderGrid(); },
    get: startDownload,
    terminalCatalog: terminalCatalog,
    terminalState: function (id) {
      return window.AstraAppStore && window.AstraAppStore.isInstalled(id) ? 'installed' : (pipeline[id] || 'idle');
    },
    terminalDownload: terminalDownload,
    terminalExtract: terminalExtract,
    terminalInstall: terminalInstall,
    terminalRemove: terminalRemove,
    openApp: function (id) { if (window.switchView) window.switchView(id); },
    goDownloads: function () { if (window.AstraFiles) window.AstraFiles.goto('downloads'); }
  };

  window.addEventListener('astra:desktop-state', function (event) { restoreDownloads(event.detail, 30); });
  if (window.AstraDesktopState) window.AstraDesktopState.ready.then(function (state) { restoreDownloads(state, 30); });

  /* =======================================================================
   * STREAMTUBE - fake video app, downloadable/installable like anything else
   * ===================================================================== */
  var ST_CATS = ['Trending', 'Finance Tips', 'Comedy', 'Music', 'Vlogs'];
  var ST_VIDEOS = [
    { t: 'I Turned $500 Into $50,000 Trading NVID (NOT CLICKBAIT)', ch: 'GrindsetGary', cat: 'Finance Tips', views: '1.2M', dur: '14:02', icon: '\uD83D\uDCC8',
      desc: 'Gary explains his "system." His system is luck, three margin calls, and a thumbnail. Take from it what you will.' },
    { t: 'Reading the OMNI-BOT Terms of Service Out Loud (4 Hours)', ch: 'Insomnia Radio', cat: 'Comedy', views: '340K', dur: '4:01:12', icon: '\uD83D\uDCC4',
      desc: 'Exactly what it sounds like. Surprisingly load-bearing for anyone who actually wants to know what VEX does with your data.' },
    { t: 'Why Nobody Is Getting Hired Right Now (Career Corner)', ch: 'The Ledger', cat: 'Finance Tips', views: '512K', dur: '9:44', icon: '\uD83D\uDCBC',
      desc: 'A calmer take than the title: most postings on JobBoardNet quietly prefer a referral or a portfolio piece over a cold application.' },
    { t: 'lofi hip hop radio - beats to lose your savings to \u2634', ch: 'Chillstream', cat: 'Music', views: '8.9M', dur: 'LIVE', icon: '\uD83C\uDFA7',
      desc: '24/7 stream. Popular with the LUCKYSPIN crowd for reasons nobody has fully explained.' },
    { t: 'A Week in My Life as a Remote STAFFR Manager', ch: 'quietdesk', cat: 'Vlogs', views: '88K', dur: '11:30', icon: '\uD83C\uDFE0',
      desc: 'Low-key, mostly coffee and spreadsheets. One good rant about no-show interviews around the 6 minute mark.' },
    { t: 'The Boggle Ads Algorithm Explained in 90 Seconds', ch: 'ByteSize', cat: 'Trending', views: '2.1M', dur: '1:31', icon: '\u26A1',
      desc: 'It is not actually explained in 90 seconds. It is a 90 second ad for a course that explains it.' },
    { t: 'Macrosoft Earnings Call but Every "Synergy" Is a Drum Hit', ch: 'Insomnia Radio', cat: 'Comedy', views: '655K', dur: '3:20', icon: '\uD83E\uDD41',
      desc: 'A public service, honestly.' },
    { t: 'Cold Emailing 50 Companies: What Actually Got Replies', ch: 'The Ledger', cat: 'Finance Tips', views: '203K', dur: '16:55', icon: '\u2709',
      desc: 'Spoiler: not the ones with "urgent" in the subject line. Decent watch before you touch CAREER or CLIENT DIRECTORY.' },
    { t: 'synthwave drive // late shift at the exchange', ch: 'Chillstream', cat: 'Music', views: '1.4M', dur: '46:10', icon: '\uD83C\uDFB9',
      desc: 'Good background for MARKETS & SEARCH. No advice contained within, just a beat.' },
    { t: 'I Let an AI Manage My Portfolio for 30 Days', ch: 'quietdesk', cat: 'Vlogs', views: '410K', dur: '13:18', icon: '\uD83E\uDD16',
      desc: 'Went about as well as you'
        + '\u2019d expect. Ends with a very sincere apology to OMNICHAT.' }
  ];
  var stCurrentCat = 'Trending';

  function streamtubeHtml() {
    var tabs = ['Trending'].concat(ST_CATS.filter(function (c) { return c !== 'Trending'; })).map(function (c) {
      return '<button class="terminal-btn a17-cat-tab" id="stcat-' + esc(c) + '" onclick="AstraStreamTube.setCat(\'' + esc(c) + '\')">' + esc(c.toUpperCase()) + '</button>';
    }).join('');
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">STREAMTUBE</div></div>' +
        '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">' + tabs + '</div>' +
        '<div id="stGrid" class="a17-vid-grid"></div>' +
      '</div>' +
      '<div id="stPlayer" class="terminal-panel" style="display:none;"></div>';
  }

  function stRenderGrid() {
    var grid = $('stGrid');
    if (!grid) return;
    ['Trending'].concat(ST_CATS.filter(function (c) { return c !== 'Trending'; })).forEach(function (c) {
      var tab = $('stcat-' + c);
      if (tab) tab.classList.toggle('active-nav', c === stCurrentCat);
    });
    var list = stCurrentCat === 'Trending' ? ST_VIDEOS : ST_VIDEOS.filter(function (v) { return v.cat === stCurrentCat; });
    grid.innerHTML = list.map(function (v, i) {
      var idx = ST_VIDEOS.indexOf(v);
      return '<div style="cursor:pointer; display:flex; flex-direction:column; gap:5px;" onclick="AstraStreamTube.play(' + idx + ')">' +
        '<div class="a17-thumb">' + v.icon + '<span class="a17-dur">' + esc(v.dur) + '</span></div>' +
        '<div style="font-size:11px; color:#fff; line-height:1.3;">' + esc(v.t) + '</div>' +
        '<div style="font-size:9.5px; color:#8a97ad;">' + esc(v.ch) + ' &middot; ' + esc(v.views) + ' views</div>' +
      '</div>';
    }).join('');
  }

  function stPlay(i) {
    var v = ST_VIDEOS[i];
    var box = $('stPlayer');
    if (!v || !box) return;
    box.style.display = '';
    box.innerHTML =
      '<div class="panel-header"><div class="panel-heading-title">' + esc(v.t) + '</div></div>' +
      '<div class="a17-thumb" style="height:180px; font-size:52px;">' + v.icon + '</div>' +
      '<div style="display:flex; justify-content:space-between; margin:8px 0; font-size:10.5px; color:#8a97ad;">' +
        '<span>' + esc(v.ch) + ' &middot; ' + esc(v.views) + ' views &middot; ' + esc(v.dur) + '</span>' +
        '<button class="terminal-btn">SUBSCRIBE</button></div>' +
      '<div style="font-size:11px; color:#cfd8e3; line-height:1.6; border-top:1px solid var(--border-color); padding-top:8px;">' + esc(v.desc) + '</div>' +
      '<button class="terminal-btn" style="margin-top:10px;" onclick="AstraStreamTube.close()">CLOSE PLAYER</button>';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  window.AstraStreamTube = {
    setCat: function (c) { stCurrentCat = c; stRenderGrid(); },
    play: stPlay,
    close: function () { var box = $('stPlayer'); if (box) box.style.display = 'none'; }
  };

  /* =======================================================================
   * BLOGNET - fake blog/news reader, also downloadable/installable
   * ===================================================================== */
  var BLOG_POSTS = [
    { cat: 'Markets Desk', title: 'NVID Volatility Isn\u2019t a Bug, It\u2019s the Business Model', byline: 'R. Kessler',
      snippet: 'Semiconductor cycles used to take years. NVID\u2019s takes about a fiscal quarter now.',
      body: 'Semiconductor cycles used to take years. NVID\u2019s takes about a fiscal quarter now, and the option market has priced that in whether you have or not. If you\u2019re trading it off vibes and a green candle, you are the liquidity, not the trader. Pull the last four earnings prints before you size a position - the pattern is duller than the price action suggests.' },
    { cat: 'Career Corner', title: 'Companies Are Quietly Only Hiring Through Referrals This Quarter', byline: 'D. Okafor',
      snippet: 'Cold applications on JobBoardNet are getting auto-filtered at a higher rate than operators think.',
      body: 'Cold applications on JobBoardNet are getting auto-filtered at a higher rate than most operators think. Firms like Fairview & Co and Apex Capital Group are leaning hard on internal referral pipelines this cycle. If you don\u2019t know anyone, the workaround isn\u2019t spamming applications - it\u2019s building something a hiring manager can actually look at before they ever see your name.' },
    { cat: 'Markets Desk', title: 'Apex Bullion Isn\u2019t a Hedge, It\u2019s a Waiting Room', byline: 'R. Kessler',
      snippet: 'Gold does one thing well and operators keep asking it to do three.',
      body: 'Gold does one thing well - it sits there - and operators keep asking it to do three. It won\u2019t save a portfolio that\u2019s already over-levered on EtherNet Index, and it won\u2019t outrun inflation fast enough to matter on a short horizon. It\u2019s a waiting room, not an exit.' },
    { cat: 'Opinion', title: 'The VPN Panel Doesn\u2019t Make You Invisible, and That\u2019s Fine', byline: 'M. Vantz',
      snippet: 'A relay that lowers your odds of an audit strike is still not the same thing as security.',
      body: 'A relay that lowers your odds of an audit strike is still not the same thing as security, and Ghost-VPN has never claimed otherwise if you actually read the panel copy. Treat it like a discount, not a shield.' },
    { cat: 'Career Corner', title: 'Boss Reviews Are Rigged in a Way You Can Actually Use', byline: 'D. Okafor',
      snippet: 'The review isn\u2019t graded on vibes. It\u2019s graded on whether your numbers matched what you promised.',
      body: 'The review isn\u2019t graded on vibes. It\u2019s graded on whether your numbers matched what you promised in the interview. Undersell your target in the interview stage and the bar for a good review drops with it - operators who oversell to look impressive are the ones who get put on a performance plan two weeks later.' },
    { cat: 'Culture', title: 'Everyone on STREAMTUBE Is Either Selling a Course or Recovering From One', byline: 'Staff',
      snippet: 'A brief, mildly bitter field guide.',
      body: 'A brief, mildly bitter field guide: if the thumbnail has a red circle around a number, assume the number is fake. If the channel posts three times a day, assume the trading account is not doing three times a day\u2019s worth of trading.' },
    { cat: 'Markets Desk', title: 'Postify Royalties Explained for People Who Hate Reading Contracts', byline: 'R. Kessler',
      snippet: 'Self-released keeps 90% of not much. A label keeps you less of a lot more, maybe.',
      body: 'Self-released keeps 90% of not much. A label keeps you less of a lot more, maybe - the reach multiplier only pays off if the genre you picked actually has an audience left to reach. Chiptune and ambient are stable because nobody expected much. Acid house is the one that either pays your rent or doesn\u2019t.' },
    { cat: 'Opinion', title: 'The Free Download Was Never Going to Be Free', byline: 'M. Vantz',
      snippet: 'A short reminder for anyone who searched "free" in the browser this week.',
      body: 'A short reminder for anyone who searched "free" in the browser this week: the real OMNI App Store listing and the "cracked, no sign-up" listing are never the same link, and only one of them ends with money leaving your account instead of software arriving on your desktop.' }
  ];
  var blCurrentCat = 'All';
  var blOpenPost = null;

  function blognetHtml() {
    var cats = ['All', 'Markets Desk', 'Career Corner', 'Opinion', 'Culture'];
    var tabs = cats.map(function (c) {
      return '<button class="terminal-btn a17-cat-tab" id="blcat-' + esc(c) + '" onclick="AstraBlognet.setCat(\'' + esc(c) + '\')">' + esc(c.toUpperCase()) + '</button>';
    }).join('');
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">BLOGNET</div></div>' +
        '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">' + tabs + '</div>' +
        '<div id="blList" style="display:flex; flex-direction:column; gap:8px;"></div>' +
      '</div>' +
      '<div id="blPost" class="terminal-panel" style="display:none;"></div>';
  }

  function blRenderList() {
    var list = $('blList');
    if (!list) return;
    ['All', 'Markets Desk', 'Career Corner', 'Opinion', 'Culture'].forEach(function (c) {
      var tab = $('blcat-' + c);
      if (tab) tab.classList.toggle('active-nav', c === blCurrentCat);
    });
    var posts = blCurrentCat === 'All' ? BLOG_POSTS : BLOG_POSTS.filter(function (p) { return p.cat === blCurrentCat; });
    list.innerHTML = posts.map(function (p) {
      var idx = BLOG_POSTS.indexOf(p);
      return '<div class="d-list-item" style="cursor:pointer; flex-direction:column; align-items:flex-start; gap:3px;" onclick="AstraBlognet.open(' + idx + ')">' +
        '<div style="display:flex; justify-content:space-between; width:100%;"><b style="color:var(--pixel-yellow);">' + esc(p.title) + '</b>' +
        '<span class="a17-badge">' + esc(p.cat) + '</span></div>' +
        '<div style="font-size:10px; color:#8a97ad;">by ' + esc(p.byline) + '</div>' +
        '<div style="font-size:10.5px; color:#8a97ad;">' + esc(p.snippet) + '</div></div>';
    }).join('');
  }

  function blOpen(i) {
    var p = BLOG_POSTS[i];
    var box = $('blPost');
    if (!p || !box) return;
    box.style.display = '';
    box.innerHTML =
      '<div class="panel-header"><div class="panel-heading-title">' + esc(p.title) + '</div></div>' +
      '<div style="font-size:10px; color:#8a97ad; margin-bottom:8px;">' + esc(p.cat) + ' &middot; by ' + esc(p.byline) + '</div>' +
      '<div style="font-size:11.5px; color:#cfd8e3; line-height:1.7;">' + esc(p.body) + '</div>' +
      '<button class="terminal-btn" style="margin-top:10px;" onclick="AstraBlognet.close()">CLOSE ARTICLE</button>';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  window.AstraBlognet = {
    posts: function () { return BLOG_POSTS; },
    setCat: function (c) { blCurrentCat = c; blRenderList(); },
    open: blOpen,
    close: function () { var box = $('blPost'); if (box) box.style.display = 'none'; }
  };

  /* =======================================================================
   * boot
   * ===================================================================== */
  var done = false;
  function build() {
    if (done) return;
    if (!document.querySelector('.header-nav') || !$('view-dashboard')) return;
    injectStyles();

    addView('appstore', storeViewHtml());
    addNavButton('appstore', '[\u25A7] APP STORE');
    refreshEmploymentGate();
    setInterval(refreshEmploymentGate, 6000);
    renderGrid();

    addView('streamtube', streamtubeHtml());
    addNavButton('streamtube', '[\u25B7] STREAMTUBE');
    stRenderGrid();

    addView('blognet', blognetHtml());
    addNavButton('blognet', '[\u2637] BLOGNET');
    blRenderList();

    if (window.AstraDesktopState) restoreDownloads(window.AstraDesktopState.get());

    done = true;
    if (window.winosRescanApps) window.winosRescanApps();
  }

  function waitAndRun(triesLeft) {
    if (($('view-dashboard') && document.querySelector('.header-nav')) || triesLeft <= 0) { build(); return; }
    setTimeout(function () { waitAndRun(triesLeft - 1); }, 150);
  }

  window.addEventListener('astrax:ready', function () { waitAndRun(45); });
  setTimeout(function () { waitAndRun(1); }, 9000);
})();
