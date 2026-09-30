/* ===========================================================================
 * astra_stage25_mail.js - Stage 25: MAIL. Ambient inbox generated from your
 * PRIVACY exposure: the more exposed you are, the more of what lands here is
 * phishing, and the better it's disguised. Click a bad link and it costs you
 * money; report it correctly and your security score climbs.
 * =========================================================================== */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(u, o) { return fetch(u, o).then(function (r) { return r.json(); }).catch(function () { return { success: false }; }); }
  function post(u, b) { return api(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); }

  var st = null, folder = 'inbox', openId = null;

  function injectStyles() {
    if ($('m25Styles')) return;
    var s = document.createElement('style'); s.id = 'm25Styles';
    s.textContent = [
      '.m25{display:grid; grid-template-columns:280px 1fr; gap:10px; height:100%;} @media(max-width:760px){.m25{grid-template-columns:1fr;}}',
      '.m25-list{border:1px solid var(--border-color); overflow:auto;}',
      '.m25-row{padding:8px 10px; border-bottom:1px solid rgba(15,28,48,.6); cursor:pointer; transition:background .12s;}',
      '.m25-row:hover{background:rgba(0,255,204,.05);} .m25-row.on{background:rgba(0,255,204,.1);}',
      '.m25-row.unread .m25-sub{font-weight:bold; color:#fff;}',
      '.m25-from{font-size:10.5px; color:#8a97ad;} .m25-sub{font-size:12px; margin-top:2px;} .m25-at{font-size:9.5px; color:#556; float:right;}',
      '.m25-tag{font-size:9px; padding:1px 5px; border:1px solid; margin-right:6px;}',
      '.m25-tag.phish{color:var(--pixel-red); border-color:var(--pixel-red);}',
      '.m25-tag.spam{color:var(--pixel-yellow); border-color:var(--pixel-yellow);}',
      '.m25-tag.legit{color:var(--pixel-green); border-color:var(--pixel-green);}',
      '.m25-detail{border:1px solid var(--border-color); padding:14px; overflow:auto;}',
      '.m25-body{white-space:pre-wrap; font-size:12px; line-height:1.6; margin:10px 0;}',
      '.m25-link{border:1px dashed var(--pixel-cyan); padding:8px; margin:8px 0; cursor:pointer; font-size:11.5px;}',
      '.m25-tells{border:1px solid var(--pixel-red); padding:8px; margin-top:10px; font-size:11px; color:#ffb3c0; animation:m25in .4s ease;}',
      '.m25-tells li{margin:3px 0;}',
      '@keyframes m25in{from{opacity:0; transform:translateY(-4px);}to{opacity:1; transform:none;}}',
      '.m25-empty{color:#8a97ad; font-size:11.5px; padding:20px;}',
      '@media (prefers-reduced-motion: reduce){.m25-tells{animation:none;}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function addNav() {
    var nav = document.querySelector('.header-nav');
    if (!nav || $('nav-mail')) return;
    var b = document.createElement('button');
    b.className = 'terminal-btn'; b.id = 'nav-mail'; b.innerHTML = '[\u2709] MAIL<span id="m25Badge" style="display:none; margin-left:5px; color:var(--pixel-red);">\u25CF</span>';
    b.onclick = function () { window.switchView('mail'); };
    var s = $('nav-settings'); if (s) nav.insertBefore(b, s); else nav.appendChild(b);
  }
  function addView() {
    if ($('view-mail')) return;
    var host = $('view-dashboard'), wrap = (host && host.parentNode) || $('mainAppWrapper');
    if (!host || !wrap) return;
    var v = document.createElement('div'); v.id = 'view-mail'; v.className = 'app-view';
    v.innerHTML = '<div class="terminal-panel" style="height:100%; display:flex; flex-direction:column;"><div class="panel-header"><div class="panel-heading-title">MAIL</div>' +
      '<div class="d25-tabs" id="m25Tabs"><button class="terminal-btn" data-f="inbox">INBOX</button><button class="terminal-btn" data-f="spam">SPAM</button></div></div>' +
      '<div class="m25" id="m25Root" style="flex:1; min-height:0;"><div class="m25-list" id="m25List"></div><div class="m25-detail" id="m25Detail"><div class="m25-empty">Select a message.</div></div></div></div>';
    wrap.insertBefore(v, host);
    v.querySelectorAll('#m25Tabs button').forEach(function (b) { b.onclick = function () { folder = b.getAttribute('data-f'); openId = null; render(); }; });
  }
  function isActive() { var v = $('view-mail'); return v && v.classList.contains('active-view'); }

  function tagFor(kind) { return '<span class="m25-tag ' + kind + '">' + kind.toUpperCase() + '</span>'; }

  function renderList() {
    var list = $('m25List'); if (!list) return;
    document.querySelectorAll('#m25Tabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-f') === folder); });
    var items = (st && st[folder]) || [];
    if (!items.length) { list.innerHTML = '<div class="m25-empty">Nothing here.</div>'; return; }
    list.innerHTML = items.map(function (m) {
      return '<div class="m25-row ' + (!m.read ? 'unread' : '') + ' ' + (m.id === openId ? 'on' : '') + '" data-id="' + m.id + '">' +
        '<div class="m25-from">' + esc(m.from_name) + '<span class="m25-at">' + m.at + '</span></div>' +
        '<div class="m25-sub">' + esc(m.subject) + '</div></div>';
    }).join('');
    list.querySelectorAll('.m25-row').forEach(function (r) { r.onclick = function () { openId = parseInt(r.getAttribute('data-id'), 10); renderDetail(); renderList(); }; });
  }

  function renderDetail() {
    var det = $('m25Detail'); if (!det) return;
    var items = (st && st[folder]) || [];
    var m = items.find(function (x) { return x.id === openId; });
    if (!m) { det.innerHTML = '<div class="m25-empty">Select a message.</div>'; return; }
    var link = m.link ? '<div class="m25-link" id="m25LinkBtn">\u2192 ' + esc(m.link.label) + '<br><span style="color:#8a97ad; font-size:10px;">' + esc(m.link.shown) + '</span></div>' : '';
    det.innerHTML = tagFor(m.kind) + '<b>' + esc(m.subject) + '</b><br>' +
      '<div style="font-size:11px; color:#8a97ad; margin-top:6px;">From: ' + esc(m.from_name) + ' &lt;' + esc(m.from_addr) + '&gt;' +
      (m.reply_to && m.reply_to !== m.from_addr ? '<br>Reply-To: ' + esc(m.reply_to) : '') + '</div>' +
      '<div class="m25-body">' + esc(m.body) + '</div>' + link +
      '<div style="display:flex; gap:6px; margin-top:10px;">' +
      '<button class="terminal-btn btn-warning" id="m25Report">REPORT PHISH/SPAM</button>' +
      '<button class="terminal-btn" id="m25Del">DELETE</button></div>' +
      '<div id="m25Reveal"></div>';
    if (!m.read) post('/api/mail/read', { id: m.id });
    var lb = $('m25LinkBtn');
    if (lb) lb.onclick = function () {
      post('/api/mail/act', { id: m.id }).then(function (d) {
        showReveal(d);
        if (d.open_app) window.switchView(d.open_app.replace('app:', ''));
        refresh();
      });
    };
    $('m25Report').onclick = function () {
      post('/api/mail/report', { id: m.id }).then(function (d) { showReveal(d); refresh(); });
    };
    $('m25Del').onclick = function () { post('/api/mail/delete', { id: m.id }).then(function () { openId = null; refresh(); }); };
  }

  function showReveal(d) {
    var box = $('m25Reveal'); if (!box) return;
    var lines = [];
    if (d.loss) lines.push('You lost $' + d.loss.toLocaleString(undefined, { minimumFractionDigits: 2 }) + '.');
    if (d.msg) lines.push(esc(d.msg));
    var tells = d.tells || d.reveal_tells || [];
    var html = lines.map(function (l) { return '<div>' + l + '</div>'; }).join('');
    if (tells.length) html += '<div class="m25-tells"><b>What gave it away:</b><ul>' + tells.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
    box.innerHTML = html;
  }

  function refresh() {
    api('/api/mail/inbox').then(function (d) {
      if (!d || d.success === false) return;
      st = d;
      var badge = $('m25Badge'); if (badge) badge.style.display = d.unread ? 'inline' : 'none';
      if (isActive()) { renderList(); renderDetail(); }
    });
  }

  function render() { renderList(); renderDetail(); }

  window.addEventListener('astrax:ready', function () {
    injectStyles();
    var tries = 0;
    (function boot() {
      addNav(); addView();
      if ($('nav-mail') && $('view-mail')) { refresh(); if (window.winosRescanApps) window.winosRescanApps(); return; }
      if (++tries < 80) setTimeout(boot, 250);
    })();
    setInterval(function () { if (!document.hidden) refresh(); }, 10000);
  });
})();
