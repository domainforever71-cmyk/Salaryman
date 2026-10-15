/* ===========================================================================
 * astra_stage19_workshift.js - Stage 19.
 *
 * Three pieces, all frontend for backend that already exists (app.py's
 * work_shift_start/submit, the /api/reports + /api/admin/* routes, and
 * models.py's Report/User.is_admin):
 *
 * 1) WORK DESK (nav-workdesk) - only appears once GameSave.job_status isn't
 *    "unemployed" (polled from /api/game/state, same pattern
 *    astra_fragment.js already used for the FUNDS tab). Clocking in opens
 *    all four tasks of a shift at once, in their own bordered panels on the
 *    same screen - you're meant to be juggling the ledger, the equation, the
 *    percentage, and the essay simultaneously, not doing them one at a time
 *    in sequence. Submitting grades all four together against app.py's
 *    seeded, server-side answers.
 *
 * 2) A "DIALING..." phone overlay wrapped around window.callClientBot and
 *    window.requestBossReview (both already existed, inline in index.html -
 *    the boss one even already said "Dialing the boss's office..." in its
 *    placeholder text). Purely cosmetic - it delays the real call by well
 *    under a second and changes nothing about what either function does.
 *
 * 3) ADMIN (nav-admin) - only appears if /api/settings reports
 *    is_admin:true for the logged-in account. Two tabs: open reports (with
 *    resolve/dismiss), and a user cross-check search. There is no hardcoded
 *    account that gets this - see admin_tools.py for how a real account
 *    earns the flag.
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sfx(n) { if (window.SFX) window.SFX.play(n); }
  function addNavButton(id, label) {
    var nav = document.querySelector('.header-nav');
    if (!nav || $('nav-' + id)) return null;
    var btn = document.createElement('button');
    btn.className = 'terminal-btn';
    btn.id = 'nav-' + id;
    btn.textContent = label;
    btn.onclick = function () { window.switchView(id); };
    var settings = $('nav-settings');
    if (settings) nav.insertBefore(btn, settings); else nav.appendChild(btn);
    return btn;
  }
  function addView(id, html) {
    if ($('view-' + id)) return $('view-' + id);
    var host = $('view-dashboard');
    var wrapper = (host && host.parentNode) || $('mainAppWrapper');
    if (!host || !wrapper) return null;
    var view = document.createElement('div');
    view.id = 'view-' + id;
    view.className = 'app-view';
    view.innerHTML = html;
    wrapper.insertBefore(view, host);
    return view;
  }
  async function api(url, opts) {
    var res = await fetch(url, opts);
    return res.json();
  }
  function post(url, body) {
    return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  }

  function injectStyles() {
    if ($('astra19Styles')) return;
    var css = document.createElement('style');
    css.id = 'astra19Styles';
    css.textContent = [
      '.a19-shift-grid{display:grid; grid-template-columns:1fr 1fr; gap:10px;}',
      '@media (max-width:760px){.a19-shift-grid{grid-template-columns:1fr;}}',
      '.a19-task{border:1px solid var(--border-color); padding:10px;}',
      '.a19-task h4{margin:0 0 8px; color:var(--pixel-cyan); font-size:11.5px; letter-spacing:.5px;}',
      '.a19-task input, .a19-task textarea{width:100%; background:#000; border:1px solid var(--border-color); color:#fff; ' +
      'padding:6px; font-family:var(--font-current); font-size:11.5px; box-sizing:border-box;}',
      '.a19-task textarea{resize:vertical; min-height:90px;}',
      '.a19-ledger-row{display:flex; justify-content:space-between; font-size:10.5px; color:#aaa; padding:2px 0;}',
      '.a19-dial{position:fixed; inset:0; background:rgba(1,3,6,.92); z-index:99998; display:flex; ' +
      'align-items:center; justify-content:center; flex-direction:column; gap:10px; color:var(--pixel-cyan); font-size:13px;}',
      '.a19-dial .a19-dots span{animation:a19blink 1s infinite; opacity:.2;}',
      '.a19-dial .a19-dots span:nth-child(2){animation-delay:.2s;} .a19-dial .a19-dots span:nth-child(3){animation-delay:.4s;}',
      '@keyframes a19blink{0%,100%{opacity:.2;}50%{opacity:1;}}',
      '.a19-result-ok{color:var(--pixel-green);} .a19-result-bad{color:var(--pixel-red);}'
    ].join('');
    document.head.appendChild(css);
  }

  /* =======================================================================
   * 1) WORK DESK
   * ===================================================================== */
  var activeShift = null;

  function workdeskHtml() {
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">WORK DESK</div></div>' +
        '<div style="font-size:10.5px; color:#5c7a99; margin-bottom:10px;">A shift is four tasks, open at once. Clock out grades all of them together - partial credit if you don\u2019t finish everything.</div>' +
        '<div id="a19Stats" style="font-size:10.5px; color:#8a97ad; margin-bottom:10px;">Loading stats\u2026</div>' +
        '<button class="terminal-btn btn-start" id="a19ClockBtn" onclick="AstraWork.clockIn()">[\u23F1] CLOCK IN</button>' +
      '</div>' +
      '<div id="a19ShiftPanel"></div>';
  }

  async function loadStats() {
    var el = $('a19Stats');
    if (!el) return;
    try {
      var d = await api('/api/game/state');
      var total = d.work_tasks_total || 0;
      var correct = d.work_tasks_correct || 0;
      var acc = total ? Math.round((correct / total) * 100) : 0;
      el.innerHTML = 'Shifts completed: <b style="color:var(--pixel-yellow);">' + (d.work_shifts_completed || 0) + '</b>' +
        ' &middot; Task accuracy: <b style="color:var(--pixel-yellow);">' + acc + '%</b>' +
        ' &middot; Essays written: <b style="color:var(--pixel-yellow);">' + (d.essays_written || 0) + '</b>';
    } catch (e) { el.textContent = 'Stats unavailable.'; }
  }

  function ledgerTaskHtml(ledger) {
    var rows = ledger.items.map(function (it) {
      var cls = it.amount < 0 ? 'a19-result-bad' : 'a19-result-ok';
      return '<div class="a19-ledger-row"><span>' + esc(it.label) + '</span><span class="' + cls + '">' +
        (it.amount < 0 ? '-$' + Math.abs(it.amount).toFixed(2) : '+$' + it.amount.toFixed(2)) + '</span></div>';
    }).join('');
    return '' +
      '<div class="a19-task"><h4>LEDGER \u2014 RECONCILE THE ACCOUNT</h4>' +
      '<div style="font-size:10.5px; color:#aaa; margin-bottom:6px;">Starting balance: <b>$' + ledger.start_balance.toLocaleString() + '</b></div>' +
      rows +
      '<div style="margin-top:8px;"><label style="font-size:10px; color:#8a97ad;">Ending balance:</label>' +
      '<input type="text" id="a19Ledger" placeholder="e.g. 12345.67"></div></div>';
  }

  function algebraTaskHtml(algebra) {
    var bTerm = algebra.b >= 0 ? ' + ' + algebra.b : ' - ' + Math.abs(algebra.b);
    return '' +
      '<div class="a19-task"><h4>ALGEBRA \u2014 SOLVE FOR X</h4>' +
      '<div style="font-size:13px; color:#fff; margin-bottom:8px;">' + algebra.a + 'x' + bTerm + ' = ' + algebra.c + '</div>' +
      '<label style="font-size:10px; color:#8a97ad;">x =</label>' +
      '<input type="text" id="a19Algebra" placeholder="e.g. 7"></div>';
  }

  function percentTaskHtml(percent) {
    return '' +
      '<div class="a19-task"><h4>COMMISSION \u2014 WORK THE PERCENTAGE</h4>' +
      '<div style="font-size:13px; color:#fff; margin-bottom:8px;">What is ' + percent.pct + '% of $' + percent.base.toLocaleString() + '?</div>' +
      '<label style="font-size:10px; color:#8a97ad;">Amount ($):</label>' +
      '<input type="text" id="a19Percent" placeholder="e.g. 240.00"></div>';
  }

  function essayTaskHtml(prompt) {
    return '' +
      '<div class="a19-task" style="grid-column:1 / -1;"><h4>' + esc(prompt.title.toUpperCase()) + '</h4>' +
      '<div style="font-size:10.5px; color:#aaa; margin-bottom:6px;">' + esc(prompt.brief) + '</div>' +
      '<div style="font-size:9.5px; color:#5c7a99; margin-bottom:6px;">Minimum ' + prompt.min_words + ' words. Must include: ' +
      prompt.must_include.map(function (t) { return '<i>' + esc(t) + '</i>'; }).join(', ') + '.</div>' +
      '<textarea id="a19Essay" placeholder="Write it here..."></textarea></div>';
  }

  function shiftHtml(shift) {
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">SHIFT IN PROGRESS</div></div>' +
        '<div class="a19-shift-grid">' +
          algebraTaskHtml(shift.algebra) + percentTaskHtml(shift.percent) +
          ledgerTaskHtml(shift.ledger) + essayTaskHtml(shift.essay_prompt) +
        '</div>' +
        '<button class="terminal-btn btn-action" style="margin-top:12px;" onclick="AstraWork.clockOut()">[\u2713] CLOCK OUT &amp; SUBMIT SHIFT</button>' +
        '<div id="a19ShiftResult" style="margin-top:10px;"></div>' +
      '</div>';
  }

  async function clockIn() {
    var btn = $('a19ClockBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'CLOCKING IN\u2026'; }
    try {
      var d = await api('/api/work/shift/start');
      if (!d.success) { alert(d.msg || 'Could not clock in.'); if (btn) { btn.disabled = false; btn.textContent = '[\u23F1] CLOCK IN'; } return; }
      activeShift = d.shift;
      var panel = $('a19ShiftPanel');
      if (panel) panel.innerHTML = shiftHtml(activeShift);
      if (btn) btn.style.display = 'none';
      sfx('click');
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = '[\u23F1] CLOCK IN'; }
    }
  }

  async function clockOut() {
    var body = {
      algebra: ($('a19Algebra') || {}).value, percent: ($('a19Percent') || {}).value,
      ledger: ($('a19Ledger') || {}).value, essay: ($('a19Essay') || {}).value
    };
    var d = await post('/api/work/shift/submit', body);
    var box = $('a19ShiftResult');
    if (!d.success) { if (box) box.innerHTML = '<div class="a19-result-bad">' + esc(d.msg || 'Could not submit.') + '</div>'; return; }
    var lines = ['algebra', 'percent', 'ledger', 'essay'].map(function (k) {
      var ok = d.results[k];
      return '<div class="' + (ok ? 'a19-result-ok' : 'a19-result-bad') + '">' + k.toUpperCase() + ': ' + (ok ? 'CORRECT' : 'MISSED') + '</div>';
    }).join('');
    if (box) {
      box.innerHTML = lines +
        '<div style="margin-top:6px; color:var(--pixel-yellow);">' + d.correct_count + '/4 correct \u2014 payout: $' + d.payout.toFixed(2) + '</div>' +
        '<button class="terminal-btn" style="margin-top:8px;" onclick="AstraWork.reset()">DONE</button>';
    }
    sfx(d.correct_count >= 3 ? 'cash' : 'deny');
    loadStats();
    if (window.AstraFiles) { /* balance/UI elsewhere polls its own state */ }
  }

  function resetPanel() {
    activeShift = null;
    var panel = $('a19ShiftPanel');
    if (panel) panel.innerHTML = '';
    var btn = $('a19ClockBtn');
    if (btn) { btn.style.display = ''; btn.disabled = false; btn.textContent = '[\u23F1] CLOCK IN'; }
    loadStats();
  }

  window.AstraWork = { clockIn: clockIn, clockOut: clockOut, reset: resetPanel };

  var workdeskUnlocked = false;
  function pollWorkdeskUnlock() {
    api('/api/game/state').then(function (d) {
      var employed = !!(d && d.job_status && d.job_status !== 'unemployed');
      if (employed && !workdeskUnlocked) {
        workdeskUnlocked = true;
        addNavButton('workdesk', '[\u23F1] WORK DESK');
        if (window.winosRescanApps) window.winosRescanApps();
      } else if (!employed && workdeskUnlocked) {
        workdeskUnlocked = false;
        var btn = $('nav-workdesk');
        if (btn) btn.remove();
        if (window.winosRescanApps) window.winosRescanApps();
      }
    }).catch(function () {});
  }

  /* =======================================================================
   * 2) DIAL OVERLAY - wraps callClientBot / requestBossReview
   * ===================================================================== */
  function showDial(label) {
    var el = document.createElement('div');
    el.className = 'a19-dial';
    el.id = 'a19DialOverlay';
    el.innerHTML = '<div style="font-size:22px;">\u260E</div><div>DIALING ' + esc(label.toUpperCase()) + '\u2026</div>' +
      '<div class="a19-dots"><span>\u25CF</span><span>\u25CF</span><span>\u25CF</span></div>';
    document.body.appendChild(el);
    sfx('click');
  }
  function hideDial() {
    var el = $('a19DialOverlay');
    if (el) el.remove();
  }
  function wrapWithDial(fnName, label) {
    var original = window[fnName];
    if (typeof original !== 'function' || original._a19Wrapped) return;
    var wrapped = function () {
      var args = arguments, self = this;
      showDial(label);
      setTimeout(function () {
        hideDial();
        original.apply(self, args);
      }, 700 + Math.random() * 500);
    };
    wrapped._a19Wrapped = true;
    window[fnName] = wrapped;
  }

  /* =======================================================================
   * 3) ADMIN
   * ===================================================================== */
  var adminTab = 'reports';

  function adminHtml() {
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">ADMIN</div></div>' +
        '<div style="display:flex; gap:6px; margin-bottom:10px;">' +
          '<button class="terminal-btn" id="a19AdminTab-reports" onclick="AstraAdmin.setTab(\'reports\')">REPORTS</button>' +
          '<button class="terminal-btn" id="a19AdminTab-users" onclick="AstraAdmin.setTab(\'users\')">USERS</button>' +
          '<button class="terminal-btn" id="a19AdminTab-admins" onclick="AstraAdmin.setTab(\'admins\')">ADMINS</button>' +
        '</div>' +
        '<div id="a19AdminBody">Loading\u2026</div>' +
      '</div>';
  }

  async function renderReports() {
    var body = $('a19AdminBody');
    if (!body) return;
    body.innerHTML = 'Loading reports\u2026';
    var d = await api('/api/admin/reports?status=open');
    if (!d.success) { body.innerHTML = '<div class="a19-result-bad">Could not load reports.</div>'; return; }
    if (!d.reports.length) { body.innerHTML = '<div style="color:#888;">No open reports.</div>'; return; }
    body.innerHTML = d.reports.map(function (r) {
      return '<div class="d-list-item" style="flex-direction:column; align-items:flex-start; gap:4px;">' +
        '<div style="display:flex; justify-content:space-between; width:100%;">' +
        '<b style="color:var(--pixel-yellow);">' + esc(r.target_username) + '</b>' +
        '<span class="a17-badge">' + esc(r.reason) + '</span></div>' +
        '<div style="font-size:10px; color:#8a97ad;">reported by ' + esc(r.reporter || '?') + ' &middot; ' + esc(r.created_at || '') + '</div>' +
        (r.details ? '<div style="font-size:10.5px; color:#cfd8e3;">' + esc(r.details) + '</div>' : '') +
        '<div style="display:flex; gap:6px; margin-top:4px;">' +
          '<button class="terminal-btn btn-action" onclick="AstraAdmin.resolve(' + r.id + ',\'resolved\')">RESOLVE</button>' +
          '<button class="terminal-btn" onclick="AstraAdmin.resolve(' + r.id + ',\'dismissed\')">DISMISS</button>' +
        '</div></div>';
    }).join('');
  }

  async function renderUsers() {
    var body = $('a19AdminBody');
    if (!body) return;
    body.innerHTML =
      '<input type="text" id="a19AdminSearch" placeholder="Search username..." ' +
      'style="width:100%; background:#000; border:1px solid var(--border-color); color:#fff; padding:6px; font-family:var(--font-current); margin-bottom:8px;" ' +
      'oninput="AstraAdmin.searchUsers(this.value)">' +
      '<div id="a19AdminUserList">Loading\u2026</div>';
    searchUsers('');
  }

  async function searchUsers(q) {
    var list = $('a19AdminUserList');
    if (!list) return;
    var d = await api('/api/admin/users?q=' + encodeURIComponent(q || ''));
    if (!d.success) { list.innerHTML = '<div class="a19-result-bad">Could not load users.</div>'; return; }
    list.innerHTML = d.users.map(function (u) {
      return '<div class="d-list-item">' +
        '<div style="min-width:0;flex:1;"><b style="color:var(--pixel-yellow);">' + esc(u.username) + '</b>' +
        (u.is_admin ? ' <span class="a17-badge">ADMIN</span>' : '') +
        (u.is_banned ? ' <span class="a17-badge" style="color:var(--pixel-red);">SUSPENDED</span>' : '') +
        (u.open_reports ? ' <span class="a17-badge" style="color:var(--pixel-red);">' + u.open_reports + ' OPEN REPORT(S)</span>' : '') +
        '<div style="font-size:10px; color:#8a97ad;">' + esc(u.job_title || u.job_status || 'unemployed') +
          ' &middot; pay ' + (u.salary == null ? 'none' : '$' + Number(u.salary).toLocaleString()) +
          ' &middot; balance $' + Number(u.balance || 0).toLocaleString() +
          ' &middot; joined ' + esc(u.created_at || '') + '</div>' +
        (u.is_banned && u.ban_reason ? '<div style="font-size:10px;color:var(--pixel-red);">Reason: ' + esc(u.ban_reason) + '</div>' : '') +
        '</div>' +
        (u.is_admin ? '' : (u.is_banned
          ? '<button class="terminal-btn" onclick="AstraAdmin.unban(' + u.id + ')">RESTORE ACCESS</button>'
          : '<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">' +
              '<input id="a19BanReason-' + u.id + '" maxlength="160" placeholder="reason for suspension" style="max-width:180px;">' +
              '<button class="terminal-btn" onclick="AstraAdmin.ban(' + u.id + ')">SUSPEND</button></div>')) +
      '</div>';
    }).join('') || '<div style="color:#888;">No matches.</div>';
  }

  async function renderAdmins() {
    var body = $('a19AdminBody');
    if (!body) return;
    body.innerHTML = 'Loading administrators...';
    var d = await api('/api/admin/users?admins_only=1');
    if (!d.success) { body.innerHTML = '<div class="a19-result-bad">Could not load admin roster.</div>'; return; }
    var names = d.users.map(function (u) { return u.username; });
    body.innerHTML = '<div class="terminal-panel"><div class="panel-header"><div class="panel-heading-title">admins</div>' +
      '<span class="a17-badge">READ ONLY</span></div>' +
      '<textarea id="a19AdminsNote" readonly rows="' + Math.max(3, names.length) + '" style="width:100%;resize:vertical;">' +
      esc(names.join('\n') || '(no administrators)') + '</textarea>' +
      '<div style="font-size:10px;color:#8a97ad;margin-top:6px;">Access is granted by the host through the protected account role, not by editing this roster.</div></div>';
  }

  window.AstraAdmin = {
    setTab: function (t) {
      adminTab = t;
      ['reports', 'users', 'admins'].forEach(function (k) {
        var tab = $('a19AdminTab-' + k);
        if (tab) tab.classList.toggle('active-nav', k === t);
      });
      if (t === 'reports') renderReports();
      else if (t === 'admins') renderAdmins();
      else renderUsers();
    },
    resolve: async function (id, status) {
      await post('/api/admin/reports/' + id + '/resolve', { status: status });
      renderReports();
    },
    ban: async function (id) {
      var input = $('a19BanReason-' + id);
      var reason = input ? input.value.trim() : '';
      if (!reason) return;
      await post('/api/admin/users/' + id + '/ban', { reason: reason });
      searchUsers(($('a19AdminSearch') || {}).value || '');
    },
    unban: async function (id) {
      await post('/api/admin/users/' + id + '/unban', {});
      searchUsers(($('a19AdminSearch') || {}).value || '');
    },
    searchUsers: searchUsers
  };

  /* =======================================================================
   * boot
   * ===================================================================== */
  var done = false;
  async function build() {
    if (done) return;
    if (!document.querySelector('.header-nav') || !$('view-dashboard')) return;
    done = true;
    injectStyles();

    addView('workdesk', workdeskHtml());
    loadStats();
    pollWorkdeskUnlock();
    setInterval(pollWorkdeskUnlock, 6000);

    wrapWithDial('callClientBot', 'client');
    wrapWithDial('requestBossReview', 'the boss\u2019s office');

    try {
      var settingsResp = await api('/api/settings');
      if (settingsResp && settingsResp.success && settingsResp.settings && settingsResp.settings.is_admin) {
        addView('admin', adminHtml());
        addNavButton('admin', '[\u2606] ADMIN');
        renderReports();
      }
    } catch (e) { /* not logged in yet, or offline - skip admin this pass */ }

    if (window.winosRescanApps) window.winosRescanApps();
  }

  function waitAndRun(triesLeft) {
    if (($('view-dashboard') && document.querySelector('.header-nav')) || triesLeft <= 0) { build(); return; }
    setTimeout(function () { waitAndRun(triesLeft - 1); }, 150);
  }

  window.addEventListener('astrax:ready', function () { waitAndRun(45); });
  setTimeout(function () { waitAndRun(1); }, 9800);
})();
