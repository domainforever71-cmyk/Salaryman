(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sfx(n) { try { if (window.SFX) window.SFX.play(n); } catch (e) { } }

  var ZIP_ID = 'dl-blognet', DIR_ID = 'dl-blognet-x';

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42);
  }
  function posts() {
    return (window.AstraBlognet && window.AstraBlognet.posts) ? window.AstraBlognet.posts() : [];
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function buildFiles() {
    var ps = posts();
    var files = ps.map(function (p, i) {
      return {
        name: pad2(i + 1) + '_' + slug(p.title) + '.txt',
        text: p.title + '\n' + new Array(p.title.length + 1).join('=') + '\n' +
          'Section: ' + p.cat + '\nBy: ' + p.byline + '\n\n' + p.body + '\n'
      };
    });
    var idx = ['file,section,author,title'];
    ps.forEach(function (p, i) {
      idx.push([files[i].name, p.cat, p.byline, '"' + p.title.replace(/"/g, '""') + '"'].join(','));
    });
    files.push({ name: 'index.csv', text: idx.join('\n') + '\n' });
    files.push({
      name: 'README.txt',
      text: 'BLOGNET OFFLINE PACK\n====================\n' +
        ps.length + ' articles, saved for offline reading.\n\n' +
        'Files:\n  NN_title.txt  one article each\n  index.csv     section / author / title table\n\n' +
        'Tip: /r openEX opens all of these in the READER.\n' +
        'Everything in here is fiction. Please do not trade on it.\n'
    });
    return files;
  }
  function sizeOf(files) {
    return files.reduce(function (a, f) { return a + f.text.length; }, 0);
  }
  function fmtSize(b) { return b < 1024 ? b + ' B' : (b / 1024).toFixed(1) + ' KB'; }

  var TTS_PREF_KEY = 'astra_tts_preferences';
  var ttsPrefs = { language: 'en', gender: 'auto' };
  try {
    var savedTtsPrefs = JSON.parse(localStorage.getItem(TTS_PREF_KEY) || '{}');
    if (savedTtsPrefs.language === 'en' || savedTtsPrefs.language === 'fr') ttsPrefs.language = savedTtsPrefs.language;
    if (savedTtsPrefs.gender === 'auto' || savedTtsPrefs.gender === 'male' || savedTtsPrefs.gender === 'female') ttsPrefs.gender = savedTtsPrefs.gender;
  } catch (e) { }

  function voiceGender(voice) {
    var explicit = String(voice.gender || '').toLowerCase();
    if (explicit === 'male' || explicit === 'female') return explicit;
    var name = String(voice.name || '') + ' ' + String(voice.voiceURI || '');
    if (/\b(female|woman|girl|samantha|zira|hazel|karen|moira|susan|victoria|tessa|fiona|amelie|hortense|julie|audrey|celine|virginie|denise)\b/i.test(name)) return 'female';
    if (/\b(male|man|boy|alex|daniel|david|fred|guy|james|mark|oliver|thomas|paul|henri|nicolas)\b/i.test(name)) return 'male';
    return 'unknown';
  }

  function refreshTtsControls() {
    var language = $('ttsLanguage'), gender = $('ttsGender');
    if (language) language.value = ttsPrefs.language;
    if (gender) gender.value = ttsPrefs.gender;
  }

  window.AstraTTS = {
    supported: function () { return !!(window.speechSynthesis && window.SpeechSynthesisUtterance); },
    configure: function (patch) {
      patch = patch || {};
      if (patch.language === 'en' || patch.language === 'fr') ttsPrefs.language = patch.language;
      if (patch.gender === 'auto' || patch.gender === 'male' || patch.gender === 'female') ttsPrefs.gender = patch.gender;
      try { localStorage.setItem(TTS_PREF_KEY, JSON.stringify(ttsPrefs)); } catch (e) { }
      refreshTtsControls();
    },
    speak: function (text) {
      if (!this.supported() || !text) return false;
      try {
        var voices = window.speechSynthesis.getVoices() || [];
        var languageVoices = voices.filter(function (voice) { return String(voice.lang).toLowerCase().indexOf(ttsPrefs.language) === 0; });
        var matchingVoices = ttsPrefs.gender === 'auto' ? languageVoices : languageVoices.filter(function (voice) { return voiceGender(voice) === ttsPrefs.gender; });
        var utterance = new SpeechSynthesisUtterance(String(text).slice(0, 1000));
        utterance.lang = ttsPrefs.language === 'fr' ? 'fr-FR' : 'en-US';
        utterance.voice = matchingVoices[0] || languageVoices[0] || null;
        utterance.rate = 1;
        utterance.pitch = ttsPrefs.gender === 'male' ? 0.82 : (ttsPrefs.gender === 'female' ? 1.12 : 0.95);
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
        window.speechSynthesis.speak(utterance);
        return true;
      } catch (e) { return false; }
    }
  };
  refreshTtsControls();

  function ds() { return window.AstraDesktopState; }
  function saved() { return (ds() && ds().get().downloads) || []; }
  function has(id) { return saved().some(function (e) { return e.id === id; }); }
  function persist(entry) {
    if (!ds()) return;
    var list = saved().filter(function (e) { return e.id !== entry.id; });
    list.push(entry);
    ds().update({ downloads: list.slice(-100) });
  }
  function forget(id) {
    if (!ds()) return;
    ds().update({ downloads: saved().filter(function (e) { return e.id !== id; }) });
  }
  var hasZip = function () { return has(ZIP_ID); };
  var hasDir = function () { return has(DIR_ID); };

  function whenFiles(fn, tries) {
    if (window.AstraFiles) { fn(); return; }
    if ((tries === undefined ? 40 : tries) <= 0) return;
    setTimeout(function () { whenFiles(fn, (tries === undefined ? 40 : tries) - 1); }, 200);
  }
  function showZip(progress) {
    whenFiles(function () {
      window.AstraFiles.pushDownload({
        id: ZIP_ID, name: 'blognet_files.zip', icon: progress == null ? '\u25A3' : '\u2B07',
        progress: progress == null ? null : progress,
        hint: progress == null ? 'Download complete \u2014 compressed, run /r extract (or click EXTRACT).' : 'Downloading\u2026 ' + progress + '%',
        action: progress == null ? { label: 'EXTRACT', run: function () { runCommand('extract'); } } : null
      });
    });
  }
  function showDir() {
    whenFiles(function () {
      var files = buildFiles();
      window.AstraFiles.pushDownload({
        id: DIR_ID, name: 'blognet_files', isFolder: true, icon: '',
        hint: 'Extracted \u2014 ' + files.length + ' files (' + fmtSize(sizeOf(files)) + ')',
        children: files.map(function (f, i) {
          return {
            id: 'bnf-' + i, name: f.name, icon: '\u2637', hint: fmtSize(f.text.length),
            open: function () { Reader.open(f.name); }
          };
        })
      });
    });
  }
  function restore() {
    if (hasZip()) showZip(null);
    if (hasDir()) showDir();
  }

  var Reader = {
    current: null, all: false,
    open: function (name) {
      Reader.current = name; Reader.all = false;
      Reader.render();
      if (window.switchView) window.switchView('reader');
    },
    openAll: function () {
      Reader.all = true; Reader.current = null;
      Reader.render();
      if (window.switchView) window.switchView('reader');
    },
    speak: function (name) {
      var f = buildFiles().filter(function (x) { return x.name === name; })[0];
      if (f && window.AstraTTS) window.AstraTTS.speak(f.text);
    },
    render: function () {
      var box = $('rdBody'), list = $('rdList');
      if (!box || !list) return;
      if (!hasDir()) {
        list.innerHTML = '';
        box.innerHTML = '<div class="s26-dim">No text documents are extracted. App Store downloads are installed from TERMINAL with <b>/r openEX</b>.</div>';
        return;
      }
      var files = buildFiles();
      list.innerHTML = '<div class="s26-rd-item' + (Reader.all ? ' on' : '') + '" onclick="AstraReader.openAll()">\u2263 all files (' + files.length + ')</div>' +
        files.map(function (f) {
          return '<div class="s26-rd-item' + (!Reader.all && Reader.current === f.name ? ' on' : '') +
            '" data-f="' + esc(f.name) + '">' + esc(f.name) + '</div>';
        }).join('');
      Array.prototype.forEach.call(list.querySelectorAll('[data-f]'), function (el) {
        el.onclick = function () { Reader.open(el.getAttribute('data-f')); };
      });
      var shown = Reader.all ? files : files.filter(function (f) { return f.name === Reader.current; });
      if (!shown.length) shown = [files[0]];
      box.innerHTML = shown.map(function (f) {
        return '<div class="s26-doc"><div class="s26-doc-h"><span>' + esc(f.name) + '</span>' +
          '<button class="terminal-btn" data-say="' + esc(f.name) + '">\u25B6 READ ALOUD</button></div>' +
          '<pre class="s26-pre">' + esc(f.text) + '</pre></div>';
      }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('[data-say]'), function (b) {
        b.onclick = function () { Reader.speak(b.getAttribute('data-say')); };
      });
    }
  };
  window.AstraReader = Reader;

  function newsHtml() {
    return '<div class="terminal-panel"><div class="panel-header"><div class="panel-heading-title">ASTRA WIRE</div></div>' +
      '<div id="s26NewsList"></div><div id="s26NewsStory"></div></div>';
  }
  function renderNews() {
    var list = $('s26NewsList');
    if (!list) return;
    list.innerHTML = posts().map(function (post, i) {
      return '<button class="terminal-btn" style="display:block;width:100%;text-align:left;margin:4px 0;" onclick="AstraNews.open(' + i + ')">' +
        esc(post.cat) + ' | ' + esc(post.title) + '</button>';
    }).join('') || '<div class="s26-dim">No stories available.</div>';
  }
  window.AstraNews = {
    headlines: function () { return posts().map(function (post) { return { cat: post.cat, title: post.title }; }); },
    open: function (index) {
      var post = posts()[index], story = $('s26NewsStory');
      if (!post || !story) return;
      story.innerHTML = '<h3>' + esc(post.title) + '</h3><div class="s26-dim">' + esc(post.cat) + ' / ' + esc(post.byline) + '</div><p>' + esc(post.body) + '</p>';
    }
  };

  var outEl = null, inEl = null, busy = false, hist = [], hIdx = 0;
  var terminalAdmin = false;

  function print(text, cls) {
    if (!outEl) return null;
    var d = document.createElement('div');
    d.className = 's26-line' + (cls ? ' ' + cls : '');
    d.textContent = text;
    outEl.appendChild(d);
    outEl.scrollTop = outEl.scrollHeight;
    return d;
  }
  function printHtml(html, cls) {
    if (!outEl) return null;
    var d = document.createElement('div');
    d.className = 's26-line' + (cls ? ' ' + cls : '');
    d.innerHTML = html;
    outEl.appendChild(d);
    outEl.scrollTop = outEl.scrollHeight;
    return d;
  }
  function bar(pct, w) {
    var n = Math.round(pct / 100 * w);
    return '[' + new Array(n + 1).join('#') + new Array(w - n + 1).join('.') + '] ' + pct + '%';
  }
  function username() {
    var el = $('setupPlayerName');
    var n = (el && el.value ? el.value : '').trim().replace(/\s+/g, '_');
    return n || 'operator';
  }

  function progress(label, totalMs, total, onTick) {
    return new Promise(function (resolve) {
      var line = print(label + ' ' + bar(0, 24), 's26-dim');
      var start = Date.now();
      var t = setInterval(function () {
        var pct = Math.min(100, Math.round((Date.now() - start) / totalMs * 100));
        if (line) line.textContent = label + ' ' + bar(pct, 24) + '  ' + fmtSize(Math.round(total * pct / 100)) + ' / ' + fmtSize(total);
        if (onTick) onTick(pct);
        if (pct >= 100) { clearInterval(t); resolve(); }
      }, 120);
    });
  }

  function selectedStoreApps(args) {
    var store = window.AstraStore2;
    if (!store || !store.terminalCatalog) return Promise.reject(new Error('App Store is unavailable'));
    var query = (args || []).join(' ').trim().toLowerCase();
    return store.terminalCatalog().then(function (apps) {
      if (!query || query === 'all') return apps;
      return apps.filter(function (app) {
        return app.id.toLowerCase() === query || app.name.toLowerCase().indexOf(query) >= 0;
      });
    });
  }

  function runStoreBatch(apps, action, phase) {
    var store = window.AstraStore2;
    return apps.reduce(function (queue, app) {
      return queue.then(function () {
        print(phase + ' ' + app.name + ' ...');
        return Promise.resolve().then(function () { return action(store, app); }).then(function () {
          print(app.name + ' ' + phase + ' complete.', 's26-ok');
        }).catch(function (error) {
          print('skipped ' + app.name + ': ' + (error.message || 'unavailable'), 's26-warn');
        });
      });
    }, Promise.resolve());
  }

  var COMMANDS = {
    help: function (args) {
      if ((args && args[0] || '').toLowerCase() === 'admin') { adminHelp(); return; }
      [
        'Commands (type them with a leading /r):',
        '  /r download [app|all]  download eligible App Store apps (default: all)',
        '  /r extract [app|all]   extract downloaded app installers',
        '  /r openEX [app|all]    install and open extracted apps',
        '  /r ls                  list eligible apps and their install state',
        '  /r status              show each eligible app state',
        '  /r rm <app>            remove an uninstalled app download',
        '  /r news        latest headlines from the NEWS app',
        '  /r say <text>  read text aloud (text-to-speech)',
        '  /r open <app>  open an app (e.g. /r open bank)',
        '  /r apps        list openable apps',
        '  /r balance     your ASD balance',
        '  /r whoami | date | echo <text> | history | clear | about',
        '  /r help admin  moderation, announcements, economy and world commands'
      ].forEach(function (l) { print(l); });
    },

    download: function (args) {
      return selectedStoreApps(args).then(function (apps) {
        var targets = apps.filter(function (app) {
          return window.AstraStore2.terminalState(app.id) !== 'installed';
        });
        if (!targets.length) { print('No eligible, uninstalled App Store apps matched.', 's26-warn'); return; }
        print('Downloading ' + targets.length + ' eligible App Store app(s).');
        return runStoreBatch(targets, function (store, app) {
          var state = store.terminalState(app.id);
          if (state === 'zip' || state === 'folder') {
            print(app.name + ' already downloaded; current state: ' + state + '.', 's26-dim');
            return;
          }
          if (state !== 'idle') throw new Error('download already in progress');
          return store.terminalDownload(app.id);
        }, 'downloading');
      }).catch(function (error) { print(error.message, 's26-err'); });
    },

    extract: function (args) {
      return selectedStoreApps(args).then(function (apps) {
        var targets = apps.filter(function (app) { return window.AstraStore2.terminalState(app.id) === 'zip'; });
        if (!targets.length) { print('No downloaded app archives are ready to extract.', 's26-warn'); return; }
        return runStoreBatch(targets, function (store, app) { return store.terminalExtract(app.id); }, 'extracting');
      }).catch(function (error) { print(error.message, 's26-err'); });
    },

    openex: function (args) {
      return selectedStoreApps(args).then(function (apps) {
        var targets = apps.filter(function (app) { return window.AstraStore2.terminalState(app.id) === 'folder'; });
        if (!targets.length) { print('No extracted app installers are ready. Run /r download, then /r extract.', 's26-warn'); return; }
        return runStoreBatch(targets, function (store, app) { return store.terminalInstall(app.id); }, 'installing');
      }).catch(function (error) { print(error.message, 's26-err'); });
    },

    ls: function () {
      return selectedStoreApps([]).then(function (apps) {
        if (!apps.length) { print('No apps are currently available for this operator.', 's26-warn'); return; }
        apps.forEach(function (app) { print(app.id + '  [' + window.AstraStore2.terminalState(app.id) + ']  ' + app.name); });
      }).catch(function (error) { print(error.message, 's26-err'); });
    },

    cat: function (args) {
      if (!hasDir()) { print('nothing extracted. Run /r extract first.', 's26-err'); return; }
      var q = (args[0] || '').toLowerCase();
      if (!q) { print('usage: /r cat <filename or number>', 's26-err'); return; }
      var files = buildFiles();
      var f = files.filter(function (x) { return x.name.toLowerCase() === q || x.name.toLowerCase().indexOf(q) === 0 || x.name.toLowerCase().indexOf(q) > -1; })[0];
      if (!f) { print('no such file: ' + q, 's26-err'); return; }
      f.text.split('\n').forEach(function (l) { print(l); });
    },

    status: function () {
      return COMMANDS.ls();
    },

    rm: function (args) {
      if (!args.length) { print('usage: /r rm <app id>', 's26-err'); return; }
      return selectedStoreApps(args).then(function (apps) {
        var targets = apps.filter(function (app) { return window.AstraStore2.terminalState(app.id) !== 'installed'; });
        if (!targets.length) { print('No removable app downloads matched.', 's26-warn'); return; }
        return runStoreBatch(targets, function (store, app) { return store.terminalRemove(app.id); }, 'removing');
      }).catch(function (error) { print(error.message, 's26-err'); });
    },

    news: function () {
      if (window.AstraNews && window.AstraNews.headlines) {
        window.AstraNews.headlines().slice(0, 8).forEach(function (h, i) { print((i + 1) + '. [' + h.cat + '] ' + h.title); });
        print('open the NEWS app for the full stories (/r open news).');
      } else print('NEWS is not loaded yet.', 's26-err');
    },

    say: function (args) {
      var t = args.join(' ');
      if (!t) { print('usage: /r say <text>', 's26-err'); return; }
      if (!window.AstraTTS || !window.AstraTTS.supported()) { print('text-to-speech is not supported in this browser.', 's26-err'); return; }
      window.AstraTTS.speak(t);
      print('speaking\u2026');
    },

    open: function (args) {
      var id = (args[0] || '').toLowerCase();
      if (!id) { print('usage: /r open <app>   (see /r apps)', 's26-err'); return; }
      if (!$('view-' + id)) { print('no such app: ' + id, 's26-err'); return; }
      var btn = $('nav-' + id);
      if (btn && btn.classList.contains('ws-app-locked')) { print(id + ' is not installed. Get it from the APP STORE.', 's26-err'); return; }
      window.switchView(id);
      print('opened ' + id, 's26-ok');
    },

    apps: function () {
      var nav = document.querySelector('.header-nav');
      var ids = nav ? Array.prototype.slice.call(nav.querySelectorAll('.terminal-btn[id^="nav-"]'))
        .filter(function (b) { return !b.classList.contains('ws-app-locked') && $('view-' + b.id.slice(4)); })
        .map(function (b) { return b.id.slice(4); }) : [];
      print(ids.join('  ') || '(none)');
    },

    balance: function () {
      return fetch('/api/game/state').then(function (r) { return r.json(); }).then(function (d) {
        if (d && typeof d.balance === 'number') print('balance: ' + d.balance.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' ASD');
        else print('no career started yet.', 's26-warn');
      }).catch(function () { print('could not reach the server.', 's26-err'); });
    },

    whoami: function () { print(username()); },
    date: function () { print(new Date().toString()); },
    echo: function (args) { print(args.join(' ')); },
    history: function () { hist.forEach(function (h, i) { print((i + 1) + '  ' + h); }); },
    clear: function () { if (outEl) outEl.innerHTML = ''; },
    about: function () {
      print('ASTRA TERMINAL v2.6');
      print('commands start with /r . type /r help.');
    }
  };

  // ---------------------------------------------------------------- admin commands
  function adm(method, path, body) {
    return fetch(path, {
      method: method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return { success: false, msg: 'Bad response from the server.' }; });
    }).then(function (r) { if (r && !r.msg && r.error) r.msg = r.error; return r; },
      function () { return { success: false, msg: 'Could not reach the server.' }; });
  }
  function say(r, okMsg) {
    print(r.msg || (r.success ? (okMsg || 'done.') : 'failed.'), r.success ? 's26-ok' : 's26-err');
    return !!r.success;
  }
  function need(args, n, usage) {
    if ((args || []).length >= n) return true;
    print('usage: ' + usage, 's26-err');
    return false;
  }
  function parseHours(v) {
    var m = String(v || '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)(m|h|d)?$/);
    if (!m) return NaN;
    var n = parseFloat(m[1]);
    return m[2] === 'm' ? n / 60 : m[2] === 'd' ? n * 24 : n;
  }
  function findOperator(name) {
    return adm('GET', '/api/admin/users?q=' + encodeURIComponent(name)).then(function (r) {
      if (!r.success) throw new Error(r.msg || 'user lookup failed');
      var low = name.toLowerCase();
      var u = r.users.filter(function (x) { return x.username.toLowerCase() === low; })[0];
      if (!u) throw new Error('no operator named ' + name);
      return u;
    });
  }
  function money(n) { return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function fmtLeft(sec) { return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's'; }
  function safe(fn) {
    return function (args) {
      try {
        return Promise.resolve(fn(args || [])).catch(function (e) { print(e.message || 'error', 's26-err'); });
      } catch (e) { print(e.message || 'error', 's26-err'); return Promise.resolve(); }
    };
  }

  function adminHelp() {
    [
      'ADMIN COMMANDS (all actions are logged; see /r audit)',
      ' Announcements',
      '  /r announce [-w|-u] [-t 30m|6h|2d] <message>   tell every player (default: info, 24h)',
      '       -w = warning   -u = urgent   (alias: /r broadcast)',
      '  /r announcements   recent announcements and their ids',
      '  /r retract <id>    pull an announcement back',
      ' Players',
      '  /r users [search]              list operators',
      '  /r whois <user>                full profile, job, balance, record',
      '  /r ban <user> <reason>         suspend an account',
      '  /r unban <user>                restore an account',
      '  /r jail <user> <minutes> [reason]   custody order (max 1440)',
      '  /r release <user>              end custody',
      '  /r admins                      list administrators',
      ' Moderation',
      '  /r reports [open|reviewing|resolved|dismissed]',
      '  /r resolve <id> [resolved|dismissed|reviewing] [note]',
      '  /r queue                       BLABBER posts needing review',
      '  /r hide <post id> | /r unhide <post id> | /r reveal <post id>',
      '  /r leads                       cheat-check outliers (leads, not verdicts)',
      ' Economy / world',
      '  /r give <user> <amount> <reason>    add ASD',
      '  /r take <user> <amount> <reason>    remove ASD (never below 0)',
      '  /r regime [name]               show or set the world regime',
      ' Live events (all accept -in 2h or -at 2026-10-01T18:00 to schedule, -m <message> last)',
      '  /r stimulus <amount> [opts]    pay every active player',
      '  /r levy <percent> [opts]       collect 1-50% of every active balance',
      '  /r raffle <prize> <winners> [opts]   random active players win a prize',
      '  /r halt <10m|2h> [reason]      freeze all trading;  /r resume ends it',
      '  /r live | /r cancelevent <id>  list / cancel live events',
      ' Market',
      '  /r crash|boom <SYMBOL|all> <pct> [opts] | /r market | /r cancel <id> | /r symbols',
      '  /r stats                       server overview',
      '  /r audit [count]               recent admin actions'
    ].forEach(function (l) { print(l); });
  }

  var ADMIN_COMMANDS = {
    announce: safe(function (args) {
      var level = 'info', hours = 24, words = [];
      for (var i = 0; i < args.length; i++) {
        var a = args[i];
        if (a === '-w' || a === '--warn') level = 'warn';
        else if (a === '-u' || a === '--urgent') level = 'urgent';
        else if (a === '-t' || a === '--hours') {
          if (i + 1 >= args.length) throw new Error('-t needs a duration, e.g. -t 30m, -t 6h, -t 2d');
          hours = parseHours(args[++i]);
          if (!isFinite(hours) || hours <= 0) throw new Error('bad duration. Use 30m, 6h or 2d (15 minutes to 30 days).');
        } else words.push(a);
      }
      var body = words.join(' ');
      if (!body) throw new Error('usage: /r announce [-w|-u] [-t 30m|6h|2d] <message>');
      return adm('POST', '/api/admin/announce', { body: body, level: level, hours: hours }).then(function (r) {
        if (say(r) && r.announcement) print('id ' + r.announcement.id + ' \u00b7 ' + level + ' \u00b7 expires ' + (r.announcement.expires || 'never') + ' UTC', 's26-dim');
      });
    }),

    announcements: safe(function () {
      return adm('GET', '/api/admin/announcements').then(function (r) {
        if (!r.success) { say(r); return; }
        if (!r.announcements.length) { print('no announcements yet.', 's26-dim'); return; }
        r.announcements.slice(0, 15).forEach(function (a) {
          var st = a.retracted ? 'retracted' : a.active ? 'ACTIVE' : 'expired';
          print('#' + a.id + ' [' + a.level + '] ' + st + ' \u00b7 ' + a.author + ' \u00b7 ' + a.at + '\n    ' + a.body,
            a.active ? 's26-ok' : 's26-dim');
        });
      });
    }),

    retract: safe(function (args) {
      if (!need(args, 1, '/r retract <announcement id>')) return;
      var id = parseInt(String(args[0]).replace('#', ''), 10);
      if (!(id > 0)) throw new Error('announcement id must be a number (see /r announcements)');
      return adm('POST', '/api/admin/announce/' + id + '/retract').then(function (r) { say(r); });
    }),

    users: safe(function (args) {
      return adm('GET', '/api/admin/users?q=' + encodeURIComponent(args.join(' '))).then(function (r) {
        if (!r.success) { say(r); return; }
        if (!r.users.length) { print('no matching operators.', 's26-dim'); return; }
        r.users.slice(0, 40).forEach(function (u) {
          print(u.username + (u.is_admin ? '  [ADMIN]' : '') + (u.is_banned ? '  [BANNED: ' + (u.ban_reason || '?') + ']' : '') +
            '  ' + (u.job_status || 'no career') + '  ' + (u.balance != null ? money(u.balance) + ' ASD' : '') +
            (u.open_reports ? '  reports:' + u.open_reports : ''),
            u.is_banned ? 's26-warn' : undefined);
        });
        if (r.users.length > 40) print('... ' + (r.users.length - 40) + ' more. Narrow with /r users <search>.', 's26-dim');
      });
    }),

    whois: safe(function (args) {
      if (!need(args, 1, '/r whois <user>')) return;
      return adm('GET', '/api/admin/whois/' + encodeURIComponent(args.join(' '))).then(function (r) {
        if (!r.success) { say(r); return; }
        print(r.username + (r.is_admin ? '  [ADMIN]' : '') + (r.is_banned ? '  [BANNED]' : ''), 's26-ok');
        print('  joined ' + (r.created || '?') + ' \u00b7 account #' + r.id);
        if (r.is_banned) print('  banned by ' + (r.banned_by || '?') + ': ' + (r.ban_reason || 'no reason'), 's26-warn');
        if (r.has_save) {
          print('  ' + (r.job_title || '-') + ' (' + (r.job_status || '-') + ')' + (r.company ? ' at ' + r.company : '') + ' \u00b7 salary ' + money(r.salary));
          print('  balance ' + money(r.balance) + ' ASD \u00b7 ' + (r.active ? 'active career' : 'career not active'));
        } else print('  no career started');
        print('  convictions ' + r.convictions + ' \u00b7 wanted ' + r.wanted + (r.jail_seconds_left ? ' \u00b7 IN CUSTODY ' + fmtLeft(r.jail_seconds_left) : ''));
        print('  reports: ' + r.open_reports + ' open / ' + r.total_reports + ' total');
      });
    }),

    ban: safe(function (args) {
      if (!need(args, 2, '/r ban <user> <reason>')) return;
      var name = args[0], reason = args.slice(1).join(' ');
      return findOperator(name).then(function (u) {
        return adm('POST', '/api/admin/users/' + u.id + '/ban', { reason: reason });
      }).then(function (r) { say(r); });
    }),

    unban: safe(function (args) {
      if (!need(args, 1, '/r unban <user>')) return;
      return findOperator(args[0]).then(function (u) {
        return adm('POST', '/api/admin/users/' + u.id + '/unban', {});
      }).then(function (r) { say(r); });
    }),

    jail: safe(function (args) {
      if (!need(args, 2, '/r jail <user> <minutes> [reason]')) return;
      var mins = parseInt(args[1], 10);
      if (!(mins >= 0)) throw new Error('minutes must be a number (0 releases).');
      return adm('POST', '/api/admin/world/jail', { username: args[0], minutes: mins, reason: args.slice(2).join(' ') })
        .then(function (r) { say(r); });
    }),

    release: safe(function (args) {
      if (!need(args, 1, '/r release <user>')) return;
      return adm('POST', '/api/admin/world/jail', { username: args[0], minutes: 0, reason: 'Released by admin' })
        .then(function (r) { say(r); });
    }),

    admins: safe(function () {
      return adm('GET', '/api/admin/users?admins_only=1').then(function (r) {
        if (!r.success) { say(r); return; }
        print(r.users.map(function (u) { return u.username; }).join('  ') || '(none)');
      });
    }),

    reports: safe(function (args) {
      var st = (args[0] || 'open').toLowerCase();
      return adm('GET', '/api/admin/reports?status=' + encodeURIComponent(st)).then(function (r) {
        if (!r.success) { say(r); return; }
        if (!r.reports.length) { print('no ' + st + ' reports.', 's26-dim'); return; }
        r.reports.slice(0, 25).forEach(function (x) {
          print('#' + x.id + ' \u2192 ' + (x.target_username || '?') + ' \u00b7 ' + (x.reason || '') + ' \u00b7 by ' + (x.reporter || '?') +
            (x.details ? '\n    ' + x.details : ''));
        });
      });
    }),

    resolve: safe(function (args) {
      if (!need(args, 1, '/r resolve <report id> [resolved|dismissed|reviewing] [note]')) return;
      var id = parseInt(String(args[0]).replace('#', ''), 10);
      if (!(id > 0)) throw new Error('report id must be a number (see /r reports)');
      var rest = args.slice(1), status = 'resolved';
      if (rest.length && /^(resolved|dismissed|reviewing)$/i.test(rest[0])) status = rest.shift().toLowerCase();
      return adm('POST', '/api/admin/reports/' + id + '/resolve', { status: status, note: rest.join(' ') })
        .then(function (r) { print(r.success ? 'report #' + id + ' marked ' + status + '.' : (r.msg || 'failed.'), r.success ? 's26-ok' : 's26-err'); });
    }),

    queue: safe(function () {
      return adm('GET', '/api/admin/blabber/queue').then(function (r) {
        if (!r.success) { say(r); return; }
        if (!r.posts.length) { print('moderation queue is empty.', 's26-dim'); return; }
        r.posts.slice(0, 25).forEach(function (p) {
          print('#' + p.id + (p.hidden ? ' [hidden]' : '') + (p.flagged ? ' [flagged]' : '') + ' reports:' + p.reports + '\n    ' + p.body);
        });
      });
    }),

    hide: safe(function (args) {
      if (!need(args, 1, '/r hide <post id>')) return;
      return adm('POST', '/api/admin/blabber/' + parseInt(args[0], 10) + '/remove').then(function (r) { say(r, 'post hidden.'); });
    }),
    unhide: safe(function (args) {
      if (!need(args, 1, '/r unhide <post id>')) return;
      return adm('POST', '/api/admin/blabber/' + parseInt(args[0], 10) + '/restore').then(function (r) { say(r, 'post restored.'); });
    }),
    reveal: safe(function (args) {
      if (!need(args, 1, '/r reveal <post id>')) return;
      return adm('GET', '/api/admin/blabber/' + parseInt(args[0], 10) + '/reveal').then(function (r) {
        if (r.success) print('author: ' + r.author + '   (this lookup was logged)', 's26-warn'); else say(r);
      });
    }),

    leads: safe(function () {
      return adm('GET', '/api/admin/cheatcheck').then(function (r) {
        if (!r.success) { say(r); return; }
        print('average balance ' + money(r.avg_balance) + ' ASD. Top suspicion scores (leads, not verdicts):', 's26-dim');
        r.players.slice(0, 15).forEach(function (p) {
          print(p.username + '  score ' + p.suspicion + '  bal ' + money(p.balance) + ' (' + p.x_avg + 'x avg)  crimes24h ' + p.crimes_24h +
            '  sent24h ' + money(p.sent_24h) + '  reports ' + p.open_reports, p.suspicion >= 3 ? 's26-warn' : undefined);
        });
      });
    }),

    give: safe(function (args) {
      if (!need(args, 3, '/r give <user> <amount> <reason>')) return;
      var amt = parseFloat(args[1]);
      if (!(amt > 0)) throw new Error('amount must be a positive number (use /r take to remove).');
      return adm('POST', '/api/admin/economy/adjust', { username: args[0], amount: amt, reason: args.slice(2).join(' ') })
        .then(function (r) { say(r); });
    }),
    take: safe(function (args) {
      if (!need(args, 3, '/r take <user> <amount> <reason>')) return;
      var amt = parseFloat(args[1]);
      if (!(amt > 0)) throw new Error('amount must be a positive number.');
      return adm('POST', '/api/admin/economy/adjust', { username: args[0], amount: -amt, reason: args.slice(2).join(' ') })
        .then(function (r) { say(r); });
    }),

    regime: safe(function (args) {
      if (!args.length) {
        return adm('GET', '/api/world/state').then(function (r) {
          if (!r.success) { say(r); return; }
          print('current regime: ' + r.regime + ' (' + r.rules.label + ') \u00b7 changed ' + r.changed_ago_min + ' min ago');
          print('options: ' + Object.keys(r.regimes).join(', ') + '   set with /r regime <name>', 's26-dim');
        });
      }
      return adm('POST', '/api/admin/world/regime', { regime: args[0].toLowerCase() }).then(function (r) { say(r); });
    }),

    stats: safe(function () {
      return adm('GET', '/api/admin/stats').then(function (r) {
        if (!r.success) { say(r); return; }
        print('accounts ' + r.accounts + ' \u00b7 active players ' + r.active_players + ' \u00b7 admins ' + r.admins + ' \u00b7 banned ' + r.banned);
        print('open reports ' + r.open_reports + ' \u00b7 in custody ' + r.jailed + ' \u00b7 live announcements ' + r.active_announcements);
        print('regime ' + r.regime_label + ' \u00b7 average balance ' + money(r.avg_balance) + ' ASD');
      });
    }),

    audit: safe(function (args) {
      var n = Math.max(1, Math.min(parseInt(args[0], 10) || 15, 100));
      return adm('GET', '/api/admin/actions').then(function (r) {
        if (!r.success) { say(r); return; }
        if (!r.actions.length) { print('audit log is empty.', 's26-dim'); return; }
        r.actions.slice(0, n).forEach(function (a) { print(a.at + ' \u00b7 ' + a.admin + ' \u00b7 ' + a.action + ' \u00b7 ' + a.target + (a.detail ? ' \u00b7 ' + a.detail : '')); });
      });
    })
  };
  ADMIN_COMMANDS.broadcast = ADMIN_COMMANDS.announce;
  ADMIN_COMMANDS.anns = ADMIN_COMMANDS.announcements;
  Object.keys(ADMIN_COMMANDS).forEach(function (k) { COMMANDS[k] = ADMIN_COMMANDS[k]; });

  function parseSecs(v, flag) {
    var m = String(v || '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)(s|m|h|d)?$/);
    if (!m) throw new Error(flag + ' needs a duration like 30s, 10m, 2h or 1d (plain numbers = minutes).');
    var n = parseFloat(m[1]), u = m[2] || 'm';
    return Math.round(n * (u === 's' ? 1 : u === 'm' ? 60 : u === 'h' ? 3600 : 86400));
  }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec >= 86400) return (sec / 86400).toFixed(1).replace(/\.0$/, '') + 'd';
    if (sec >= 3600) return (sec / 3600).toFixed(1).replace(/\.0$/, '') + 'h';
    if (sec >= 60) return Math.round(sec / 60) + 'm';
    return sec + 's';
  }
  function marketShock(sign, args, word) {
    var usage = '/r ' + word + ' <SYMBOL|all> <percent> [-in 2h | -at 2026-10-01T18:00] [-ramp 30s] [-hold 10m] [-recover 30m] [-m headline]';
    if (args.length < 2) throw new Error('usage: ' + usage);
    var pct = parseFloat(String(args[1]).replace('%', ''));
    if (!isFinite(pct) || pct === 0) throw new Error('percent must be a number, e.g. 40 (the sign is added for you).');
    var body = { symbol: args[0].toUpperCase(), pct: sign * Math.abs(pct) };
    for (var i = 2; i < args.length; i++) {
      var f = args[i].toLowerCase();
      if (f === '-m') { body.note = args.slice(i + 1).join(' '); break; }
      if (f === '-in' || f === '-ramp' || f === '-hold' || f === '-recover' || f === '-at') {
        if (i + 1 >= args.length) throw new Error(f + ' needs a value.');
        var v = args[++i];
        if (f === '-at') body.start_at = v;
        else body[{ '-in': 'delay_s', '-ramp': 'ramp_s', '-hold': 'hold_s', '-recover': 'recover_s' }[f]] = parseSecs(v, f);
      } else throw new Error('unknown option ' + args[i] + '.  usage: ' + usage);
    }
    return adm('POST', '/api/admin/market/event', body).then(function (r) {
      if (say(r) && r.event) {
        var e = r.event;
        print('falls over ' + fmtDur(e.ramp_s) + ', holds ' + fmtDur(e.hold_s) + ', recovers over ' + fmtDur(e.recover_s) +
          ' \u00b7 cancel with /r cancel ' + e.id, 's26-dim');
      }
    });
  }

  var MARKET_COMMANDS = {
    crash: safe(function (args) { return marketShock(-1, args, 'crash'); }),
    boom: safe(function (args) { return marketShock(1, args, 'boom'); }),
    market: safe(function () {
      return adm('GET', '/api/admin/market/events').then(function (r) {
        if (!r.success) { say(r); return; }
        if (!r.events.length) { print('no market events yet. Try /r crash all 30 -in 1h', 's26-dim'); return; }
        r.events.slice(0, 20).forEach(function (e) {
          var when = e.status === 'scheduled' ? 'in ' + fmtDur(e.starts_in_s) : e.start + ' UTC';
          print('#' + e.id + ' ' + e.symbol + ' ' + (e.pct > 0 ? '+' : '') + e.pct + '%  [' + e.status + ']  ' + when +
            '  (' + fmtDur(e.ramp_s) + ' / ' + fmtDur(e.hold_s) + ' / ' + fmtDur(e.recover_s) + ')' + (e.note ? '  "' + e.note + '"' : ''),
            e.status === 'active' ? 's26-warn' : e.status === 'scheduled' ? 's26-ok' : 's26-dim');
        });
      });
    }),
    cancel: safe(function (args) {
      if (!need(args, 1, '/r cancel <market event id>')) return;
      var id = parseInt(String(args[0]).replace('#', ''), 10);
      if (!(id > 0)) throw new Error('event id must be a number (see /r market).');
      return adm('POST', '/api/admin/market/event/' + id + '/cancel').then(function (r) { say(r); });
    }),
    symbols: safe(function () {
      return adm('GET', '/api/admin/market/symbols').then(function (r) {
        if (!r.success) { say(r); return; }
        print('exchange stocks (full ramp/hold/recover curve): ' + r.economy.join(' '));
        print('desk stocks (one-off drop at start):            ' + r.desk.join(' '));
        print('ALL hits every ticker.', 's26-dim');
      });
    })
  };
  MARKET_COMMANDS.events = MARKET_COMMANDS.market;
  Object.keys(MARKET_COMMANDS).forEach(function (k) { COMMANDS[k] = MARKET_COMMANDS[k]; });


  // ---------------------------------------------------------------- live events
  function liveOpts(args, from, body, usage) {
    for (var i = from; i < args.length; i++) {
      var f = args[i].toLowerCase();
      if (f === '-m') { body.note = args.slice(i + 1).join(' '); break; }
      if (f === '-in' || f === '-at') {
        if (i + 1 >= args.length) throw new Error(f + ' needs a value.');
        var v = args[++i];
        if (f === '-at') body.start_at = v; else body.delay_s = parseSecs(v, f);
      } else throw new Error('unknown option ' + args[i] + '.  usage: ' + usage);
    }
    return body;
  }
  function liveSend(body) {
    return adm('POST', '/api/admin/live/event', body).then(function (r) {
      if (say(r) && r.event) print('cancel with /r cancelevent ' + r.event.id + ' \u00b7 list with /r live', 's26-dim');
    });
  }
  var LIVE_COMMANDS = {
    stimulus: safe(function (args) {
      var usage = '/r stimulus <amount each> [-in 2h | -at 2026-10-01T18:00] [-m message]';
      if (args.length < 1) throw new Error('usage: ' + usage);
      var amt = parseFloat(String(args[0]).replace(/,/g, ''));
      if (!(amt > 0)) throw new Error('amount must be a positive number.');
      return liveSend(liveOpts(args, 1, { kind: 'stimulus', amount: amt }, usage));
    }),
    levy: safe(function (args) {
      var usage = '/r levy <percent of balance> [-in 2h | -at ...] [-m message]';
      if (args.length < 1) throw new Error('usage: ' + usage);
      var pct = parseFloat(String(args[0]).replace('%', ''));
      if (!(pct > 0)) throw new Error('percent must be a positive number (1-50).');
      return liveSend(liveOpts(args, 1, { kind: 'levy', pct: pct }, usage));
    }),
    raffle: safe(function (args) {
      var usage = '/r raffle <prize each> <winners> [-in 2h | -at ...] [-m message]';
      if (args.length < 2) throw new Error('usage: ' + usage);
      var amt = parseFloat(String(args[0]).replace(/,/g, '')), w = parseInt(args[1], 10);
      if (!(amt > 0) || !(w > 0)) throw new Error('prize and winners must be positive numbers.');
      return liveSend(liveOpts(args, 2, { kind: 'raffle', amount: amt, winners: w }, usage));
    }),
    halt: safe(function (args) {
      if (!need(args, 1, '/r halt <30s|10m|2h> [reason]   (trading halt, max 24h)')) return;
      var secs = parseSecs(args[0], 'duration');
      return adm('POST', '/api/admin/live/halt', { minutes: secs / 60, reason: args.slice(1).join(' ') }).then(function (r) { say(r); });
    }),
    resume: safe(function () {
      return adm('POST', '/api/admin/live/halt', { minutes: 0 }).then(function (r) { say(r); });
    }),
    live: safe(function () {
      return adm('GET', '/api/admin/live/events').then(function (r) {
        if (!r.success) { say(r); return; }
        if (r.halt && r.halt.active) print('TRADING HALT active: ' + fmtLeft(r.halt.seconds_left) + ' left' + (r.halt.reason ? ' - ' + r.halt.reason : ''), 's26-warn');
        if (!r.events.length) { print('no live events yet. Try /r stimulus 500 -in 1h', 's26-dim'); return; }
        r.events.slice(0, 20).forEach(function (e) {
          var what = e.kind === 'levy' ? e.pct + '%' : money(e.amount) + ' ASD' + (e.kind === 'raffle' ? ' x' + e.winners : '');
          var when = e.status === 'scheduled' ? 'in ' + fmtDur(e.starts_in_s) : e.start + ' UTC';
          print('#' + e.id + ' ' + e.kind + ' ' + what + '  [' + e.status + ']  ' + when + (e.result ? '  -> ' + e.result : ''),
            e.status === 'scheduled' ? 's26-ok' : 's26-dim');
        });
      });
    }),
    cancelevent: safe(function (args) {
      if (!need(args, 1, '/r cancelevent <live event id>')) return;
      var id = parseInt(String(args[0]).replace('#', ''), 10);
      if (!(id > 0)) throw new Error('event id must be a number (see /r live).');
      return adm('POST', '/api/admin/live/event/' + id + '/cancel').then(function (r) { say(r); });
    })
  };
  Object.keys(LIVE_COMMANDS).forEach(function (k) { COMMANDS[k] = LIVE_COMMANDS[k]; });

  function runCommand(line) {
    if (!terminalAdmin) {
      print('Access denied: administrator access is required.', 's26-err');
      return Promise.resolve();
    }
    line = String(line || '').trim();
    if (!line) return Promise.resolve();
    var m = line.match(/^\/?r(?:\s+(.*))?$/i);
    var rest = m ? (m[1] || '') : line.replace(/^\/r\s+/i, '');
    if (!m && /^\/\S/.test(line)) {
      print('unknown prefix. Commands look like: /r help', 's26-err');
      return Promise.resolve();
    }
    var parts = rest.trim().split(/\s+/).filter(Boolean);
    var name = (parts.shift() || 'help').toLowerCase();
    var fn = Object.prototype.hasOwnProperty.call(COMMANDS, name) ? COMMANDS[name] : null;
    if (!fn) { print('unknown command: ' + name + '   (try /r help)', 's26-err'); return Promise.resolve(); }
    try { return Promise.resolve(fn(parts)); }
    catch (e) { print('error: ' + e.message, 's26-err'); return Promise.resolve(); }
  }
  window.AstraTerminal = { run: runCommand };

  function submit() {
    if (busy || !inEl) return;
    var line = inEl.value;
    inEl.value = '';
    if (!line.trim()) return;
    hist.push(line); hIdx = hist.length;
    printHtml('<span class="s26-prompt">' + esc(username()) + '@astra:~$</span> ' + esc(line));
    busy = true;
    inEl.disabled = true;
    runCommand(line).then(function () { }, function () { }).then(function () {
      busy = false; inEl.disabled = false; inEl.focus();
      if (outEl) outEl.scrollTop = outEl.scrollHeight;
    });
  }

  function css() {
    if ($('astra26Styles')) return;
    var s = document.createElement('style'); s.id = 'astra26Styles';
    s.textContent = [
      '.s26-term{display:flex; flex-direction:column; height:100%; min-height:300px;}',
      '.s26-out{flex:1; overflow:auto; background:#000; border:1px solid var(--border-color); padding:8px; font-size:12px; line-height:1.5; color:#39ff88; font-family:Consolas,"Courier New",monospace; min-height:220px;}',
      '.s26-line{white-space:pre-wrap; word-break:break-word;}',
      '.s26-dim{color:#5c7a99;} .s26-err{color:#ff6b6b;} .s26-warn{color:#ffbb00;} .s26-ok{color:#00ffcc;}',
      '.s26-prompt{color:#00ffcc;}',
      '.s26-inrow{display:flex; gap:6px; align-items:center; margin-top:6px; font-family:Consolas,"Courier New",monospace; font-size:12px; color:#00ffcc;}',
      '.s26-in{flex:1; background:#000; border:1px solid var(--border-color); color:#fff; padding:7px; font-family:inherit; font-size:12px; outline:none;}',
      '.s26-in:focus{border-color:var(--pixel-cyan);}',
      '.s26-rd{display:flex; gap:10px; height:100%; min-height:320px;}',
      '.s26-rd-list{width:210px; flex:none; overflow:auto; border-right:1px solid var(--border-color); padding-right:6px;}',
      '.s26-rd-item{font-size:11px; padding:5px 6px; cursor:pointer; color:#9aa7c7; word-break:break-all;}',
      '.s26-rd-item:hover{background:rgba(0,255,204,.08);} .s26-rd-item.on{color:var(--pixel-cyan); background:rgba(0,255,204,.12);}',
      '.s26-rd-body{flex:1; overflow:auto;}',
      '.s26-doc{margin-bottom:14px; border:1px solid var(--border-color);}',
      '.s26-doc-h{display:flex; justify-content:space-between; align-items:center; padding:5px 8px; background:rgba(0,255,204,.08); font-size:11px; color:var(--pixel-yellow);}',
      '.s26-pre{margin:0; padding:10px; white-space:pre-wrap; font-size:11.5px; line-height:1.65; color:#cfd8e3; font-family:inherit;}'
    ].join('\n');
    document.head.appendChild(s);
  }
  function addNav(id, label) {
    var nav = document.querySelector('.header-nav');
    if (!nav || $('nav-' + id)) return;
    var b = document.createElement('button');
    b.className = 'terminal-btn'; b.id = 'nav-' + id; b.textContent = label;
    b.onclick = function () { window.switchView(id); };
    var settings = $('nav-settings');
    if (settings) nav.insertBefore(b, settings); else nav.appendChild(b);
  }
  function addView(id, html) {
    if ($('view-' + id)) return $('view-' + id);
    var host = $('view-dashboard'), wrap = (host && host.parentNode) || $('mainAppWrapper');
    if (!host || !wrap) return null;
    var v = document.createElement('div');
    v.id = 'view-' + id; v.className = 'app-view'; v.innerHTML = html;
    wrap.insertBefore(v, host);
    return v;
  }

  var done = false, buildStarted = false;
  function build() {
    if (done || buildStarted) return;
    if (!document.querySelector('.header-nav') || !$('view-dashboard')) return;
    buildStarted = true;
    fetch('/api/settings').then(function (response) {
      return response.ok ? response.json() : null;
    }).catch(function () { return null; }).then(function (result) {
      terminalAdmin = !!(result && result.success && result.settings && result.settings.is_admin);
      css();
      if (terminalAdmin) {
        addView('terminal',
          '<div class="terminal-panel s26-term">' +
            '<div class="panel-header"><div class="panel-heading-title">ADMIN TERMINAL</div>' +
            '<span style="font-size:10px; color:#5c7a99;">type /r help</span></div>' +
            '<div class="s26-out" id="trmOut"></div>' +
            '<div class="s26-inrow"><span id="trmPrompt">operator@astra:~$</span><input class="s26-in" id="trmIn" autocomplete="off" spellcheck="false" placeholder="/r help"></div>' +
          '</div>');
        addNav('terminal', '[\u2328] ADMIN TERMINAL');
      }
      addView('reader',
        '<div class="terminal-panel">' +
          '<div class="panel-header"><div class="panel-heading-title">READER</div></div>' +
          '<div class="s26-rd"><div class="s26-rd-list" id="rdList"></div><div class="s26-rd-body" id="rdBody"></div></div>' +
        '</div>');
      addView('news', newsHtml());
      addNav('reader', '[\u2263] READER');
      addNav('news', '[NEWS] ASTRA WIRE');
      if (terminalAdmin) {
        outEl = $('trmOut'); inEl = $('trmIn');
        $('trmPrompt').textContent = username() + '@astra:~$';
        print('ASTRA ADMIN TERMINAL v2.6  -  type /r help for commands', 's26-ok');
        inEl.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          else if (e.key === 'ArrowUp') { if (hIdx > 0) { hIdx--; inEl.value = hist[hIdx] || ''; } e.preventDefault(); }
          else if (e.key === 'ArrowDown') { if (hIdx < hist.length) { hIdx++; inEl.value = hist[hIdx] || ''; } e.preventDefault(); }
        });
        outEl.parentNode.addEventListener('click', function () { if (!busy && window.getSelection().toString() === '') inEl.focus(); });
      }
      Reader.render();
      renderNews();
      done = true;
      if (window.winosRescanApps) window.winosRescanApps();
      setTimeout(function () {
        var states = ds() && ds().get().window_states || {};
        ['reader', 'news'].concat(terminalAdmin ? ['terminal'] : []).forEach(function (id) {
          if (states[id] && window.switchView) window.switchView(id);
        });
      }, 150);
      if (ds()) ds().ready.then(restore); else restore();
      window.addEventListener('astra:desktop-state', restore);
    });
  }
  function waitAndRun(n) {
    if (($('view-dashboard') && document.querySelector('.header-nav')) || n <= 0) { build(); return; }
    setTimeout(function () { waitAndRun(n - 1); }, 150);
  }
  window.addEventListener('astrax:ready', function () { waitAndRun(45); });
  setTimeout(function () { waitAndRun(1); }, 100);
})();
