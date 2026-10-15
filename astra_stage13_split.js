/* ===========================================================================
 * astra_stage13_split.js - Stage 13.
 *
 * astra_fragment.js (Stage 11) only fragmented the side-drawer. The "NEW
 * GAME" window itself (view-game) still crammed FOUR unrelated tools behind
 * one icon: the buy/sell trading desk, the 50-bot client call directory, the
 * boss check-in, and a scratch notepad - none of which look like a normal
 * desktop app, they look like tabs inside a game. This finishes the job:
 *
 *   - trading desk (stocksMarketGrid + BUY/SELL + the day clock)  -> merged
 *     into the existing MARKETS app, which already showed a read-only
 *     mirror of the same feed ("SYNCED WITH SIMULATOR ENGINE") right next
 *     to it. One live feed instead of two.
 *   - client call directory                                       -> new
 *     standalone CLIENT DIRECTORY app.
 *   - boss weekly review                                           -> moved
 *     into the CAREER app (Stage 11) - it's job performance, same as
 *     interviews and quitting.
 *   - operator notebook/memo                                       -> new
 *     standalone NOTEPAD app (account-backed autosave with a local cache).
 *
 * Same pure-DOM-move contract as astra_fragment.js: every relocated element
 * keeps its id, so executeTrade(), sendClientPitch(), requestBossReview(),
 * sendBossReply() in index.html never change. Trading desk and client
 * directory were both only ever shown once #gameActiveContainer was
 * revealed by startBrokerGame() - moving them out of that container loses
 * that gate for free, so this recreates it by mirroring the same flag onto
 * their new homes (same technique astra_fragment.js already used for
 * #tabBtnFunds -> #nav-funds).
 *
 * Loads after astra_fragment.js and before astra_winos.js - same
 * astrax:ready contract, same reasoning about script order guaranteeing
 * these nav-/view- pairs exist before discoverApps() runs.
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

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

  function makeView(id) {
    if ($('view-' + id)) return $('view-' + id);
    var host = $('view-dashboard');
    var wrapper = (host && host.parentNode) || $('mainAppWrapper');
    if (!host || !wrapper) return null;
    var view = document.createElement('div');
    view.id = 'view-' + id;
    view.className = 'app-view';
    wrapper.insertBefore(view, host);
    return view;
  }

  // Mirrors #gameActiveContainer's display onto a relocated panel that used
  // to live inside it, with a placeholder shown while the career hasn't
  // started yet. Same idea as astra_fragment.js's syncFundsVisibility.
  function gateOnCareerStarted(panel, placeholderText) {
    var placeholder = document.createElement('div');
    placeholder.className = 'terminal-panel';
    placeholder.style.color = '#888';
    placeholder.style.fontSize = '11px';
    placeholder.style.textAlign = 'center';
    placeholder.style.padding = '18px';
    placeholder.textContent = placeholderText;
    panel.parentNode.insertBefore(placeholder, panel);
    var lastActive = null;
    function sync() {
      var gac = $('gameActiveContainer');
      var active = !!(gac && gac.style.display !== 'none');
      if (active === lastActive) return;
      lastActive = active;
      panel.style.display = active ? '' : 'none';
      placeholder.style.display = active ? 'none' : '';
    }
    sync();
    setInterval(sync, 2000);
  }

  function panelOf(childId) {
    var child = $(childId);
    return child ? child.closest('.terminal-panel') : null;
  }

  var done = false;

  function split() {
    if (done) return;
    var tradingPanel = panelOf('stocksMarketGrid');
    var clientPanel = panelOf('clientBotsListContainer');
    var bossPanel = panelOf('bossReviewBox');
    var notePanel = panelOf('operatorNotepad');
    var marketsView = $('view-markets');
    var careerView = $('view-career');
    if (!tradingPanel || !clientPanel || !bossPanel || !notePanel || !marketsView || !careerView) return;

    // 1. Trading desk -> MARKETS (appended after its existing read-only feed).
    marketsView.appendChild(tradingPanel);
    gateOnCareerStarted(tradingPanel, 'Start your career from the NEW GAME app first - nothing to trade until you have.');

    // 2. Client call directory -> its own new CLIENTS app.
    var clientsView = makeView('clients');
    if (clientsView) {
      clientsView.appendChild(clientPanel);
      gateOnCareerStarted(clientPanel, 'Start your career from the NEW GAME app first - no line, nobody to call.');
      addNavButton('clients', '[\u260E] CLIENT DIRECTORY');
    }

    // 3. Boss weekly review -> CAREER (job performance lives with the rest
    // of career management: interviews, quitting, applications).
    careerView.appendChild(bossPanel);

    // 4. Notebook/memo -> its own new NOTEPAD app, now actually persisted -
    // it rendered a plain <textarea> with no id and no save logic before,
    // so anything written in it was gone on refresh.
    var notesView = makeView('notes');
    if (notesView) {
      notesView.appendChild(notePanel);
      addNavButton('notes', '[\u270D] NOTEPAD');
      wireNotepadPersistence();
    }

    done = true;
    if (window.applyLanguage && window.currentLang) window.applyLanguage(window.currentLang);
    if (window.winosRescanApps) window.winosRescanApps();
  }

  function wireNotepadPersistence() {
    var ta = $('operatorNotepad');
    if (!ta) return;
    var key = 'astra_notepad:' + ((document.getElementById('setupPlayerName') || {}).value || 'guest');
    var localValue = null;
    try {
      localValue = localStorage.getItem(key);
    } catch (e) { /* ignore */ }
    var desktop = window.AstraDesktopState;
    if (desktop) {
      desktop.ready.then(function (state) {
        if (Object.prototype.hasOwnProperty.call(state, 'notepad')) ta.value = state.notepad;
        else if (localValue !== null) {
          ta.value = localValue;
          desktop.update({ notepad: localValue });
        }
      });
    } else if (localValue !== null) ta.value = localValue;
    var timer = null;
    ta.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        try { localStorage.setItem(key, ta.value); } catch (e) { /* ignore */ }
        if (window.AstraDesktopState) window.AstraDesktopState.update({ notepad: ta.value });
      }, 400);
    });
  }

  function waitAndRun(triesLeft) {
    if (($('stocksMarketGrid') && $('view-career')) || triesLeft <= 0) { split(); return; }
    setTimeout(function () { waitAndRun(triesLeft - 1); }, 150);
  }

  // Must run after astra_fragment.js has built view-career - registering
  // this listener after fragment.js's own (script tag order) guarantees
  // fragment's handler, which runs synchronously once its DOM waits clear,
  // fires first.
  window.addEventListener('astrax:ready', function () { waitAndRun(60); });
  setTimeout(function () { waitAndRun(1); }, 9000); // last-resort fallback
})();
