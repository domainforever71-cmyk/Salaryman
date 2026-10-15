/* ===========================================================================
 * astra_stage25_desk.js - Stage 25: the real brokerage desk.
 *
 * Replaces the old view-dashboard ("MYNT"): a hardcoded $42,150 and a BTC/USDT
 * price that read "FETCHING..." forever, wired to nothing. This is why NEW GAME
 * and MYNT looked like two unrelated trading surfaces - MYNT never touched the
 * actual save. Now view-dashboard IS the trading terminal: real cash/equity from
 * desk.py, an order ticket with a pre-trade check, a positions table, watchlist,
 * movers, an equity curve, and the BIN (cancelled orders / resignation letters).
 *
 * The career screen's own quick-trade widget (CAREER > BROKERAGE TRADING DESK)
 * is untouched - it's the simple buy/sell tied to convincing client bots. This
 * is the advanced desk: limit/stop orders, fees, and portfolio analytics.
 * =========================================================================== */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n, d) { d = d == null ? 2 : d; var v = Number(n || 0); return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pct(n) { return (n >= 0 ? '+' : '') + Number(n || 0).toFixed(2) + '%'; }
  function pnlClass(n) { return n > 0 ? 'd25-up' : (n < 0 ? 'd25-down' : ''); }
  function api(u, o) { return fetch(u, o).then(function (r) { return r.json().catch(function(){return {};}).then(function(d){ d.__status = r.status; return d; }); }).catch(function () { return { success: false, msg: 'Network error.' }; }); }
  function post(u, b) { return api(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); }

  var st = null, tab = 'trade', selSym = null, ticket = { side: 'buy', type: 'market', qty: 10, price: '' };
  var flashTimer = null;

  function injectStyles() {
    if ($('d25Styles')) return;
    var s = document.createElement('style'); s.id = 'd25Styles';
    s.textContent = [
      '.d25{display:flex; flex-direction:column; gap:10px; height:100%;}',
      '.d25-tabs{display:flex; gap:6px; flex-wrap:wrap;}',
      '.d25-tabs .terminal-btn.on{background:var(--pixel-cyan); color:#000;}',
      '.d25-cards{display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:8px;}',
      '.d25-card{border:1px solid var(--border-color); padding:8px 10px; background:rgba(0,255,204,.02);}',
      '.d25-card .l{font-size:10px; color:#8a97ad; letter-spacing:.04em;}',
      '.d25-card .v{font-size:17px; margin-top:2px; font-variant-numeric:tabular-nums;}',
      '.d25-up{color:var(--pixel-green) !important;} .d25-down{color:var(--pixel-red) !important;}',
      '.d25-grid{display:grid; grid-template-columns:1.3fr .8fr; gap:10px;} @media(max-width:860px){.d25-grid{grid-template-columns:1fr;}}',
      '.d25-tbl{width:100%; border-collapse:collapse; font-size:11.5px;}',
      '.d25-tbl th{text-align:left; color:#8a97ad; font-weight:normal; font-size:10px; padding:4px 6px; border-bottom:1px solid var(--border-color);}',
      '.d25-tbl td{padding:5px 6px; border-bottom:1px solid rgba(15,28,48,.6);}',
      '.d25-tbl tr{cursor:pointer; transition:background .12s;} .d25-tbl tr:hover{background:rgba(0,255,204,.05);}',
      '.d25-ticket{border:1px solid var(--border-color); padding:10px; display:flex; flex-direction:column; gap:8px;}',
      '.d25-row{display:flex; gap:6px; align-items:center;}',
      '.d25-seg{display:flex; border:1px solid var(--border-color);} .d25-seg button{flex:1; background:#000; color:var(--text-main); border:none; padding:6px; font-family:inherit; cursor:pointer; font-size:11px;}',
      '.d25-seg button.on{background:var(--pixel-cyan); color:#000;}',
      '.d25-seg button.sell.on{background:var(--pixel-red); color:#000;}',
      '.d25-in{background:#000; color:#fff; border:1px solid var(--border-color); padding:6px; font-family:inherit; width:100%;}',
      '.d25-warn{color:var(--pixel-yellow); font-size:11px;} .d25-block{color:var(--pixel-red); font-size:11px;}',
      '.d25-spark{display:inline-block; vertical-align:middle;}',
      '.d25-flash{animation:d25flash .6s ease;} @keyframes d25flash{0%{background:rgba(0,255,204,.35);}100%{background:transparent;}}',
      '.d25-curve{width:100%; height:64px;}',
      '.d25-bin-item{border:1px solid var(--border-color); padding:8px; margin-bottom:6px; display:flex; justify-content:space-between; gap:8px; align-items:flex-start;}',
      '.d25-empty{color:#8a97ad; font-size:11.5px; padding:14px 4px;}',
      '.d25-meter{height:6px; background:#000; border:1px solid var(--border-color); overflow:hidden;}',
      '.d25-meter i{display:block; height:100%; background:var(--pixel-cyan); transition:width .4s ease;}',
      '@media (prefers-reduced-motion: reduce){.d25-flash{animation:none;}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function svgSpark(arr, w, h, cls) {
    if (!arr || arr.length < 2) return '';
    var lo = Math.min.apply(null, arr), hi = Math.max.apply(null, arr), span = (hi - lo) || 1;
    var pts = arr.map(function (v, i) { return (i / (arr.length - 1) * w).toFixed(1) + ',' + (h - (v - lo) / span * h).toFixed(1); }).join(' ');
    var up = arr[arr.length - 1] >= arr[0];
    return '<svg class="d25-spark ' + (cls || '') + '" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<polyline points="' + pts + '" fill="none" stroke="' + (up ? 'var(--pixel-green)' : 'var(--pixel-red)') + '" stroke-width="1.5"/></svg>';
  }

  function view() { return $('view-dashboard'); }
  function isActive() { var v = view(); return v && v.classList.contains('active-view'); }

  function skeleton() {
    var v = view();
    if (!v || v.dataset.d25) return;
    v.dataset.d25 = '1';
    v.innerHTML = '<div class="d25" id="d25Root">' +
      '<div class="d25-cards" id="d25Cards"></div>' +
      '<div class="d25-tabs">' +
      '<button class="terminal-btn" data-t="trade">TRADE</button>' +
      '<button class="terminal-btn" data-t="portfolio">POSITIONS</button>' +
      '<button class="terminal-btn" data-t="watch">WATCHLIST</button>' +
      '<button class="terminal-btn" data-t="history">ORDERS &amp; HISTORY</button>' +
      '<button class="terminal-btn" data-t="bin">BIN</button>' +
      '</div>' +
      '<div id="d25Body" style="flex:1; overflow:auto;"></div>' +
      '</div>';
    v.querySelectorAll('.d25-tabs button').forEach(function (b) {
      b.onclick = function () { tab = b.getAttribute('data-t'); render(); };
    });
  }

  function cards() {
    if (!st || !st.active) return '';
    return [
      ['EQUITY', money(st.equity), ''],
      ['CASH / BUYING POWER', money(st.cash) + ' / ' + money(st.buying_power), ''],
      ["DAY P&L", money(st.day_change) + ' (' + pct(st.day_change_pct) + ')', pnlClass(st.day_change)],
      ['UNREALIZED P&L', money(st.unrealized), pnlClass(st.unrealized)],
      ['DIVERSIFICATION', st.diversification + '/100', ''],
      ['SESSION', esc(st.session.label) + (st.session.depth === 'thin' ? ' (thin)' : ''), '']
    ].map(function (c) {
      return '<div class="d25-card"><div class="l">' + c[0] + '</div><div class="v ' + c[2] + '">' + c[1] + '</div></div>';
    }).join('');
  }

  function tradeTab() {
    var universe = st.universe.slice().sort(function (a, b) { return a.symbol < b.symbol ? -1 : 1; });
    if (!selSym) selSym = (universe[0] || {}).symbol;
    var sym = universe.find(function (s) { return s.symbol === selSym; }) || universe[0];
    var rows = universe.map(function (s) {
      return '<tr data-sym="' + s.symbol + '" class="' + (s.symbol === selSym ? 'on' : '') + '"><td>' + s.symbol + '</td><td>' + esc(s.name) + '</td>' +
        '<td>' + money(s.price) + '</td><td class="' + pnlClass(s.change) + '">' + pct(s.change_pct) + '</td>' +
        '<td>' + svgSpark(s.spark, 64, 20) + '</td></tr>';
    }).join('');
    var gates = st.certs.broker ? '' :
      '<div class="d25-block">CERTIFICATE REQUIRED: pass Brokerage 101 in ASTRAWIKI before you can place an order.</div>';
    return '<div class="d25-grid">' +
      '<div>' +
      '<table class="d25-tbl" id="d25Universe"><thead><tr><th>SYM</th><th>NAME</th><th>PRICE</th><th>CHG</th><th>30-TICK</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div style="margin-top:10px;"><div class="l" style="color:#8a97ad; font-size:10px; margin-bottom:4px;">TOP MOVERS</div>' +
      '<div style="display:flex; gap:14px; flex-wrap:wrap; font-size:11.5px;">' +
      st.gainers.concat(st.losers).map(function (m) { return '<span class="' + pnlClass(m.change) + '">' + m.symbol + ' ' + pct(m.change_pct) + '</span>'; }).join('') +
      '</div></div>' +
      '</div>' +
      '<div class="d25-ticket">' +
      '<div style="font-size:13px;">' + (sym ? esc(sym.symbol) + ' - ' + esc(sym.name) : '') + '</div>' +
      '<div style="font-size:20px;" id="d25TicketPx">' + (sym ? money(sym.price) : '') + '</div>' +
      gates +
      '<div class="d25-seg" id="d25Side"><button data-v="buy" class="' + (ticket.side === 'buy' ? 'on' : '') + '">BUY</button><button data-v="sell" class="sell ' + (ticket.side === 'sell' ? 'on' : '') + '">SELL</button></div>' +
      '<div class="d25-seg" id="d25Type"><button data-v="market" class="' + (ticket.type === 'market' ? 'on' : '') + '">MARKET</button><button data-v="limit" class="' + (ticket.type === 'limit' ? 'on' : '') + '">LIMIT</button><button data-v="stop" class="' + (ticket.type === 'stop' ? 'on' : '') + '">STOP</button></div>' +
      '<div class="d25-row"><input class="d25-in" id="d25Qty" type="number" min="1" value="' + ticket.qty + '" placeholder="Shares"></div>' +
      (ticket.type !== 'market' ? '<div class="d25-row"><input class="d25-in" id="d25Price" type="number" step="0.01" value="' + esc(ticket.price) + '" placeholder="' + (ticket.type === 'limit' ? 'Limit price' : 'Stop price') + '"></div>' : '') +
      '<div id="d25Check" style="font-size:11px; color:#8a97ad;"></div>' +
      '<button class="terminal-btn btn-start" id="d25Submit">[' + (ticket.side === 'buy' ? 'BUY' : 'SELL') + ' ' + esc(selSym || '') + ']</button>' +
      '<button class="terminal-btn" data-watch="' + esc(selSym || '') + '">' + (st.watch.some(function (w) { return w.symbol === selSym; }) ? '\u2605 ON WATCHLIST' : '\u2606 ADD TO WATCHLIST') + '</button>' +
      '</div></div>';
  }

  function portfolioTab() {
    if (!st.positions.length) return '<div class="d25-empty">No open positions. Place a trade from the TRADE tab.</div>';
    var rows = st.positions.map(function (p) {
      return '<tr><td>' + p.symbol + '</td><td>' + p.qty + '</td><td>' + money(p.price) + '</td>' +
        '<td>' + (p.avg_cost != null ? money(p.avg_cost) : '-') + '</td><td>' + money(p.value) + '</td>' +
        '<td class="' + pnlClass(p.unrealized) + '">' + (p.unrealized != null ? money(p.unrealized) + ' (' + pct(p.unrealized_pct) + ')' : '-') + '</td>' +
        '<td>' + p.weight + '%</td></tr>';
    }).join('');
    return '<table class="d25-tbl"><thead><tr><th>SYM</th><th>QTY</th><th>PRICE</th><th>AVG COST</th><th>VALUE</th><th>UNREALIZED</th><th>WEIGHT</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (st.top_weight > 40 ? '<div class="d25-warn" style="margin-top:8px;">Top position is ' + st.top_weight.toFixed(0) + '% of equity - concentrated.</div>' : '') +
      '<div style="margin-top:12px;"><div class="l" style="color:#8a97ad; font-size:10px; margin-bottom:4px;">EQUITY CURVE</div>' + svgSpark(st.curve, 560, 64, 'd25-curve') + '</div>';
  }

  function watchTab() {
    if (!st.watch.length) return '<div class="d25-empty">Watchlist is empty. Add symbols from the TRADE tab.</div>';
    var rows = st.watch.map(function (s) {
      return '<tr data-sym="' + s.symbol + '"><td>' + s.symbol + '</td><td>' + esc(s.name) + '</td><td>' + money(s.price) + '</td>' +
        '<td class="' + pnlClass(s.change) + '">' + pct(s.change_pct) + '</td><td>' + svgSpark(s.spark, 64, 20) + '</td>' +
        '<td><button class="terminal-btn btn-warning" data-unwatch="' + s.symbol + '" style="font-size:10px; padding:3px 6px;">REMOVE</button></td></tr>';
    }).join('');
    return '<table class="d25-tbl"><thead><tr><th>SYM</th><th>NAME</th><th>PRICE</th><th>CHG</th><th>30-TICK</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function historyTab() {
    var open = st.open_orders.length ? '<table class="d25-tbl"><thead><tr><th>SYM</th><th>SIDE</th><th>TYPE</th><th>QTY</th><th>PRICE</th><th>NOW</th><th>AGE</th><th></th></tr></thead><tbody>' +
      st.open_orders.map(function (o) {
        return '<tr><td>' + o.symbol + '</td><td class="' + (o.side === 'buy' ? 'd25-up' : 'd25-down') + '">' + o.side.toUpperCase() + '</td><td>' + o.kind.toUpperCase() + '</td>' +
          '<td>' + o.qty + '</td><td>' + money(o.price) + '</td><td>' + money(o.now) + '</td><td>' + o.age_s + 's</td>' +
          '<td><button class="terminal-btn btn-warning" data-cancel="' + o.id + '" style="font-size:10px; padding:3px 6px;">CANCEL</button></td></tr>';
      }).join('') + '</tbody></table>' : '<div class="d25-empty">No open orders.</div>';
    var hist = st.history.length ? '<table class="d25-tbl"><thead><tr><th>TIME</th><th>SYM</th><th>SIDE</th><th>TYPE</th><th>QTY</th><th>FILL</th><th>FEE</th><th>REALIZED</th><th>STATUS</th></tr></thead><tbody>' +
      st.history.map(function (o) {
        return '<tr><td>' + o.at + '</td><td>' + o.symbol + '</td><td class="' + (o.side === 'buy' ? 'd25-up' : 'd25-down') + '">' + o.side.toUpperCase() + '</td>' +
          '<td>' + o.kind.toUpperCase() + '</td><td>' + o.qty + '</td><td>' + (o.fill_price != null ? money(o.fill_price) : '-') + '</td>' +
          '<td>' + (o.fee ? money(o.fee) : '-') + '</td><td class="' + pnlClass(o.realized) + '">' + (o.realized != null ? money(o.realized) : '-') + '</td><td>' + o.status + '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="d25-empty">No filled or cancelled orders yet.</div>';
    return '<div class="l" style="color:#8a97ad; font-size:10px; margin-bottom:4px;">OPEN ORDERS</div>' + open +
      '<div class="l" style="color:#8a97ad; font-size:10px; margin:14px 0 4px;">HISTORY</div>' + hist;
  }

  function binTab(items) {
    if (!items || !items.length) return '<div class="d25-empty">Nothing in the bin. Cancelled orders, resignation letters and shredded notes land here.</div>';
    return items.map(function (b) {
      return '<div class="d25-bin-item"><div><div style="font-size:11px; color:#8a97ad;">' + b.kind.toUpperCase() + ' \u00B7 ' + b.at + '</div>' +
        '<div>' + esc(b.label) + '</div>' + (b.body ? '<div style="font-size:11px; color:#8a97ad; margin-top:4px; white-space:pre-wrap;">' + esc(b.body.slice(0, 200)) + '</div>' : '') + '</div>' +
        '<div style="display:flex; gap:6px; flex-shrink:0;">' +
        '<button class="terminal-btn btn-start" data-restore="' + b.id + '" style="font-size:10px; padding:3px 6px;">RESTORE</button>' +
        '<button class="terminal-btn btn-warning" data-shred="' + b.id + '" style="font-size:10px; padding:3px 6px;">DELETE</button></div></div>';
    }).join('') + '<button class="terminal-btn btn-warning" id="d25EmptyBin" style="margin-top:6px;">EMPTY BIN</button>';
  }

  function wireTrade() {
    var root = $('d25Body');
    root.querySelectorAll('#d25Universe tbody tr').forEach(function (tr) {
      tr.onclick = function () { selSym = tr.getAttribute('data-sym'); render(); };
    });
    var side = $('d25Side'); if (side) side.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () { ticket.side = b.getAttribute('data-v'); render(); };
    });
    var typ = $('d25Type'); if (typ) typ.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () { ticket.type = b.getAttribute('data-v'); render(); };
    });
    var qty = $('d25Qty'); if (qty) qty.oninput = function () { ticket.qty = qty.value; checkTicket(); };
    var price = $('d25Price'); if (price) price.oninput = function () { ticket.price = price.value; checkTicket(); };
    var watchBtn = root.querySelector('[data-watch]');
    if (watchBtn) watchBtn.onclick = function () {
      var on = !st.watch.some(function (w) { return w.symbol === selSym; });
      post('/api/desk/watch', { symbol: selSym, on: on }).then(refresh);
    };
    var submit = $('d25Submit');
    if (submit) submit.onclick = function () {
      submit.disabled = true;
      post('/api/desk/order', { symbol: selSym, side: ticket.side, type: ticket.type, qty: parseInt(ticket.qty || 0, 10), price: parseFloat(ticket.price || 0) })
        .then(function (d) {
          submit.disabled = false;
          toast(d.msg || (d.success ? 'Order placed.' : 'Order failed.'), d.success);
          if (d.success) { flashCards(); refresh(); }
        });
    };
    checkTicket();
  }

  function checkTicket() {
    var out = $('d25Check');
    if (!out || !selSym) return;
    var qty = parseInt(ticket.qty || 0, 10);
    if (!qty || qty < 1) { out.textContent = ''; return; }
    post('/api/desk/check', { symbol: selSym, side: ticket.side, type: ticket.type, qty: qty, price: parseFloat(ticket.price || 0) })
      .then(function (d) {
        if (!d.success) return;
        var lines = [];
        lines.push('Fill ~' + money(d.fill) + ' \u00B7 fee ' + money(d.fee) + ' \u00B7 total ' + money(d.total));
        if (d.cash_after != null) lines.push('Cash after: ' + money(d.cash_after));
        (d.blockers || []).forEach(function (b) { lines.push('<span class="d25-block">' + esc(b) + '</span>'); });
        (d.warnings || []).forEach(function (w) { lines.push('<span class="d25-warn">' + esc(w) + '</span>'); });
        out.innerHTML = lines.join('<br>');
        var btn = $('d25Submit'); if (btn) btn.disabled = !d.ok;
      });
  }

  function wireBin(items) {
    var root = $('d25Body');
    root.querySelectorAll('[data-restore]').forEach(function (b) {
      b.onclick = function () { post('/api/desk/bin/restore', { id: parseInt(b.getAttribute('data-restore'), 10) }).then(function (d) { toast(d.msg, d.success); refresh(); }); };
    });
    root.querySelectorAll('[data-shred]').forEach(function (b) {
      b.onclick = function () { post('/api/desk/bin/delete', { id: parseInt(b.getAttribute('data-shred'), 10) }).then(function () { refresh(); }); };
    });
    var empty = $('d25EmptyBin');
    if (empty) empty.onclick = function () { post('/api/desk/bin/empty', {}).then(function (d) { toast(d.msg, true); refresh(); }); };
  }

  function wireHistory() {
    $('d25Body').querySelectorAll('[data-cancel]').forEach(function (b) {
      b.onclick = function () { post('/api/desk/cancel', { id: parseInt(b.getAttribute('data-cancel'), 10) }).then(function (d) { toast(d.msg, d.success); refresh(); }); };
    });
  }

  function wireWatch() {
    $('d25Body').querySelectorAll('[data-unwatch]').forEach(function (b) {
      b.onclick = function () { post('/api/desk/watch', { symbol: b.getAttribute('data-unwatch'), on: false }).then(refresh); };
    });
  }

  function toast(msg, ok) {
    var t = $('d25Toast');
    if (!t) { t = document.createElement('div'); t.id = 'd25Toast'; t.style.cssText = 'position:fixed;bottom:46px;left:50%;transform:translateX(-50%);z-index:100700;padding:8px 16px;font-size:11.5px;'; document.body.appendChild(t); }
    t.style.background = '#000'; t.style.border = '1px solid ' + (ok ? 'var(--pixel-green)' : 'var(--pixel-red)'); t.style.color = ok ? 'var(--pixel-green)' : 'var(--pixel-red)';
    t.textContent = msg || ''; t.style.display = 'block';
    clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, 3200);
  }

  function flashCards() {
    var c = $('d25Cards'); if (!c) return;
    c.classList.remove('d25-flash'); void c.offsetWidth; c.classList.add('d25-flash');
  }

  function render() {
    if (!st) return;
    var cardsEl = $('d25Cards'); if (cardsEl) cardsEl.innerHTML = cards();
    var body = $('d25Body'); if (!body) return;
    document.querySelectorAll('.d25-tabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-t') === tab); });
    if (!st.active) { body.innerHTML = '<div class="d25-empty">Start a career from CAREER to open an account.</div>'; return; }
    if (tab === 'trade') { body.innerHTML = tradeTab(); wireTrade(); }
    else if (tab === 'portfolio') body.innerHTML = portfolioTab();
    else if (tab === 'watch') { body.innerHTML = watchTab(); wireWatch(); }
    else if (tab === 'history') { body.innerHTML = historyTab(); wireHistory(); }
    else if (tab === 'bin') api('/api/desk/bin').then(function (d) { body.innerHTML = binTab(d.items); wireBin(d.items); });
  }

  function refresh() {
    api('/api/desk/portfolio').then(function (d) {
      if (!d || d.success === false) return;
      st = d;
      var ae = document.activeElement, body = $('d25Body');
      if (ae && body && body.contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) {
        var cardsEl = $('d25Cards'); if (cardsEl) cardsEl.innerHTML = cards();
        var px = $('d25TicketPx'), s = (st.universe || []).find(function (x) { return x.symbol === selSym; });
        if (px && s) px.textContent = money(s.price);
        return;
      }
      if (isActive() || $('d25Root')) render();
    });
  }

  window.addEventListener('astrax:ready', function () {
    injectStyles();
    var tries = 0;
    (function boot() {
      skeleton();
      if ($('d25Root')) { refresh(); return; }
      if (++tries < 80) setTimeout(boot, 250);
    })();
    setInterval(function () { if (!document.hidden) refresh(); }, 6000);
  });
})();
