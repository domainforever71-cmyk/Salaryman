/* ===========================================================================
 * astra_stage24_learn.js - Stage 24: ASTRAWIKI (wiki + search + finance calc + exams)
 * and the market-session ticker. Gates are enforced by learn.py on the server;
 * this file only teaches, tests, and explains a 403 when one fires.
 * =========================================================================== */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function api(u, o) { return fetch(u, o).then(function (r) { return r.json(); }).catch(function () { return { success: false, msg: 'Network error.' }; }); }
  function post(u, b) { return api(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); }

  var st = null, tab = 'wiki', reading = null, readTimer = null, exam = null, examTimer = null, examEnd = 0, lastResult = '';

  /* ---- finance calculators (client side; the exam is graded server side) ---- */
  function n(v) { return parseFloat(v); }
  var CALCS = [
    { id: 'fv', name: 'Compound growth', f: [['P', 'Principal $', 1000], ['r', 'Rate %/yr', 6], ['n', 'Years', 5]],
      run: function (v) { return 'Future value: ' + money(v.P * Math.pow(1 + v.r / 100, v.n)); } },
    { id: 'pmt', name: 'Loan payment', f: [['P', 'Principal $', 10000], ['apr', 'APR %', 12], ['y', 'Years', 3]],
      run: function (v) { var r = v.apr / 1200, k = v.y * 12, m = r === 0 ? v.P / k : v.P * r / (1 - Math.pow(1 + r, -k));
        return 'Monthly: ' + money(m) + ' | total paid: ' + money(m * k) + ' | interest: ' + money(m * k - v.P); } },
    { id: 'real', name: 'Real return', f: [['n', 'Nominal %', 8], ['i', 'Inflation %', 4]],
      run: function (v) { return 'Real return: ' + (((1 + v.n / 100) / (1 + v.i / 100) - 1) * 100).toFixed(2) + '%'; } },
    { id: 'pl', name: 'Trade profit', f: [['q', 'Shares', 10], ['b', 'Buy $', 50], ['s', 'Sell $', 55], ['fee', 'Fee $ per trade', 2]],
      run: function (v) { return 'Net P/L: ' + money(v.q * (v.s - v.b) - 2 * v.fee); } },
    { id: 'be', name: 'Break-even price', f: [['b', 'Buy $', 50], ['f', 'Fee % per leg', 1]],
      run: function (v) { return 'Sell above: ' + money(v.b * (1 + v.f / 100) / (1 - v.f / 100)); } },
    { id: 'avg', name: 'Average cost', f: [['q1', 'Shares 1', 10], ['p1', 'Price 1', 40], ['q2', 'Shares 2', 10], ['p2', 'Price 2', 60]],
      run: function (v) { return 'Average cost: ' + money((v.q1 * v.p1 + v.q2 * v.p2) / (v.q1 + v.q2)); } },
    { id: 'size', name: 'Position size', f: [['a', 'Account $', 5000], ['rp', 'Risk %', 1], ['e', 'Entry $', 60], ['s', 'Stop $', 55]],
      run: function (v) { return v.e <= v.s ? 'Stop must be below entry.' : 'Max shares: ' + Math.floor(v.a * v.rp / 100 / (v.e - v.s)); } },
    { id: 'rec', name: 'Drawdown recovery', f: [['d', 'Loss %', 30]],
      run: function (v) { return v.d >= 100 ? 'Wiped out.' : 'Gain needed: ' + (v.d / (100 - v.d) * 100).toFixed(2) + '%'; } },
    { id: 'ev', name: 'Expected value', f: [['p', 'Win prob %', 40], ['w', 'Win $', 200], ['l', 'Loss $', 100]],
      run: function (v) { return 'EV: ' + money(v.p / 100 * v.w - (1 - v.p / 100) * v.l); } },
    { id: 'net', name: 'Net pay / runway', f: [['g', 'Gross monthly $', 4000], ['t', 'Tax %', 22], ['c', 'Monthly costs $', 1500], ['cash', 'Cash $', 3000]],
      run: function (v) { var net = v.g * (1 - v.t / 100); return 'Net: ' + money(net) + ' | saved/mo: ' + money(net - v.c) + ' | runway: ' + (v.c ? (v.cash / v.c).toFixed(2) : 'inf') + ' months'; } }
  ];

  function injectStyles() {
    if ($('astra24Styles')) return;
    var s = document.createElement('style'); s.id = 'astra24Styles';
    s.textContent = [
      '.a24-tabs{display:flex; gap:6px; margin-bottom:8px;} .a24-tabs .on{background:var(--pixel-cyan); color:#000;}',
      '.a24-row{display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:6px 0;}',
      '.a24-card{border:1px solid var(--border-color); padding:10px; flex:1; min-width:200px;} .a24-card.ok{border-color:#39d353;}',
      '.a24-dim{color:#8a97ad; font-size:10.5px;} .a24-in{background:#000; color:var(--pixel-cyan); border:1px solid var(--border-color); padding:4px 6px; font-family:inherit; width:110px;}',
      '.a24-art{border:1px solid var(--border-color); padding:10px; margin-top:8px; font-size:12px; line-height:1.5;} .a24-art p{margin:6px 0;}',
      '#mktSession{margin-right:10px; font-size:10.5px; letter-spacing:.06em; color:var(--pixel-cyan); cursor:pointer;}',
      '#mktSession i{display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:5px; background:#39d353; box-shadow:0 0 6px #39d353;}',
      '#mktSession.thin i{background:#ffbb00; box-shadow:0 0 6px #ffbb00;}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function addNav() {
    var nav = document.querySelector('.header-nav');
    if (!nav || $('nav-learn')) return;
    var b = document.createElement('button');
    b.className = 'terminal-btn'; b.id = 'nav-learn'; b.textContent = 'ASTRAWIKI';
    b.onclick = function () { window.switchView('learn'); };
    var s = $('nav-settings'); if (s) nav.insertBefore(b, s); else nav.appendChild(b);
  }
  function addView() {
    if ($('view-learn')) return;
    var host = $('view-dashboard'), wrap = (host && host.parentNode) || $('mainAppWrapper');
    if (!host || !wrap) return;
    var v = document.createElement('div'); v.id = 'view-learn'; v.className = 'app-view';
    v.innerHTML = '<div class="terminal-panel"><div class="panel-header"><div class="panel-heading-title">ASTRAWIKI &mdash; LEARN, CALCULATE, CERTIFY</div></div><div id="a24Body">Loading...</div></div>';
    wrap.insertBefore(v, host);
  }
  function isActive() { var v = $('view-learn'); return v && v.classList.contains('active-view'); }

  function certBadges() {
    return st.certs.map(function (c) {
      return '<span class="a24-dim" style="margin-right:10px;">' + (c.passed ? '[\u2713]' : '[ ]') + ' ' + esc(c.label) + '</span>';
    }).join('');
  }

  function render() {
    var el = $('a24Body'); if (!el || !st) return;
    if (tab === 'exam' && exam) { return; }              // do not clobber a sitting in progress
    if (tab !== 'exam' && el.getAttribute('data-tab') === tab) return;   // keep typed values, results, open article
    el.setAttribute('data-tab', tab);
    var tabs = ['wiki', 'exam', 'calc'].map(function (t) {
      return '<button class="terminal-btn' + (t === tab ? ' on' : '') + '" onclick="AstraLearn.tab(\'' + t + '\')">' + { wiki: 'WIKI + SEARCH', exam: 'EXAM DESK', calc: 'CALC' }[t] + '</button>';
    }).join('');
    var body = '';
    if (tab === 'wiki') body = wikiHtml(); else if (tab === 'exam') body = examHtml(); else body = calcHtml();
    el.innerHTML = '<div class="a24-tabs">' + tabs + '</div><div>' + certBadges() + '</div>' + body;
    if (tab === 'calc') calcRun();
  }

  function wikiHtml() {
    var arts = st.articles.map(function (a) {
      return '<button class="terminal-btn" onclick="AstraLearn.open(\'' + a.id + '\')">' + esc(a.title) + '</button>';
    }).join(' ');
    return '<div class="a24-row"><input id="a24Q" class="a24-in" style="width:220px" placeholder="search: loan, fee, stop loss..." onkeydown="if(event.key===\'Enter\')AstraLearn.search()">' +
      '<button class="terminal-btn" onclick="AstraLearn.search()">SEARCH</button></div>' +
      '<div class="a24-row">' + arts + '</div><div id="a24Res"></div><div id="a24Art"></div>' +
      '<div class="a24-dim">Locked out of loans, jobs or trading? Read the matching article, then sit the exam.</div>';
  }

  function examHtml() {
    var cards = st.certs.map(function (c) {
      var state = c.passed ? '<b style="color:#39d353">CERTIFIED</b>'
        : !c.prereq_ok ? '<span class="a24-dim">Needs ' + esc(st.certs.filter(function (x) { return x.id === c.prereq; })[0].label) + ' first</span>'
        : c.lock_left ? '<span class="a24-dim">Locked ' + c.lock_left + 's</span>'
        : '<button class="terminal-btn" onclick="AstraLearn.start(\'' + c.id + '\')">SIT EXAM (' + (c.fee ? money(c.fee) : 'free') + ')</button>';
      return '<div class="a24-card' + (c.passed ? ' ok' : '') + '"><b>' + esc(c.label) + '</b><div class="a24-dim" style="margin:4px 0;">Unlocks: ' + esc(c.unlocks) + '</div>' +
        '<div class="a24-dim">Study: <a href="#" onclick="AstraLearn.open(\'' + c.article + '\');AstraLearn.tab(\'wiki\');return false;">' + esc(c.article) + '</a></div><div style="margin-top:6px;">' + state + '</div></div>';
    }).join('');
    return '<div class="a24-dim">' + st.questions + ' numeric questions, pass ' + st.pass_mark + '. Fresh numbers each sitting. Fee is not refunded. Have the article open for ' + st.study_seconds + 's first. Use CALC.</div>' +
      '<div class="a24-row">' + cards + '</div><div id="a24Exam"></div><div id="a24Msg" class="a24-dim">' + esc(lastResult) + '</div>';
  }

  function calcHtml() {
    var opts = CALCS.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
    return '<div class="a24-row"><select id="a24Calc" class="a24-in" style="width:200px" onchange="AstraLearn.calcPick()">' + opts + '</select></div>' +
      '<div id="a24CalcF" class="a24-row"></div><div id="a24CalcOut" style="margin-top:8px; color:var(--pixel-yellow);"></div>';
  }
  function calcPick() {
    var c = CALCS.filter(function (x) { return x.id === $('a24Calc').value; })[0];
    $('a24CalcF').innerHTML = c.f.map(function (f) {
      return '<label class="a24-dim">' + esc(f[1]) + '<br><input class="a24-in a24-cf" data-k="' + f[0] + '" value="' + f[2] + '" oninput="AstraLearn.calcRun()"></label>';
    }).join('');
    calcRun();
  }
  function calcRun() {
    var sel = $('a24Calc'); if (!sel) return;
    var c = CALCS.filter(function (x) { return x.id === sel.value; })[0], v = {}, bad = false;
    if (!$('a24CalcF').children.length) { calcPick(); return; }
    Array.prototype.slice.call(document.querySelectorAll('.a24-cf')).forEach(function (i) { var x = n(i.value); if (isNaN(x)) bad = true; v[i.getAttribute('data-k')] = x; });
    $('a24CalcOut').textContent = bad ? 'Enter numbers only.' : c.run(v);
  }

  function open(id) {
    api('/api/learn/article/' + id).then(function (d) {
      if (!d.success) return;
      reading = d; reading.t0 = Date.now() - d.studied * 1000;
      if (tab !== 'wiki') { tab = 'wiki'; $('a24Body').removeAttribute('data-tab'); render(); }
      var a = $('a24Art'); if (!a) return;
      a.innerHTML = '<div class="a24-art"><b>' + esc(d.title) + '</b>' + d.body.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') +
        (d.cert ? '<div class="a24-dim" id="a24Study"></div>' : '') + '</div>';
      clearInterval(readTimer);
      readTimer = setInterval(function () {
        var e = $('a24Study'); if (!e) { clearInterval(readTimer); return; }
        var s = Math.floor((Date.now() - reading.t0) / 1000);
        e.textContent = s >= d.study_needed ? 'Study time met. You may sit the exam.' : 'Studying: ' + s + '/' + d.study_needed + 's';
      }, 500);
    });
  }
  function search() {
    var q = ($('a24Q') || {}).value || '';
    api('/api/learn/search?q=' + encodeURIComponent(q)).then(function (d) {
      var r = $('a24Res'); if (!r) return;
      r.innerHTML = !d.results || !d.results.length ? '<div class="a24-dim">Nothing found. Try other words.</div>'
        : d.results.map(function (x) { return '<div class="a24-card" style="margin:4px 0;"><a href="#" onclick="AstraLearn.open(\'' + x.id + '\');return false;"><b>' + esc(x.title) + '</b></a><div class="a24-dim">' + esc(x.snippet) + '</div></div>'; }).join('');
    });
  }

  function start(cert) {
    post('/api/learn/exam/start', { cert: cert }).then(function (d) {
      if (!d.success) { lastResult = d.msg || 'Cannot start.'; var m = $('a24Msg'); if (m) { m.textContent = lastResult; m.style.color = '#ff7b7b'; } return; }
      exam = d; examEnd = Date.now() + d.seconds_left * 1000; lastResult = '';
      var box = $('a24Exam'); if (!box) return;
      box.innerHTML = '<div class="a24-art"><b>' + esc(d.cert.toUpperCase()) + ' EXAM</b> <span id="a24Clock" class="a24-dim"></span>' +
        d.questions.map(function (q, i) { return '<p>' + (i + 1) + '. ' + esc(q) + '<br><input class="a24-in a24-ans" placeholder="answer"></p>'; }).join('') +
        '<button class="terminal-btn" onclick="AstraLearn.submit()">SUBMIT</button></div>';
      clearInterval(examTimer);
      examTimer = setInterval(function () {
        var l = Math.max(0, Math.floor((examEnd - Date.now()) / 1000)), c = $('a24Clock');
        if (c) c.textContent = Math.floor(l / 60) + ':' + ('0' + (l % 60)).slice(-2) + ' left';
        if (l <= 0) clearInterval(examTimer);
      }, 500);
    });
  }
  function submit() {
    var ans = Array.prototype.slice.call(document.querySelectorAll('.a24-ans')).map(function (i) { return i.value; });
    post('/api/learn/exam/submit', { answers: ans }).then(function (d) {
      clearInterval(examTimer); exam = null;
      lastResult = d.msg || (d.success ? 'Done.' : 'Failed.');
      if (d.marks) lastResult += '  [' + d.marks.map(function (x) { return x ? '\u2713' : '\u2717'; }).join(' ') + ']';
      refresh(true);
    });
  }

  function refresh(force) {
    return api('/api/learn/status').then(function (d) {
      if (!d || !d.success) return;
      st = d; ticker();
      if (force) { var el = $('a24Body'); if (el) el.removeAttribute('data-tab'); }
      if (isActive()) render();
      if (force) { var m = $('a24Msg'); if (m) { m.textContent = lastResult; m.style.color = lastResult.indexOf('PASSED') === 0 ? '#39d353' : '#ff7b7b'; } }
    });
  }

  /* ---- 24/7 market-session ticker (cosmetic: the market never closes) ---- */
  function ticker() {
    var tray = $('winosTray'); if (!tray || !st) return;
    var t = $('mktSession');
    if (!t) { t = document.createElement('span'); t.id = 'mktSession'; t.title = 'Markets are open 24/7. Liquidity follows the sun.'; tray.insertBefore(t, tray.firstChild); t.onclick = function () { window.switchView('learn'); }; }
    var now = new Date(), hh = ('0' + now.getUTCHours()).slice(-2), mm = ('0' + now.getUTCMinutes()).slice(-2);
    t.className = st.session.depth === 'thin' ? 'thin' : '';
    t.innerHTML = '<i></i>' + esc(st.session.label) + ' \u00B7 ' + hh + ':' + mm + ' UTC \u00B7 OPEN 24/7';
  }

  /* ---- explain a knowledge gate instead of a bare 403 ---- */
  var _fetch = window.fetch;
  window.fetch = function () {
    return _fetch.apply(this, arguments).then(function (r) {
      if (r.status === 403) {
        r.clone().json().then(function (d) {
          if (d && d.gate) {
            var t = $('a22Toast');
            if (!t) { t = document.createElement('div'); t.id = 'a22Toast'; t.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:100700;padding:10px 18px;background:#000;border:1px solid #ffbb00;color:#ffbb00;'; document.body.appendChild(t); }
            t.textContent = d.msg + ' (click to open ASTRAWIKI)'; t.style.display = 'block'; t.style.cursor = 'pointer';
            t.onclick = function () { t.style.display = 'none'; tab = 'exam'; window.switchView('learn'); };
            clearTimeout(t._g); t._g = setTimeout(function () { t.style.display = 'none'; }, 7000);
          }
        }).catch(function () {});
      }
      return r;
    });
  };

  window.AstraLearn = {
    tab: function (t) { tab = t; exam = null; clearInterval(examTimer); var el = $('a24Body'); if (el) el.removeAttribute('data-tab'); reading = null; render(); },
    open: open, search: search, start: start, submit: submit, calcPick: calcPick, calcRun: calcRun, refresh: refresh
  };

  window.addEventListener('astrax:ready', function () {
    injectStyles();
    var tries = 0;
    (function boot() {
      addNav(); addView();
      if ($('winosTray') && $('nav-learn')) { refresh(true); return; }
      if (++tries < 60) setTimeout(boot, 250);
    })();
    setInterval(function () { if (!document.hidden) refresh(false); }, 15000);
    setInterval(ticker, 30000);
  });
})();
