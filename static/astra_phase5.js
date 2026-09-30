/* ===========================================================================
 * astra_phase5.js - Phase 4/5 surface: operator exchange, credits, the step
 * sequencer, DM attachments + read receipts, a live company desk quote, and
 * the arbitrage feed-health strip.
 *
 * Loads *after* astra_extras.js and waits for its `astrax:ready` event, since
 * everything here hangs off views and nav buttons that astra_extras builds.
 * Deliberately does NOT re-wrap executeTrade / advanceGameDay /
 * sendOmniConsole - index.html's runtime-integrity check snapshots exactly
 * those three off `astrax:ready`, so touching them here would lock every
 * player out of the terminal.
 * =========================================================================== */
(function () {
  'use strict';

  var WIP = {};
  var EX = { friends: [], active: null, draft: null, balance: 0, shares: {}, prices: {}, staged: null, saveTimer: null };
  var CR = { credits: 0, frames: [], ledger: [] };

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
  function jsStr(s) { return esc(s).replace(/'/g, "\\'"); }
  async function api(url, opts) {
    var res = await fetch(url, opts);
    if (!res.ok && res.status !== 400 && res.status !== 403 && res.status !== 404) throw new Error(res.status);
    return res.json();
  }
  function post(url, body) {
    return api(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }
  function badge(key) {
    var f = WIP[key];
    if (!f) return '';
    return '<span class="wip-badge" title="' + esc(f.note) + '">' + esc(f.state.toUpperCase()) + '</span>';
  }
  function note(key) {
    var f = WIP[key];
    if (!f) return '';
    return '<div class="wip-note">' + esc(f.note) + '</div>';
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
    btn.innerHTML = esc(label) + badge(id);
    btn.onclick = function () { window.switchView(id); };
    var settings = $('nav-settings');
    if (settings) nav.insertBefore(btn, settings); else nav.appendChild(btn);
  }

  function injectStyles() {
    var css = document.createElement('style');
    css.textContent = [
      '.p5-row{display:flex;justify-content:space-between;align-items:center;gap:8px;',
      'padding:6px 0;border-bottom:1px solid var(--border-color);font-size:12px;}',
      '.p5-row:last-child{border-bottom:none;}',
      '.p5-k{color:#5c7a99;font-size:10px;letter-spacing:1px;}',
      '.p5-card{border:1px solid var(--border-color);background:#000;padding:10px 12px;margin-bottom:8px;}',
      '.p5-chip{background:#000;border:1px solid var(--border-color);color:var(--text-main);',
      'font-family:inherit;font-size:10.5px;padding:4px 9px;cursor:pointer;}',
      '.p5-chip.sel{border-color:var(--pixel-cyan);color:var(--pixel-cyan);background:rgba(0,255,204,.08);}',
      '.p5-chip[disabled]{opacity:.4;cursor:not-allowed;}',
      /* step sequencer grid */
      '.p5-seq{display:grid;gap:3px;}',
      '.p5-step{height:22px;border:1px solid var(--border-color);background:#000;cursor:pointer;}',
      '.p5-step.on{background:var(--pixel-cyan);border-color:var(--pixel-cyan);}',
      '.p5-step.beat{border-color:#243a56;}',
      '.p5-step.cursor{outline:1px solid var(--pixel-yellow);outline-offset:-1px;}',
      '.p5-seq-label{font-size:10px;color:#5c7a99;letter-spacing:1px;display:flex;align-items:center;}',
      /* attachments */
      '.p5-att{display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:4px 7px;',
      'border:1px dashed var(--border-color);font-size:10.5px;color:var(--text-main);}',
      '.p5-receipt{font-size:9px;color:#5c7a99;letter-spacing:.5px;margin-top:3px;text-align:right;}',
      '@media (max-width:760px){.p5-two{grid-template-columns:1fr !important;}}'
    ].join('');
    document.head.appendChild(css);
  }

  /* =================================================================
   * 1. OPERATOR EXCHANGE - player-to-player cash + share trades
   *
   * Resumable: the staging area is written back to the server as a draft
   * (debounced), so closing the tab mid-trade and coming back restores it.
   * ================================================================= */

  function exchangeView() {
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">OPERATOR EXCHANGE' + badge('exchange') + '</div>' +
        '<span style="font-size:11px;color:var(--pixel-cyan);" id="p5ExStatus"></span></div>' +
        note('exchange') +
        '<div style="font-size:11px;color:#5c7a99;line-height:1.7;">' +
          'Trade cash and shares directly with a friend. Both sides are re-checked on the ' +
          'server the moment an offer is accepted, and everything moves in one transaction ' +
          '- a stale offer fails instead of overdrawing either account.' +
        '</div>' +
      '</div>' +
      '<div class="game-dashboard-grid p5-two">' +
        '<div class="terminal-panel">' +
          '<div class="panel-header"><div class="panel-heading-title">COMPOSE OFFER</div>' +
          '<span style="font-size:10px;color:#5c7a99;" id="p5DraftState"></span></div>' +
          '<div id="p5Compose" style="font-size:12px;color:#888;">Loading...</div>' +
        '</div>' +
        '<div class="terminal-panel" style="max-height:620px;overflow-y:auto;">' +
          '<div class="panel-header"><div class="panel-heading-title">OFFERS</div></div>' +
          '<div id="p5Offers" style="font-size:12px;color:#888;">Loading...</div>' +
        '</div>' +
      '</div>';
  }

  function stagedFromDraft(d) {
    return {
      offer_cash: d ? d.offer_cash : 0,
      want_cash: d ? d.want_cash : 0,
      offer_shares: d ? Object.assign({}, d.offer_shares) : {},
      want_shares: d ? Object.assign({}, d.want_shares) : {},
      note: d ? (d.note || '') : '',
      allow_partial: d ? !!d.allow_partial : false
    };
  }

  async function loadExchange() {
    var host = $('p5Compose');
    if (!host) return;
    try {
      var url = '/api/exchange/state' + (EX.active ? '?with=' + encodeURIComponent(EX.active) : '');
      var d = await api(url);
      if (!d.success) throw new Error('failed');
      EX.friends = d.friends || [];
      EX.balance = d.balance;
      EX.shares = d.shares || {};
      EX.prices = d.prices || {};
      EX.incoming = d.incoming || [];
      EX.outgoing = d.outgoing || [];
      EX.history = d.history || [];
      if (EX.active && !EX.staged) EX.staged = stagedFromDraft(d.draft);
      if (!EX.active) EX.staged = null;
      renderCompose();
      renderOffers();
    } catch (e) {
      host.innerHTML = '<div style="color:var(--pixel-red);font-size:11px;">Could not reach the exchange.</div>';
    }
  }

  function renderCompose() {
    var host = $('p5Compose');
    if (!host) return;

    if (!EX.friends.length) {
      host.innerHTML = '<div style="font-size:11.5px;color:#888;line-height:1.7;">' +
        'You can only trade with a confirmed friend. Add one from the ' +
        '<span style="color:var(--pixel-cyan);">[\u2709] MESSAGES</span> tab first.</div>';
      return;
    }

    var picker = '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px;">' +
      EX.friends.map(function (f) {
        return '<button class="p5-chip' + (EX.active === f ? ' sel' : '') +
          '" onclick="AstraP5.pickCounterparty(\'' + jsStr(f) + '\')">' + esc(f) + '</button>';
      }).join('') + '</div>';

    if (!EX.active) {
      host.innerHTML = picker + '<div style="font-size:11px;color:#888;">Pick an operator to build an offer for.</div>';
      return;
    }

    var s = EX.staged || stagedFromDraft(null);
    var symbols = Object.keys(EX.prices).sort();

    function shareRows(side) {
      var map = side === 'offer' ? s.offer_shares : s.want_shares;
      var held = side === 'offer' ? EX.shares : null;
      return '<div style="display:flex;gap:4px;margin-top:5px;">' +
          '<select class="d-input" id="p5Sym' + side + '" style="flex:1;">' +
            symbols.map(function (sym) {
              var own = held ? ' (hold ' + (held[sym] || 0) + ')' : '';
              return '<option value="' + sym + '">' + sym + ' \u00b7 ' + money(EX.prices[sym]) + own + '</option>';
            }).join('') +
          '</select>' +
          '<input type="number" min="1" value="1" id="p5Qty' + side + '" class="d-input" style="width:72px;">' +
          '<button class="terminal-btn" style="padding:4px 9px;font-size:10px;" ' +
            'onclick="AstraP5.addShares(\'' + side + '\')">[ADD]</button>' +
        '</div>' +
        (Object.keys(map).length
          ? '<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px;">' +
              Object.keys(map).sort().map(function (sym) {
                return '<div class="p5-row" style="padding:3px 0;">' +
                  '<span>' + esc(sym) + ' \u00d7 ' + map[sym] + '</span>' +
                  '<span style="display:flex;gap:6px;align-items:center;">' +
                    '<span style="color:#5c7a99;">' + money(map[sym] * (EX.prices[sym] || 0)) + '</span>' +
                    '<span style="cursor:pointer;color:var(--pixel-red);" title="Remove" ' +
                      'onclick="AstraP5.dropShares(\'' + side + '\',\'' + esc(sym) + '\')">\u2715</span>' +
                  '</span></div>';
              }).join('') +
            '</div>'
          : '<div style="font-size:10.5px;color:#5c7a99;margin-top:5px;">No shares staged.</div>');
    }

    host.innerHTML = picker +
      '<div class="p5-card">' +
        '<div class="p5-k">YOU GIVE</div>' +
        '<div style="display:flex;gap:6px;align-items:center;margin-top:6px;">' +
          '<span style="font-size:11px;color:#5c7a99;width:38px;">CASH</span>' +
          '<input type="number" min="0" step="0.01" class="d-input" id="p5OfferCash" ' +
            'value="' + (s.offer_cash || 0) + '" oninput="AstraP5.setCash(\'offer\', this.value)" style="flex:1;">' +
          '<span style="font-size:10.5px;color:#5c7a99;">of ' + money(EX.balance) + '</span>' +
        '</div>' +
        shareRows('offer') +
      '</div>' +

      '<div class="p5-card">' +
        '<div class="p5-k">YOU RECEIVE</div>' +
        '<div style="display:flex;gap:6px;align-items:center;margin-top:6px;">' +
          '<span style="font-size:11px;color:#5c7a99;width:38px;">CASH</span>' +
          '<input type="number" min="0" step="0.01" class="d-input" id="p5WantCash" ' +
            'value="' + (s.want_cash || 0) + '" oninput="AstraP5.setCash(\'want\', this.value)" style="flex:1;">' +
        '</div>' +
        shareRows('want') +
      '</div>' +

      '<div class="p5-card">' +
        '<div class="p5-k">MEMO (OPTIONAL)</div>' +
        '<textarea class="d-input" id="p5Note" rows="2" placeholder="Terms, context, whatever..." ' +
          'style="resize:vertical;margin-top:6px;width:100%;" oninput="AstraP5.setNote(this.value)">' + esc(s.note || '') + '</textarea>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-main);margin-top:8px;">' +
          '<input type="checkbox" id="p5Partial"' + (s.allow_partial ? ' checked' : '') +
            ' onchange="AstraP5.setPartial(this.checked)"> ' +
          'Allow partial fills' +
          '<span style="color:#5c7a99;font-size:10px;">(they can take a slice and leave the rest standing)</span>' +
        '</label>' +
        '<div style="display:flex;gap:6px;align-items:center;margin-top:6px;">' +
          '<input type="text" id="p5NotePin" class="d-input" placeholder="Encrypt memo with PIN (optional)" ' +
            'maxlength="8" style="flex:1;">' +
        '</div>' +
        '<div style="font-size:9.5px;color:#5c7a99;margin-top:6px;line-height:1.6;">' +
          'The terms themselves stay readable by the server - it has to move the assets. ' +
          'Only the memo is encrypted, with a PIN you share out of band.' +
        '</div>' +
      '</div>' +

      '<div style="display:flex;gap:6px;">' +
        '<button class="terminal-btn btn-start" style="flex:1;" onclick="AstraP5.sendOffer()">[SEND OFFER]</button>' +
        '<button class="terminal-btn btn-warning" onclick="AstraP5.clearDraft()">[CLEAR]</button>' +
      '</div>' +
      '<div id="p5ExMsg" style="font-size:11px;margin-top:8px;min-height:15px;"></div>';
  }

  function offerHtml(o, kind) {
    function side(cash, shares) {
      var bits = [];
      if (cash) bits.push(money(cash));
      Object.keys(shares || {}).sort().forEach(function (sym) { bits.push(shares[sym] + ' ' + sym); });
      return bits.length ? bits.join(' + ') : '\u2014';
    }
    var theyGive = side(o.offer_cash, o.offer_shares);
    var theyGet = side(o.want_cash, o.want_shares);
    var head = o.from_me ? 'TO ' + esc(o.counterparty) : 'FROM ' + esc(o.counterparty);
    var statusColor = { accepted: 'var(--pixel-green)', declined: 'var(--pixel-red)',
                        cancelled: '#5c7a99', pending: 'var(--pixel-yellow)' }[o.status] || '#888';

    var actions = '';
    if (kind === 'incoming') {
      actions = '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">' +
        '<button class="terminal-btn btn-start" style="flex:1;padding:4px;font-size:10px;" ' +
          'onclick="AstraP5.respond(' + o.id + ',\'accept\')">[ACCEPT]</button>' +
        (o.allow_partial
          ? '<button class="terminal-btn" style="flex:1;padding:4px;font-size:10px;" ' +
              'onclick="AstraP5.acceptPartial(' + o.id + ')">[TAKE PART]</button>'
          : '') +
        '<button class="terminal-btn" style="flex:1;padding:4px;font-size:10px;" ' +
          'onclick="AstraP5.counter(' + o.id + ')">[COUNTER]</button>' +
        '<button class="terminal-btn btn-warning" style="flex:1;padding:4px;font-size:10px;" ' +
          'onclick="AstraP5.respond(' + o.id + ',\'decline\')">[DECLINE]</button></div>';
    } else if (kind === 'outgoing') {
      actions = '<div style="margin-top:8px;"><button class="terminal-btn btn-warning" ' +
        'style="padding:4px 9px;font-size:10px;" onclick="AstraP5.cancel(' + o.id + ')">[WITHDRAW]</button></div>';
    }

    var memo = '';
    if (o.note_encrypted) {
      memo = '<div style="margin-top:6px;font-size:10.5px;">' +
        '<span style="color:var(--pixel-yellow);">[ENCRYPTED MEMO]</span> ' +
        '<button class="terminal-btn" style="padding:2px 6px;font-size:9.5px;" ' +
          'onclick="AstraP5.readNote(' + o.id + ', this)">DECRYPT</button>' +
        '<div class="p5-memo" style="display:none;margin-top:4px;color:#fff;"></div></div>';
    } else if (o.note) {
      memo = '<div style="margin-top:6px;font-size:10.5px;color:#b8c3d9;">\u201c' + esc(o.note) + '\u201d</div>';
    }

    return '<div class="p5-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<span class="p5-k">' + head + '</span>' +
        '<span style="font-size:10px;color:' + statusColor + ';">' + esc(o.status.toUpperCase()) + '</span>' +
      '</div>' +
      '<div style="font-size:12px;margin-top:6px;">' +
        '<span style="color:var(--pixel-red);">' + (o.from_me ? 'You give' : 'They give') + ':</span> ' + esc(theyGive) +
      '</div>' +
      '<div style="font-size:12px;">' +
        '<span style="color:var(--pixel-green);">' + (o.from_me ? 'You get' : 'They want') + ':</span> ' + esc(theyGet) +
      '</div>' +
      (o.allow_partial ? '<div style="font-size:9.5px;color:#5c7a99;margin-top:4px;">Partial fills allowed' +
        (o.fills ? ' \u00b7 ' + o.fills + ' filled so far' : '') + '</div>' : '') +
      (o.counter_to_id ? '<div style="font-size:9.5px;color:#5c7a99;margin-top:4px;">Counter to offer #' + o.counter_to_id + '</div>' : '') +
      (o.decline_reason ? '<div style="font-size:10.5px;color:#5c7a99;margin-top:5px;">Reason: ' + esc(o.decline_reason) + '</div>' : '') +
      memo + actions +
      '</div>';
  }

  function renderOffers() {
    var host = $('p5Offers');
    if (!host) return;
    var html = '';
    html += '<div class="p5-k" style="color:var(--pixel-yellow);">INCOMING</div>';
    html += (EX.incoming || []).length
      ? EX.incoming.map(function (o) { return offerHtml(o, 'incoming'); }).join('')
      : '<div style="font-size:11px;color:#888;margin-bottom:10px;">Nothing waiting on you.</div>';
    html += '<div class="p5-k" style="margin-top:10px;">SENT</div>';
    html += (EX.outgoing || []).length
      ? EX.outgoing.map(function (o) { return offerHtml(o, 'outgoing'); }).join('')
      : '<div style="font-size:11px;color:#888;margin-bottom:10px;">No offers out.</div>';
    if ((EX.history || []).length) {
      html += '<div class="p5-k" style="margin-top:10px;">SETTLED</div>';
      html += EX.history.map(function (o) { return offerHtml(o, 'history'); }).join('');
    }
    host.innerHTML = html;

    var badgeEl = $('nav-exchange');
    if (badgeEl) {
      var dot = badgeEl.querySelector('.p5-offer-dot');
      if ((EX.incoming || []).length) {
        if (!dot) {
          dot = document.createElement('span');
          dot.className = 'p5-offer-dot';
          dot.style.cssText = 'display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--pixel-yellow);margin-left:5px;';
          badgeEl.appendChild(dot);
        }
      } else if (dot) { dot.remove(); }
    }
  }

  function queueDraftSave() {
    if (!EX.active) return;
    var state = $('p5DraftState');
    if (state) { state.textContent = 'saving draft...'; state.style.color = '#5c7a99'; }
    clearTimeout(EX.saveTimer);
    EX.saveTimer = setTimeout(async function () {
      try {
        var s = EX.staged || stagedFromDraft(null);
        await post('/api/exchange/draft', {
          to: EX.active,
          offer_cash: s.offer_cash, want_cash: s.want_cash,
          offer_shares: s.offer_shares, want_shares: s.want_shares,
          note: s.note, allow_partial: s.allow_partial
        });
        if (state) { state.textContent = 'draft saved \u00b7 resumes here'; state.style.color = 'var(--pixel-green)'; }
      } catch (e) {
        if (state) { state.textContent = 'draft not saved'; state.style.color = 'var(--pixel-red)'; }
      }
    }, 600);
  }

  /* =================================================================
   * 2. CREDITS
   * ================================================================= */

  function creditsView() {
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">CREDITS' + badge('credits') + '</div>' +
        '<span style="font-size:13px;color:var(--pixel-yellow);" id="p5CreditBal"></span></div>' +
        note('credits') +
        '<div id="p5CreditEarn" style="font-size:11px;color:#5c7a99;"></div>' +
      '</div>' +
      '<div class="game-dashboard-grid p5-two">' +
        '<div class="terminal-panel">' +
          '<div class="panel-header"><div class="panel-heading-title">SHOP</div>' +
          '<span style="font-size:10px;color:#5c7a99;">COSMETIC ONLY</span></div>' +
          '<div class="p5-k">FRAMES</div>' +
          '<div id="p5Frames" style="font-size:12px;color:#888;">Loading...</div>' +
          '<div class="p5-k" style="margin-top:12px;">EMBLEMS</div>' +
          '<div id="p5Emblems" style="font-size:12px;color:#888;"></div>' +
          '<div class="p5-k" style="margin-top:12px;">OPERATOR TITLE</div>' +
          '<div id="p5Title" style="font-size:12px;color:#888;"></div>' +
        '</div>' +
        '<div class="terminal-panel" style="max-height:520px;overflow-y:auto;">' +
          '<div class="panel-header"><div class="panel-heading-title">LEDGER</div></div>' +
          '<div id="p5Ledger" style="font-size:12px;color:#888;">Loading...</div>' +
        '</div>' +
      '</div>';
  }

  async function loadCredits() {
    var host = $('p5Frames');
    if (!host) return;
    try {
      var d = await api('/api/credits');
      if (!d.success) throw new Error('failed');
      CR = d;
      $('p5CreditBal').textContent = (d.credits || 0).toLocaleString() + ' CR';
      $('p5CreditEarn').innerHTML = 'Earned so far: <span style="color:var(--pixel-green);">' +
        (d.earned_total || 0).toLocaleString() + ' CR</span> \u00b7 earn rates: ' +
        (d.rules || []).map(function (r) { return esc(r.reason) + ' +' + r.amount; }).join(' \u00b7 ');

      host.innerHTML = (d.frames || []).map(function (f) {
        var owned = f.owned;
        var active = d.active_frame === f.id;
        return '<div class="p5-row">' +
          '<span style="display:flex;align-items:center;gap:10px;">' +
            '<span style="width:26px;height:26px;border:' + f.css + ';display:inline-block;' +
              (f.shadow ? 'box-shadow:' + f.shadow + ';' : '') + '"></span>' +
            '<span>' + esc(f.name) + (active ? ' <span style="color:var(--pixel-cyan);font-size:10px;">[EQUIPPED]</span>' : '') + '</span>' +
          '</span>' +
          (owned
            ? '<button class="p5-chip" onclick="AstraP5.equipFrame(\'' + esc(f.id) + '\')">' +
                (active ? 'ACTIVE' : 'EQUIP') + '</button>'
            : '<button class="p5-chip" onclick="AstraP5.buyFrame(\'' + esc(f.id) + '\')">BUY \u00b7 ' + f.cost + ' CR</button>') +
          '</div>';
      }).join('') +
      '<div id="p5FrameMsg" style="font-size:11px;margin-top:8px;min-height:15px;"></div>';

      var emblems = $('p5Emblems');
      if (emblems) {
        emblems.innerHTML = (d.avatars || []).map(function (a) {
          var active = d.active_avatar === a.id;
          return '<div class="p5-row">' +
            '<span style="display:flex;align-items:center;gap:10px;">' +
              '<span style="font-size:17px;color:' + a.color + ';">' + a.glyph + '</span>' +
              '<span>' + esc(a.name) + (active ? ' <span style="color:var(--pixel-cyan);font-size:10px;">[WORN]</span>' : '') + '</span>' +
            '</span>' +
            (a.owned
              ? '<button class="p5-chip" onclick="AstraP5.equipAvatar(\'' + esc(a.id) + '\')">' +
                  (active ? 'ACTIVE' : 'WEAR') + '</button>'
              : '<button class="p5-chip" onclick="AstraP5.buyAvatar(\'' + esc(a.id) + '\')">BUY \u00b7 ' + a.cost + ' CR</button>') +
            '</div>';
        }).join('') || '<div style="font-size:11px;color:#888;">Nothing for sale.</div>';
      }

      var titleHost = $('p5Title');
      if (titleHost) {
        var sink = (d.sinks || {}).custom_title || { cost: 0, blurb: '' };
        var owned = !!d.custom_title;
        titleHost.innerHTML =
          '<div style="font-size:10.5px;color:#5c7a99;line-height:1.6;margin-bottom:6px;">' +
            esc(sink.blurb) + (owned ? ' Renaming it is free.' : '') + '</div>' +
          '<div style="font-size:11px;margin-bottom:6px;">Earned rank: ' +
            '<span style="color:var(--pixel-cyan);">' + esc(d.rank || '') + '</span></div>' +
          '<div style="display:flex;gap:6px;">' +
            '<input type="text" id="p5TitleInput" class="d-input" maxlength="32" style="flex:1;" ' +
              'placeholder="Your own title..." value="' + esc(d.custom_title || '') + '">' +
            '<button class="p5-chip" onclick="AstraP5.saveTitle()">' +
              (owned ? 'UPDATE' : 'BUY \u00b7 ' + sink.cost + ' CR') + '</button>' +
            (owned ? '<button class="p5-chip" onclick="AstraP5.clearTitle()">CLEAR</button>' : '') +
          '</div>';
      }

      var led = $('p5Ledger');
      led.innerHTML = (d.ledger || []).length
        ? d.ledger.map(function (e) {
            var col = e.amount >= 0 ? 'var(--pixel-green)' : 'var(--pixel-red)';
            return '<div class="p5-row"><span>' + esc(e.reason) + '<br>' +
              '<span style="font-size:9.5px;color:#5c7a99;">' + esc(e.at || '') + '</span></span>' +
              '<span style="color:' + col + ';">' + (e.amount >= 0 ? '+' : '') + e.amount + '</span></div>';
          }).join('')
        : '<div style="font-size:11px;color:#888;">Nothing earned yet. Advance a day, close a deal, or release a track.</div>';
    } catch (e) {
      host.innerHTML = '<div style="color:var(--pixel-red);font-size:11px;">Could not load credits.</div>';
    }
  }

  /* =================================================================
   * 3. STEP SEQUENCER
   *
   * A real 4-voice / 16-step grid with its own WebAudio engine, so it works
   * whether or not astra_sfx.js's Chiptune generator is around. The pattern
   * is sent to /api/game/music/release and stored on the track, so a
   * sequenced track replays exactly what you wrote instead of a seed.
   * ================================================================= */

  var SEQ = {
    steps: 16,
    rows: { lead: [], bass: [], kick: [], hat: [] },
    order: ['lead', 'bass', 'kick', 'hat'],
    labels: { lead: 'LEAD', bass: 'BASS', kick: 'KICK', hat: 'HAT' },
    bpm: 120, key: 'C', genre: 'chiptune',
    playing: false, pos: 0, timer: null, ctx: null
  };

  var SCALE = { C: 261.63, D: 293.66, E: 329.63, F: 349.23, G: 392.00, A: 440.00, B: 493.88 };
  var WAVE = { chiptune: 'square', synthwave: 'sawtooth', darkwave: 'triangle', acidhouse: 'sawtooth', ambient: 'sine' };

  function seqInit() {
    SEQ.order.forEach(function (r) {
      SEQ.rows[r] = new Array(SEQ.steps).fill(0);
    });
    // A gentle starting pattern so the grid isn't a blank wall.
    SEQ.rows.kick[0] = SEQ.rows.kick[4] = SEQ.rows.kick[8] = SEQ.rows.kick[12] = 1;
    SEQ.rows.hat[2] = SEQ.rows.hat[6] = SEQ.rows.hat[10] = SEQ.rows.hat[14] = 1;
    SEQ.rows.bass[0] = SEQ.rows.bass[8] = 1;
    SEQ.rows.lead[0] = SEQ.rows.lead[3] = SEQ.rows.lead[6] = SEQ.rows.lead[11] = 1;
  }

  function sequencerPanel() {
    return '<div class="terminal-panel" id="p5SeqPanel">' +
      '<div class="panel-header"><div class="panel-heading-title">STEP SEQUENCER</div>' +
      '<span style="font-size:11px;color:var(--pixel-cyan);" id="p5SeqStatus">STOPPED</span></div>' +
      '<div style="font-size:11px;color:#5c7a99;line-height:1.7;margin-bottom:10px;">' +
        'Write a pattern step by step instead of rolling a seed. The grid is stored with ' +
        'the track, so releasing it here keeps exactly what you wrote - and a busier, ' +
        'multi-voice pattern scores better than four notes in a corner.' +
      '</div>' +
      '<div id="p5SeqGrid"></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px;">' +
        '<button class="terminal-btn btn-action" id="p5SeqPlay" onclick="AstraP5.seqToggle()">[\u25b6] PLAY</button>' +
        '<button class="terminal-btn" onclick="AstraP5.seqClear()">[CLEAR]</button>' +
        '<button class="terminal-btn" onclick="AstraP5.seqRandom()">[\u21bb] RANDOMIZE</button>' +
        '<label style="font-size:11px;color:#5c7a99;display:flex;align-items:center;gap:6px;">TEMPO' +
          '<input type="range" min="60" max="200" value="120" id="p5SeqBpm" ' +
            'oninput="AstraP5.seqBpm(this.value)" style="width:120px;">' +
          '<span id="p5SeqBpmLabel" style="color:var(--pixel-cyan);">120</span></label>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px;">' +
        '<select id="p5SeqGenre" class="d-input" onchange="AstraP5.seqGenre(this.value)" style="width:150px;">' +
          Object.keys(WAVE).map(function (g) {
            return '<option value="' + g + '">' + g.charAt(0).toUpperCase() + g.slice(1) + '</option>';
          }).join('') +
        '</select>' +
        '<select id="p5SeqKey" class="d-input" onchange="AstraP5.seqKey(this.value)" style="width:70px;">' +
          Object.keys(SCALE).map(function (k) { return '<option value="' + k + '">' + k + '</option>'; }).join('') +
        '</select>' +
        '<select id="p5SeqLabel" class="d-input" style="width:170px;"><option value="indie">Self-Released</option>' +
          '<option value="midtier">Static Records ($500)</option>' +
          '<option value="major">Chrome Cassette ($3,000)</option></select>' +
        '<input type="text" id="p5SeqTitle" class="d-input" placeholder="Track title..." style="flex:1;min-width:150px;">' +
        '<button class="terminal-btn btn-start" onclick="AstraP5.seqRelease()">[\u2605] RELEASE</button>' +
      '</div>' +
      '<div id="p5SeqMsg" style="font-size:11px;margin-top:8px;min-height:15px;"></div>' +
    '</div>';
  }

  function renderSeqGrid() {
    var host = $('p5SeqGrid');
    if (!host) return;
    host.innerHTML = SEQ.order.map(function (row) {
      var cells = SEQ.rows[row].map(function (on, i) {
        return '<div class="p5-step' + (on ? ' on' : '') + (i % 4 === 0 ? ' beat' : '') +
          '" data-row="' + row + '" data-i="' + i + '" ' +
          'onclick="AstraP5.seqToggleStep(\'' + row + '\',' + i + ')"></div>';
      }).join('');
      return '<div style="display:grid;grid-template-columns:44px 1fr;gap:6px;margin-bottom:3px;">' +
        '<div class="p5-seq-label">' + SEQ.labels[row] + '</div>' +
        '<div class="p5-seq" style="grid-template-columns:repeat(' + SEQ.steps + ',1fr);">' + cells + '</div>' +
      '</div>';
    }).join('');
  }

  function markCursor(i) {
    var grid = $('p5SeqGrid');
    if (!grid) return;
    grid.querySelectorAll('.p5-step.cursor').forEach(function (el) { el.classList.remove('cursor'); });
    grid.querySelectorAll('.p5-step[data-i="' + i + '"]').forEach(function (el) { el.classList.add('cursor'); });
  }

  function audioCtx() {
    if (!SEQ.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      SEQ.ctx = new AC();
    }
    if (SEQ.ctx.state === 'suspended') SEQ.ctx.resume();
    return SEQ.ctx;
  }

  function voice(row, step, when) {
    var ctx = audioCtx();
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    var root = SCALE[SEQ.key] || 261.63;
    var vol = (window.SFX && typeof window.SFX.volume === 'number') ? window.SFX.volume : 0.5;

    if (row === 'lead') {
      var degrees = [0, 2, 4, 7, 9, 12];
      osc.type = WAVE[SEQ.genre] || 'square';
      osc.frequency.value = root * Math.pow(2, degrees[step % degrees.length] / 12);
      gain.gain.setValueAtTime(0.16 * vol, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
      osc.start(when); osc.stop(when + 0.2);
    } else if (row === 'bass') {
      osc.type = SEQ.genre === 'ambient' ? 'sine' : 'triangle';
      osc.frequency.value = root / 2;
      gain.gain.setValueAtTime(0.22 * vol, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.26);
      osc.start(when); osc.stop(when + 0.28);
    } else if (row === 'kick') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, when);
      osc.frequency.exponentialRampToValueAtTime(48, when + 0.12);
      gain.gain.setValueAtTime(0.3 * vol, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.14);
      osc.start(when); osc.stop(when + 0.16);
    } else {
      // Hat: short filtered noise burst.
      var len = Math.floor(ctx.sampleRate * 0.04);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 6000;
      gain.gain.setValueAtTime(0.14 * vol, when);
      src.connect(hp); hp.connect(gain); gain.connect(ctx.destination);
      src.start(when); src.stop(when + 0.05);
      return;
    }
    osc.connect(gain); gain.connect(ctx.destination);
  }

  function seqTick() {
    var ctx = audioCtx();
    var when = ctx ? ctx.currentTime + 0.01 : 0;
    SEQ.order.forEach(function (row) {
      if (SEQ.rows[row][SEQ.pos]) voice(row, SEQ.pos, when);
    });
    markCursor(SEQ.pos);
    SEQ.pos = (SEQ.pos + 1) % SEQ.steps;
  }

  function seqStart() {
    if (SEQ.playing) return;
    if (!audioCtx()) {
      var m = $('p5SeqMsg');
      if (m) { m.style.color = 'var(--pixel-red)'; m.textContent = 'This browser has no WebAudio support.'; }
      return;
    }
    SEQ.playing = true;
    SEQ.pos = 0;
    var interval = (60 / SEQ.bpm) * 1000 / 4;  // sixteenth notes
    SEQ.timer = setInterval(seqTick, interval);
    var btn = $('p5SeqPlay'), st = $('p5SeqStatus');
    if (btn) btn.textContent = '[\u25a0] STOP';
    if (st) { st.textContent = 'PLAYING'; st.style.color = 'var(--pixel-green)'; }
  }

  function seqStop() {
    SEQ.playing = false;
    clearInterval(SEQ.timer);
    SEQ.timer = null;
    var btn = $('p5SeqPlay'), st = $('p5SeqStatus');
    if (btn) btn.textContent = '[\u25b6] PLAY';
    if (st) { st.textContent = 'STOPPED'; st.style.color = 'var(--pixel-cyan)'; }
    var grid = $('p5SeqGrid');
    if (grid) grid.querySelectorAll('.p5-step.cursor').forEach(function (el) { el.classList.remove('cursor'); });
  }

  function seqSeed() {
    // Deterministic seed from the grid, so the server still gets a stable
    // number and two different patterns don't collide.
    var s = 7;
    SEQ.order.forEach(function (row, r) {
      SEQ.rows[row].forEach(function (on, i) { if (on) s = (s * 31 + (r + 1) * 97 + i) % 2147483647; });
    });
    return s;
  }

  function mountSequencer() {
    var view = $('view-studio');
    if (!view || $('p5SeqPanel')) return;
    seqInit();
    var wrap = document.createElement('div');
    wrap.innerHTML = sequencerPanel();
    var panel = wrap.firstChild;
    // Sit between the studio's own composer and the released catalogue.
    var catalogue = view.children[1];
    if (catalogue) view.insertBefore(panel, catalogue); else view.appendChild(panel);
    renderSeqGrid();
  }

  /* =================================================================
   * 4. DM ATTACHMENTS, READ RECEIPTS, REMEMBERED THREAD PASSPHRASE
   *
   * Overrides astra_extras' thread renderer rather than patching around it,
   * keeping the same DOM ids so the rest of its Messages tab (contacts list,
   * friend requests, unread dots) keeps working untouched.
   * ================================================================= */

  var DM = { active: null, thread: [], pending: null };

  function threadKey(username) {
    try { return localStorage.getItem('astra:dmkey:' + username) || ''; }
    catch (e) { return ''; }
  }
  function setThreadKey(username, pin) {
    try {
      if (pin) localStorage.setItem('astra:dmkey:' + username, pin);
      else localStorage.removeItem('astra:dmkey:' + username);
    } catch (e) { /* private browsing - fall back to prompting */ }
  }

  function humanSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function renderThread(thread) {
    var body = $('axThreadBody');
    if (!body) return;
    if (thread) DM.thread = thread;
    if (!DM.thread.length) {
      body.innerHTML = '<div style="color:#888; font-size:11px;">No messages yet \u2014 say hello.</div>';
      return;
    }
    body.innerHTML = DM.thread.map(function (m) {
      var mine = m.from_me;
      var style = 'max-width:80%; align-self:' + (mine ? 'flex-end' : 'flex-start') + '; ' +
        'background:' + (mine ? 'rgba(0,255,204,.08)' : '#000') + '; border:1px solid var(--border-color); ' +
        'padding:7px 10px; font-size:12px; word-break:break-word;';
      var inner;
      if (m.encrypted) {
        inner = '<span style="color:var(--pixel-yellow);">[ENCRYPTED]</span> ' +
          '<button class="terminal-btn" style="padding:2px 6px; font-size:10px;" ' +
            'onclick="AstraP5.decryptMessage(' + m.id + ', this)">DECRYPT</button>' +
          '<div class="ax-decrypted" style="margin-top:5px; display:none;"></div>';
      } else {
        inner = esc(m.body);
      }
      if (m.attachment) {
        var a = m.attachment;
        inner += '<div class="p5-att">' +
          '<span style="color:' + (a.encrypted ? 'var(--pixel-yellow)' : 'var(--pixel-cyan)') + ';">' +
            (a.encrypted ? '[LOCKED FILE]' : '[FILE]') + '</span>' +
          '<span>' + esc(a.filename) + ' \u00b7 ' + humanSize(a.size_bytes) + '</span>' +
          '<button class="terminal-btn" style="padding:2px 6px;font-size:9.5px;" ' +
            'onclick="AstraP5.getAttachment(' + a.id + ', this)">' + (a.encrypted ? 'UNLOCK' : 'SAVE') + '</button>' +
        '</div>';
      }
      if (mine) {
        inner += '<div class="p5-receipt">' + (m.read ? '\u2713\u2713 read ' + esc(m.read_at || '') : '\u2713 sent') + '</div>';
      }
      return '<div style="' + style + '">' + inner + '</div>';
    }).join('');
    body.scrollTop = body.scrollHeight;
  }

  function mountComposerExtras() {
    var composer = $('axThreadComposer');
    if (!composer || $('p5AttachRow')) return;
    var row = document.createElement('div');
    row.id = 'p5AttachRow';
    row.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px;' +
      'border-top:1px solid var(--border-color);padding-top:8px;';
    row.innerHTML =
      '<input type="file" id="p5File" style="display:none;" onchange="AstraP5.fileChosen(this)">' +
      '<button class="p5-chip" onclick="document.getElementById(\'p5File\').click()">[ATTACH FILE]</button>' +
      '<span id="p5FileName" style="font-size:10.5px;color:#5c7a99;">No file selected \u00b7 256 KB max</span>' +
      '<button class="p5-chip" id="p5SendFile" onclick="AstraP5.sendAttachment()" disabled>[SEND FILE]</button>' +
      '<span style="flex:1;"></span>' +
      '<button class="p5-chip" onclick="AstraP5.editThreadKey()" id="p5KeyBtn" ' +
        'title="Stored in this browser only - never sent to the server">[THREAD KEY]</button>';
    composer.appendChild(row);
  }

  function refreshKeyBtn() {
    var btn = $('p5KeyBtn');
    if (!btn) return;
    var has = !!threadKey(DM.active || '');
    btn.textContent = has ? '[THREAD KEY \u2713]' : '[THREAD KEY]';
    btn.classList.toggle('sel', has);
  }

  // astra_extras.js still owns fetching the thread and the contacts list; it
  // calls this when a thread opens and delegates its renderer to ours.
  function onThreadOpen(username) {
    DM.active = username;
    mountComposerExtras();
    refreshKeyBtn();
  }

  function reopenThread() {
    if (DM.active && window.AstraX && window.AstraX.openThread) window.AstraX.openThread(DM.active);
  }

  /* =================================================================
   * 5. LIVE SYNDICATE UPDATES (long-poll)
   *
   * Replaces astra_extras.js's 4-second timer. /api/coop/poll holds the
   * request open until the room's revision counter moves, so the tab repaints
   * the moment another member trades or says something, and sits silent
   * otherwise. Parked while you're on another tab, so a browser left open on
   * the dashboard isn't holding a server thread for nothing.
   * ================================================================= */

  var COOPW = { rev: 0, running: false, cb: null, gen: 0 };

  function watchCoop(revision, onChange) {
    COOPW.rev = revision || COOPW.rev || 1;
    COOPW.cb = onChange;
    if (COOPW.running) return;
    COOPW.running = true;
    var gen = ++COOPW.gen;

    (async function loop() {
      while (COOPW.running && gen === COOPW.gen) {
        try {
          var d = await api('/api/coop/poll?since=' + COOPW.rev);
          if (!d.success) {          // kicked, or the room is gone
            stopCoopWatch();
            if (onChange) onChange();
            return;
          }
          COOPW.rev = d.revision;
          if (d.changed && COOPW.cb) COOPW.cb();
          // The server answers straight away now (no parked worker thread),
          // so pace the loop here instead of hot-spinning.
          if (!d.changed) await new Promise(function (r) { setTimeout(r, 1500); });
        } catch (e) {
          // Network hiccup or a proxy cutting the long request - back off
          // rather than hammering, then re-arm.
          await new Promise(function (r) { setTimeout(r, 4000); });
        }
      }
    })();
  }

  function stopCoopWatch() {
    COOPW.running = false;
    COOPW.gen++;
  }

  /* =================================================================
   * 6. LIVE COMPANY DESK QUOTE + ARBITRAGE FEED HEALTH
   * ================================================================= */

  function startDeskPoll() {
    setInterval(async function () {
      var overlay = $('axStockOverlay');
      if (!overlay || !overlay.classList.contains('open')) return;
      var sheet = $('axStockSheet');
      var px = sheet && sheet.querySelector('.ax-px');
      if (!px) return;
      var tick = sheet.querySelector('.ax-tick');
      var symbol = tick && tick.textContent.trim();
      if (!symbol) return;
      try {
        var d = await api('/api/game/stock/' + encodeURIComponent(symbol) + '/quote');
        if (!d.success) return;
        var up = d.change >= 0;
        var col = up ? 'var(--pixel-green)' : 'var(--pixel-red)';
        px.textContent = money(d.price);
        px.style.color = col;
        var line = px.nextElementSibling;
        if (line) {
          line.style.color = col;
          line.textContent = (up ? '+' : '') + d.change.toFixed(2) + ' (' + (up ? '+' : '') +
            d.change_pct.toFixed(2) + '%) today';
        }
        window.__axPrice = d.price;
      } catch (e) { /* desk stays on the last good quote */ }
    }, 4000);
  }

  function mountFeedStrip() {
    if ($('p5Feeds')) return;
    var heads = document.querySelectorAll('#view-arbitrage .panel-heading-title');
    var target = null;
    Array.prototype.forEach.call(heads, function (h) {
      if (/ARBITRAGE ENGINE/i.test(h.textContent)) target = h.parentElement;
    });
    if (!target) return;
    var span = document.createElement('span');
    span.id = 'p5Feeds';
    span.style.cssText = 'font-size:10px;letter-spacing:1px;margin-left:auto;';
    target.appendChild(span);
    pollFeeds();
    setInterval(pollFeeds, 10000);
  }

  async function pollFeeds() {
    var el = $('p5Feeds');
    if (!el) return;
    try {
      var d = await api('/api/status');
      var f = d.feeds || {};
      function tag(name, live) {
        return '<span style="color:' + (live ? 'var(--pixel-green)' : 'var(--pixel-yellow)') + ';">' +
          name + ' ' + (live ? 'LIVE' : 'SIMULATED') + '</span>';
      }
      el.innerHTML = tag('BINANCE', !!f.binance) + ' \u00b7 ' + tag('KRAKEN', !!f.kraken);
      el.title = 'Both legs are polled from the real public price APIs. A leg that fails ' +
        'falls back to a simulated quote and is labelled SIMULATED rather than passed off as live.';
    } catch (e) { /* leave the last reading up */ }
  }

  /* =================================================================
   * Public surface
   * ================================================================= */

  window.AstraP5 = {
    /* ---- exchange ---- */
    pickCounterparty: function (name) {
      EX.active = name;
      EX.staged = null;
      sfx('click');
      loadExchange();
    },
    setCash: function (side, value) {
      if (!EX.staged) EX.staged = stagedFromDraft(null);
      var n = Math.max(0, parseFloat(value) || 0);
      if (side === 'offer') EX.staged.offer_cash = n; else EX.staged.want_cash = n;
      queueDraftSave();
    },
    setPartial: function (on) {
      if (!EX.staged) EX.staged = stagedFromDraft(null);
      EX.staged.allow_partial = !!on;
      queueDraftSave();
    },
    acceptPartial: async function (id) {
      var pct = prompt('Take what percentage of this offer? (5-100)', '50');
      if (pct === null) return;
      var f = Math.max(5, Math.min(100, parseFloat(pct) || 0)) / 100;
      try {
        var d = await post('/api/exchange/respond', { id: id, action: 'accept', fraction: f });
        sfx(d.success ? 'cash' : 'deny');
        if (!d.success) alert(d.msg || 'Could not fill that.');
        else if (d.summary) alert(d.msg + '\n\n' + d.summary);
        loadExchange();
        if (window.pollGameState) window.pollGameState();
      } catch (e) { sfx('error'); }
    },
    counter: async function (id) {
      try {
        var d = await post('/api/exchange/counter', { id: id });
        if (!d.success) { sfx('deny'); alert(d.msg || 'Could not counter.'); return; }
        sfx('confirm');
        EX.active = d.counterparty;
        EX.staged = stagedFromDraft(d.draft);
        await loadExchange();
        var msg = $('p5ExMsg');
        if (msg) { msg.style.color = 'var(--pixel-cyan)'; msg.textContent = d.msg; }
      } catch (e) { sfx('error'); }
    },
    setNote: function (value) {
      if (!EX.staged) EX.staged = stagedFromDraft(null);
      EX.staged.note = value;
      queueDraftSave();
    },
    addShares: function (side) {
      if (!EX.staged) EX.staged = stagedFromDraft(null);
      var sym = ($('p5Sym' + side) || {}).value;
      var qty = Math.max(1, parseInt(($('p5Qty' + side) || {}).value, 10) || 1);
      if (!sym) return;
      var map = side === 'offer' ? EX.staged.offer_shares : EX.staged.want_shares;
      map[sym] = (map[sym] || 0) + qty;
      sfx('click');
      renderCompose();
      queueDraftSave();
    },
    dropShares: function (side, sym) {
      if (!EX.staged) return;
      var map = side === 'offer' ? EX.staged.offer_shares : EX.staged.want_shares;
      delete map[sym];
      renderCompose();
      queueDraftSave();
    },
    clearDraft: function () {
      EX.staged = stagedFromDraft(null);
      renderCompose();
      queueDraftSave();
      sfx('close');
    },
    sendOffer: async function () {
      var msg = $('p5ExMsg');
      if (!EX.active) return;
      clearTimeout(EX.saveTimer);
      var s = EX.staged || stagedFromDraft(null);
      try {
        await post('/api/exchange/draft', {
          to: EX.active, offer_cash: s.offer_cash, want_cash: s.want_cash,
          offer_shares: s.offer_shares, want_shares: s.want_shares,
          note: s.note, allow_partial: s.allow_partial
        });
        var pin = ($('p5NotePin') || {}).value || '';
        var d = await post('/api/exchange/send', { to: EX.active, note_pin: pin });
        if (!d.success) {
          sfx('deny');
          if (msg) { msg.style.color = 'var(--pixel-red)'; msg.textContent = d.msg || 'Could not send.'; }
          return;
        }
        sfx('confirm');
        if (msg) { msg.style.color = 'var(--pixel-green)'; msg.textContent = d.msg; }
        EX.staged = stagedFromDraft(null);
        loadExchange();
      } catch (e) { sfx('error'); }
    },
    respond: async function (id, action) {
      var reason = '';
      if (action === 'decline') {
        reason = prompt('Optional: tell them why (leave blank to just decline):') || '';
      } else if (!confirm('Accept this trade? Both sides settle immediately.')) {
        return;
      }
      try {
        var d = await post('/api/exchange/respond', { id: id, action: action, reason: reason });
        sfx(d.success ? (action === 'accept' ? 'cash' : 'close') : 'deny');
        if (!d.success) alert(d.msg || 'Could not complete that.');
        loadExchange();
        if (window.pollGameState) window.pollGameState();
      } catch (e) { sfx('error'); }
    },
    cancel: async function (id) {
      try {
        await post('/api/exchange/cancel', { id: id });
        sfx('close');
        loadExchange();
      } catch (e) { sfx('error'); }
    },
    readNote: async function (id, btn) {
      var pin = prompt('PIN for this memo:');
      if (!pin) return;
      try {
        var d = await post('/api/exchange/note', { id: id, pin: pin });
        var out = btn.parentElement.querySelector('.p5-memo');
        if (!out) return;
        out.style.display = 'block';
        out.style.color = d.success ? '#fff' : 'var(--pixel-red)';
        out.textContent = d.success ? d.note : (d.msg || 'Wrong PIN.');
        sfx(d.success ? 'unlock' : 'deny');
      } catch (e) { sfx('error'); }
    },

    /* ---- credits ---- */
    buyFrame: async function (id) {
      var msg = $('p5FrameMsg');
      try {
        var d = await post('/api/credits/buy_frame', { frame_id: id });
        sfx(d.success ? 'cash' : 'deny');
        if (msg) {
          msg.style.color = d.success ? 'var(--pixel-green)' : 'var(--pixel-red)';
          msg.textContent = d.msg;
        }
        if (d.success) loadCredits();
      } catch (e) { sfx('error'); }
    },
    buyAvatar: async function (id) {
      var msg = $('p5FrameMsg');
      try {
        var d = await post('/api/credits/buy_avatar', { avatar_id: id });
        sfx(d.success ? 'cash' : 'deny');
        if (msg) { msg.style.color = d.success ? 'var(--pixel-green)' : 'var(--pixel-red)'; msg.textContent = d.msg; }
        if (d.success) loadCredits();
      } catch (e) { sfx('error'); }
    },
    equipAvatar: async function (id) {
      var msg = $('p5FrameMsg');
      try {
        var d = await post('/api/profile', { avatar_glyph: id });
        sfx(d.success ? 'confirm' : 'deny');
        if (msg && !d.success) { msg.style.color = 'var(--pixel-red)'; msg.textContent = d.msg; }
        if (d.success) {
          loadCredits();
          if (window.AstraX && window.AstraX.refreshProfile) window.AstraX.refreshProfile();
        }
      } catch (e) { sfx('error'); }
    },
    saveTitle: async function () {
      var msg = $('p5FrameMsg');
      var title = ($('p5TitleInput') || {}).value || '';
      try {
        var d = await post('/api/credits/buy_title', { title: title });
        sfx(d.success ? 'cash' : 'deny');
        if (msg) { msg.style.color = d.success ? 'var(--pixel-green)' : 'var(--pixel-red)'; msg.textContent = d.msg; }
        if (d.success) {
          loadCredits();
          if (window.AstraX && window.AstraX.refreshProfile) window.AstraX.refreshProfile();
        }
      } catch (e) { sfx('error'); }
    },
    clearTitle: async function () {
      try {
        var d = await post('/api/credits/buy_title', { title: '' });
        sfx('close');
        var msg = $('p5FrameMsg');
        if (msg) { msg.style.color = '#5c7a99'; msg.textContent = d.msg || ''; }
        loadCredits();
        if (window.AstraX && window.AstraX.refreshProfile) window.AstraX.refreshProfile();
      } catch (e) { sfx('error'); }
    },
    equipFrame: async function (id) {
      var msg = $('p5FrameMsg');
      try {
        var d = await post('/api/profile', { avatar_frame: id });
        sfx(d.success ? 'confirm' : 'deny');
        if (msg && !d.success) { msg.style.color = 'var(--pixel-red)'; msg.textContent = d.msg; }
        if (d.success) loadCredits();
      } catch (e) { sfx('error'); }
    },

    /* ---- sequencer ---- */
    seqToggleStep: function (row, i) {
      SEQ.rows[row][i] = SEQ.rows[row][i] ? 0 : 1;
      renderSeqGrid();
      if (!SEQ.playing && SEQ.rows[row][i]) {
        var ctx = audioCtx();
        if (ctx) voice(row, i, ctx.currentTime + 0.01);
      }
    },
    seqToggle: function () { if (SEQ.playing) seqStop(); else seqStart(); },
    seqClear: function () {
      SEQ.order.forEach(function (r) { SEQ.rows[r] = new Array(SEQ.steps).fill(0); });
      renderSeqGrid();
      sfx('close');
    },
    seqRandom: function () {
      SEQ.order.forEach(function (r) {
        var density = r === 'hat' ? 0.45 : r === 'kick' ? 0.3 : 0.28;
        SEQ.rows[r] = SEQ.rows[r].map(function () { return Math.random() < density ? 1 : 0; });
      });
      renderSeqGrid();
      sfx('click');
    },
    seqBpm: function (v) {
      SEQ.bpm = Math.max(60, Math.min(200, parseInt(v, 10) || 120));
      var label = $('p5SeqBpmLabel');
      if (label) label.textContent = SEQ.bpm;
      if (SEQ.playing) { seqStop(); seqStart(); }
    },
    seqGenre: function (g) { SEQ.genre = g; },
    seqKey: function (k) { SEQ.key = k; },
    seqRelease: async function () {
      var msg = $('p5SeqMsg');
      var title = ($('p5SeqTitle') || {}).value || '';
      if (!title.trim()) {
        if (msg) { msg.style.color = 'var(--pixel-red)'; msg.textContent = 'Give the track a title first.'; }
        return;
      }
      var payload = {
        title: title.trim(),
        genre: SEQ.genre,
        key: SEQ.key,
        label: ($('p5SeqLabel') || {}).value || 'indie',
        bpm: SEQ.bpm,
        bars: 8,
        seed: seqSeed(),
        pattern: { steps: SEQ.steps, rows: SEQ.rows }
      };
      try {
        var d = await post('/api/game/music/release', payload);
        sfx(d.success ? 'cash' : 'deny');
        if (msg) {
          msg.style.color = d.success ? 'var(--pixel-green)' : 'var(--pixel-red)';
          msg.textContent = d.msg || (d.success ? 'Released.' : 'Could not release.');
        }
        if (d.success && window.AstraX && window.AstraX.reloadStudio) window.AstraX.reloadStudio();
      } catch (e) { sfx('error'); }
    },

    /* ---- live sync (astra_live.js) ---- */
    refreshExchange: loadExchange,

    /* ---- syndicate ---- */
    watchCoop: watchCoop,
    stopCoopWatch: stopCoopWatch,

    /* ---- messages ---- */
    renderThread: renderThread,
    onThreadOpen: onThreadOpen,
    editThreadKey: function () {
      if (!DM.active) return;
      var current = threadKey(DM.active);
      var next = prompt(
        'Shared PIN for this conversation (4-8 digits).\n\n' +
        'Kept in this browser only - it is never sent to the server, and there is no ' +
        'in-app way to send it to them. Agree it out of band.\n\n' +
        'Leave blank to forget it.', current);
      if (next === null) return;
      setThreadKey(DM.active, next.trim());
      refreshKeyBtn();
      sfx(next.trim() ? 'confirm' : 'close');
    },
    decryptMessage: async function (id, btn) {
      var pin = threadKey(DM.active || '') || prompt('Enter the PIN this message was sent with:');
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
    },
    fileChosen: function (input) {
      var file = input.files && input.files[0];
      var label = $('p5FileName'), send = $('p5SendFile');
      if (!file) {
        DM.pending = null;
        if (label) label.textContent = 'No file selected \u00b7 256 KB max';
        if (send) send.disabled = true;
        return;
      }
      if (file.size > 256 * 1024) {
        DM.pending = null;
        if (label) { label.style.color = 'var(--pixel-red)'; label.textContent = file.name + ' is ' + humanSize(file.size) + ' - cap is 256 KB'; }
        if (send) send.disabled = true;
        return;
      }
      DM.pending = file;
      if (label) { label.style.color = '#5c7a99'; label.textContent = file.name + ' \u00b7 ' + humanSize(file.size); }
      if (send) send.disabled = false;
    },
    sendAttachment: async function () {
      if (!DM.pending || !DM.active) return;
      var file = DM.pending;
      var encrypt = !!($('axMsgEncrypt') && $('axMsgEncrypt').checked);
      var pin = '';
      if (encrypt) {
        pin = threadKey(DM.active) || ($('axMsgPin') && $('axMsgPin').value) || '';
        if (!/^\d{4,8}$/.test(pin)) {
          alert('Encrypted files need a 4-8 digit PIN. Set a thread key, or type one in the PIN box.');
          return;
        }
      }
      var label = $('p5FileName');
      if (label) { label.style.color = 'var(--pixel-cyan)'; label.textContent = 'Uploading ' + file.name + '...'; }

      var reader = new FileReader();
      reader.onload = async function () {
        var b64 = String(reader.result).split(',')[1] || '';
        try {
          var d = await post('/api/messages/attach', {
            to: DM.active, filename: file.name, mime: file.type || 'application/octet-stream',
            data: b64, encrypt: encrypt, pin: pin,
            body: ($('axMsgBody') && $('axMsgBody').value.trim()) || ''
          });
          if (!d.success) {
            sfx('deny');
            if (label) { label.style.color = 'var(--pixel-red)'; label.textContent = d.msg || 'Upload failed.'; }
            return;
          }
          sfx('confirm');
          DM.pending = null;
          if ($('p5File')) $('p5File').value = '';
          if ($('axMsgBody')) $('axMsgBody').value = '';
          if ($('p5SendFile')) $('p5SendFile').disabled = true;
          if (label) { label.style.color = '#5c7a99'; label.textContent = 'No file selected \u00b7 256 KB max'; }
          reopenThread();
        } catch (e) { sfx('error'); }
      };
      reader.readAsDataURL(file);
    },
    getAttachment: async function (id, btn) {
      var body = { };
      var att = null;
      DM.thread.forEach(function (m) { if (m.attachment && m.attachment.id === id) att = m.attachment; });
      if (att && att.encrypted) {
        var pin = threadKey(DM.active || '') || prompt('PIN this file was locked with:');
        if (!pin) return;
        body.pin = pin;
      }
      try {
        var d = await post('/api/messages/attachment/' + id, body);
        if (!d.success) {
          sfx('deny');
          alert(d.msg || 'Could not open that file.');
          return;
        }
        var binary = atob(d.data);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        var url = URL.createObjectURL(new Blob([bytes], { type: d.mime || 'application/octet-stream' }));
        var a = document.createElement('a');
        a.href = url;
        a.download = d.filename || 'attachment';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        sfx('unlock');
        if (btn) btn.textContent = 'SAVED';
      } catch (e) { sfx('error'); }
    }
  };

  /* =================================================================
   * Boot - after astra_extras has built its views and nav buttons.
   * ================================================================= */

  var booted = false;

  async function boot() {
    if (booted) return;
    booted = true;
    injectStyles();

    try {
      var w = await api('/api/wip');
      WIP = w.features || {};
    } catch (e) { WIP = {}; }

    addView('exchange', exchangeView());
    addView('credits', creditsView());
    addNavButton('exchange', '[\u21c4] EXCHANGE');
    addNavButton('credits', '[\u00a4] CREDITS');
    mountSequencer();
    // Pick up the operator's language for the two tabs just added (index.html
    // ran its first pass long before these existed).
    if (window.applyLanguage && window.currentLang) window.applyLanguage(window.currentLang);
    mountFeedStrip();
    startDeskPoll();

    // astra_extras.js keeps ownership of the Messages tab; we hand it a
    // renderer (attachments + read receipts) and take over decryption so the
    // remembered thread key is tried before prompting.
    if (window.AstraX) {
      var origSend = window.AstraX.sendMessage;
      window.AstraX.decryptMessage = window.AstraP5.decryptMessage;
      window.AstraX.sendMessage = function () {
        // Fall back to the remembered thread key when "encrypt" is ticked but
        // the PIN box is empty, so the secret only has to be agreed once.
        var enc = $('axMsgEncrypt'), pinEl = $('axMsgPin');
        if (enc && enc.checked && pinEl && !pinEl.value) pinEl.value = threadKey(DM.active || '');
        return origSend.apply(this, arguments);
      };
    }

    // View hooks. Note: switchView only - the three functions index.html's
    // integrity check snapshots are deliberately left alone.
    var origSwitch = window.switchView;
    if (typeof origSwitch === 'function') {
      window.switchView = function (name) {
        var r = origSwitch.apply(this, arguments);
        if (name === 'exchange') loadExchange();
        if (name === 'credits') loadCredits();
        if (name === 'arbitrage') mountFeedStrip();
        // Don't hold a long-poll open for a tab nobody is looking at.
        if (name !== 'coop') stopCoopWatch();
        return r;
      };
    }

    // Keep the incoming-offer dot current without needing the tab open.
    loadExchange();
    setInterval(function () {
      if (document.getElementById('view-exchange')) loadExchange();
    }, 30000);
  }

  window.addEventListener('astrax:ready', boot);
  // Fallback: if astra_extras never loads (or its boot throws before the
  // event), come up anyway after a beat rather than silently doing nothing.
  setTimeout(boot, 6000);
})();
