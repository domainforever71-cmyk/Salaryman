/* ===========================================================================
 * astra_stage18_inbox_ads.js - Stage 18.
 *
 * Two small, unrelated-but-shipped-together additions:
 *
 * 1) A "WELCOME BACK" panel shown once per real login (index.html is a fresh
 *    server render each time you land on "/", so a plain module-level flag
 *    is enough - no need to persist "have I shown this" anywhere). It pulls
 *    /api/messages/inbox_summary (added alongside this file - see app.py's
 *    messages_inbox_summary) and lists whatever's unread, grouped by sender,
 *    across every conversation, not just friends (astra_extras.js's
 *    messages_thread/messages_send no longer require an accepted friendship
 *    either - see the same app.py change). Reading this summary marks
 *    nothing as read; only actually opening a thread does that, same as
 *    before - "missed messages" stay in the thread and stay unread until you
 *    genuinely read them there, they're never deleted or summarized-away.
 *
 * 2) A small "sponsored" line folded into the same panel, in the same
 *    deadpan-fake-ad voice as login.html's own strip and everything else
 *    this codebase already treats as a deterrent-not-real-thing (the VPN
 *    copy, the browser's scam listing, LUCKYSPIN's own disclaimer). Pure
 *    flavor - it doesn't spend anything, charge anything, or gate anything.
 *
 * Loads after astra_extras.js (needs AstraX.openThread) and astra_winos.js
 * (needs window.switchView / winos chrome to exist so the panel doesn't pop
 * up over a blank page before the desktop itself has rendered).
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

  var DESKTOP_ADS = [
    'GHOST-VPN: your free relay trial is "about to expire" (it is not on a timer, but act now anyway).',
    'BLOGNET Career Corner has a new post. Cold applications are still losing to referrals.',
    'STREAMTUBE: 3 creators you don\u2019t follow uploaded a video about a stock you don\u2019t own.',
    'Meridian Capital Bank: pre-approved for a loan you did not apply for.',
    'VEX SCANNER noticed a spread. It will not act on it for you.',
    'Your OMNI App Store wishlist called - nothing on it got cheaper.'
  ];

  function injectStyles() {
    if ($('astra18Styles')) return;
    var css = document.createElement('style');
    css.id = 'astra18Styles';
    css.textContent =
      '.a18-row{display:flex; justify-content:space-between; align-items:center; gap:10px; ' +
      'border:1px solid var(--border-color); padding:8px 10px; margin-bottom:6px;}' +
      '.a18-ad{font-size:10.5px; color:#b7a45c; border:1px dashed #4a3f1a; background:rgba(255,187,0,.05); ' +
      'padding:8px 10px; margin-top:12px;}';
    document.head.appendChild(css);
  }

  function panelHtml(summary) {
    var ad = DESKTOP_ADS[Math.floor(Math.random() * DESKTOP_ADS.length)];
    var body;
    if (!summary || !summary.total_unread) {
      body = '<div style="color:#888; font-size:11px;">No missed messages while you were away.</div>';
    } else {
      body = summary.senders.map(function (s) {
        return '<div class="a18-row">' +
          '<div><b style="color:var(--pixel-yellow);">' + esc(s.username) + '</b>' +
          '<span style="color:var(--pixel-red); font-size:10px; margin-left:6px;">' + s.count + ' unread</span>' +
          '<div style="font-size:10px; color:#8a97ad; max-width:340px;">' + esc(s.preview || '') + '</div></div>' +
          '<button class="terminal-btn btn-action" onclick="AstraWelcomeBack.open(\'' + esc(s.username).replace(/'/g, '') + '\')">OPEN</button>' +
        '</div>';
      }).join('');
    }
    return '' +
      '<div class="ax-sheet" style="width:460px;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">' +
          '<div class="panel-heading-title">WELCOME BACK' + (summary && summary.total_unread ? ' \u2014 ' + summary.total_unread + ' UNREAD' : '') + '</div>' +
          '<button class="ax-close" onclick="AstraWelcomeBack.close()">CLOSE</button>' +
        '</div>' +
        body +
        '<div class="a18-ad"><b>SPONSORED</b> \u2014 ' + esc(ad) + '</div>' +
      '</div>';
  }

  function ensureOverlay() {
    var el = $('a18Overlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'a18Overlay';
    el.className = 'ax-overlay';
    document.body.appendChild(el);
    return el;
  }

  function show(summary) {
    injectStyles();
    var overlay = ensureOverlay();
    overlay.innerHTML = panelHtml(summary);
    overlay.classList.add('open');
    sfx('boot');
  }

  window.AstraWelcomeBack = {
    close: function () {
      var overlay = $('a18Overlay');
      if (overlay) overlay.classList.remove('open');
    },
    open: function (username) {
      window.AstraWelcomeBack.close();
      if (window.switchView) window.switchView('messages');
      setTimeout(function () {
        if (window.AstraX && window.AstraX.openThread) window.AstraX.openThread(username);
      }, 60);
    }
  };

  var shown = false;
  async function runOnce() {
    if (shown) return;
    shown = true;
    try {
      var res = await fetch('/api/messages/inbox_summary');
      var data = await res.json();
      show(data && data.success ? data : null);
    } catch (e) {
      show(null);
    }
  }

  function waitAndRun(triesLeft) {
    if (document.querySelector('.header-nav') || triesLeft <= 0) { setTimeout(runOnce, 500); return; }
    setTimeout(function () { waitAndRun(triesLeft - 1); }, 150);
  }

  window.addEventListener('astrax:ready', function () { waitAndRun(45); });
  setTimeout(function () { waitAndRun(1); }, 9500);
})();
