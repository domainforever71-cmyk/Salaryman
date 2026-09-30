/* ===========================================================================
 * astra_phase7_bank.js - Phase 7, first slice: debt & credit.
 *
 * Adds one new tab, BANK, the same way phase6.js added STAFF/TASKS/CASINO/
 * INVESTORS - a dynamically-built #view-bank appended after #view-dashboard,
 * plus a nav button, wired through the same switchView wrapper contract.
 * Talks to the three new backend routes:
 *   GET  /api/game/bank/status  -> credit score + lender tiers + your loans
 *   POST /api/game/bank/loan    -> take a loan from a tier you qualify for
 *   POST /api/game/bank/repay   -> pay down (or off) an active loan
 * No client-side game logic lives here - every number (interest, credit
 * score deltas, lock-outs) is computed server-side in app.py; this file
 * only renders what those routes return and asks the same "actual dice-
 * roll-style check" server for anything real, same as every other panel.
 *
 * Loads after astra_phase6.js, before astra_consolidate.js (which folds
 * this tab's nav button into the BROKER SIMULATOR sub-nav same as the
 * others - see GAME_GROUP in astra_consolidate.js).
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
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
    return res.json();
  }
  function post(url, body) {
    return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
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
    btn.innerHTML = esc(label);
    btn.onclick = function () { window.switchView(id); };
    var settings = $('nav-settings');
    if (settings) nav.insertBefore(btn, settings); else nav.appendChild(btn);
  }

  function injectStyles() {
    var css = document.createElement('style');
    css.textContent = [
      '.p7-score{font-size:26px;letter-spacing:1px;}',
      '.p7-score.good{color:var(--pixel-green,#00ff66);}',
      '.p7-score.fair{color:var(--pixel-cyan);}',
      '.p7-score.poor{color:var(--pixel-red);}',
      '.p7-tier{border:1px solid var(--border-color);background:#000;padding:10px 12px;margin-bottom:8px;}',
      '.p7-tier.locked{opacity:.5;}',
      '.p7-tier-row{display:flex;justify-content:space-between;align-items:center;gap:8px;}',
      '.p7-loan{border:1px solid var(--border-color);background:#000;padding:10px 12px;margin-bottom:8px;font-size:12px;}',
      '.p7-loan.defaulted{border-color:var(--pixel-red);}',
      '.p7-inline{display:flex;gap:6px;margin-top:6px;}',
      '.p7-inline input{width:110px;background:#050505;border:1px solid var(--border-color);',
      'color:var(--text-main);font-family:inherit;font-size:11px;padding:5px 7px;}',
    ].join('');
    document.head.appendChild(css);
  }

  function bankView() {
    return (
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">CREDIT STANDING</div></div>' +
        '<div id="p7ScoreBox" class="p7-score fair">-- LOADING --</div>' +
        '<div style="font-size:10.5px;color:#5c7a99;margin-top:4px;">300-850 scale. Missing a weekly loan ' +
        'payment costs you 20; a loan paid off in full earns back 15. Falls below a lender\'s bar and they ' +
        'won\'t issue you anything, full stop - including some job listings, which run their own check.</div>' +
      '</div>' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">LENDERS</div></div>' +
        '<div id="p7TiersBox">Loading...</div>' +
      '</div>' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">YOUR LOANS</div></div>' +
        '<div id="p7LoansBox">Loading...</div>' +
      '</div>'
    );
  }

  function scoreClass(score) {
    if (score >= 700) return 'good';
    if (score >= 580) return 'fair';
    return 'poor';
  }

  function renderTiers(tiers) {
    if (!tiers || !tiers.length) return '<div style="font-size:11px;color:#5c7a99;">No lenders available.</div>';
    return tiers.map(function (t) {
      return (
        '<div class="p7-tier' + (t.locked ? ' locked' : '') + '">' +
          '<div class="p7-tier-row">' +
            '<div><strong>' + esc(t.name) + '</strong><div style="font-size:10px;color:#5c7a99;">' + esc(t.blurb) + '</div></div>' +
            '<div style="text-align:right;font-size:11px;">' +
              'up to ' + money(t.max_principal) + '<br>' + (t.apr * 100).toFixed(0) + '% APR' +
            '</div>' +
          '</div>' +
          (t.locked
            ? '<div style="font-size:10.5px;color:var(--pixel-red);margin-top:6px;">Needs ' + t.min_score + '+ credit score.</div>'
            : '<div class="p7-inline">' +
                '<input type="number" min="1" max="' + t.max_principal + '" id="p7amt-' + esc(t.id) + '" placeholder="amount">' +
                '<button class="terminal-btn btn-action" onclick="AstraP7.takeLoan(\'' + esc(t.id) + '\')">[$] TAKE LOAN</button>' +
              '</div>') +
        '</div>'
      );
    }).join('');
  }

  function renderLoans(loans) {
    var active = (loans || []).filter(function (l) { return l.status !== 'paid'; });
    if (!active.length) return '<div style="font-size:11px;color:#5c7a99;">No loans on record.</div>';
    return active.map(function (l) {
      return (
        '<div class="p7-loan' + (l.status === 'defaulted' ? ' defaulted' : '') + '">' +
          '<div><strong>' + esc(l.lender) + '</strong> - ' + (l.status === 'defaulted' ? 'DEFAULTED' : 'active') + '</div>' +
          '<div>Owed: ' + money(l.balance) + ' &nbsp; APR: ' + (l.apr * 100).toFixed(0) + '% &nbsp; ' +
            'Missed payments: ' + (l.missed_payments || 0) + '</div>' +
          (l.status === 'active'
            ? '<div class="p7-inline">' +
                '<input type="number" min="1" id="p7repay-' + esc(l.id) + '" placeholder="amount">' +
                '<button class="terminal-btn btn-action" onclick="AstraP7.repayLoan(\'' + esc(l.id) + '\')">[+] REPAY</button>' +
              '</div>' : '') +
        '</div>'
      );
    }).join('');
  }

  async function loadBank() {
    var d = await api('/api/game/bank/status');
    if (!d.success) return;
    var scoreBox = $('p7ScoreBox');
    if (scoreBox) {
      scoreBox.className = 'p7-score ' + scoreClass(d.credit_score);
      scoreBox.textContent = d.credit_score + ' / 850';
    }
    var tiersBox = $('p7TiersBox');
    if (tiersBox) tiersBox.innerHTML = renderTiers(d.tiers);
    var loansBox = $('p7LoansBox');
    if (loansBox) loansBox.innerHTML = renderLoans(d.loans);
  }

  async function takeLoan(lenderId) {
    var input = $('p7amt-' + lenderId);
    var amount = input ? parseFloat(input.value) : 0;
    if (!amount || amount <= 0) return;
    var d = await post('/api/game/bank/loan', { lender_id: lenderId, amount: amount });
    if (!d.success) { alert(d.msg || 'Loan denied.'); return; }
    if (window.SFX) window.SFX.play('cash');
    loadBank();
    if (window.refreshDashboard) window.refreshDashboard();
  }

  async function repayLoan(loanId) {
    var input = $('p7repay-' + loanId);
    var amount = input ? parseFloat(input.value) : 0;
    if (!amount || amount <= 0) return;
    var d = await post('/api/game/bank/repay', { loan_id: loanId, amount: amount });
    if (!d.success) { alert(d.msg || 'Payment failed.'); return; }
    if (window.SFX) window.SFX.play('cash');
    loadBank();
    if (window.refreshDashboard) window.refreshDashboard();
  }

  var booted = false;
  function boot() {
    if (booted) return;
    if (!$('view-dashboard')) return; // dashboard not built yet - retry
    booted = true;
    injectStyles();
    addView('bank', bankView());
    addNavButton('bank', '[\u00a2] BANK');

    var origSwitch = window.switchView;
    if (typeof origSwitch === 'function') {
      window.switchView = function (name) {
        var r = origSwitch.apply(this, arguments);
        if (name === 'bank') loadBank();
        return r;
      };
    }
  }

  window.AstraP7 = { loadBank: loadBank, takeLoan: takeLoan, repayLoan: repayLoan };

  window.addEventListener('astrax:ready', boot);
  setTimeout(boot, 7000);
})();
