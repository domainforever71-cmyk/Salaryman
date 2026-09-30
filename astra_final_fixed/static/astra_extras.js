(function () {
  'use strict';

  var WIP = {};
  var PROFILE = null;
  var STUDIO = { genres: {}, labels: [], keys: [], tracks: [] };
  var draft = { genre: 'chiptune', label: 'indie', key: 'C', bpm: 150, bars: 8, seed: 1 };

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
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }
  function post(url, body) {
    return api(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }



  function injectStyles() {
    var css = document.createElement('style');
    css.textContent = [
      /* WIP badge */
      '.wip-badge{display:inline-block;font-size:9px;letter-spacing:1px;padding:2px 6px;',
      'border:1px solid var(--pixel-yellow);color:var(--pixel-yellow);background:rgba(255,187,0,.08);',
      'vertical-align:middle;margin-left:8px;cursor:help;}',
      '.wip-badge.stub{border-color:var(--pixel-red);color:var(--pixel-red);background:rgba(255,51,102,.08);}',
      '.wip-note{font-size:10.5px;color:#8a7a4a;border-left:2px solid var(--pixel-yellow);',
      'padding:6px 10px;margin-bottom:10px;background:rgba(255,187,0,.04);line-height:1.6;}',

      /* Overlay shared by the company panel */
      '.ax-overlay{position:fixed;inset:0;background:rgba(1,3,6,.88);z-index:150000;',
      'display:none;align-items:center;justify-content:center;padding:24px;}',
      '.ax-overlay.open{display:flex;}',
      '.ax-sheet{width:960px;max-width:100%;max-height:90vh;overflow-y:auto;background:var(--panel-bg);',
      'border:1px solid var(--border-color);box-shadow:0 0 50px var(--border-glow);padding:20px 22px;}',
      '.ax-close{background:transparent;border:1px solid var(--border-color);color:var(--text-main);',
      'font-family:var(--font-current);font-size:11px;padding:5px 12px;cursor:pointer;}',
      '.ax-close:hover{border-color:var(--pixel-red);color:var(--pixel-red);}',

      /* Company detail */
      '.ax-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;',
      'border-bottom:1px solid var(--border-color);padding-bottom:14px;margin-bottom:16px;}',
      '.ax-tick{font-family:\'VT323\',monospace;font-size:44px;color:#fff;line-height:.9;}',
      '.ax-px{font-family:\'VT323\',monospace;font-size:40px;line-height:1;}',
      '.ax-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:16px;}',
      '.ax-facts{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:12px 0;}',
      '.ax-fact{background:#000;border:1px solid var(--border-color);padding:7px 9px;}',
      '.ax-fact .k{font-size:9px;color:#5c7a99;letter-spacing:1px;}',
      '.ax-fact .v{font-size:13px;color:#fff;margin-top:2px;}',
      '.ax-book{width:100%;border-collapse:collapse;font-size:11px;}',
      '.ax-book td{padding:3px 6px;border-bottom:1px solid rgba(15,28,48,.7);}',
      '.ax-book .bid{color:var(--pixel-green);} .ax-book .ask{color:var(--pixel-red);}',
      '.ax-ticket{background:#000;border:1px solid var(--border-color);padding:12px;}',
      '.ax-ticket input{background:#000;border:1px solid var(--border-color);color:#fff;',
      'padding:7px;font-family:var(--font-current);width:100%;}',
      '.ax-qbtn{background:transparent;border:1px solid var(--border-color);color:var(--text-main);',
      'font-family:var(--font-current);font-size:10px;padding:4px 8px;cursor:pointer;flex:1;}',
      '.ax-qbtn:hover{border-color:var(--pixel-cyan);color:var(--pixel-cyan);}',

      /* Clickable market tiles */
      '.stock-tile{cursor:pointer;transition:border-color .12s,background .12s;}',
      '.stock-tile:hover{border-color:var(--pixel-cyan)!important;background:#04121c!important;}',

      /* Avatar picker */
      '.ax-avatars{display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));gap:8px;}',
      '.ax-av{background:#000;border:1px solid var(--border-color);padding:10px 4px;text-align:center;',
      'cursor:pointer;position:relative;}',
      '.ax-av:hover{border-color:var(--pixel-cyan);}',
      '.ax-av.sel{border-color:var(--pixel-cyan);background:rgba(0,255,204,.07);}',
      '.ax-av.locked{opacity:.32;cursor:not-allowed;}',
      '.ax-av .g{font-size:26px;line-height:1;}',
      '.ax-av .n{font-size:8.5px;color:#5c7a99;margin-top:5px;}',
      '.ax-pfp{width:78px;height:78px;display:flex;align-items:center;justify-content:center;',
      'font-size:42px;background:#000;flex-shrink:0;}',

      /* Studio */
      '.ax-chip{background:#000;border:1px solid var(--border-color);color:var(--text-main);',
      'font-family:var(--font-current);font-size:11px;padding:7px 10px;cursor:pointer;text-align:left;}',
      '.ax-chip:hover{border-color:var(--pixel-cyan);}',
      '.ax-chip.sel{border-color:var(--pixel-cyan);color:#fff;background:rgba(0,255,204,.08);}',
      '.ax-chip .sub{display:block;font-size:9px;color:#5c7a99;margin-top:3px;line-height:1.4;}',
      '.ax-track{display:flex;justify-content:space-between;align-items:center;gap:10px;',
      'background:#000;border:1px solid var(--border-color);padding:9px 11px;}',
      '.ax-meter{height:6px;background:#000;border:1px solid var(--border-color);overflow:hidden;}',
      '.ax-meter i{display:block;height:100%;background:var(--pixel-cyan);}',

      /* Bot status dot */
      '.ax-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;',
      'vertical-align:middle;background:var(--pixel-green);}',
      '.ax-dot.off{background:var(--pixel-red);}',
      '@keyframes axpulse{50%{opacity:.25}}',
      '.ax-dot.live{animation:axpulse 1.8s ease-in-out infinite;}',
      '@media (prefers-reduced-motion: reduce){.ax-dot.live{animation:none}}'
    ].join('');
    document.head.appendChild(css);
  }

  /* =================================================================
   * Work-in-progress badging
   * ================================================================= */

  function badge(key) {
    var f = WIP[key];
    if (!f) return '';
    var cls = f.state === 'stub' ? 'wip-badge stub' : 'wip-badge';
    return '<span class="' + cls + '" title="' + esc(f.note) + '">' + esc(f.state.toUpperCase()) + '</span>';
  }
  function note(key) {
    var f = WIP[key];
    if (!f) return '';
    return '<div class="wip-note"><strong>' + esc(f.label) + ' is ' + esc(f.state) +
      '.</strong> ' + esc(f.note) + '</div>';
  }

  // Badge the panels that already existed in the template.
  function badgeExistingPanels() {
    var map = {
      'CROSS-EXCHANGE ARBITRAGE ENGINE': 'arbitrage',
      'OMNI-CORE // GENERAL COMMAND ASSISTANT': null
    };
    document.querySelectorAll('.panel-heading-title').forEach(function (el) {
      var key = map[el.textContent.trim()];
      if (key && WIP[key] && el.querySelectorAll('.wip-badge').length === 0) {
        el.insertAdjacentHTML('beforeend', badge(key));
      }
    });
  }

  /* =================================================================
   * Navigation + view scaffolding
   * ================================================================= */

  function addView(id, html) {
    var host = document.getElementById('view-dashboard');
    if (!host || document.getElementById('view-' + id)) return;
    var div = document.createElement('div');
    div.id = 'view-' + id;
    div.className = 'app-view';
    div.innerHTML = html;
    host.parentNode.appendChild(div);
  }

  function addNavButton(id, label, cls) {
    var nav = document.querySelector('.header-nav');
    if (!nav || document.getElementById('nav-' + id)) return;
    var btn = document.createElement('button');
    btn.className = 'terminal-btn' + (cls ? ' ' + cls : '');
    btn.id = 'nav-' + id;
    // index.html's i18n dictionary carries nav_profile / nav_studio / etc, so
    // these tabs get re-labelled with the rest of the bar instead of staying
    // English when the operator switches language.
    btn.setAttribute('data-i18n', 'nav_' + id);
    btn.textContent = label;
    btn.onclick = function () { window.switchView(id); };
    // Keep SETTINGS last so the bar still reads left-to-right sensibly.
    var settings = document.getElementById('nav-settings');
    if (settings) nav.insertBefore(btn, settings); else nav.appendChild(btn);
  }

  /* =================================================================
   * Company detail (full-screen trading desk)
   * ================================================================= */

  var activeSymbol = null;

  function buildOverlay() {
    if ($('axStockOverlay')) return;
    var o = document.createElement('div');
    o.id = 'axStockOverlay';
    o.className = 'ax-overlay';
    o.innerHTML = '<div class="ax-sheet" id="axStockSheet"></div>';
    o.addEventListener('click', function (e) { if (e.target === o) closeStock(); });
    document.body.appendChild(o);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && o.classList.contains('open')) closeStock();
    });
  }

  function sparkline(history, up) {
    if (!history || history.length < 2) return '';
    var w = 560, h = 90, lo = Math.min.apply(null, history), hi = Math.max.apply(null, history);
    var span = (hi - lo) || 1;
    var pts = history.map(function (p, i) {
      var x = (i / (history.length - 1)) * w;
      var y = h - ((p - lo) / span) * (h - 8) - 4;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var color = up ? 'var(--pixel-green)' : 'var(--pixel-red)';
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" ' +
      'style="width:100%;height:90px;background:#000;border:1px solid var(--border-color);" ' +
      'role="img" aria-label="Intraday price line">' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.5"/>' +
      '</svg>';
  }

  async function openStock(symbol) {
    buildOverlay();
    activeSymbol = symbol;
    var sheet = $('axStockSheet');
    sheet.innerHTML = '<div style="color:var(--pixel-cyan);font-size:12px;">Opening ' + esc(symbol) + ' desk...</div>';
    $('axStockOverlay').classList.add('open');
    sfx('open');
    try { await renderStock(symbol); }
    catch (e) {
      sheet.innerHTML = '<div style="color:var(--pixel-red);font-size:12px;">' +
        'Could not reach the desk for ' + esc(symbol) + '. The market feed may be down — try again.' +
        '</div><div style="margin-top:12px;"><button class="ax-close" onclick="AstraX.closeStock()">CLOSE</button></div>';
    }
  }

  async function renderStock(symbol) {
    var d = await api('/api/game/stock/' + encodeURIComponent(symbol));
    var s = d.stock, p = d.profile || {}, up = s.change >= 0;
    var col = up ? 'var(--pixel-green)' : 'var(--pixel-red)';

    var facts = [
      ['CEO', p.ceo], ['FOUNDED', p.founded], ['HEADCOUNT', p.employees ? p.employees.toLocaleString() : '—'],
      ['HQ', p.hq], ['P/E', p.pe || '—'], ['DIVIDEND', (p.dividend || 0) + '%']
    ].map(function (f) {
      return '<div class="ax-fact"><div class="k">' + esc(f[0]) + '</div><div class="v">' + esc(f[1] || '—') + '</div></div>';
    }).join('');

    var book = d.book.map(function (r) {
      return '<tr><td class="bid">' + r.bid_size + '</td><td class="bid">' + money(r.bid) +
        '</td><td class="ask">' + money(r.ask) + '</td><td class="ask">' + r.ask_size + '</td></tr>';
    }).join('');

    var news = d.headlines.map(function (h) {
      return '<div style="font-size:11px;color:#b8c3d9;padding:6px 0;border-bottom:1px solid rgba(15,28,48,.7);">' +
        '&gt; ' + esc(h) + '</div>';
    }).join('');

    $('axStockSheet').innerHTML =
      '<div class="ax-head">' +
        '<div>' +
          '<div class="ax-tick">' + esc(symbol) + '</div>' +
          '<div style="font-size:14px;color:#fff;margin-top:4px;">' + esc(s.name) + '</div>' +
          '<div style="font-size:11px;color:var(--pixel-cyan);">' + esc(s.sector) + '</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div class="ax-px" style="color:' + col + ';">' + money(s.price) + '</div>' +
          '<div style="font-size:12px;color:' + col + ';">' +
            (up ? '+' : '') + s.change.toFixed(2) + ' (' + (up ? '+' : '') + s.change_pct.toFixed(2) + '%) today</div>' +
          '<div style="margin-top:10px;"><button class="ax-close" onclick="AstraX.closeStock()">CLOSE [ESC]</button></div>' +
        '</div>' +
      '</div>' +

      note('stock_detail') +

      '<div class="ax-grid">' +
        '<div>' +
          sparkline(d.history, up) +
          '<div style="font-size:9px;color:#5c7a99;margin-top:4px;letter-spacing:1px;">' +
            'INTRADAY — ' + d.history.length + ' TICKS</div>' +
          '<div class="ax-facts">' + facts + '</div>' +
          '<div style="font-size:11.5px;line-height:1.7;color:var(--text-main);' +
            'border-left:2px solid var(--border-color);padding-left:10px;">' + esc(p.desc || '') + '</div>' +
          '<div style="margin-top:14px;font-size:10px;color:#5c7a99;letter-spacing:1px;">ON THE WIRE</div>' +
          news +
        '</div>' +

        '<div>' +
          '<div class="ax-ticket">' +
            '<div style="font-size:10px;color:#5c7a99;letter-spacing:1px;margin-bottom:8px;">ORDER TICKET</div>' +
            '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;">' +
              '<span>Cash</span><span style="color:var(--pixel-green);">' + money(d.balance) + '</span></div>' +
            '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;">' +
              '<span>Holding</span><span style="color:#fff;">' + d.owned + ' shares</span></div>' +
            '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:10px;">' +
              '<span>Position</span><span style="color:#fff;">' + money(d.position_value) + '</span></div>' +
            '<input type="number" id="axQty" min="1" value="1" oninput="AstraX.updateCost()">' +
            '<div style="display:flex;gap:4px;margin-top:6px;">' +
              '<button class="ax-qbtn" onclick="AstraX.setQty(1)">1</button>' +
              '<button class="ax-qbtn" onclick="AstraX.setQty(10)">10</button>' +
              '<button class="ax-qbtn" onclick="AstraX.setQty(' + d.max_affordable + ')">MAX</button>' +
              '<button class="ax-qbtn" onclick="AstraX.setQty(' + d.owned + ')">ALL</button>' +
            '</div>' +
            '<div id="axCost" style="font-size:11px;color:var(--pixel-yellow);margin:10px 0;">' +
              'Est. cost ' + money(s.price) + '</div>' +
            '<div style="display:flex;gap:6px;">' +
              '<button class="terminal-btn btn-start" style="flex:1;" onclick="AstraX.trade(\'buy\')">BUY</button>' +
              '<button class="terminal-btn btn-warning" style="flex:1;" onclick="AstraX.trade(\'sell\')">SELL</button>' +
            '</div>' +
            '<div id="axMsg" style="font-size:11px;margin-top:9px;min-height:15px;"></div>' +
          '</div>' +

          '<div style="margin-top:12px;font-size:10px;color:#5c7a99;letter-spacing:1px;">ORDER BOOK</div>' +
          '<table class="ax-book"><tr style="color:#5c7a99;font-size:9px;">' +
            '<td>BID SZ</td><td>BID</td><td>ASK</td><td>ASK SZ</td></tr>' + book + '</table>' +
          '<div style="font-size:9.5px;color:#5c7a99;margin-top:10px;line-height:1.6;">' +
            'Simulated market. ' + esc(s.name) + ' is a parody company and this is not investment advice.</div>' +
        '</div>' +
      '</div>';

    if (window.__axPrice) window.__axPrice = s.price;
    window.__axPrice = s.price;
    updateCost();
  }

  function setQty(n) {
    var q = $('axQty');
    if (q) { q.value = Math.max(1, n || 1); updateCost(); sfx('click'); }
  }

  function updateCost() {
    var q = $('axQty'), c = $('axCost');
    if (!q || !c) return;
    var n = Math.max(1, parseInt(q.value, 10) || 1);
    c.textContent = 'Est. cost ' + money(n * (window.__axPrice || 0));
  }

  async function trade(action) {
    var q = $('axQty'), msg = $('axMsg');
    var qty = Math.max(1, parseInt(q && q.value, 10) || 1);
    try {
      var d = await post('/api/game/trade_share', { symbol: activeSymbol, action: action, qty: qty });
      if (d.success) {
        sfx(action === 'buy' ? 'buy' : 'sell');
        msg.style.color = 'var(--pixel-green)';
        msg.textContent = (action === 'buy' ? 'Bought ' : 'Sold ') + qty + ' ' + activeSymbol + '.';
        await renderStock(activeSymbol);
        if (window.pollGameState) window.pollGameState();
      } else {
        sfx('deny');
        msg.style.color = 'var(--pixel-red)';
        msg.textContent = d.msg || 'Order rejected.';
      }
    } catch (e) {
      sfx('error');
      msg.style.color = 'var(--pixel-red)';
      msg.textContent = 'Order failed to reach the desk. Check your connection and retry.';
    }
  }

  function closeStock() {
    var o = $('axStockOverlay');
    if (o) o.classList.remove('open');
    activeSymbol = null;
    sfx('close');
  }

  /* =================================================================
   * Operator profile
   * ================================================================= */

  function profileView() {
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">OPERATOR PROFILE</div>' +
        '<span style="font-size:11px;color:var(--pixel-cyan);" id="axProfileStatus"></span></div>' +
        '<div id="axProfileBody" style="font-size:12px;color:#888;">Loading profile...</div>' +
      '</div>';
  }

  async function loadProfile() {
    var body = $('axProfileBody');
    if (!body) return;
    try {
      var d = await api('/api/profile');
      PROFILE = d;
      var p = d.profile, st = d.stats;
      var cur = d.avatars.filter(function (a) { return a.id === p.avatar_glyph; })[0] || d.avatars[0];
      var frame = d.frames.filter(function (f) { return f.id === p.avatar_frame; })[0] || d.frames[0];

      var avatars = d.avatars.map(function (a) {
        return '<div class="ax-av' + (a.id === p.avatar_glyph ? ' sel' : '') +
          (a.unlocked ? '' : ' locked') + '" ' +
          (a.unlocked ? 'onclick="AstraX.pickAvatar(\'' + a.id + '\')"' : '') +
          ' title="' + esc(a.unlocked ? a.name : 'Locked — ' + a.unlock) + '">' +
          '<div class="g" style="color:' + a.color + ';">' + a.glyph + '</div>' +
          '<div class="n">' + esc(a.unlocked ? a.name : 'LOCKED') + '</div></div>';
      }).join('');

      var frames = d.frames.map(function (f) {
        // Paid frames are bought in the [\u00a4] CREDITS tab; locked ones are shown
        // with their price rather than hidden, so you know what's there.
        if (f.unlocked === false) {
          return '<button class="ax-chip" style="opacity:.55;" title="Unlock in the CREDITS tab" ' +
            'onclick="window.switchView(\'credits\')">' + esc(f.name) + ' \u00b7 ' + (f.cost || 0) + ' CR</button>';
        }
        return '<button class="ax-chip' + (f.id === p.avatar_frame ? ' sel' : '') +
          '" onclick="AstraX.pickFrame(\'' + f.id + '\')">' + esc(f.name) + '</button>';
      }).join('');

      var stats = [
        ['SCORE', (st.score || 0).toLocaleString()], ['NET WORTH', money(st.net_worth)],
        ['CASH', money(st.balance)], ['DEALS CLOSED', st.deals_closed],
        ['TRADES', st.trades_count], ['TIMES FIRED', st.times_fired],
        ['WEEK', st.week], ['BOSS MOOD', (st.boss_mood || 0) + '/100'],
        ['TRACKS OUT', st.tracks_released], ['MUSIC EARNED', money(st.music_earned)]
      ].map(function (s) {
        return '<div class="ax-fact"><div class="k">' + s[0] + '</div><div class="v">' + esc(s[1]) + '</div></div>';
      }).join('');

      body.innerHTML =
        '<div style="display:flex;gap:18px;align-items:flex-start;margin-bottom:18px;">' +
          '<div class="ax-pfp" id="axPfp" style="color:' + cur.color + ';border:' + frame.css + ';">' +
            cur.glyph + '</div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:19px;color:#fff;">' + esc(p.display_name) + '</div>' +
            '<div style="font-size:11px;color:var(--pixel-cyan);">' + esc(d.title) + ' — ' +
              esc(st.job_status === 'unemployed' ? 'Unemployed' : (st.job_title || '')) +
              (st.company_name && st.job_status !== 'unemployed' ? ' @ ' + esc(st.company_name) : '') + '</div>' +
            '<div style="font-size:10.5px;color:#5c7a99;margin-top:3px;">' +
              '@' + esc(p.username) + ' · operator since ' + esc(p.member_since) + '</div>' +
            '<div style="font-size:11.5px;color:var(--text-main);margin-top:8px;line-height:1.6;">' +
              (p.bio ? esc(p.bio) : '<span style="color:#44566b;">No bio set. Add one below.</span>') + '</div>' +
          '</div>' +
        '</div>' +

        '<div class="ax-facts" style="grid-template-columns:repeat(5,1fr);">' + stats + '</div>' +

        '<div style="margin-top:20px;font-size:10px;color:#5c7a99;letter-spacing:1px;">' +
          'EMBLEM' + badge('avatar_unlocks') + '</div>' +
        '<div style="font-size:10.5px;color:#44566b;margin:4px 0 10px;">' +
          'Drawn by the terminal — no uploads, no image hosting.</div>' +
        '<div class="ax-avatars">' + avatars + '</div>' +

        '<div style="margin-top:18px;font-size:10px;color:#5c7a99;letter-spacing:1px;">FRAME</div>' +
        '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">' + frames + '</div>' +

        '<div style="margin-top:20px;display:grid;grid-template-columns:1fr 2fr;gap:10px;">' +
          '<div><div style="font-size:10px;color:#5c7a99;">DISPLAY NAME</div>' +
            '<input id="axName" class="ax-ticket" maxlength="32" value="' + esc(p.display_name) + '" ' +
            'style="background:#000;border:1px solid var(--border-color);color:#fff;padding:8px;' +
            'font-family:var(--font-current);width:100%;margin-top:4px;"></div>' +
          '<div><div style="font-size:10px;color:#5c7a99;">BIO (160 CHARS)</div>' +
            '<input id="axBio" maxlength="160" value="' + esc(p.bio) + '" ' +
            'placeholder="Cold caller. Two firms, one firing, no regrets." ' +
            'style="background:#000;border:1px solid var(--border-color);color:#fff;padding:8px;' +
            'font-family:var(--font-current);width:100%;margin-top:4px;"></div>' +
        '</div>' +

        '<div style="margin-top:16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;">' +
          '<label style="font-size:11px;cursor:pointer;"><input type="checkbox" id="axSfx"' +
            (window.SFX && window.SFX.enabled ? ' checked' : '') +
            ' onchange="AstraX.toggleSfx(this.checked)"> Sound effects</label>' +
          '<button class="terminal-btn btn-action" onclick="AstraX.testSfx()">TEST SOUND</button>' +
          '<button class="terminal-btn btn-start" onclick="AstraX.saveProfile()">SAVE PROFILE</button>' +
        '</div>';
    } catch (e) {
      body.innerHTML = '<div style="color:var(--pixel-red);font-size:12px;">' +
        'Could not load your profile. Reload the terminal to try again.</div>';
    }
  }

  async function patchProfile(payload, quiet) {
    var status = $('axProfileStatus');
    try {
      var d = await post('/api/profile', payload);
      if (!d.success) {
        sfx('deny');
        if (status) { status.style.color = 'var(--pixel-red)'; status.textContent = d.msg || 'Save failed.'; }
        return false;
      }
      sfx(quiet ? 'click' : 'confirm');
      if (status && !quiet) {
        status.style.color = 'var(--pixel-green)';
        status.textContent = 'PROFILE SAVED';
        setTimeout(function () { status.textContent = ''; }, 2500);
      }
      await loadProfile();
      return true;
    } catch (e) {
      sfx('error');
      if (status) { status.style.color = 'var(--pixel-red)'; status.textContent = 'Save failed — connection lost.'; }
      return false;
    }
  }

  /* =================================================================
   * Music studio
   * ================================================================= */

  function studioView() {
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">POSTIFY STUDIO' + '</div>' +
        '<span style="font-size:11px;color:var(--pixel-cyan);" id="axStudioStatus"></span></div>' +
        '<div id="axStudioBody" style="font-size:12px;color:#888;">Loading studio...</div>' +
      '</div>' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">RELEASED CATALOGUE</div>' +
        '<span style="font-size:11px;color:var(--pixel-green);" id="axRoyalty"></span></div>' +
        '<div id="axTracks" style="display:flex;flex-direction:column;gap:6px;">' +
          '<div style="color:#888;font-size:11px;">No tracks yet.</div></div>' +
      '</div>';
  }

  async function loadStudio() {
    var body = $('axStudioBody');
    if (!body) return;
    try {
      var d = await api('/api/game/music/options');
      STUDIO.genres = d.genres; STUDIO.labels = d.labels; STUDIO.keys = d.keys;

      var genres = Object.keys(d.genres).map(function (id) {
        var g = d.genres[id];
        return '<button class="ax-chip' + (draft.genre === id ? ' sel' : '') +
          '" onclick="AstraX.pickGenre(\'' + id + '\')">' + esc(g.name) +
          '<span class="sub">' + esc(g.blurb) + '</span></button>';
      }).join('');

      var labels = d.labels.map(function (l) {
        return '<button class="ax-chip' + (draft.label === l.id ? ' sel' : '') +
          '" onclick="AstraX.pickLabel(\'' + l.id + '\')">' + esc(l.name) +
          '<span class="sub">Keeps ' + Math.round(l.cut * 100) + '% · reach ×' + l.reach +
          (l.cost ? ' · ' + money(l.cost) + ' up front' : ' · free') + '<br>' + esc(l.blurb) + '</span></button>';
      }).join('');

      var keys = d.keys.map(function (k) {
        return '<button class="ax-chip' + (draft.key === k ? ' sel' : '') +
          '" style="flex:1;text-align:center;" onclick="AstraX.pickKey(\'' + k + '\')">' + k + '</button>';
      }).join('');

      body.innerHTML =
        note('music_studio') +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">' +
          '<div>' +
            '<div style="font-size:10px;color:#5c7a99;letter-spacing:1px;margin-bottom:6px;">GENRE</div>' +
            '<div style="display:flex;flex-direction:column;gap:5px;">' + genres + '</div>' +
            '<div style="font-size:10px;color:#5c7a99;letter-spacing:1px;margin:14px 0 6px;">KEY</div>' +
            '<div style="display:flex;gap:4px;">' + keys + '</div>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:10px;color:#5c7a99;letter-spacing:1px;margin-bottom:6px;">LABEL</div>' +
            '<div style="display:flex;flex-direction:column;gap:5px;">' + labels + '</div>' +
          '</div>' +
        '</div>' +

        '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin-top:16px;">' +
          '<div><div style="font-size:10px;color:#5c7a99;">TRACK TITLE</div>' +
            '<input id="axTitle" maxlength="64" placeholder="e.g. Margin Call at 4AM" ' +
            'style="background:#000;border:1px solid var(--border-color);color:#fff;padding:8px;' +
            'font-family:var(--font-current);width:100%;margin-top:4px;"></div>' +
          '<div><div style="font-size:10px;color:#5c7a99;">TEMPO <span id="axBpmVal">' + draft.bpm + '</span> BPM</div>' +
            '<input type="range" id="axBpm" min="40" max="220" value="' + draft.bpm + '" ' +
            'style="width:100%;margin-top:12px;" oninput="AstraX.setBpm(this.value)"></div>' +
          '<div><div style="font-size:10px;color:#5c7a99;">LENGTH <span id="axBarsVal">' + draft.bars + '</span> BARS</div>' +
            '<input type="range" id="axBars" min="2" max="32" value="' + draft.bars + '" ' +
            'style="width:100%;margin-top:12px;" oninput="AstraX.setBars(this.value)"></div>' +
        '</div>' +

        '<div style="display:flex;gap:6px;margin-top:14px;flex-wrap:wrap;align-items:center;">' +
          '<button class="terminal-btn btn-action" onclick="AstraX.preview()" id="axPreviewBtn">[▶] PREVIEW</button>' +
          '<button class="terminal-btn" onclick="AstraX.reroll()">[⟳] NEW MELODY</button>' +
          '<button class="terminal-btn btn-start" onclick="AstraX.release()">[★] RELEASE TRACK</button>' +
          '<span id="axStudioMsg" style="font-size:11px;"></span>' +
        '</div>' +
        '<div style="font-size:9.5px;color:#5c7a99;margin-top:10px;line-height:1.6;">' +
          'Audio is synthesised in your browser from the settings above — nothing is uploaded or downloaded. ' +
          'A released track pays royalties every in-game day, decaying as it ages.</div>';

      loadTracks();
    } catch (e) {
      body.innerHTML = '<div style="color:var(--pixel-red);font-size:12px;">' +
        'Studio unavailable. Reload the terminal to try again.</div>';
    }
  }

  async function loadTracks() {
    var box = $('axTracks'), tot = $('axRoyalty');
    if (!box) return;
    try {
      var d = await api('/api/game/music/tracks');
      STUDIO.tracks = d.tracks;
      if (tot) tot.textContent = d.tracks.length
        ? money(d.total_daily) + '/day · ' + money(d.total_earned) + ' lifetime' : '';
      if (!d.tracks.length) {
        box.innerHTML = '<div style="color:#44566b;font-size:11px;">' +
          'Nothing released yet. Compose a track above and it starts paying royalties each day.</div>';
        return;
      }
      box.innerHTML = d.tracks.map(function (t) {
        var g = STUDIO.genres[t.genre] || { name: t.genre };
        return '<div class="ax-track">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="color:#fff;font-size:12px;">' + esc(t.title) + '</div>' +
            '<div style="font-size:10px;color:#5c7a99;">' + esc(g.name) + ' · ' + esc(t.key) + ' · ' +
              t.bpm + ' BPM · ' + t.bars + ' bars · released day ' + t.released_day + '</div>' +
            '<div class="ax-meter" style="margin-top:5px;width:150px;">' +
              '<i style="width:' + t.score + '%;"></i></div>' +
          '</div>' +
          '<div style="text-align:right;flex-shrink:0;">' +
            '<div style="color:var(--pixel-green);font-size:12px;">' + money(t.daily_royalty) + '/day</div>' +
            '<div style="font-size:10px;color:#5c7a99;">' + money(t.total_earned) + ' lifetime</div>' +
          '</div>' +
          '<div style="display:flex;gap:4px;flex-shrink:0;">' +
            '<button class="ax-qbtn" onclick="AstraX.playTrack(' + t.id + ')">▶</button>' +
            '<button class="ax-qbtn" onclick="AstraX.deleteTrack(' + t.id + ')">✕</button>' +
          '</div></div>';
      }).join('');
    } catch (e) { /* catalogue is non-critical */ }
  }

  function currentSpec() {
    return { genre: draft.genre, bpm: draft.bpm, key: draft.key, bars: draft.bars, seed: draft.seed };
  }

  function preview() {
    var btn = $('axPreviewBtn');
    if (window.Chiptune && window.Chiptune.isPlaying()) {
      window.Chiptune.stop();
      if (btn) btn.textContent = '[▶] PREVIEW';
      return;
    }
    if (!window.Chiptune) return;
    var ok = window.Chiptune.play(currentSpec());
    if (btn) btn.textContent = ok ? '[■] STOP' : '[▶] PREVIEW';
    if (!ok) msgStudio('Tap anywhere first — browsers block audio until you interact with the page.', true);
  }

  function msgStudio(text, bad) {
    var m = $('axStudioMsg');
    if (!m) return;
    m.style.color = bad ? 'var(--pixel-red)' : 'var(--pixel-green)';
    m.textContent = text;
    setTimeout(function () { if (m.textContent === text) m.textContent = ''; }, 5000);
  }

  /* =================================================================
   * Investor calculator
   * ================================================================= */

  var calcMode = 'compound';

  function calcView() {
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">INVESTOR CALCULATOR</div></div>' +
        '<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;">' +
          '<button class="ax-chip' + (calcMode === 'compound' ? ' sel' : '') +
            '" onclick="AstraX.setCalcMode(\'compound\')">COMPOUND GROWTH</button>' +
          '<button class="ax-chip' + (calcMode === 'position' ? ' sel' : '') +
            '" onclick="AstraX.setCalcMode(\'position\')">POSITION SIZING</button>' +
          '<button class="ax-chip' + (calcMode === 'pnl' ? ' sel' : '') +
            '" onclick="AstraX.setCalcMode(\'pnl\')">P&amp;L</button>' +
          '<button class="ax-chip' + (calcMode === 'retro' ? ' sel' : '') +
            '" onclick="AstraX.setCalcMode(\'retro\')">STANDARD (RETRO)</button>' +
        '</div>' +
        '<div id="axCalcBody"></div>' +
      '</div>';
  }

  /* ---- Standard retro calculator ------------------------------------------
   * A plain four-function calculator (with %, +/-, and a running memory-free
   * expression display), styled like an actual pocket-calculator LCD instead
   * of the other three modes' input-grid layout. It shares the CALC tab's
   * chip switcher but is otherwise self-contained: its own tiny expression
   * evaluator (digits/operators only, never a raw eval of user text) and its
   * own state, so it doesn't disturb calcMode/runCalc's compound/position/
   * P&L math above. */
  var RETRO = { display: '0', expr: '', justEvaluated: false };

  function retroKeypad() {
    var rows = [
      ['C', '±', '%', '÷'],
      ['7', '8', '9', '×'],
      ['4', '5', '6', '−'],
      ['1', '2', '3', '+'],
      ['0', '.', '=']
    ];
    return rows.map(function (row) {
      return '<div style="display:flex;gap:6px;margin-top:6px;">' +
        row.map(function (k) {
          var wide = (k === '0');
          var op = (k === '÷' || k === '×' || k === '−' || k === '+' || k === '=');
          var util = (k === 'C' || k === '±' || k === '%');
          return '<button class="ax-chip retro-key' + (op ? ' retro-op' : '') + (util ? ' retro-util' : '') +
            '" style="flex:' + (wide ? '2' : '1') + ' 0 0;padding:12px 0;font-size:15px;" ' +
            'onclick="AstraX.retroPress(\'' + k.replace(/'/g, "\\'") + '\')">' + k + '</button>';
        }).join('') +
      '</div>';
    }).join('');
  }

  function retroCalcView() {
    return '' +
      '<div style="max-width:280px;margin:0 auto;">' +
        '<div style="background:#000;border:2px solid var(--border-color);padding:14px 10px;' +
          'text-align:right;margin-bottom:8px;">' +
          '<div id="retroExprLine" style="font-size:10px;color:#5c7a99;min-height:12px;white-space:nowrap;' +
            'overflow:hidden;text-overflow:ellipsis;">' + esc(RETRO.expr) + '&nbsp;</div>' +
          '<div id="retroDisplay" style="font-size:28px;color:var(--pixel-green);letter-spacing:1px;' +
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(RETRO.display) + '</div>' +
        '</div>' +
        retroKeypad() +
        '<div style="font-size:9.5px;color:#5c7a99;margin-top:10px;text-align:center;">' +
          'Plain four-function calculator. No connection to your balance or the market feed.</div>' +
      '</div>';
  }

  function retroSyncDom() {
    var d = $('retroDisplay'), e = $('retroExprLine');
    if (d) d.textContent = RETRO.display;
    if (e) e.textContent = RETRO.expr || '\u00A0';
  }

  // Evaluates a plain +-*/ expression string using a small manual scanner -
  // never a raw eval()/Function() of anything a player typed, even though
  // today's only input source is this calculator's own button presses.
  function safeEvalExpr(str) {
    // The expression is built by retroPress as "num op num op num" with single
    // spaces, so split on whitespace. That keeps negative numbers (from the +/-
    // key) intact and accepts both the real minus sign (U+2212, what the key
    // sends) and an ASCII hyphen.
    var tokens = String(str).trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return 0;
    var isOp = function (t) { return t === '+' || t === '-' || t === '\u2212' || t === '\u00d7' || t === '\u00f7'; };
    // First pass: multiply and divide, left to right.
    var pass1 = [tokens[0]];
    for (var i = 1; i < tokens.length; i += 2) {
      var op = tokens[i], rhs = tokens[i + 1];
      if (rhs === undefined || !isOp(op)) break;
      if (op === '\u00d7' || op === '\u00f7') {
        var lhs = parseFloat(pass1.pop());
        var r = parseFloat(rhs);
        if (op === '\u00f7' && r === 0) return Infinity;   // shows ERROR
        pass1.push(String(op === '\u00d7' ? lhs * r : lhs / r));
      } else {
        pass1.push(op, rhs);
      }
    }
    // Second pass: add and subtract, left to right.
    var total = parseFloat(pass1[0]) || 0;
    for (var j = 1; j < pass1.length; j += 2) {
      var op2 = pass1[j], rhs2 = parseFloat(pass1[j + 1]) || 0;
      if (op2 === '+') total += rhs2;
      else total -= rhs2;   // '-' or '\u2212'
    }
    return total;
  }

  function retroFormat(n) {
    if (!isFinite(n)) return 'ERROR';
    var s = Math.round(n * 1e9) / 1e9; // trim float noise, keep real precision
    return String(s);
  }

  function retroPress(key) {
    sfx('type');
    if (key === 'C') {
      RETRO.display = '0'; RETRO.expr = ''; RETRO.justEvaluated = false;
    } else if (key === '±') {
      var pv = parseFloat(RETRO.display || '0');
      RETRO.display = pv === 0 ? '0' : String(pv * -1);
    } else if (key === '%') {
      RETRO.display = retroFormat((parseFloat(RETRO.display || '0')) / 100);
    } else if (key === '=') {
      var full = RETRO.expr + RETRO.display;
      RETRO.display = retroFormat(safeEvalExpr(full));
      RETRO.expr = '';
      RETRO.justEvaluated = true;
    } else if (key === '+' || key === '−' || key === '×' || key === '÷') {
      RETRO.expr = RETRO.expr + RETRO.display + ' ' + key + ' ';
      RETRO.display = '0';
      RETRO.justEvaluated = false;
    } else if (key === '.') {
      if (RETRO.justEvaluated) { RETRO.display = '0'; RETRO.justEvaluated = false; }
      if (RETRO.display.indexOf('.') === -1) RETRO.display += '.';
    } else {
      // digit
      if (RETRO.justEvaluated) { RETRO.display = ''; RETRO.expr = ''; RETRO.justEvaluated = false; }
      RETRO.display = (RETRO.display === '0' ? '' : RETRO.display) + key;
      if (RETRO.display.length > 16) RETRO.display = RETRO.display.slice(0, 16);
    }
    retroSyncDom();
  }

  function calcField(id, label, value, opts) {
    opts = opts || {};
    return '<div><div style="font-size:10px;color:#5c7a99;">' + label + '</div>' +
      '<input id="' + id + '" type="number" value="' + value + '" ' +
      (opts.step ? 'step="' + opts.step + '" ' : '') +
      'oninput="AstraX.runCalc()" ' +
      'style="background:#000;border:1px solid var(--border-color);color:#fff;padding:8px;' +
      'font-family:var(--font-current);width:100%;margin-top:4px;"></div>';
  }

  function calcResultRow(label, value, big) {
    return '<div style="display:flex;justify-content:space-between;padding:6px 0;' +
      'border-bottom:1px solid var(--border-color);">' +
      '<span style="font-size:11px;color:var(--text-main);">' + label + '</span>' +
      '<span style="font-size:' + (big ? '15px' : '12px') + ';color:' +
        (big ? 'var(--pixel-green)' : '#fff') + ';">' + value + '</span></div>';
  }

  function renderCalc() {
    var body = $('axCalcBody');
    if (!body) return;

    if (calcMode === 'retro') {
      body.innerHTML = retroCalcView();
      return;
    }

    if (calcMode === 'compound') {
      body.innerHTML =
        '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">' +
          calcField('calcPrincipal', 'STARTING BALANCE ($)', 2000) +
          calcField('calcMonthly', 'MONTHLY CONTRIBUTION ($)', 200) +
          calcField('calcRate', 'ANNUAL RETURN (%)', 8, { step: '0.1' }) +
          calcField('calcYears', 'YEARS', 10) +
        '</div>' +
        '<div id="axCalcResult" style="margin-top:16px;"></div>';
    } else if (calcMode === 'position') {
      body.innerHTML =
        '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">' +
          calcField('calcBalance', 'ACCOUNT BALANCE ($)', 10000) +
          calcField('calcRiskPct', 'RISK PER TRADE (%)', 1, { step: '0.1' }) +
          calcField('calcEntry', 'ENTRY PRICE ($)', 50, { step: '0.01' }) +
          calcField('calcStop', 'STOP-LOSS PRICE ($)', 47, { step: '0.01' }) +
        '</div>' +
        '<div id="axCalcResult" style="margin-top:16px;"></div>';
    } else {
      body.innerHTML =
        '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">' +
          calcField('calcPEntry', 'ENTRY PRICE ($)', 50, { step: '0.01' }) +
          calcField('calcPExit', 'EXIT PRICE ($)', 56, { step: '0.01' }) +
          calcField('calcShares', 'SHARES', 100) +
          calcField('calcFees', 'FEES / SLIPPAGE ($)', 5, { step: '0.01' }) +
        '</div>' +
        '<div style="margin-top:10px;">' +
          '<button class="ax-chip sel" id="calcSideLong" onclick="AstraX.setCalcSide(\'long\')">LONG</button> ' +
          '<button class="ax-chip" id="calcSideShort" onclick="AstraX.setCalcSide(\'short\')">SHORT</button>' +
        '</div>' +
        '<div id="axCalcResult" style="margin-top:16px;"></div>';
    }
    runCalc();
  }

  var calcSide = 'long';

  function fmtMoney(n) {
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function runCalc() {
    var out = $('axCalcResult');
    if (!out) return;
    var g = function (id) { var el = $(id); return el ? parseFloat(el.value) || 0 : 0; };

    if (calcMode === 'compound') {
      var principal = g('calcPrincipal'), monthly = g('calcMonthly'),
          rate = g('calcRate') / 100, years = Math.max(0, g('calcYears'));
      var monthlyRate = rate / 12, months = Math.round(years * 12);
      var balance = principal, contributed = principal;
      var milestones = [];
      for (var m = 1; m <= months; m++) {
        balance = balance * (1 + monthlyRate) + monthly;
        contributed += monthly;
        if (m % 12 === 0) milestones.push({ year: m / 12, balance: balance });
      }
      var growth = balance - contributed;
      out.innerHTML =
        calcResultRow('FINAL BALANCE', fmtMoney(balance), true) +
        calcResultRow('TOTAL CONTRIBUTED', fmtMoney(contributed)) +
        calcResultRow('TOTAL GROWTH', fmtMoney(growth)) +
        '<div style="margin-top:12px;font-size:10px;color:#5c7a99;letter-spacing:1px;">YEAR-BY-YEAR</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">' +
          milestones.map(function (mm) {
            return '<div style="border:1px solid var(--border-color);padding:5px 8px;font-size:10.5px;">' +
              'Y' + mm.year + ': ' + fmtMoney(mm.balance) + '</div>';
          }).join('') +
        '</div>';
    } else if (calcMode === 'position') {
      var balance2 = g('calcBalance'), riskPct = g('calcRiskPct') / 100,
          entry = g('calcEntry'), stop = g('calcStop');
      var riskDollars = balance2 * riskPct;
      var perShareRisk = Math.abs(entry - stop);
      var shares = perShareRisk > 0 ? Math.floor(riskDollars / perShareRisk) : 0;
      var positionValue = shares * entry;
      var pctOfAccount = balance2 > 0 ? (positionValue / balance2) * 100 : 0;
      out.innerHTML =
        calcResultRow('MAX RISK THIS TRADE', fmtMoney(riskDollars), true) +
        calcResultRow('SHARES TO BUY', shares.toLocaleString()) +
        calcResultRow('POSITION VALUE', fmtMoney(positionValue)) +
        calcResultRow('% OF ACCOUNT DEPLOYED', pctOfAccount.toFixed(1) + '%') +
        (perShareRisk === 0 ? '<div style="color:var(--pixel-red);font-size:11px;margin-top:8px;">' +
          'Entry and stop are equal - set a real stop distance.</div>' : '');
    } else {
      var pEntry = g('calcPEntry'), pExit = g('calcPExit'), shares2 = g('calcShares'), fees = g('calcFees');
      var gross = calcSide === 'long' ? (pExit - pEntry) * shares2 : (pEntry - pExit) * shares2;
      var net = gross - fees;
      var basis = pEntry * shares2;
      var pctReturn = basis > 0 ? (net / basis) * 100 : 0;
      out.innerHTML =
        calcResultRow('NET P&L', fmtMoney(net), true) +
        calcResultRow('GROSS P&L', fmtMoney(gross)) +
        calcResultRow('FEES / SLIPPAGE', fmtMoney(-fees)) +
        calcResultRow('RETURN ON CAPITAL', pctReturn.toFixed(2) + '%');
      out.querySelector('div:first-child span:last-child').style.color =
        net >= 0 ? 'var(--pixel-green)' : 'var(--pixel-red)';
    }
  }


  /* =================================================================
   * Co-op Syndicates
   * ================================================================= */

  var COOP = { inRoom: false, data: null, pollTimer: null };

  function coopView() {
    return (
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">CO-OP SYNDICATE' + badge('coop') + '</div></div>' +
        note('coop') +
        '<div id="axCoopBody">Loading...</div>' +
      '</div>'
    );
  }

  function coopLobbyHtml() {
    return (
      '<div class="game-dashboard-grid">' +
        '<div class="terminal-panel">' +
          '<div class="panel-header"><div class="panel-heading-title">FOUND A SYNDICATE</div></div>' +
          '<input type="text" id="axCoopFirmName" class="d-input" placeholder="Syndicate name..." style="margin-bottom:8px;">' +
          '<button class="terminal-btn btn-start" onclick="AstraX.createCoop()">[FOUND SYNDICATE]</button>' +
        '</div>' +
        '<div class="terminal-panel">' +
          '<div class="panel-header"><div class="panel-heading-title">JOIN A SYNDICATE</div></div>' +
          '<input type="text" id="axCoopJoinCode" class="d-input" placeholder="Room code..." style="margin-bottom:8px; text-transform:uppercase;">' +
          '<button class="terminal-btn btn-action" onclick="AstraX.joinCoop()">[JOIN SYNDICATE]</button>' +
        '</div>' +
      '</div>' +
      '<span id="axCoopMsg" style="font-size:11px; display:block; margin-top:8px;"></span>'
    );
  }

  function coopRoomHtml(d) {
    var stockOptions = Object.keys(d.stocks || {}).map(function (sym) {
      return '<option value="' + sym + '">' + sym + ' — $' + d.stocks[sym].price.toFixed(2) + '</option>';
    }).join('');
    var shareRows = Object.keys(d.shares || {}).filter(function (s) { return d.shares[s] > 0; }).map(function (s) {
      return '<div style="display:flex; justify-content:space-between; padding:3px 0; border-bottom:1px solid var(--border-color); font-size:12px;">' +
        '<span>' + esc(s) + '</span><span>' + d.shares[s] + ' shares</span></div>';
    }).join('') || '<div style="color:#888; font-size:11px;">No positions yet.</div>';

    return (
      '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">' +
        '<div><strong style="color:var(--pixel-cyan);">' + esc(d.firm_name) + '</strong> ' +
          '<span style="color:#5c7a99; font-size:11px;">ROOM CODE: <strong style="color:#fff;">' + esc(d.room_code) + '</strong> — share this to invite</span></div>' +
        '<button class="terminal-btn btn-warning" style="padding:5px 10px; font-size:10px;" onclick="AstraX.leaveCoop()">[LEAVE]</button>' +
      '</div>' +
      '<div class="game-hud-bar" style="margin-bottom:10px;">' +
        '<div class="gh-card"><div class="gh-lbl">SYNDICATE BALANCE</div><div class="gh-val" style="font-size:18px; color:var(--pixel-green);">$' + d.balance.toLocaleString(undefined, { minimumFractionDigits: 2 }) + '</div></div>' +
        '<div class="gh-card"><div class="gh-lbl">WEEKLY TARGET</div><div class="gh-val" style="font-size:18px;">$' + d.weekly_target.toLocaleString() + '</div></div>' +
        '<div class="gh-card"><div class="gh-lbl">WEEKLY BILLS</div><div class="gh-val" style="font-size:18px;">$' + d.weekly_bills.toLocaleString() + '</div></div>' +
        '<div class="gh-card"><div class="gh-lbl">COMMISSION (WK)</div><div class="gh-val" style="font-size:18px; color:var(--pixel-cyan);">$' + d.weekly_commission.toLocaleString() + '</div></div>' +
        '<div class="gh-card"><div class="gh-lbl">DAY / WEEK</div><div class="gh-val" style="font-size:18px;">' + d.day + ' / ' + d.week + '</div></div>' +
        '<div class="gh-card"><div class="gh-lbl">MEMBERS</div><div class="gh-val" style="font-size:18px;">' + (d.members || []).length + '</div></div>' +
      '</div>' +
      '<div class="game-dashboard-grid">' +
        '<div class="terminal-panel">' +
          '<div class="panel-header"><div class="panel-heading-title">SHARED TRADING DESK</div></div>' +
          '<select id="axCoopSymbol" class="d-input" style="margin-bottom:6px;">' + stockOptions + '</select>' +
          '<input type="number" id="axCoopQty" class="d-input" value="1" min="1" style="margin-bottom:6px;">' +
          '<div style="display:flex; gap:6px; margin-bottom:10px;">' +
            '<button class="terminal-btn btn-start" style="flex:1;" onclick="AstraX.coopTrade(\'buy\')">[BUY]</button>' +
            '<button class="terminal-btn btn-warning" style="flex:1;" onclick="AstraX.coopTrade(\'sell\')">[SELL]</button>' +
          '</div>' +
          '<div style="font-size:10px; color:#5c7a99; letter-spacing:1px; margin-bottom:4px;">SYNDICATE POSITIONS</div>' +
          shareRows +
          '<button class="terminal-btn" style="margin-top:10px; width:100%;" onclick="AstraX.coopAdvanceDay()">[ADVANCE SYNDICATE DAY]</button>' +
          '<div style="font-size:10px; color:#5c7a99; margin-top:6px;">MEMBERS: ' + (d.members || []).map(esc).join(', ') + '</div>' +
        '</div>' +
        '<div class="terminal-panel">' +
          '<div class="panel-header"><div class="panel-heading-title">SYNDICATE LOG</div></div>' +
          '<div id="axCoopLog" class="market-ticker-view" style="height:220px; margin-bottom:8px;">' +
            (d.logs || []).slice().reverse().map(function (l) {
              return '<div><span style="color:#5c7a99;">[' + l.time + ']</span> <strong style="color:var(--pixel-cyan);">' + esc(l.username) + '</strong> ' + esc(l.message) + '</div>';
            }).join('') +
          '</div>' +
          '<div style="display:flex; gap:6px;">' +
            '<input type="text" id="axCoopChatInput" class="d-input" placeholder="Message the syndicate..." onkeydown="if(event.key===\'Enter\') AstraX.coopChat()">' +
            '<button class="terminal-btn btn-action" onclick="AstraX.coopChat()">SEND</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  async function loadCoopState() {
    var host = $('axCoopBody');
    if (!host) return;
    try {
      var d = await api('/api/coop/state');
      if (!d.success) throw new Error('not in room');
      COOP.inRoom = true;
      COOP.data = d;
      host.innerHTML = coopRoomHtml(d);
      // astra_phase5.js swaps the 4-second timer for a long-poll that repaints
      // the instant anyone in the room does anything. The interval stays as a
      // fallback for when that file isn't loaded.
      if (window.AstraP5 && window.AstraP5.watchCoop) {
        if (COOP.pollTimer) { clearInterval(COOP.pollTimer); COOP.pollTimer = null; }
        window.AstraP5.watchCoop(d.revision, function () { if (COOP.inRoom) loadCoopState(); });
      } else if (!COOP.pollTimer) {
        COOP.pollTimer = setInterval(function () { if (COOP.inRoom) loadCoopState(); }, 4000);
      }
    } catch (e) {
      COOP.inRoom = false;
      if (window.AstraP5 && window.AstraP5.stopCoopWatch) window.AstraP5.stopCoopWatch();
      if (COOP.pollTimer) { clearInterval(COOP.pollTimer); COOP.pollTimer = null; }
      host.innerHTML = coopLobbyHtml();
    }
  }



  var MSG = { friends: [], incoming: [], outgoing: [], active: null, thread: [], pendingEncrypt: false };
  var friendsLoading = false;

  function messagesView() {
    return (
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">ADD FRIEND' + badge('friends_dm') + '</div></div>' +
        note('friends_dm') +
        '<div style="display:flex; gap:6px;">' +
          '<input type="text" id="axFriendUsername" class="d-input" placeholder="Operator username..." ' +
            'onkeydown="if(event.key===\'Enter\') AstraX.sendFriendRequest()">' +
          '<button class="terminal-btn btn-action" onclick="AstraX.sendFriendRequest()">[SEND REQUEST]</button>' +
        '</div>' +
        '<span id="axFriendMsg" style="font-size:11px; display:block; margin-top:6px;"></span>' +
      '</div>' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">MESSAGE ANY OPERATOR</div></div>' +
        '<div style="font-size:10px; color:#5c7a99; margin-bottom:6px;">Friendship isn\'t required to DM someone - just their exact username.</div>' +
        '<div style="display:flex; gap:6px;">' +
          '<input type="text" id="axDMUsername" class="d-input" placeholder="Operator username..." ' +
            'onkeydown="if(event.key===\'Enter\') AstraX.openThread(document.getElementById(\'axDMUsername\').value.trim())">' +
          '<button class="terminal-btn btn-action" onclick="AstraX.openThread(document.getElementById(\'axDMUsername\').value.trim())">[OPEN THREAD]</button>' +
        '</div>' +
      '</div>' +
      '<div class="game-dashboard-grid">' +
        '<div class="terminal-panel" style="max-height:520px; overflow-y:auto;">' +
          '<div class="panel-header"><div class="panel-heading-title">CONTACTS</div></div>' +
          '<div id="axFriendsList">Loading...</div>' +
        '</div>' +
        '<div class="terminal-panel" style="display:flex; flex-direction:column;">' +
          '<div class="panel-header"><div class="panel-heading-title" id="axThreadTitle">SELECT A FRIEND</div></div>' +
          '<div id="axThreadBody" style="flex-grow:1; min-height:280px; max-height:360px; overflow-y:auto; ' +
            'display:flex; flex-direction:column; gap:6px; margin-bottom:8px;">' +
            '<div style="color:#888; font-size:11px;">Pick a contact on the left to open the thread.</div>' +
          '</div>' +
          '<div id="axThreadComposer" style="display:none;">' +
            '<textarea id="axMsgBody" class="d-input" rows="2" placeholder="Type a message..." ' +
              'style="resize:vertical; margin-bottom:6px;"></textarea>' +
            '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">' +
              '<label style="font-size:11px; color:var(--text-main); display:flex; align-items:center; gap:5px;">' +
                '<input type="checkbox" id="axMsgEncrypt" onchange="AstraX.toggleMsgEncrypt(this.checked)"> ENCRYPT THIS' +
              '</label>' +
              '<input type="text" id="axMsgPin" class="d-input" placeholder="PIN (4-8 digits)" ' +
                'style="display:none; width:140px;" maxlength="8">' +
              '<button class="terminal-btn btn-action" onclick="AstraX.sendMessage()">[SEND]</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  async function loadFriends() {
    var host = $('axFriendsList');
    if (!host || friendsLoading) return;
    friendsLoading = true;
    try {
      var d = await api('/api/friends');
      MSG.friends = d.friends || [];
      MSG.incoming = d.incoming || [];
      MSG.outgoing = d.outgoing || [];
      renderFriendsList();
      var navBadge = $('nav-messages');
      var unreadTotal = MSG.friends.reduce(function (n, f) { return n + (f.unread || 0); }, 0);
      if (navBadge) {
        var dot = navBadge.querySelector('.ax-unread-dot');
        if (unreadTotal > 0) {
          if (!dot) {
            dot = document.createElement('span');
            dot.className = 'ax-unread-dot';
            dot.style.cssText = 'display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--pixel-red);margin-left:5px;';
            navBadge.appendChild(dot);
          }
        } else if (dot) { dot.remove(); }
      }
    } catch (e) {
      host.innerHTML = '<div style="color:var(--pixel-red); font-size:11px;">Could not load contacts.</div>';
    } finally {
      friendsLoading = false;
    }
  }

  function renderFriendsList() {
    var host = $('axFriendsList');
    if (!host) return;
    var html = '';

    if (MSG.incoming.length) {
      html += '<div style="font-size:10px; color:var(--pixel-yellow); letter-spacing:1px; margin-bottom:4px;">INCOMING REQUESTS</div>';
      html += MSG.incoming.map(function (r) {
        return '<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid var(--border-color);">' +
          '<span>' + esc(r.username) + '</span>' +
          '<span style="display:flex; gap:4px;">' +
            '<button class="terminal-btn btn-start" style="padding:3px 8px; font-size:10px;" onclick="AstraX.respondFriend(' + r.id + ',\'accept\')">✓</button>' +
            '<button class="terminal-btn btn-warning" style="padding:3px 8px; font-size:10px;" onclick="AstraX.respondFriend(' + r.id + ',\'decline\')">✕</button>' +
          '</span></div>';
      }).join('');
    }
    if (MSG.outgoing.length) {
      html += '<div style="font-size:10px; color:#5c7a99; letter-spacing:1px; margin:8px 0 4px;">PENDING (SENT)</div>';
      html += MSG.outgoing.map(function (r) {
        return '<div style="padding:5px 0; color:#888; font-size:12px;">' + esc(r.username) + ' — waiting...</div>';
      }).join('');
    }

    html += '<div style="font-size:10px; color:var(--pixel-cyan); letter-spacing:1px; margin:8px 0 4px;">FRIENDS</div>';
    if (!MSG.friends.length) {
      html += '<div style="color:#888; font-size:11px;">No friends yet — add one above by username.</div>';
    } else {
      html += MSG.friends.map(function (f) {
        var active = MSG.active === f.username;
        var safeName = esc(f.username).replace(/'/g, "\\'");
        return '<div class="client-row" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; ' +
          'padding:7px 6px; border-bottom:1px solid var(--border-color);' +
          (active ? ' background:rgba(0,255,204,.06);' : '') + '">' +
          '<span onclick="AstraX.openThread(\'' + safeName + '\')" style="flex-grow:1; color:' + (active ? 'var(--pixel-cyan)' : '#fff') + ';">' + esc(f.username) + '</span>' +
          (f.unread ? '<span style="background:var(--pixel-red); color:#000; font-size:10px; padding:1px 6px; border-radius:8px; margin-right:6px;">' + f.unread + '</span>' : '') +
          '<span onclick="AstraX.removeFriend(\'' + safeName + '\')" style="color:#556b85; font-size:11px; cursor:pointer;" title="Remove friend">✕</span>' +
        '</div>';
      }).join('');
    }
    host.innerHTML = html;
  }

  async function openThread(username) {
    MSG.active = username;
    sfx('tab');
    if (window.AstraP5 && window.AstraP5.onThreadOpen) window.AstraP5.onThreadOpen(username);
    renderFriendsList();
    $('axThreadTitle').textContent = 'DM — ' + username.toUpperCase();
    // Stage 19: one-click report for whoever is on the other end of this thread.
    (function () {
      var title = $('axThreadTitle'), old = $('axReportBtn');
      if (old) old.remove();
      if (!title || !title.parentNode) return;
      var b = document.createElement('button');
      b.id = 'axReportBtn'; b.className = 'terminal-btn'; b.textContent = '[!] REPORT';
      b.style.marginLeft = 'auto'; b.style.fontSize = '10px';
      b.onclick = async function () {
        var reason = (prompt('Report ' + username + ' for? (cheating / nsfw / harassment / scam / other)', 'other') || '').trim().toLowerCase();
        if (!reason) return;
        var details = prompt('Anything the admins should know? (optional)', '') || '';
        try {
          var res = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_username: username, target_type: 'dm', reason: reason, details: details }) });
          var d = await res.json();
          alert(d.msg || (d.success ? 'Report filed.' : 'Could not file report.'));
        } catch (e) { alert('Could not reach the server.'); }
      };
      title.parentNode.appendChild(b);
    })();
    $('axThreadComposer').style.display = 'block';
    var body = $('axThreadBody');
    body.innerHTML = '<div style="color:#888; font-size:11px;">Loading thread...</div>';
    try {
      var d = await api('/api/messages/' + encodeURIComponent(username));
      if (d && d.success === false) {
        body.innerHTML = '<div style="color:var(--pixel-red); font-size:11px;">' + esc(d.msg || 'Could not open that thread.') + '</div>';
        return;
      }
      MSG.thread = d.messages || [];
      renderThread();
      loadFriends(); // clears the unread badge we just read
    } catch (e) {
      body.innerHTML = '<div style="color:var(--pixel-red); font-size:11px;">Could not load thread.</div>';
    }
  }

  function renderThread() {
    var body = $('axThreadBody');
    if (!body) return;
    // astra_phase5.js takes this over to draw attachments and read receipts.
    // Delegating (rather than being overridden wholesale) keeps MSG.active and
    // sendMessage() below working off this file's own state.
    if (window.AstraP5 && window.AstraP5.renderThread) {
      window.AstraP5.renderThread(MSG.thread);
      return;
    }
    if (!MSG.thread.length) {
      body.innerHTML = '<div style="color:#888; font-size:11px;">No messages yet — say hello.</div>';
      return;
    }
    body.innerHTML = MSG.thread.map(function (m) {
      var mine = m.from_me;
      var bubbleStyle = 'max-width:80%; align-self:' + (mine ? 'flex-end' : 'flex-start') + '; ' +
        'background:' + (mine ? 'rgba(0,255,204,.08)' : '#000') + '; border:1px solid var(--border-color); ' +
        'padding:7px 10px; font-size:12px; word-break:break-word;';
      if (m.encrypted) {
        return '<div style="' + bubbleStyle + '">' +
          '<span style="color:var(--pixel-yellow);">[ENCRYPTED]</span> ' +
          '<button class="terminal-btn" style="padding:2px 6px; font-size:10px;" onclick="AstraX.decryptMessage(' + m.id + ', this)">DECRYPT</button>' +
          '<div class="ax-decrypted" style="margin-top:5px; display:none;"></div>' +
        '</div>';
      }
      return '<div style="' + bubbleStyle + '">' + esc(m.body) + '</div>';
    }).join('');
    body.scrollTop = body.scrollHeight;
  }

  async function decryptMessage(id, btn) {
    var pin = prompt('Enter the PIN this message was sent with:');
    if (!pin) return;
    try {
      var d = await post('/api/messages/decrypt', { id: id, pin: pin });
      var out = btn.parentElement.querySelector('.ax-decrypted');
      if (!d.success) {
        sfx('deny');
        if (out) { out.style.display = 'block'; out.style.color = 'var(--pixel-red)'; out.textContent = d.msg || 'Wrong PIN.'; }
        return;
      }
      sfx('unlock');
      btn.style.display = 'none';
      if (out) { out.style.display = 'block'; out.style.color = '#fff'; out.textContent = d.body; }
    } catch (e) { sfx('error'); }
  }

  async function refreshBotStatus() {
    var el = $('aiEngineStatusLabel');
    if (!el) return;
    try {
      var d = await api('/api/omni_bots');
      var live = !!d.ai_live;
      el.innerHTML = '<span class="ax-dot' + (live ? ' live' : ' off') + '"></span>' +
        (live ? 'OMNI-CORE ONLINE · ' + esc(String(d.model || '').split('/').pop()) +
                ' · ' + d.bots.length + ' BOTS ACTIVE'
              : 'OMNI-CORE LOCAL MODE · COMMAND SET ONLY');
      el.style.color = live ? 'var(--pixel-green)' : 'var(--pixel-yellow)';
      el.title = live
        ? 'A language model is connected. Bots reply live to what you type.'
        : 'No model key configured. OMNI-CORE still answers /commands from live terminal state.';
    } catch (e) { /* the original poller also covers this label */ }
  }

  function seedConsoleHelp() {
    var log = $('omniConsoleLog');
    if (!log || log.dataset.axSeeded) return;
    log.dataset.axSeeded = '1';
    log.innerHTML =
      '<div style="color:var(--pixel-cyan);">[OMNI-CORE]: Online. I can read this terminal\'s live state — ' +
      'your career, cash, positions and engine.</div>' +
      '<div style="color:#5c7a99;">Try: <strong>/help</strong> · <strong>/portfolio</strong> · ' +
      '<strong>/price CHIP</strong> · <strong>/company POST</strong> · <strong>/career</strong> · ' +
      '<strong>/whoami</strong> · <strong>/reveal</strong> · <strong>/translate ES hello</strong> · ' +
      '<strong>/wip</strong> — or just ask a question.</div>';
  }

  /* =================================================================
   * Wiring into the original script
   * ================================================================= */

  function wrapGlobals() {
    // Make every market tile open the full company desk.
    var origRender = window.renderGameState;
    if (typeof origRender === 'function') {
      window.renderGameState = function () {
        var r = origRender.apply(this, arguments);
        ['stocksMarketGrid', 'marketsStocksGrid'].forEach(function (gridId) {
          var grid = $(gridId);
          if (!grid) return;
          Array.prototype.forEach.call(grid.children, function (tile) {
            var label = tile.querySelector('div');
            if (!label) return;
            var sym = label.textContent.trim();
            if (!sym || tile.dataset.axBound) return;
            tile.dataset.axBound = '1';
            tile.classList.add('stock-tile');
            tile.title = 'Open the ' + sym + ' desk';
            tile.addEventListener('click', function () { openStock(sym); });
          });
        });
        return r;
      };
    }

    // Sound on view changes.
    var origSwitch = window.switchView;
    if (typeof origSwitch === 'function') {
      window.switchView = function (name) {
        var r = origSwitch.apply(this, arguments);
        sfx('tab');
        if (name === 'profile') loadProfile();
        if (name === 'studio') loadStudio();
        if (name === 'calc') renderCalc();
        if (name === 'messages') loadFriends();
        if (name === 'coop') loadCoopState();
        if (name === 'bots') { refreshBotStatus(); seedConsoleHelp(); }
        return r;
      };
    }

    // Sound on the original buy/sell buttons and the day tick.
    ['executeTrade', 'advanceGameDay', 'callClientBot', 'sendClientPitch',
     'hireEmployee', 'applyToJob', 'startOwnBusiness', 'marryPartnerDrawer'].forEach(function (fn) {
      var orig = window[fn];
      if (typeof orig !== 'function') return;
      var cue = { executeTrade: 'buy', advanceGameDay: 'day', callClientBot: 'dial',
                  sendClientPitch: 'click', hireEmployee: 'confirm', applyToJob: 'dial',
                  startOwnBusiness: 'cash', marryPartnerDrawer: 'cash' }[fn];
      window[fn] = function (arg) {
        if (fn === 'executeTrade') cue = arg === 'sell' ? 'sell' : 'buy';
        sfx(cue);
        return orig.apply(this, arguments);
      };
    });

    // Generic UI sound: any terminal button, plus typing in terminal inputs.
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.terminal-btn, .d-tab, .auth-tab, .client-row');
      if (b) sfx('click');
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && e.key.length === 1) sfx('type');
    }, true);
  }

  /* =================================================================
   * Public surface (referenced by inline onclick attributes)
   * ================================================================= */

  window.AstraX = {
    openStock: openStock,
    closeStock: closeStock,
    setQty: setQty,
    updateCost: updateCost,
    trade: trade,

    pickAvatar: function (id) { patchProfile({ avatar_glyph: id }, true); },
    pickFrame: function (id) { patchProfile({ avatar_frame: id }, true); },
    saveProfile: function () {
      patchProfile({
        display_name: ($('axName') || {}).value || '',
        bio: ($('axBio') || {}).value || ''
      });
    },
    toggleSfx: function (on) {
      if (window.SFX) window.SFX.setEnabled(on);
      if (on) sfx('confirm');
      patchProfile({ sfx_enabled: !!on }, true);
    },
    testSfx: function () {
      var all = ['boot', 'confirm', 'buy', 'cash', 'dial', 'deny'];
      all.forEach(function (n, i) { setTimeout(function () { sfx(n); }, i * 520); });
    },

    pickGenre: function (id) {
      draft.genre = id;
      var g = STUDIO.genres[id];
      if (g) draft.bpm = g.bpm;
      sfx('click');
      loadStudio();
    },
    pickLabel: function (id) { draft.label = id; sfx('click'); loadStudio(); },
    pickKey: function (k) { draft.key = k; sfx('click'); loadStudio(); },
    setBpm: function (v) { draft.bpm = parseInt(v, 10); var e = $('axBpmVal'); if (e) e.textContent = v; },
    setBars: function (v) { draft.bars = parseInt(v, 10); var e = $('axBarsVal'); if (e) e.textContent = v; },
    reroll: function () {
      draft.seed = Math.floor(Math.random() * 1000000);
      sfx('click');
      if (window.Chiptune && window.Chiptune.isPlaying()) { window.Chiptune.stop(); preview(); }
      else msgStudio('New melody seeded. Hit preview.');
    },
    preview: preview,

    release: async function () {
      var title = ($('axTitle') || {}).value || '';
      if (!title.trim()) { sfx('deny'); msgStudio('Give the track a title first.', true); return; }
      try {
        var d = await post('/api/game/music/release', {
          title: title, genre: draft.genre, label: draft.label,
          key: draft.key, bpm: draft.bpm, bars: draft.bars, seed: draft.seed
        });
        if (!d.success) { sfx('deny'); msgStudio(d.msg || 'Release rejected.', true); return; }
        sfx('cash');
        msgStudio(d.msg);
        if ($('axTitle')) $('axTitle').value = '';
        loadTracks();
        if (window.pollGameState) window.pollGameState();
      } catch (e) { sfx('error'); msgStudio('Release failed — connection lost.', true); }
    },

    playTrack: function (id) {
      var t = STUDIO.tracks.filter(function (x) { return x.id === id; })[0];
      if (!t || !window.Chiptune) return;
      if (window.Chiptune.isPlaying()) { window.Chiptune.stop(); return; }
      window.Chiptune.play({ genre: t.genre, bpm: t.bpm, key: t.key, bars: t.bars, seed: t.seed });
    },

    deleteTrack: async function (id) {
      if (!confirm('Pull this track from the catalogue? Royalties stop immediately.')) return;
      try { await post('/api/game/music/delete', { id: id }); sfx('close'); loadTracks(); }
      catch (e) { sfx('error'); }
    },

    refreshBotStatus: refreshBotStatus,

    setCalcMode: function (m) {
      calcMode = m;
      sfx('tab');
      var host = $('view-calc');
      if (host) host.innerHTML = calcView();
      renderCalc();
    },
    setCalcSide: function (s) {
      calcSide = s;
      var l = $('calcSideLong'), sh = $('calcSideShort');
      if (l) l.classList.toggle('sel', s === 'long');
      if (sh) sh.classList.toggle('sel', s === 'short');
      runCalc();
    },
    runCalc: runCalc,
    retroPress: retroPress,

    sendFriendRequest: async function () {
      var input = $('axFriendUsername');
      var msgEl = $('axFriendMsg');
      var username = (input && input.value || '').trim();
      if (!username) return;
      try {
        var d = await post('/api/friends/request', { username: username });
        if (msgEl) { msgEl.style.color = d.success ? 'var(--pixel-green)' : 'var(--pixel-red)'; msgEl.textContent = d.msg || ''; }
        sfx(d.success ? 'confirm' : 'deny');
        if (d.success) { input.value = ''; loadFriends(); }
      } catch (e) { sfx('error'); }
    },

    respondFriend: async function (id, action) {
      try {
        var d = await post('/api/friends/respond', { id: id, action: action });
        sfx(d.success ? (action === 'accept' ? 'confirm' : 'close') : 'deny');
        loadFriends();
      } catch (e) { sfx('error'); }
    },

    removeFriend: async function (username) {
      if (!confirm('Remove ' + username + ' as a friend? This does not delete your message history.')) return;
      try {
        await post('/api/friends/remove', { username: username });
        sfx('close');
        if (MSG.active === username) { MSG.active = null; }
        loadFriends();
      } catch (e) { sfx('error'); }
    },

    openThread: openThread,
    decryptMessage: decryptMessage,

    toggleMsgEncrypt: function (checked) {
      MSG.pendingEncrypt = checked;
      var pinField = $('axMsgPin');
      if (pinField) pinField.style.display = checked ? 'block' : 'none';
    },

    sendMessage: async function () {
      if (!MSG.active) return;
      var bodyEl = $('axMsgBody');
      var pinEl = $('axMsgPin');
      var body = (bodyEl && bodyEl.value || '').trim();
      if (!body) return;
      var payload = { to: MSG.active, body: body, encrypt: !!MSG.pendingEncrypt };
      if (MSG.pendingEncrypt) {
        payload.pin = (pinEl && pinEl.value || '').trim();
        if (!/^\d{4,8}$/.test(payload.pin)) { sfx('deny'); alert('Pick a 4-8 digit PIN for this encrypted message, then share it with them however you trust.'); return; }
      }
      try {
        var d = await post('/api/messages/send', payload);
        if (!d.success) { sfx('deny'); alert(d.msg || 'Send failed.'); return; }
        sfx('confirm');
        bodyEl.value = '';
        if (pinEl) pinEl.value = '';
        openThread(MSG.active);
      } catch (e) { sfx('error'); }
    }
  };

  Object.assign(window.AstraX, {
    // Small surface for astra_phase5.js so it can refresh this file's views
    // after it changes something (a released track, a read thread).
    refreshFriends: loadFriends,
    // Live sync (astra_live.js): which thread is open, and a quiet re-fetch of
    // it that repaints the messages without resetting what you're typing.
    activeThread: function () { return MSG.active; },
    refreshThread: async function () {
      if (!MSG.active) return;
      var who = MSG.active;
      try {
        var d = await api('/api/messages/' + encodeURIComponent(who));
        if (MSG.active !== who || !d || d.success === false) return;
        MSG.thread = d.messages || [];
        renderThread();
        var body = $('axThreadBody');
        if (body) body.scrollTop = body.scrollHeight;
        loadFriends();
      } catch (e) { /* next sync tries again */ }
    },
    reloadStudio: loadStudio,
    refreshProfile: loadProfile,

    createCoop: async function () {
      var name = ($('axCoopFirmName') && $('axCoopFirmName').value || '').trim();
      try {
        var d = await post('/api/coop/create', { firm_name: name });
        if (!d.success) { sfx('deny'); return; }
        sfx('confirm');
        loadCoopState();
      } catch (e) { sfx('error'); }
    },
    joinCoop: async function () {
      var code = ($('axCoopJoinCode') && $('axCoopJoinCode').value || '').trim().toUpperCase();
      var msgEl = $('axCoopMsg');
      if (!code) return;
      try {
        var d = await post('/api/coop/join', { room_code: code });
        if (!d.success) { sfx('deny'); if (msgEl) { msgEl.style.color = 'var(--pixel-red)'; msgEl.textContent = d.msg || 'Could not join.'; } return; }
        sfx('confirm');
        loadCoopState();
      } catch (e) { sfx('error'); }
    },
    leaveCoop: async function () {
      if (!confirm('Leave this syndicate? You can rejoin later with the room code.')) return;
      try { await post('/api/coop/leave', {}); sfx('close'); loadCoopState(); } catch (e) { sfx('error'); }
    },
    coopTrade: async function (action) {
      var symbol = $('axCoopSymbol') && $('axCoopSymbol').value;
      var qty = Math.max(1, parseInt(($('axCoopQty') && $('axCoopQty').value) || '1', 10));
      if (!symbol) return;
      try {
        var d = await post('/api/coop/trade_share', { symbol: symbol, action: action, qty: qty });
        sfx(d.success ? (action === 'buy' ? 'buy' : 'sell') : 'deny');
        if (!d.success) alert(d.msg || 'Trade failed.');
        loadCoopState();
      } catch (e) { sfx('error'); }
    },
    coopAdvanceDay: async function () {
      try { sfx('day'); await post('/api/coop/advance_day', {}); loadCoopState(); } catch (e) { sfx('error'); }
    },
    coopChat: async function () {
      var input = $('axCoopChatInput');
      var message = (input && input.value || '').trim();
      if (!message) return;
      try {
        await post('/api/coop/chat', { message: message });
        input.value = '';
        sfx('click');
        loadCoopState();
      } catch (e) { sfx('error'); }
    }
  });

  /* =================================================================
   * Boot
   * ================================================================= */

  async function boot() {
    injectStyles();

    try {
      var w = await api('/api/wip');
      WIP = w.features || {};
    } catch (e) { WIP = {}; }

    addView('profile', profileView());
    addView('studio', studioView());
    addView('calc', calcView());
    addView('messages', messagesView());
    addView('coop', coopView());
    addNavButton('profile', '[◆] PROFILE');
    addNavButton('studio', '[♪] POSTIFY');
    addNavButton('calc', '[Σ] CALC');
    addNavButton('messages', '[✉] MESSAGES');
    addNavButton('coop', '[⚑] SYNDICATE');
    badgeExistingPanels();
    if (window.applyLanguage && window.currentLang) window.applyLanguage(window.currentLang);

    // The studio nav button carries its own WIP marker so it's obvious before
    // you even open it.
    var sb = $('nav-studio');
    if (sb && WIP.music_studio) {
      sb.insertAdjacentHTML('beforeend', badge('music_studio'));
      sb.title = WIP.music_studio.note;
    }

    wrapGlobals();
    refreshBotStatus();
    seedConsoleHelp();
    loadFriends();
    setInterval(refreshBotStatus, 20000);
    setInterval(function () {
      if (document.visibilityState === 'hidden') return;
      var messagesWindow = $('wswin-messages');
      var messagesView = $('view-messages');
      if ((messagesWindow && messagesWindow.classList.contains('active')) ||
          (!messagesWindow && messagesView && messagesView.classList.contains('active-view'))) {
        loadFriends();
      }
    }, 5000);

    // Fires once wrapGlobals() has finished reassigning the SFX-cue wrappers
    // (executeTrade, advanceGameDay, etc.) - anything that needs to snapshot
    // "the real, final version" of those functions (e.g. the runtime
    // integrity check in index.html) should wait for this instead of
    // guessing with a timeout, since wrapGlobals runs asynchronously after
    // an awaited /api/wip call above and its timing isn't fixed.
    window.dispatchEvent(new CustomEvent('astrax:ready'));

    // Load the operator's saved sound preference.
    try {
      var s = await api('/api/settings');
      if (s.success && window.SFX && s.settings.sfx_enabled === false) window.SFX.setEnabled(false);
    } catch (e) { /* default to on */ }

    // The original loader hides #loadingScreen then calls initAstraApp(); by
    // the time that happens the app wrapper is visible, so play the boot cue.
    var wrapper = $('mainAppWrapper');
    if (wrapper) {
      var poll = setInterval(function () {
        if (wrapper.style.display !== 'none') {
          clearInterval(poll);
          sfx('boot');
        }
      }, 400);
      setTimeout(function () { clearInterval(poll); }, 30000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();