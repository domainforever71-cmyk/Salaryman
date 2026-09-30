/* ===========================================================================
 * astra_stage21_wallet.js - Stage 21. WALLET inside the BANK app.
 *
 * astra_phase7_bank.js builds #view-bank (credit score, lenders, loans). This
 * file does NOT touch that code: it prepends a [LOANS & CREDIT | WALLET] tab
 * bar to #view-bank, and shows/hides the original panels around a new wallet
 * panel. Talks to economy.py's /api/wallet/* and /api/econ/convert.
 *
 * WALLET: net worth (nominal AND inflation-adjusted), four currency cards
 * with savings accounts, currency converter, send-to-player, and the ledger.
 * Loads after astra_stage20_world.js.
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function api(url, opts) { return fetch(url, opts).then(function (r) { return r.json(); }).catch(function () { return { success: false, msg: 'Network error.' }; }); }
  function post(url, body) { return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); }
  function say(msg, ok) { var e = $('wlMsg'); if (e) { e.textContent = msg || ''; e.style.color = ok ? '#39d353' : '#ff7b7b'; } }

  var CURS = ['ASD', 'VLT', 'KRN', 'DRX'];
  var tab = 'loans', data = null, oldest = null;

  function injectStyles() {
    if ($('astra21Styles')) return;
    var s = document.createElement('style'); s.id = 'astra21Styles';
    s.textContent = [
      '.a21-tabs{display:flex; gap:6px; margin-bottom:10px;}',
      '.a21-grid{display:flex; gap:8px; flex-wrap:wrap;}',
      '.a21-card{flex:1; min-width:200px; border:1px solid var(--border-color); background:#000; padding:10px;}',
      '.a21-card h4{margin:0 0 6px; color:var(--pixel-cyan); font-size:12px; letter-spacing:.5px;}',
      '.a21-big{font-size:18px; color:#fff;} .a21-dim{color:#8a97ad; font-size:10.5px; line-height:1.5;}',
      '.a21-up{color:#39d353;} .a21-down{color:#ff7b7b;}',
      '.a21-in{background:#000; border:1px solid var(--border-color); color:#fff; padding:5px; font-family:inherit; font-size:11.5px; width:90px;}',
      '.a21-row{display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:6px;}',
      '.a21-tx{display:flex; justify-content:space-between; gap:8px; border-bottom:1px solid var(--border-color); padding:4px 0; font-size:11px;}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function walletHtml() {
    var opts = CURS.map(function (c) { return '<option>' + c + '</option>'; }).join('');
    return '' +
      '<div class="terminal-panel"><div class="panel-header"><div class="panel-heading-title">NET WORTH</div></div>' +
        '<div class="a21-grid" id="wlWorth"></div><div class="a21-dim" id="wlWorthNote" style="margin-top:6px;"></div></div>' +
      '<div class="terminal-panel"><div class="panel-header"><div class="panel-heading-title">CURRENCIES &amp; SAVINGS</div></div>' +
        '<div class="a21-grid" id="wlCards"></div>' +
        '<div class="a21-row"><b class="a21-dim">CONVERT</b><input class="a21-in" id="wlCAmt" type="number" min="0" placeholder="amount">' +
        '<select class="a21-in" id="wlCFrom" style="width:70px">' + opts + '</select> &rarr; ' +
        '<select class="a21-in" id="wlCTo" style="width:70px">' + opts.replace('<option>VLT', '<option selected>VLT') + '</select>' +
        '<button class="terminal-btn" onclick="AstraWallet.convert()">CONVERT (1% spread)</button></div></div>' +
      '<div class="terminal-panel"><div class="panel-header"><div class="panel-heading-title">SEND TO A PLAYER</div></div>' +
        '<div class="a21-row"><input class="a21-in" id="wlTo" placeholder="username" style="width:130px">' +
        '<input class="a21-in" id="wlAmt" type="number" min="0" placeholder="amount">' +
        '<select class="a21-in" id="wlCur" style="width:70px">' + opts + '</select>' +
        '<input class="a21-in" id="wlNote" placeholder="note (optional)" style="width:160px" maxlength="60">' +
        '<button class="terminal-btn" onclick="AstraWallet.send()">SEND</button></div>' +
        '<div class="a21-dim" id="wlSendInfo" style="margin-top:4px;"></div></div>' +
      '<div class="a21-dim" id="wlMsg" style="min-height:14px; margin:4px 0;"></div>' +
      '<div class="terminal-panel"><div class="panel-header"><div class="panel-heading-title">TRANSACTIONS</div></div>' +
        '<div id="wlTx"></div><button class="terminal-btn" id="wlMore" style="display:none; margin-top:6px;" onclick="AstraWallet.more()">LOAD OLDER</button></div>';
  }

  function txRow(t) {
    var pos = t.amount >= 0;
    return '<div class="a21-tx"><span><b>' + esc(t.kind.toUpperCase()) + '</b> <span class="a21-dim">' + esc(t.note) + '</span></span>' +
      '<span><span class="' + (pos ? 'a21-up' : 'a21-down') + '">' + (pos ? '+' : '') + fmt(t.amount) + ' ' + esc(t.currency) + '</span> <span class="a21-dim">' + esc(t.at) + '</span></span></div>';
  }

  function render() {
    if (!data) return;
    var w = data.worth, lost = w.total - w.real_total;
    $('wlWorth').innerHTML =
      [['CASH', w.cash], ['SAVINGS', w.savings], ['STOCKS', w.stocks], ['TOTAL', w.total]].map(function (x) {
        return '<div class="a21-card"><h4>' + x[0] + '</h4><div class="a21-big">' + fmt(x[1]) + ' <span class="a21-dim">ASD</span></div></div>';
      }).join('') +
      '<div class="a21-card"><h4>REAL VALUE</h4><div class="a21-big">' + fmt(w.real_total) + ' <span class="a21-dim">ASD</span></div>' +
      '<div class="a21-dim">in launch-day money</div></div>';
    $('wlWorthNote').textContent = 'Price index is ' + data.price_index + 'x since launch, so your total buys ' + fmt(lost) + ' ASD less than its face value says. Everything is valued in ASD at live exchange rates.';
    $('wlCards').innerHTML = CURS.map(function (c) {
      var x = data.currencies[c], good = x.real_yield_pct >= 0;
      return '<div class="a21-card"><h4>' + c + ' <span class="a21-dim">' + esc(x.name) + '</span></h4>' +
        '<div class="a21-big">' + fmt(x.wallet) + '</div><div class="a21-dim">1 ' + c + ' = ' + x.to_asd + ' ASD</div>' +
        '<div class="a21-dim" style="margin-top:6px;">Savings: <b>' + fmt(x.savings) + '</b> at ' + x.savings_rate_pct + '%/day<br>' +
        'Inflation ' + x.inflation_pct + '%/day \u2192 real <span class="' + (good ? 'a21-up' : 'a21-down') + '">' + (good ? '+' : '') + x.real_yield_pct + '%/day</span></div>' +
        '<div class="a21-row"><input class="a21-in" id="wlS-' + c + '" type="number" min="0" placeholder="amount">' +
        '<button class="terminal-btn" onclick="AstraWallet.save(\'' + c + '\')">SAVE</button>' +
        '<button class="terminal-btn" onclick="AstraWallet.withdraw(\'' + c + '\')">TAKE OUT</button></div></div>';
    }).join('');
    $('wlSendInfo').textContent = data.send.allowed
      ? 'Fee ' + data.send.fee_pct + '% (min 0.5). Daily limit ' + fmt(data.send.limit_asd) + ' ASD, ' + fmt(data.send.used_asd) + ' used. Savings cap ' + fmt(data.savings_cap_asd) + ' ASD per currency.'
      : 'Player-to-player transfers are BANNED under the current regime.';
    $('wlTx').innerHTML = data.tx.map(txRow).join('') || '<div class="a21-dim">No transactions yet.</div>';
    oldest = data.tx.length === 40 ? data.tx[data.tx.length - 1].id : null;
    $('wlMore').style.display = oldest ? '' : 'none';
  }

  async function load() { var r = await api('/api/wallet/summary'); if (r.success) { data = r; render(); } }
  async function act(url, body, okAfter) {
    var r = await post(url, body); say(r.msg, r.success);
    if (r.success) { if (window.SFX) window.SFX.play('cash'); if (window.refreshDashboard) window.refreshDashboard(); }
    load(); return r;
  }

  window.AstraWallet = {
    load: load,
    convert: function () { act('/api/econ/convert', { from: $('wlCFrom').value, to: $('wlCTo').value, amount: parseFloat($('wlCAmt').value) }); },
    send: function () { act('/api/wallet/send', { to: $('wlTo').value, currency: $('wlCur').value, amount: parseFloat($('wlAmt').value), note: $('wlNote').value }); },
    save: function (c) { act('/api/wallet/save', { currency: c, amount: parseFloat($('wlS-' + c).value) }); },
    withdraw: function (c) { act('/api/wallet/withdraw', { currency: c, amount: parseFloat($('wlS-' + c).value) }); },
    more: async function () {
      var r = await api('/api/wallet/history?before=' + oldest);
      if (!r.success) return;
      $('wlTx').insertAdjacentHTML('beforeend', r.tx.map(txRow).join(''));
      oldest = r.next_before; $('wlMore').style.display = oldest ? '' : 'none';
    },
    tab: function (t) {
      tab = t;
      var view = $('view-bank'); if (!view) return;
      Array.prototype.forEach.call(view.children, function (el) {
        if (el.id === 'a21Tabs') return;
        if (el.id === 'a21Wallet') el.style.display = t === 'wallet' ? '' : 'none';
        else el.style.display = t === 'wallet' ? 'none' : '';
      });
      $('a21tabLoans').classList.toggle('active-nav', t === 'loans');
      $('a21tabWallet').classList.toggle('active-nav', t === 'wallet');
      if (t === 'wallet') load();
    }
  };

  var done = false;
  function build() {
    var view = $('view-bank');
    if (done || !view) return;
    done = true; injectStyles();
    var bar = document.createElement('div'); bar.id = 'a21Tabs'; bar.className = 'a21-tabs';
    bar.innerHTML = '<button class="terminal-btn active-nav" id="a21tabLoans" onclick="AstraWallet.tab(\'loans\')">[\u00a2] LOANS &amp; CREDIT</button>' +
      '<button class="terminal-btn" id="a21tabWallet" onclick="AstraWallet.tab(\'wallet\')">[\u25C6] WALLET</button>';
    var wal = document.createElement('div'); wal.id = 'a21Wallet'; wal.style.display = 'none'; wal.innerHTML = walletHtml();
    view.insertBefore(bar, view.firstChild); view.appendChild(wal);
    setInterval(function () {
      if (tab === 'wallet' && view.classList.contains('active-view')) load();
    }, 8000);
  }
  function waitAndRun(n) {
    if ($('view-bank')) { build(); return; }
    if (n > 0) setTimeout(function () { waitAndRun(n - 1); }, 500);
  }
  window.addEventListener('astrax:ready', function () { waitAndRun(60); });
  setTimeout(function () { waitAndRun(60); }, 11000);
})();
