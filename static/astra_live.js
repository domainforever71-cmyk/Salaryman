/* astra_live.js - things show up without a refresh or a re-click.
 *
 * One tiny request to /api/live/sync every ~1.5s (slower when the tab is in
 * the background, instant again the moment you come back). The server says
 * what changed; this file repaints just that: the friends list, the open
 * conversation, the exchange tab. A toast pops when something new arrives.
 *
 * It never wraps or replaces any other file's functions - it only calls the
 * small public hooks (AstraX.refreshFriends / refreshThread, AstraP5.refreshExchange).
 */
(function () {
  'use strict';

  var FAST = 1500, SLOW = 8000;
  var last = null;          // previous sync payload
  var busy = false, failures = 0, timer = null;

  function $(id) { return document.getElementById(id); }
  function sfx(n) { try { if (window.SFX && window.SFX.play) window.SFX.play(n); } catch (e) {} }

  /* ---------- toasts ---------- */
  function toast(text, onClick) {
    var host = $('axLiveToasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'axLiveToasts';
      host.style.cssText = 'position:fixed;right:14px;bottom:56px;z-index:99999;display:flex;' +
        'flex-direction:column;gap:6px;pointer-events:none;';
      document.body.appendChild(host);
    }
    var t = document.createElement('div');
    t.textContent = text;
    t.style.cssText = 'pointer-events:auto;cursor:pointer;max-width:280px;padding:9px 12px;font-size:12px;' +
      'background:#05121a;color:var(--pixel-cyan,#0fc);border:1px solid var(--pixel-cyan,#0fc);' +
      'box-shadow:0 0 10px rgba(0,255,204,.25);font-family:inherit;';
    t.onclick = function () { t.remove(); if (onClick) onClick(); };
    host.appendChild(t);
    sfx('confirm');
    setTimeout(function () { if (t.parentNode) t.remove(); }, 6000);
  }

  function messagesVisible() {
    var w = $('wswin-messages'), v = $('view-messages');
    if (w) return w.classList.contains('active') && w.offsetParent !== null;
    return !!(v && v.classList.contains('active-view'));
  }

  function openMessages(name) {
    try {
      if (typeof window.switchView === 'function') window.switchView('messages');
      if (window.AstraX && name) window.AstraX.openThread(name);
    } catch (e) {}
  }

  /* ---------- react to a new payload ---------- */
  function apply(d) {
    var prev = last;
    last = d;
    if (!prev) return;   // first sample is the baseline - no toasts for old stuff

    var X = window.AstraX, P = window.AstraP5;

    // friend requests / accepts / removals
    if (d.friends_sig !== prev.friends_sig) {
      (d.incoming_requests || []).forEach(function (n) {
        if ((prev.incoming_requests || []).indexOf(n) === -1) {
          toast(n + ' sent you a friend request', function () { openMessages(); });
        }
      });
      if (X && X.refreshFriends) X.refreshFriends();
    }

    // new messages
    var active = X && X.activeThread ? X.activeThread() : null;
    Object.keys(d.unread_by || {}).forEach(function (name) {
      var now = d.unread_by[name], was = (prev.unread_by || {})[name];
      var isNew = now.last_id > (was ? was.last_id : 0);
      if (!isNew) return;
      var watching = active && active.toLowerCase() === name.toLowerCase() &&
                     messagesVisible() && !document.hidden;
      if (!watching) toast('New message from ' + name, function () { openMessages(name); });
    });
    if (d.unread_total !== prev.unread_total && X && X.refreshFriends) X.refreshFriends();

    // the conversation that's open right now
    if (d.thread && prev.thread && d.thread.with === prev.thread.with &&
        (d.thread.last_id !== prev.thread.last_id || d.thread.count !== prev.thread.count ||
         d.thread.read !== prev.thread.read)) {
      if (messagesVisible() && X && X.refreshThread) X.refreshThread();
    }

    // trade + hire offers
    if (d.trades_in > prev.trades_in) {
      toast('New trade offer received');
      if (P && P.refreshExchange && $('view-exchange')) P.refreshExchange();
    } else if (d.trades_in !== prev.trades_in && P && P.refreshExchange && $('view-exchange')) {
      P.refreshExchange();
    }
    if (d.hires_in > prev.hires_in) toast('New job offer from another operator');
  }

  /* ---------- the loop ---------- */
  function url() {
    var u = '/api/live/sync';
    var X = window.AstraX;
    var who = X && X.activeThread ? X.activeThread() : null;
    if (who && messagesVisible()) u += '?with=' + encodeURIComponent(who);
    return u;
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      var res = await fetch(url(), { credentials: 'same-origin', cache: 'no-store' });
      if (res.status === 401 || res.status === 403) { stop(); return; }   // logged out / suspended
      var d = await res.json();
      if (d && d.success) { failures = 0; apply(d); }
    } catch (e) {
      failures++;
    } finally {
      busy = false;
    }
    schedule();
  }

  function delay() {
    var base = document.hidden ? SLOW : FAST;
    return Math.min(base * Math.pow(2, Math.min(failures, 4)), 30000);   // back off while offline
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(tick, delay()); }
  function stop() { clearTimeout(timer); timer = null; }

  document.addEventListener('visibilitychange', function () { if (!document.hidden && timer !== null) { clearTimeout(timer); tick(); } });
  window.addEventListener('online', function () { failures = 0; clearTimeout(timer); tick(); });
  window.addEventListener('focus', function () { if (timer !== null) { clearTimeout(timer); tick(); } });

  // Also repaint the instant YOU send something, so your own message never waits for the next beat.
  window.AstraLive = { poke: function () { clearTimeout(timer); tick(); } };

  function start() { tick(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
