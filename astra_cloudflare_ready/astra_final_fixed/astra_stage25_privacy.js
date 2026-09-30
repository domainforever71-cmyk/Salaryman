/* ===========================================================================
 * astra_stage25_privacy.js - Stage 25: PRIVACY. How findable you are, and what
 * that costs you in MAIL. Board/profile/mail visibility and your spam filter
 * strength set your baseline exposure; data-broker listings accumulate on top
 * of that over time. Two-factor halves what a successful phish actually costs.
 * =========================================================================== */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(u, o) { return fetch(u, o).then(function (r) { return r.json(); }).catch(function () { return { success: false }; }); }
  function post(u, b) { return api(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); }

  var st = null;
  var LABELS = {
    board: [['public', 'Public'], ['alias', 'Alias only'], ['hidden', 'Hidden']],
    profile: [['public', 'Public'], ['friends', 'Friends only'], ['private', 'Private']],
    mail: [['anyone', 'Anyone'], ['contacts', 'Contacts only'], ['nobody', 'Nobody']],
    filter: [['off', 'Off'], ['standard', 'Standard'], ['strict', 'Strict']]
  };
  var NAMES = { board: 'PUBLIC BOARD VISIBILITY', profile: 'PROFILE VISIBILITY', mail: 'WHO CAN MAIL YOU', filter: 'SPAM FILTER' };

  function injectStyles() {
    if ($('p25Styles')) return;
    var s = document.createElement('style'); s.id = 'p25Styles';
    s.textContent = [
      '.p25{display:flex; flex-direction:column; gap:12px;}',
      '.p25-gauge{border:1px solid var(--border-color); padding:12px;}',
      '.p25-bar{height:10px; background:#000; border:1px solid var(--border-color); overflow:hidden; margin-top:6px;}',
      '.p25-bar i{display:block; height:100%; transition:width .5s ease;}',
      '.p25-grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px;}',
      '.p25-card{border:1px solid var(--border-color); padding:10px;}',
      '.p25-seg{display:flex; border:1px solid var(--border-color); margin-top:6px;}',
      '.p25-seg button{flex:1; background:#000; color:var(--text-main); border:none; padding:6px; font-family:inherit; cursor:pointer; font-size:10.5px;}',
      '.p25-seg button.on{background:var(--pixel-cyan); color:#000;}',
      '.p25-stat{display:flex; justify-content:space-between; font-size:11.5px; padding:3px 0;}',
      '@media (prefers-reduced-motion: reduce){.p25-bar i{transition:none;}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function addNav() {
    var nav = document.querySelector('.header-nav');
    if (!nav || $('nav-privacy')) return;
    var b = document.createElement('button');
    b.className = 'terminal-btn'; b.id = 'nav-privacy'; b.textContent = '[\u26E8] PRIVACY';
    b.onclick = function () { window.switchView('privacy'); };
    var s = $('nav-settings'); if (s) nav.insertBefore(b, s); else nav.appendChild(b);
  }
  function addView() {
    if ($('view-privacy')) return;
    var host = $('view-dashboard'), wrap = (host && host.parentNode) || $('mainAppWrapper');
    if (!host || !wrap) return;
    var v = document.createElement('div'); v.id = 'view-privacy'; v.className = 'app-view';
    v.innerHTML = '<div class="terminal-panel"><div class="panel-header"><div class="panel-heading-title">PRIVACY</div></div><div id="p25Body">Loading...</div></div>';
    wrap.insertBefore(v, host);
  }
  function isActive() { var v = $('view-privacy'); return v && v.classList.contains('active-view'); }

  function color(score) { return score >= 70 ? 'var(--pixel-green)' : score >= 40 ? 'var(--pixel-yellow)' : 'var(--pixel-red)'; }

  function body() {
    if (!st) return 'Loading...';
    var expColor = st.exposure <= 30 ? 'var(--pixel-green)' : st.exposure <= 60 ? 'var(--pixel-yellow)' : 'var(--pixel-red)';
    var segs = ['board', 'profile', 'mail', 'filter'].map(function (k) {
      return '<div class="p25-card"><div style="font-size:10px; color:#8a97ad;">' + NAMES[k] + '</div>' +
        '<div class="p25-seg" data-k="' + k + '">' + LABELS[k].map(function (o) {
          return '<button data-v="' + o[0] + '" class="' + (st.settings[k] === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
        }).join('') + '</div></div>';
    }).join('');
    return '<div class="p25">' +
      '<div class="p25-gauge"><div style="display:flex; justify-content:space-between;"><span>EXPOSURE</span><b style="color:' + expColor + ';">' + st.exposure + '/100</b></div>' +
      '<div class="p25-bar"><i style="width:' + st.exposure + '%; background:' + expColor + ';"></i></div>' +
      '<div style="display:flex; justify-content:space-between; margin-top:10px;"><span>SECURITY SCORE</span><b style="color:' + color(st.score) + ';">' + st.score + '/100</b></div>' +
      '<div class="p25-bar"><i style="width:' + st.score + '%; background:' + color(st.score) + ';"></i></div></div>' +
      '<div class="p25-grid">' + segs + '</div>' +
      '<div class="p25-grid">' +
      '<div class="p25-card"><div style="font-size:10px; color:#8a97ad;">TWO-FACTOR AUTH</div>' +
      '<p style="font-size:10.5px; color:#8a97ad;">Halves the money lost if you do click a phishing link.</p>' +
      '<button class="terminal-btn ' + (st.twofa ? 'btn-start' : 'btn-warning') + '" id="p25Twofa">' + (st.twofa ? '[\u2713] ENABLED - CLICK TO DISABLE' : 'ENABLE 2FA') + '</button></div>' +
      '<div class="p25-card"><div style="font-size:10px; color:#8a97ad;">DATA-BROKER LISTINGS</div>' +
      '<div class="p25-stat"><span>Live listings</span><span>' + st.brokers + ' / ' + st.broker_cap + '</span></div>' +
      '<p style="font-size:10.5px; color:#8a97ad;">New listings accumulate on their own; each one raises your exposure. Pay to scrub one.</p>' +
      '<button class="terminal-btn" id="p25Delist"' + (st.brokers <= 0 ? ' disabled' : '') + '>PAY TO DELIST ($25 base)</button></div>' +
      '<div class="p25-card"><div style="font-size:10px; color:#8a97ad;">VPN RELAY</div>' +
      '<p style="font-size:10.5px; color:#8a97ad;">Route through VPN to cut a leak point now and halve future broker growth for a while.</p>' +
      '<button class="terminal-btn btn-action" id="p25Relay">RUN RELAY PASS</button></div>' +
      '<div class="p25-card"><div style="font-size:10px; color:#8a97ad;">MAIL HYGIENE</div>' +
      '<div class="p25-stat"><span>Clicked bad links</span><span style="color:var(--pixel-red);">' + st.clicked + '</span></div>' +
      '<div class="p25-stat"><span>Correctly reported</span><span style="color:var(--pixel-green);">' + st.reported + '</span></div>' +
      '<div class="p25-stat"><span>False reports</span><span style="color:var(--pixel-yellow);">' + st.false_reports + '</span></div></div>' +
      '</div></div>';
  }

  function wire() {
    document.querySelectorAll('.p25-seg').forEach(function (seg) {
      var k = seg.getAttribute('data-k');
      seg.querySelectorAll('button').forEach(function (b) {
        b.onclick = function () {
          var d = {}; d[k] = b.getAttribute('data-v');
          post('/api/privacy/settings', d).then(refresh);
        };
      });
    });
    var t = $('p25Twofa'); if (t) t.onclick = function () { post('/api/privacy/twofa', { on: !st.twofa }).then(refresh); };
    var r = $('p25Relay'); if (r) r.onclick = function () { post('/api/privacy/relay', {}).then(refresh); };
    var d = $('p25Delist'); if (d) d.onclick = function () { post('/api/privacy/delist', {}).then(refresh); };
  }

  function render() {
    var b = $('p25Body'); if (!b) return;
    b.innerHTML = body();
    wire();
  }

  function refresh() {
    api('/api/privacy/status').then(function (d) {
      if (!d || d.success === false) return;
      st = d;
      if (isActive() || $('p25Body')) render();
    });
  }

  window.addEventListener('astrax:ready', function () {
    injectStyles();
    var tries = 0;
    (function boot() {
      addNav(); addView();
      if ($('nav-privacy') && $('view-privacy')) { refresh(); if (window.winosRescanApps) window.winosRescanApps(); return; }
      if (++tries < 80) setTimeout(boot, 250);
    })();
    setInterval(function () { if (!document.hidden) refresh(); }, 15000);
  });
})();
