/* ===========================================================================
 * astra_phase7_status.js - Phase 7 wrap-up: tie the new systems together
 * on the interface instead of leaving them scattered.
 *
 * Debt/credit got its own BANK tab (astra_phase7_bank.js). Compliance
 * (audit strikes), burnout (stress-driven consequences) and client trust
 * did NOT get new tabs, by design - the plan calls for extending existing
 * panels, not bolting on more top-level views. This file is the small
 * connective layer that was still missing:
 *
 *   1. Two more cards on the existing game-hud-bar (CREDIT SCORE, STANDING)
 *      so credit and compliance are visible everywhere, same as BALANCE or
 *      BOSS MOOD already are - reuses the exact .gh-card markup already on
 *      the page, doesn't touch anything else in the bar.
 *   2. A "COMPLIANCE FILE" panel appended inside the existing #view-tasks
 *      (ASSIGNMENTS) tab, since that's the plan's stated home for it -
 *      "extend ASSIGNMENT_TEMPLATES and the boss-assignment grading", not a
 *      new tab.
 *   3. Surfaces an audit_event or a burnout msg. from /api/game/assignments/
 *      submit as a one-line toast instead of silently vanishing into the
 *      response object (the base submit handler in astra_phase6.js already
 *      shows pass/fail; this only adds the extra line when one is present).
 *
 * No new game logic - every number here comes from GameSave via
 * /api/game/state and /api/game/compliance/status. Loads after
 * astra_phase7_bank.js, alongside astra_stage8.js/astra_consolidate.js.
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  async function api(url) { var r = await fetch(url); return r.json(); }

  /* =====================================================================
   * 1. HUD CARDS
   * ===================================================================== */

  function addHudCard(id, label) {
    var bar = document.querySelector('.game-hud-bar');
    if (!bar || $(id)) return;
    var card = document.createElement('div');
    card.className = 'gh-card';
    card.innerHTML = '<div class="gh-lbl">' + esc(label) + '</div><div class="gh-val" id="' + id + '">--</div>';
    bar.appendChild(card);
  }

  function creditClass(score) {
    if (score >= 700) return 'var(--pixel-green,#00ff66)';
    if (score >= 580) return 'var(--pixel-cyan)';
    return 'var(--pixel-red)';
  }

  var STANDING_LABEL = { clean: 'CLEAN', fined: 'FINED', probation: 'PROBATION' };
  var STANDING_COLOR = {
    clean: 'var(--pixel-green,#00ff66)',
    fined: 'var(--pixel-yellow)',
    probation: 'var(--pixel-red)',
  };

  function updateHud(data) {
    var creditEl = $('ghCreditScore');
    if (creditEl && typeof data.credit_score === 'number') {
      creditEl.textContent = data.credit_score;
      creditEl.style.color = creditClass(data.credit_score);
      creditEl.title = 'Credit score, 300-850. Gates bank loans and some job listings.';
    }
    var standingEl = $('ghStanding');
    if (standingEl) {
      var status = data.audit_status || 'clean';
      standingEl.textContent = STANDING_LABEL[status] || status.toUpperCase();
      standingEl.style.color = STANDING_COLOR[status] || 'var(--pixel-cyan)';
      standingEl.title = 'Compliance standing. ' + (data.audit_strikes
        ? (data.audit_strikes + ' strike' + (data.audit_strikes === 1 ? '' : 's') + ' on file.')
        : 'No strikes on file.');
    }
  }

  /* =====================================================================
   * 2. COMPLIANCE FILE PANEL (inside the existing ASSIGNMENTS tab)
   * ===================================================================== */

  function injectStyles() {
    var css = document.createElement('style');
    css.textContent = [
      '.p7c-row{display:flex;justify-content:space-between;font-size:11px;padding:4px 0;',
      'border-bottom:1px solid var(--border-color);}',
      '.p7c-row:last-child{border-bottom:none;}',
      '.p7c-strikes{font-size:22px;letter-spacing:1px;}',
    ].join('');
    document.head.appendChild(css);
  }

  function complianceView(d) {
    var strikes = d.audit_strikes || 0;
    var color = strikes >= 2 ? 'var(--pixel-red)' : strikes === 1 ? 'var(--pixel-yellow)' : 'var(--pixel-green,#00ff66)';
    var log = (d.log || []).slice().reverse();
    var logHtml = log.length
      ? log.map(function (e) {
          return '<div class="p7c-row"><span>Day ' + e.day + ' - ' + esc(e.kind || '') + '</span>' +
                 '<span style="color:#5c7a99;">' + esc((e.msg || '').slice(0, 70)) + '</span></div>';
        }).join('')
      : '<div style="font-size:11px;color:#5c7a99;">Clean file - no compliance flags yet.</div>';
    return (
      '<div class="terminal-panel" id="p7ComplianceBox">' +
        '<div class="panel-header"><div class="panel-heading-title">COMPLIANCE FILE</div></div>' +
        '<div class="p7c-strikes" style="color:' + color + ';">' + strikes + ' strike' + (strikes === 1 ? '' : 's') + '</div>' +
        '<div style="font-size:10.5px;color:#5c7a99;margin:4px 0 8px;">Failing a compliance quiz or getting caught on a ' +
        'bad reconcile/blotter can trigger a review. First strike: a fine. Second: probation (salary cut). ' +
        'Third: terminated for cause.</div>' +
        logHtml +
      '</div>'
    );
  }

  async function loadCompliance() {
    var host = $('view-tasks');
    if (!host) return;
    var d = await api('/api/game/compliance/status');
    if (!d.success) return;
    var existing = $('p7ComplianceBox');
    if (existing) existing.outerHTML = complianceView(d);
    else host.insertAdjacentHTML('beforeend', complianceView(d));
  }

  /* =====================================================================
   * 3. Boot
   * ===================================================================== */

  var booted = false;
  function boot() {
    if (booted) return;
    if (!document.querySelector('.game-hud-bar')) return; // dashboard not built yet - retry
    booted = true;
    injectStyles();
    addHudCard('ghCreditScore', 'CREDIT SCORE');
    addHudCard('ghStanding', 'STANDING');

    // Piggyback on the existing 5s dashboard poll instead of starting a
    // second timer - /api/game/state already carries credit_score/
    // audit_status/audit_strikes via GameSave.to_dict().
    var origPoll = window.pollGameState;
    if (typeof origPoll === 'function') {
      window.pollGameState = async function () {
        var r = await origPoll.apply(this, arguments);
        if (window.mockGameState) updateHud(window.mockGameState);
        return r;
      };
    }

    var origSwitch = window.switchView;
    if (typeof origSwitch === 'function') {
      window.switchView = function (name) {
        var r = origSwitch.apply(this, arguments);
        if (name === 'tasks') loadCompliance();
        return r;
      };
    }
  }

  window.addEventListener('astrax:ready', boot);
  setTimeout(boot, 7500);
})();
