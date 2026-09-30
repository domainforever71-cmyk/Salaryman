/* ===========================================================================
 * astra_stage20_world.js - Stage 20. Frontend for world.py + economy.py.
 *
 *  STOCK DESK   (view-stockdesk)  5 stocks, dividend countdown, finite share pool,
 *                                 buy average, 4 currencies, fees, inflation
 *  CIVICS       (view-civics)     vote the regime, commit crimes, custody + bail
 *  BLABBER      (view-blabber)    parody social feed, anonymous or named, reportable
 *  NOTEPAD PRO  (view-notespro)   paid notes app (import/export/share) + signed stats
 *  ADMIN+       (view-adminplus)  admins only: post queue, reveal, jail, cheat leads
 *
 * Same boot contract as every other stage: wait for astrax:ready, build views,
 * add nav buttons, call winosRescanApps(). All server text goes through esc().
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n, c) {
    return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (c ? ' ' + c : '');
  }
  function addNavButton(id, label) {
    var nav = document.querySelector('.header-nav');
    if (!nav || $('nav-' + id)) return;
    var b = document.createElement('button');
    b.className = 'terminal-btn'; b.id = 'nav-' + id; b.textContent = label;
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
  function api(url, opts) { return fetch(url, opts).then(function (r) { return r.json(); }).catch(function () { return { success: false, msg: 'Network error.' }; }); }
  function post(url, body) { return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); }
  function active(id) { var v = $('view-' + id); return v && v.classList.contains('active-view'); }
  function say(id, msg, ok) { var e = $(id); if (e) { e.textContent = msg || ''; e.style.color = ok ? '#39d353' : '#ff7b7b'; } }
  function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function panel(title, inner, extra) {
    return '<div class="terminal-panel" ' + (extra || '') + '><div class="panel-header"><div class="panel-heading-title">' + title + '</div></div>' + inner + '</div>';
  }
  function injectStyles() {
    if ($('astra20Styles')) return;
    var s = document.createElement('style'); s.id = 'astra20Styles';
    s.textContent = [
      '.a20-row{display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:6px 0;}',
      '.a20-box{border:1px solid var(--border-color); padding:6px 10px; min-width:110px; text-align:center; font-size:11px;}',
      '.a20-box b{display:block; font-size:15px; color:var(--pixel-yellow);}',
      '.a20-in{background:#000; border:1px solid var(--border-color); color:#fff; padding:6px; font-family:inherit; font-size:11.5px;}',
      'textarea.a20-in{width:100%; min-height:150px; resize:vertical;}',
      '.a20-up{color:#39d353;} .a20-down{color:#ff7b7b;} .a20-dim{color:#8a97ad; font-size:10.5px;}',
      '.a20-card{border:1px solid var(--border-color); padding:8px; flex:1; min-width:190px;}',
      '.a20-card.sel{border-color:var(--pixel-cyan);}',
      '.a20-post{border-bottom:1px solid var(--border-color); padding:7px 0;}',
      '.a20-banner{border:1px solid #ff7b7b; color:#ff7b7b; padding:8px; margin-bottom:8px; text-align:center;}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* =======================================================================
   * STOCK DESK
   * ===================================================================== */
  var eco = null, symIdx = 0, hist = {};
  var CURS = ['ASD', 'VLT', 'KRN', 'DRX'];

  function deskHtml() {
    var opts = CURS.map(function (c) { return '<option>' + c + '</option>'; }).join('');
    return '' +
      panel('WALLET &amp; CURRENCY EXCHANGE',
        '<div class="a20-row" id="qdWallet"></div><div class="a20-dim" id="qdFees"></div>' +
        '<div class="a20-row"><input class="a20-in" id="qdAmt" type="number" min="0" placeholder="amount" style="width:110px">' +
        '<select class="a20-in" id="qdFrom">' + opts + '</select> &rarr; <select class="a20-in" id="qdTo">' + opts.replace('<option>ASD', '<option selected>ASD') + '</select>' +
        '<button class="terminal-btn" onclick="AstraDesk.convert()">CONVERT</button><span id="qdConvMsg" class="a20-dim"></span></div>' +
        '<div class="a20-dim" id="qdRates"></div>') +
      panel('<span id="qdTitle">STOCK</span>',
        '<div class="a20-row" style="justify-content:space-between;">' +
          '<button class="terminal-btn" onclick="AstraDesk.step(-1)">&larr;</button>' +
          '<div class="a20-box">DIVIDENDS<b id="qdDiv">-</b><span id="qdDivAmt" class="a20-dim"></span></div>' +
          '<div style="text-align:center;"><div id="qdPrice" style="font-size:22px; color:#fff;"></div><div id="qdAvg" class="a20-dim"></div></div>' +
          '<div class="a20-box">AVAILABLE SHARES<b id="qdAvail">-</b><span id="qdFloat" class="a20-dim"></span></div>' +
          '<button class="terminal-btn" onclick="AstraDesk.step(1)">&rarr;</button></div>' +
        '<svg id="qdChart" viewBox="0 0 600 150" style="width:100%; height:150px; background:#05070d; border:1px solid var(--border-color);"></svg>' +
        '<div class="a20-row" id="qdHold"></div>' +
        '<div class="a20-row"><input class="a20-in" id="qdQty" type="number" min="1" max="1000" value="10" style="width:90px">' +
        '<button class="terminal-btn" onclick="AstraDesk.trade(\'buy\')">BUY</button>' +
        '<button class="terminal-btn" onclick="AstraDesk.trade(\'sell\')">SELL</button>' +
        '<button class="terminal-btn" onclick="AstraDesk.claim()">CLAIM DIVIDENDS</button></div>' +
        '<div id="qdMsg" class="a20-dim"></div>');
  }

  function drawChart(s) {
    var svg = $('qdChart'), ser = hist[s.symbol];
    if (!svg || !ser || !ser.length) return;
    var lo = Math.min.apply(null, ser), hi = Math.max.apply(null, ser);
    if (s.buy_avg) { lo = Math.min(lo, s.buy_avg); hi = Math.max(hi, s.buy_avg); }
    var pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
    function y(v) { return 145 - ((v - lo) / (hi - lo)) * 140; }
    var pts = ser.map(function (v, i) { return (i * 600 / (ser.length - 1)).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ');
    var up = ser[ser.length - 1] >= ser[0];
    svg.innerHTML = '<polyline fill="none" stroke="' + (up ? '#39d353' : '#ff7b7b') + '" stroke-width="2" points="' + pts + '"/>' +
      (s.buy_avg ? '<line x1="0" x2="600" y1="' + y(s.buy_avg) + '" y2="' + y(s.buy_avg) + '" stroke="#ffbb00" stroke-dasharray="6 5"/>' +
        '<text x="6" y="' + (y(s.buy_avg) - 4) + '" fill="#ffbb00" font-size="10">buy avg ' + s.buy_avg.toFixed(2) + '</text>' : '');
  }

  function deskRender() {
    if (!eco) return;
    var s = eco.stocks[symIdx % eco.stocks.length];
    $('qdWallet').innerHTML = CURS.map(function (c) { return '<div class="a20-box">' + c + '<b>' + fmt(eco.balances[c]) + '</b></div>'; }).join('') +
      '<div class="a20-box">PORTFOLIO<b>' + fmt(eco.portfolio_value_asd) + '</b><span class="a20-dim">ASD</span></div>';
    $('qdFees').textContent = 'Trade fee ' + eco.fees.trade_pct + '% (min ' + eco.fees.trade_min + ') \u00b7 conversion spread ' + eco.fees.convert_spread_pct + '% \u00b7 price index ' + eco.price_index + 'x since launch';
    $('qdRates').innerHTML = CURS.filter(function (c) { return c !== 'ASD'; }).map(function (c) {
      var x = eco.currencies[c]; return c + ' = ' + x.to_asd + ' ASD (inflation ' + x.inflation_per_day_pct + '%/day)';
    }).join(' &nbsp;|&nbsp; ') + ' &nbsp;|&nbsp; ASD inflation ' + eco.currencies.ASD.inflation_per_day_pct + '%/day';
    $('qdTitle').textContent = '$' + s.symbol + ' \u2013 ' + s.name + ' (' + s.currency + ')';
    $('qdPrice').innerHTML = fmt(s.price) + ' <span class="' + (s.change_pct >= 0 ? 'a20-up' : 'a20-down') + '" style="font-size:12px;">' + (s.change_pct >= 0 ? '+' : '') + s.change_pct + '%</span>';
    $('qdAvg').textContent = s.buy_avg ? 'Buy average: ' + fmt(s.buy_avg) : 'You hold none';
    $('qdAvail').textContent = s.available.toLocaleString();
    $('qdFloat').textContent = 'of ' + s.float.toLocaleString() + ' \u00b7 fewer left = pricier';
    $('qdDivAmt').textContent = fmt(s.div_per_share) + ' / share';
    $('qdHold').innerHTML = '<div class="a20-box">YOU HOLD<b>' + s.shares + '</b></div>' +
      '<div class="a20-box">VALUE<b>' + fmt(s.shares * s.price) + '</b><span class="a20-dim">' + s.currency + '</span></div>' +
      '<div class="a20-box">DIVIDENDS DUE<b>' + fmt(s.pending_dividends) + '</b><span class="a20-dim">' + s.currency + '</span></div>';
    drawChart(s);
  }
  function deskCountdown() {
    if (!eco || !active('stockdesk')) return;
    var s = eco.stocks[symIdx % eco.stocks.length], el = $('qdDiv');
    if (!el) return;
    var left = Math.max(0, s.next_div_in_s - Math.floor((Date.now() - eco._t) / 1000));
    el.textContent = Math.floor(left / 60) + 'm ' + (left % 60) + 's';
    if (left === 0) setTimeout(deskRefresh, 1200);
  }
  async function deskRefresh() {
    var r = await api('/api/econ/state');
    if (!r.success) return;
    r._t = Date.now(); eco = r; deskRender();
    var s = eco.stocks[symIdx % eco.stocks.length];
    var h = await api('/api/econ/history?symbol=' + s.symbol + '&n=80');
    if (h.success) { hist[s.symbol] = h.series; drawChart(s); }
  }
  window.AstraDesk = {
    step: function (d) { if (!eco) return; symIdx = (symIdx + d + eco.stocks.length) % eco.stocks.length; deskRefresh(); },
    trade: async function (kind) {
      var s = eco.stocks[symIdx % eco.stocks.length];
      var r = await post('/api/econ/' + kind, { symbol: s.symbol, shares: parseInt($('qdQty').value, 10) });
      say('qdMsg', r.msg, r.success); deskRefresh();
    },
    claim: async function () { var r = await post('/api/econ/claim'); say('qdMsg', r.msg, r.success); deskRefresh(); },
    convert: async function () {
      var r = await post('/api/econ/convert', { from: $('qdFrom').value, to: $('qdTo').value, amount: parseFloat($('qdAmt').value) });
      say('qdConvMsg', r.msg, r.success); deskRefresh();
    }
  };

  /* =======================================================================
   * CIVICS
   * ===================================================================== */
  var civ = null;
  function civicsHtml() { return '<div id="cvBanner"></div>' + panel('GOVERNMENT', '<div id="cvRegimes" class="a20-row"></div><div id="cvVoteInfo" class="a20-dim"></div>') +
    panel('THE UNDERWORLD', '<div class="a20-dim" id="cvRecord"></div><div id="cvCrimes"></div><div id="cvMsg" class="a20-dim" style="margin-top:6px;"></div>'); }
  function civicsRender() {
    if (!civ) return;
    var t = civ.tally || {};
    $('cvRegimes').innerHTML = Object.keys(civ.regimes).map(function (k) {
      var r = civ.regimes[k];
      return '<div class="a20-card ' + (k === civ.regime ? 'sel' : '') + '"><b style="color:var(--pixel-yellow)">' + esc(r.label) + (k === civ.regime ? ' (ACTIVE)' : '') + '</b>' +
        '<div class="a20-dim" style="margin:4px 0;">' + esc(r.blurb) + '</div>' +
        '<div class="a20-dim">tax ' + Math.round(r.tax_rate * 100) + '% \u00b7 policing x' + r.enforcement + ' \u00b7 trading ' + (r.allow_player_trading ? 'open' : 'BANNED') + ' \u00b7 anon posts ' + (r.allow_anonymous ? 'yes' : 'NO') + '</div>' +
        '<button class="terminal-btn" style="margin-top:6px;" onclick="AstraCivics.vote(\'' + k + '\')">' + (civ.my_vote === k ? 'VOTED' : 'VOTE') + ' (' + (t[k] || 0) + ')</button></div>';
    }).join('');
    $('cvVoteInfo').textContent = 'A regime changes when a majority of the last 24h of votes (quorum ' + civ.quorum + ') backs it and it has been \u226560 min since the last change. Active ' + civ.changed_ago_min + ' min.';
    var rec = civ.record;
    $('cvRecord').textContent = 'Wanted level ' + rec.wanted + ' (decays over time) \u00b7 convictions ' + rec.convictions;
    $('cvCrimes').innerHTML = Object.keys(civ.crimes).map(function (k) {
      var c = civ.crimes[k];
      return '<div class="a20-row"><button class="terminal-btn" onclick="AstraCivics.crime(\'' + k + '\')">' + esc(c.label) + '</button>' +
        '<span class="a20-dim">severity ' + c.severity + ' \u00b7 loot ' + fmt(c.reward[0]) + '\u2013' + fmt(c.reward[1]) + '</span></div>';
    }).join('');
    $('cvBanner').innerHTML = rec.jail_seconds_left > 0 ?
      '<div class="a20-banner">IN CUSTODY (' + esc(rec.jail_reason) + ') \u2013 <span id="cvLeft">' + rec.jail_seconds_left + '</span>s left. ' +
      '<button class="terminal-btn" onclick="AstraCivics.bail()">PAY BAIL ' + fmt(rec.bail) + '</button></div>' : '';
  }
  async function civicsRefresh() { var r = await api('/api/world/state'); if (r.success) { civ = r; civicsRender(); } }
  window.AstraCivics = {
    vote: async function (k) { var r = await post('/api/world/vote', { regime: k }); say('cvMsg', r.msg, r.success); civicsRefresh(); },
    crime: async function (k) { var r = await post('/api/world/crime', { crime: k }); say('cvMsg', r.msg, r.success && r.outcome === 'success'); civicsRefresh(); },
    bail: async function () { var r = await post('/api/world/bail'); say('cvMsg', r.msg, r.success); civicsRefresh(); }
  };

  /* =======================================================================
   * BLABBER
   * ===================================================================== */
  var bbNext = null;
  function blabberHtml() {
    return panel('BLABBER <span class="a20-dim">say it. or say it anonymously.</span>',
      '<textarea class="a20-in" id="bbBody" maxlength="280" style="min-height:60px; width:100%;" placeholder="What\u2019s on your mind? (280 chars)"></textarea>' +
      '<div class="a20-row"><label class="a20-dim"><input type="checkbox" id="bbAnon"> post anonymously</label>' +
      '<button class="terminal-btn" onclick="AstraBlabber.post()">POST</button><span id="bbMsg" class="a20-dim"></span></div>') +
      panel('FEED', '<div id="bbFeed"></div><button class="terminal-btn" id="bbMore" style="display:none;" onclick="AstraBlabber.more()">LOAD MORE</button>');
  }
  function postHtml(p) {
    return '<div class="a20-post"><b style="color:' + (p.anonymous ? '#8a97ad' : 'var(--pixel-cyan)') + '">' + esc(p.handle) + '</b> <span class="a20-dim">' + esc(p.ts) + '</span>' +
      '<div style="margin:3px 0; color:#dfe7f3;">' + esc(p.body) + '</div>' +
      '<button class="terminal-btn" onclick="AstraBlabber.like(' + p.id + ',this)">\u2665 ' + p.likes + '</button> ' +
      (p.mine ? '' : '<button class="terminal-btn" onclick="AstraBlabber.report(' + p.id + ')">REPORT</button>') + '</div>';
  }
  async function bbLoad(reset) {
    var r = await api('/api/blabber/feed' + (!reset && bbNext ? '?before=' + bbNext : ''));
    if (!r.success) return;
    var feed = $('bbFeed'); if (reset) feed.innerHTML = '';
    feed.insertAdjacentHTML('beforeend', r.posts.map(postHtml).join('') || (reset ? '<div class="a20-dim">Nothing here yet.</div>' : ''));
    bbNext = r.next_before; $('bbMore').style.display = bbNext ? '' : 'none';
    var anon = $('bbAnon'); if (anon) { anon.disabled = !r.anon_allowed; if (!r.anon_allowed) anon.checked = false; }
  }
  window.AstraBlabber = {
    post: async function () {
      var r = await post('/api/blabber/post', { body: $('bbBody').value, anonymous: $('bbAnon').checked });
      say('bbMsg', r.msg, r.success); if (r.success) { $('bbBody').value = ''; bbLoad(true); }
    },
    more: function () { bbLoad(false); },
    like: async function (id, btn) { var r = await post('/api/blabber/like', { post_id: id }); if (r.success) btn.textContent = '\u2665 ' + (parseInt(btn.textContent.replace(/\D/g, ''), 10) + 1); },
    report: async function (id) {
      var reason = prompt('Reason: nsfw / harassment / scam / cheating / other', 'nsfw');
      if (!reason) return;
      var r = await post('/api/blabber/report', { post_id: id, reason: reason.trim().toLowerCase(), details: '' });
      alert(r.msg);
    }
  };

  /* =======================================================================
   * NOTEPAD PRO + STATS
   * ===================================================================== */
  var npCur = null;
  function notesHtml() {
    return '<div id="npGate"></div><div id="npMain" style="display:none;">' +
      panel('NOTEPAD PRO', '<div class="a20-row"><input class="a20-in" id="npSearch" placeholder="search title / body / tags" style="flex:1" oninput="AstraNotes.load()">' +
        '<button class="terminal-btn" onclick="AstraNotes.newNote()">+ NEW</button>' +
        '<button class="terminal-btn" onclick="AstraNotes.exportAll()">EXPORT</button>' +
        '<label class="terminal-btn" style="cursor:pointer;">IMPORT<input type="file" id="npFile" accept=".json" style="display:none" onchange="AstraNotes.importFile(this)"></label></div>' +
        '<div class="a20-row" style="align-items:flex-start;"><div id="npList" style="width:220px; max-height:340px; overflow:auto;"></div>' +
        '<div style="flex:1; min-width:240px;"><input class="a20-in" id="npTitle" placeholder="title" style="width:100%; margin-bottom:4px;">' +
        '<input class="a20-in" id="npTags" placeholder="tags, comma separated" style="width:100%; margin-bottom:4px;">' +
        '<textarea class="a20-in" id="npBody" placeholder="Write here. Do your maths here too."></textarea>' +
        '<div class="a20-row"><button class="terminal-btn" onclick="AstraNotes.save()">SAVE</button>' +
        '<button class="terminal-btn" onclick="AstraNotes.del()">DELETE</button>' +
        '<button class="terminal-btn" onclick="AstraNotes.share()">SHARE CODE</button><span id="npMsg" class="a20-dim"></span></div></div></div>') + '</div>' +
      panel('STATS &amp; SHARING', '<div class="a20-dim">Stats are signed by the server, so an exported file can be verified but not edited.</div>' +
        '<div class="a20-row"><button class="terminal-btn" onclick="AstraNotes.exportStats()">EXPORT MY STATS</button>' +
        '<button class="terminal-btn" onclick="AstraNotes.shareStats()">SHARE MY STATS</button></div>' +
        '<div class="a20-row"><input class="a20-in" id="npCode" placeholder="paste a share code" style="width:180px">' +
        '<button class="terminal-btn" onclick="AstraNotes.open()">OPEN</button><button class="terminal-btn" onclick="AstraNotes.importShared()">IMPORT AS NOTE</button></div>' +
        '<pre id="npShared" class="a20-dim" style="white-space:pre-wrap;"></pre><div id="npShMsg" class="a20-dim"></div>');
  }
  async function notesGate() {
    var r = await api('/api/notes/status');
    if (!r.success) return;
    $('npMain').style.display = r.licensed ? '' : 'none';
    $('npGate').innerHTML = r.licensed ? '' : panel('NOTEPAD PRO \u2013 LICENSE',
      '<div style="line-height:1.7;">The free NOTEPAD is one blank page. PRO adds up to ' + r.limits.notes + ' notes, tags, search, import/export and share codes.' +
      '<div class="a20-row"><button class="terminal-btn" onclick="AstraNotes.buy()">BUY LICENSE \u2013 ' + fmt(r.price) + ' ASD</button><span id="npBuyMsg" class="a20-dim"></span></div></div>');
    if (r.licensed) notesLoad();
  }
  async function notesLoad() {
    var r = await api('/api/notes/list?q=' + encodeURIComponent($('npSearch').value || ''));
    if (!r.success) return;
    $('npList').innerHTML = r.notes.map(function (n) {
      return '<div class="d-list-item" style="cursor:pointer; flex-direction:column; align-items:flex-start;" data-id="' + n.id + '"><b>' + esc(n.title) + '</b><span class="a20-dim">' + esc(n.tags) + ' \u00b7 ' + esc(n.updated) + '</span></div>';
    }).join('') || '<div class="a20-dim">No notes yet.</div>';
    Array.prototype.forEach.call($('npList').querySelectorAll('[data-id]'), function (el) {
      el.onclick = function () { var n = r.notes.filter(function (x) { return String(x.id) === el.getAttribute('data-id'); })[0]; setCur(n); };
    });
  }
  function setCur(n) { npCur = n ? n.id : null; $('npTitle').value = n ? n.title : ''; $('npTags').value = n ? n.tags : ''; $('npBody').value = n ? n.body : ''; }
  window.AstraNotes = {
    load: notesLoad,
    newNote: function () { setCur(null); },
    buy: async function () { var r = await post('/api/notes/buy'); say('npBuyMsg', r.msg, r.success); if (r.success) notesGate(); },
    save: async function () {
      var r = await post('/api/notes/save', { id: npCur, title: $('npTitle').value, tags: $('npTags').value, body: $('npBody').value });
      say('npMsg', r.success ? 'Saved.' : r.msg, r.success); if (r.success) { npCur = r.note.id; notesLoad(); }
    },
    del: async function () { if (npCur && confirm('Delete this note?')) { await post('/api/notes/delete', { id: npCur }); setCur(null); notesLoad(); } },
    exportAll: async function () { var r = await api('/api/notes/export'); if (r.success) { download('astra-notes.json', JSON.stringify(r, null, 2)); if (window.AstraFiles) window.AstraFiles.recordExport('astra-notes.json'); } else say('npMsg', r.msg); },
    importFile: function (inp) {
      var f = inp.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = async function () {
        try { var j = JSON.parse(rd.result); } catch (e) { return say('npMsg', 'Not a valid file.'); }
        var r = await post('/api/notes/import', { notes: j.notes }); say('npMsg', r.msg, r.success); notesLoad(); inp.value = '';
      };
      rd.readAsText(f);
    },
    share: async function () {
      if (!npCur) return say('npMsg', 'Save the note first.');
      var r = await post('/api/share/create', { kind: 'note', note_id: npCur });
      say('npMsg', r.success ? 'Share code: ' + r.code + ' (valid ' + r.expires_days + ' days)' : r.msg, r.success);
    },
    exportStats: async function () { var r = await api('/api/stats/me'); if (r.success) { download('astra-stats-signed.json', JSON.stringify({ payload: r.payload, sig: r.sig }, null, 2)); if (window.AstraFiles) window.AstraFiles.recordExport('astra-stats-signed.json'); } },
    shareStats: async function () {
      var r = await post('/api/share/create', { kind: 'stats' });
      say('npShMsg', r.success ? 'Stats share code: ' + r.code : r.msg, r.success);
    },
    open: async function () {
      var r = await post('/api/share/open', { code: $('npCode').value });
      if (!r.success) return say('npShMsg', r.msg);
      var d = r.data;
      if (r.kind === 'stats') {
        var v = await post('/api/stats/verify', { payload: d.payload, sig: d.sig });
        $('npShared').textContent = 'From ' + r.from_user + (v.valid ? '  [server-verified]' : '  [FAILED verification]') + '\n' + JSON.stringify(JSON.parse(d.payload), null, 2);
      } else { $('npShared').textContent = 'From ' + r.from_user + '\n\n' + d.title + '\n' + d.body; }
      say('npShMsg', '', true);
    },
    importShared: async function () { var r = await post('/api/share/import', { code: $('npCode').value }); say('npShMsg', r.msg, r.success); notesLoad(); }
  };

  /* =======================================================================
   * ADMIN+
   * ===================================================================== */
  function adminHtml() {
    return panel('MODERATION QUEUE', '<div id="apQueue"></div>') +
      panel('CUSTODY ORDER', '<div class="a20-row"><input class="a20-in" id="apUser" placeholder="username"><input class="a20-in" id="apMin" type="number" placeholder="minutes (0 = release)" style="width:150px">' +
        '<input class="a20-in" id="apWhy" placeholder="reason"><button class="terminal-btn" onclick="AstraAdminPlus.jail()">APPLY</button><span id="apMsg" class="a20-dim"></span></div>') +
      panel('CHEAT LEADS <span class="a20-dim">outliers vs the population \u2013 leads, not verdicts</span>', '<button class="terminal-btn" onclick="AstraAdminPlus.leads()">RUN CHECK</button><div id="apLeads"></div>') +
      panel('ADMIN AUDIT LOG', '<button class="terminal-btn" onclick="AstraAdminPlus.log()">REFRESH</button><div id="apLog" class="a20-dim"></div>');
  }
  async function apQueue() {
    var r = await api('/api/admin/blabber/queue'); if (!r.success) return;
    $('apQueue').innerHTML = r.posts.map(function (p) {
      return '<div class="a20-post"><span class="a20-dim">#' + p.id + (p.anonymous ? ' anon' : '') + (p.hidden ? ' HIDDEN' : '') + (p.flagged ? ' FLAGGED' : '') + ' \u00b7 ' + p.reports + ' reports</span><div>' + esc(p.body) + '</div>' +
        '<button class="terminal-btn" onclick="AstraAdminPlus.reveal(' + p.id + ')">REVEAL AUTHOR</button> ' +
        '<button class="terminal-btn" onclick="AstraAdminPlus.act(' + p.id + ',\'remove\')">REMOVE</button> ' +
        '<button class="terminal-btn" onclick="AstraAdminPlus.act(' + p.id + ',\'restore\')">RESTORE</button></div>';
    }).join('') || '<div class="a20-dim">Queue is clear.</div>';
  }
  window.AstraAdminPlus = {
    reveal: async function (id) { var r = await api('/api/admin/blabber/' + id + '/reveal'); alert(r.success ? 'Author: ' + r.author + '\n(this lookup was logged)' : r.msg); },
    act: async function (id, a) { await post('/api/admin/blabber/' + id + '/' + a); apQueue(); },
    jail: async function () { var r = await post('/api/admin/world/jail', { username: $('apUser').value, minutes: parseInt($('apMin').value || '0', 10), reason: $('apWhy').value }); say('apMsg', r.msg, r.success); },
    leads: async function () {
      var r = await api('/api/admin/cheatcheck'); if (!r.success) return;
      $('apLeads').innerHTML = '<table style="width:100%; font-size:11px;"><tr><th>user</th><th>balance</th><th>x avg</th><th>crimes 24h</th><th>sent 24h</th><th>reports</th><th>score</th></tr>' +
        r.players.map(function (p) { return '<tr><td>' + esc(p.username) + '</td><td>' + fmt(p.balance) + '</td><td>' + p.x_avg + '</td><td>' + p.crimes_24h + '</td><td>' + fmt(p.sent_24h) + '</td><td>' + p.open_reports + '</td><td>' + p.suspicion + '</td></tr>'; }).join('') + '</table>';
    },
    log: async function () {
      var r = await api('/api/admin/actions'); if (!r.success) return;
      $('apLog').innerHTML = r.actions.map(function (a) { return esc(a.at) + ' \u00b7 ' + esc(a.admin) + ' \u00b7 ' + esc(a.action) + ' \u00b7 ' + esc(a.target) + ' ' + esc(a.detail); }).join('<br>');
    }
  };

  /* =======================================================================
   * boot
   * ===================================================================== */
  var done = false;
  async function build() {
    if (done || !document.querySelector('.header-nav') || !$('view-dashboard')) return;
    done = true; injectStyles();
    addView('stockdesk', deskHtml());   addNavButton('stockdesk', '[$] STOCK DESK');
    addView('civics', civicsHtml());    addNavButton('civics', '[\u2696] CIVICS');
    addView('blabber', blabberHtml());  addNavButton('blabber', '[\u263A] BLABBER');
    addView('notespro', notesHtml());   addNavButton('notespro', '[\u2712] NOTEPAD PRO');
    try {
      var s = await api('/api/settings');
      if (s && s.success && s.settings && s.settings.is_admin) { addView('adminplus', adminHtml()); addNavButton('adminplus', '[\u2605] ADMIN+'); apQueue(); }
    } catch (e) { /* not logged in yet */ }
    if (window.winosRescanApps) window.winosRescanApps();

    // refresh only what's on screen, so 5k idle tabs don't all poll every app
    setInterval(function () {
      if (active('stockdesk')) deskRefresh();
      if (active('civics')) civicsRefresh();
      if (active('blabber') && !$('bbFeed').children.length) bbLoad(true);
      if (active('notespro')) notesGate();
    }, 4000);
    setInterval(deskCountdown, 1000);
    setInterval(function () { var l = $('cvLeft'); if (l && civ && civ.record) { var n = Math.max(0, parseInt(l.textContent, 10) - 1); l.textContent = n; } }, 1000);
    deskRefresh(); civicsRefresh(); bbLoad(true);
  }
  function waitAndRun(n) {
    if (($('view-dashboard') && document.querySelector('.header-nav')) || n <= 0) { build(); return; }
    setTimeout(function () { waitAndRun(n - 1); }, 150);
  }
  window.addEventListener('astrax:ready', function () { waitAndRun(45); });
  setTimeout(function () { waitAndRun(1); }, 10200);
})();
