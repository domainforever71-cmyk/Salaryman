/* ===========================================================================
 * astra_phase6.js - Phase 6 surface: casino/gambling, named staff with
 * benefits + firing + vacation requests + a talk-to-employee chat, boss
 * assignments with a solvable UI, an investor message inbox, and a free
 * browser-based voice-over toggle for AI-voiced lines.
 *
 * Loads after astra_extras.js and astra_phase5.js and waits for
 * `astrax:ready`, same contract as phase5: does not touch executeTrade,
 * advanceGameDay, or sendOmniConsole.
 * =========================================================================== */
(function () {
  'use strict';

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
      '.p6-card{border:1px solid var(--border-color);background:#000;padding:10px 12px;margin-bottom:8px;}',
      '.p6-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;',
      'border-bottom:1px solid var(--border-color);font-size:12px;}',
      '.p6-row:last-child{border-bottom:none;}',
      '.p6-k{color:#5c7a99;font-size:10px;letter-spacing:1px;}',
      '.p6-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}',
      '@media (max-width:760px){.p6-grid3{grid-template-columns:1fr;}.p6-two{grid-template-columns:1fr !important;}}',
      '.p6-chip{background:#000;border:1px solid var(--border-color);color:var(--text-main);',
      'font-family:inherit;font-size:10.5px;padding:4px 9px;cursor:pointer;}',
      '.p6-chip.sel{border-color:var(--pixel-cyan);color:var(--pixel-cyan);background:rgba(0,255,204,.08);}',
      '.p6-reel{display:inline-block;width:44px;height:44px;line-height:44px;text-align:center;',
      'border:1px solid var(--border-color);font-size:11px;margin-right:4px;background:#050505;}',
      '.p6-bar{height:6px;background:#111;border:1px solid var(--border-color);overflow:hidden;}',
      '.p6-bar>i{display:block;height:100%;background:var(--pixel-cyan);}',
      '.p6-msg{font-size:11.5px;line-height:1.6;color:#ddd;white-space:pre-wrap;}',
      '.p6-speak{cursor:pointer;color:var(--pixel-cyan);font-size:10px;margin-left:6px;}',
      '.p6-win{color:var(--pixel-green,#00ff66);}',
      '.p6-lose{color:var(--pixel-red);}',
      '#voiceToggleBtn.on{border-color:var(--pixel-cyan);color:var(--pixel-cyan);}'
    ].join('');
    document.head.appendChild(css);
  }

  /* =================================================================
   * VOICE-OVER - free, offline, browser SpeechSynthesis. Any AI-voiced
   * line rendered by this file gets a small [SPEAK] control next to it;
   * a global toggle also auto-speaks new lines as they arrive so players
   * don't have to click every single one.
   * ================================================================= */
  var VOICE = { enabled: false, voice: null };

  function pickVoice() {
    if (!window.speechSynthesis) return null;
    var voices = window.speechSynthesis.getVoices() || [];
    return voices.find(function (v) { return /en/i.test(v.lang); }) || voices[0] || null;
  }

  function speak(text) {
    if (!window.speechSynthesis || !text) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(String(text).slice(0, 500));
      u.voice = VOICE.voice || pickVoice();
      u.rate = 1.02;
      u.pitch = 0.9;
      window.speechSynthesis.speak(u);
    } catch (e) { /* speech synthesis unsupported - silently no-op */ }
  }

  function speakBtn(text) {
    return '<span class="p6-speak" onclick="AstraP6.speak(\'' + jsStr(text) + '\')">[\u25b6 SPEAK]</span>';
  }

  function autoSpeak(text) { if (VOICE.enabled) speak(text); }

  function mountVoiceToggle() {
    var nav = document.querySelector('.header-nav');
    if (!nav || $('voiceToggleBtn')) return;
    var btn = document.createElement('button');
    btn.className = 'terminal-btn';
    btn.id = 'voiceToggleBtn';
    btn.title = 'Auto-read new AI lines aloud using your browser\'s built-in voice. Free, works offline.';
    btn.textContent = '[\ud83d\udd0a] VOICE: OFF';
    btn.onclick = function () {
      VOICE.enabled = !VOICE.enabled;
      btn.textContent = '[\ud83d\udd0a] VOICE: ' + (VOICE.enabled ? 'ON' : 'OFF');
      btn.classList.toggle('on', VOICE.enabled);
      sfx(VOICE.enabled ? 'unlock' : 'deny');
      if (!VOICE.enabled && window.speechSynthesis) window.speechSynthesis.cancel();
    };
    var settings = $('nav-settings');
    if (settings) nav.insertBefore(btn, settings); else nav.appendChild(btn);
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = function () { VOICE.voice = pickVoice(); };
  }

  /* =================================================================
   * 1. CASINO - server-authoritative RNG, balance updates in one call.
   * ================================================================= */

  var CASINO = { games: {}, balance: 0 };

  function casinoView() {
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">CASINO FLOOR</div>' +
        '<span style="font-size:11px;color:var(--pixel-cyan);">Balance: <span id="p6CasinoBalance">$0.00</span></span></div>' +
        '<div style="font-size:11px;color:#5c7a99;line-height:1.7;">' +
          'A way to burn - or make - cash between deals. Every game is resolved server-side; ' +
          'the house always keeps a small edge. Bet only what you can afford to lose.' +
        '</div>' +
      '</div>' +
      '<div class="p6-grid3">' +
        '<div class="terminal-panel">' +
          '<div class="panel-header"><div class="panel-heading-title">SLOT MACHINE</div></div>' +
          '<div style="text-align:center;margin:10px 0;" id="p6SlotReels">' +
            '<span class="p6-reel">?</span><span class="p6-reel">?</span><span class="p6-reel">?</span>' +
          '</div>' +
          '<input type="number" id="p6SlotBet" class="d-input" placeholder="Bet" value="25" style="margin-bottom:6px;">' +
          '<button class="terminal-btn btn-start" style="width:100%;" onclick="AstraP6.playSlots()">[\u25b6] SPIN</button>' +
          '<div id="p6SlotResult" style="font-size:11px;margin-top:6px;"></div>' +
        '</div>' +
        '<div class="terminal-panel">' +
          '<div class="panel-header"><div class="panel-heading-title">COIN FLIP</div></div>' +
          '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
            '<button class="p6-chip sel" id="p6CoinHeads" onclick="AstraP6.pickCoin(\'heads\')">HEADS</button>' +
            '<button class="p6-chip" id="p6CoinTails" onclick="AstraP6.pickCoin(\'tails\')">TAILS</button>' +
          '</div>' +
          '<input type="number" id="p6CoinBet" class="d-input" placeholder="Bet" value="25" style="margin-bottom:6px;">' +
          '<button class="terminal-btn btn-start" style="width:100%;" onclick="AstraP6.playCoin()">[\u25b6] FLIP (1.92x)</button>' +
          '<div id="p6CoinResult" style="font-size:11px;margin-top:6px;"></div>' +
        '</div>' +
        '<div class="terminal-panel">' +
          '<div class="panel-header"><div class="panel-heading-title">HIGH-LOW DICE</div></div>' +
          '<div style="font-size:10.5px;color:#5c7a99;margin-bottom:6px;">d6 roll - HIGH wins on 4-6, LOW wins on 1-3.</div>' +
          '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
            '<button class="p6-chip sel" id="p6DiceHigh" onclick="AstraP6.pickDice(\'high\')">HIGH</button>' +
            '<button class="p6-chip" id="p6DiceLow" onclick="AstraP6.pickDice(\'low\')">LOW</button>' +
          '</div>' +
          '<input type="number" id="p6DiceBet" class="d-input" placeholder="Bet" value="25" style="margin-bottom:6px;">' +
          '<button class="terminal-btn btn-start" style="width:100%;" onclick="AstraP6.playDice()">[\u25b6] ROLL (1.9x)</button>' +
          '<div id="p6DiceResult" style="font-size:11px;margin-top:6px;"></div>' +
        '</div>' +
      '</div>' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">QUICK BLACKJACK</div></div>' +
        '<div style="font-size:10.5px;color:#5c7a99;margin-bottom:6px;">' +
          'One simplified draw each, closer to 21 without busting wins. Push returns your stake.</div>' +
        '<div style="display:flex;gap:6px;">' +
          '<input type="number" id="p6BjBet" class="d-input" placeholder="Bet" value="50" style="flex:1;">' +
          '<button class="terminal-btn btn-start" onclick="AstraP6.playBlackjack()">[\u25b6] DEAL (1.95x)</button>' +
        '</div>' +
        '<div id="p6BjResult" style="font-size:11px;margin-top:6px;"></div>' +
      '</div>';
  }

  var coinChoice = 'heads', diceGuess = 'high';

  async function loadCasino() {
    try {
      var d = await api('/api/game/casino/games');
      if (!d.success) return;
      CASINO = d;
      var el = $('p6CasinoBalance');
      if (el) el.textContent = money(d.balance);
    } catch (e) {}
  }

  function refreshBalanceEverywhere(bal) {
    var el = $('p6CasinoBalance');
    if (el) el.textContent = money(bal);
    if (window.gameState) window.gameState.balance = bal;
    var gh = $('ghBalance');
    if (gh) gh.textContent = money(bal);
  }

  async function playSlots() {
    var bet = parseFloat($('p6SlotBet').value) || 0;
    var out = $('p6SlotResult');
    try {
      var d = await post('/api/game/casino/play', { game: 'slots', bet: bet });
      if (!d.success) { out.innerHTML = '<span class="p6-lose">' + esc(d.msg || 'Bet rejected.') + '</span>'; sfx('deny'); return; }
      var reels = d.detail.reels;
      $('p6SlotReels').innerHTML = reels.map(function (r) { return '<span class="p6-reel">' + esc(r) + '</span>'; }).join('');
      var won = d.net > 0;
      out.innerHTML = '<span class="' + (won ? 'p6-win' : 'p6-lose') + '">' +
        (won ? 'WIN +' + money(d.net) : 'No luck (' + money(d.net) + ')') + '</span>';
      sfx(won ? 'cash' : 'deny');
      refreshBalanceEverywhere(d.balance);
    } catch (e) { out.textContent = 'Connection error.'; }
  }

  function pickCoin(c) {
    coinChoice = c;
    $('p6CoinHeads').classList.toggle('sel', c === 'heads');
    $('p6CoinTails').classList.toggle('sel', c === 'tails');
  }

  async function playCoin() {
    var bet = parseFloat($('p6CoinBet').value) || 0;
    var out = $('p6CoinResult');
    try {
      var d = await post('/api/game/casino/play', { game: 'coinflip', bet: bet, choice: coinChoice });
      if (!d.success) { out.innerHTML = '<span class="p6-lose">' + esc(d.msg || 'Bet rejected.') + '</span>'; sfx('deny'); return; }
      var won = d.detail.won;
      out.innerHTML = 'Landed <b>' + esc(d.detail.result).toUpperCase() + '</b> - ' +
        '<span class="' + (won ? 'p6-win' : 'p6-lose') + '">' + (won ? 'WIN +' + money(d.net) : 'Lost ' + money(bet)) + '</span>';
      sfx(won ? 'cash' : 'deny');
      refreshBalanceEverywhere(d.balance);
    } catch (e) { out.textContent = 'Connection error.'; }
  }

  function pickDice(c) {
    diceGuess = c;
    $('p6DiceHigh').classList.toggle('sel', c === 'high');
    $('p6DiceLow').classList.toggle('sel', c === 'low');
  }

  async function playDice() {
    var bet = parseFloat($('p6DiceBet').value) || 0;
    var out = $('p6DiceResult');
    try {
      var d = await post('/api/game/casino/play', { game: 'dice', bet: bet, guess: diceGuess });
      if (!d.success) { out.innerHTML = '<span class="p6-lose">' + esc(d.msg || 'Bet rejected.') + '</span>'; sfx('deny'); return; }
      var won = d.detail.won;
      out.innerHTML = 'Rolled <b>' + d.detail.roll + '</b> - ' +
        '<span class="' + (won ? 'p6-win' : 'p6-lose') + '">' + (won ? 'WIN +' + money(d.net) : 'Lost ' + money(bet)) + '</span>';
      sfx(won ? 'cash' : 'deny');
      refreshBalanceEverywhere(d.balance);
    } catch (e) { out.textContent = 'Connection error.'; }
  }

  async function playBlackjack() {
    var bet = parseFloat($('p6BjBet').value) || 0;
    var out = $('p6BjResult');
    try {
      var d = await post('/api/game/casino/play', { game: 'blackjack_quick', bet: bet });
      if (!d.success) { out.innerHTML = '<span class="p6-lose">' + esc(d.msg || 'Bet rejected.') + '</span>'; sfx('deny'); return; }
      var det = d.detail;
      var label = det.push ? 'PUSH (stake returned)' : (det.won ? 'WIN +' + money(d.net) : 'Lost ' + money(bet));
      out.innerHTML = 'You: <b>' + det.player_total + '</b> vs House: <b>' + det.house_total + '</b> - ' +
        '<span class="' + (det.push ? '' : (det.won ? 'p6-win' : 'p6-lose')) + '">' + label + '</span>';
      sfx(det.won ? 'cash' : 'deny');
      refreshBalanceEverywhere(d.balance);
    } catch (e) { out.textContent = 'Connection error.'; }
  }

  /* =================================================================
   * 2. STAFF - named candidates with a benefit, roster with fire, morale,
   *    a talk-to-employee composer, and the vacation-request inbox.
   * ================================================================= */

  var STAFF = { candidates: [], roster: [], vacations: [], talkTarget: null };

  function staffView() {
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">STAFF OFFICE</div>' +
        '<span style="font-size:11px;color:var(--pixel-cyan);">Weekly overhead: <span id="p6StaffBills">$0.00</span></span></div>' +
        '<div style="font-size:11px;color:#5c7a99;line-height:1.7;">' +
          'Every hire is a named person with one concrete benefit - passive income, cheaper ' +
          'bills, a boss-mood cushion, or better odds on deals. Fire from the roster any time; ' +
          'ignore a vacation request too often and morale (and their output) will show it.' +
        '</div>' +
      '</div>' +
      '<div class="game-dashboard-grid p6-two">' +
        '<div class="terminal-panel">' +
          '<div class="panel-header"><div class="panel-heading-title">CANDIDATES</div>' +
          '<button class="terminal-btn" style="font-size:10px;" onclick="AstraP6.loadStaff()">REFRESH</button></div>' +
          '<div id="p6Candidates" style="font-size:12px;color:#888;">Loading...</div>' +
        '</div>' +
        '<div class="terminal-panel">' +
          '<div class="panel-header"><div class="panel-heading-title">ROSTER</div></div>' +
          '<div id="p6Roster" style="font-size:12px;color:#888;">Loading...</div>' +
        '</div>' +
      '</div>' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">VACATION REQUESTS</div></div>' +
        '<div id="p6Vacations" style="font-size:12px;color:#888;">Loading...</div>' +
      '</div>' +
      '<div class="terminal-panel" id="p6TalkPanel" style="display:none;">' +
        '<div class="panel-header"><div class="panel-heading-title">MESSAGE: <span id="p6TalkName"></span></div>' +
        '<button class="terminal-btn" style="font-size:10px;" onclick="AstraP6.closeTalk()">CLOSE</button></div>' +
        '<div id="p6TalkLog" style="background:#000;border:1px solid var(--border-color);height:140px;overflow-y:auto;padding:8px;font-size:11.5px;color:#fff;"></div>' +
        '<div style="display:flex;gap:6px;margin-top:6px;">' +
          '<input type="text" id="p6TalkInput" class="d-input" placeholder="Say something..." style="flex-grow:1;" onkeydown="if(event.key===\'Enter\') AstraP6.sendTalk()">' +
          '<button class="terminal-btn btn-action" onclick="AstraP6.sendTalk()">SEND</button>' +
        '</div>' +
      '</div>';
  }

  async function loadStaff() {
    try {
      var d = await api('/api/game/employees/candidates');
      if (!d.success) return;
      STAFF.candidates = d.candidates || [];
      STAFF.roster = d.roster || [];
      $('p6StaffBills').textContent = money(d.weekly_bills);
      renderCandidates();
      renderRoster();
    } catch (e) {}
    loadVacations();
  }

  function renderCandidates() {
    var host = $('p6Candidates');
    if (!host) return;
    if (!STAFF.candidates.length) { host.innerHTML = '<div style="color:#888;">No candidates right now - refresh.</div>'; return; }
    host.innerHTML = STAFF.candidates.map(function (c) {
      return '<div class="p6-card">' +
        '<div class="p6-row"><b>' + esc(c.name) + '</b><span class="p6-k">' + esc(c.role) + '</span></div>' +
        '<div class="p6-row"><span>' + money(c.salary) + '/wk</span><span style="color:var(--pixel-cyan);">' + esc(c.benefit_desc) + '</span></div>' +
        '<div class="p6-row"><span class="p6-k">Trait: ' + esc(c.trait) + '</span>' +
        '<button class="terminal-btn btn-start" style="font-size:10px;" onclick="AstraP6.hire(\'' + jsStr(c.cand_id) + '\')">HIRE</button></div>' +
      '</div>';
    }).join('');
  }

  function renderRoster() {
    var host = $('p6Roster');
    if (!host) return;
    if (!STAFF.roster.length) { host.innerHTML = '<div style="color:#888;">No staff hired yet.</div>'; return; }
    host.innerHTML = STAFF.roster.map(function (e) {
      var morale = e.morale != null ? e.morale : 80;
      var moraleColor = morale >= 60 ? 'var(--pixel-cyan)' : (morale >= 30 ? 'var(--pixel-yellow)' : 'var(--pixel-red)');
      return '<div class="p6-card">' +
        '<div class="p6-row"><b>' + esc(e.name || e.role) + '</b><span class="p6-k">' + esc(e.role) + '</span></div>' +
        '<div class="p6-row"><span>' + money(e.salary) + '/wk</span><span style="color:var(--pixel-cyan);">' + esc(e.benefit_desc || '') + '</span></div>' +
        '<div class="p6-row"><span class="p6-k">MORALE</span>' +
          '<div style="flex:1;margin:0 8px;" class="p6-bar"><i style="width:' + morale + '%;background:' + moraleColor + ';"></i></div>' +
          '<span style="font-size:10px;color:' + moraleColor + ';">' + morale + '</span></div>' +
        '<div class="p6-row">' +
          '<button class="terminal-btn" style="font-size:10px;" onclick="AstraP6.openTalk(' + e.id + ',\'' + jsStr(e.name || e.role) + '\')">MESSAGE</button>' +
          '<button class="terminal-btn btn-warning" style="font-size:10px;" onclick="AstraP6.fire(' + e.id + ')">[\u2715] FIRE</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  async function hire(candId) {
    var c = STAFF.candidates.find(function (x) { return x.cand_id === candId; });
    if (!c) return;
    try {
      var d = await post('/api/game/employees/hire_named', c);
      if (!d.success) { alert(d.msg || 'Could not hire.'); sfx('deny'); return; }
      sfx('cash');
      refreshBalanceEverywhere(d.balance);
      $('p6StaffBills').textContent = money(d.weekly_bills);
      STAFF.candidates = STAFF.candidates.filter(function (x) { return x.cand_id !== candId; });
      STAFF.roster = d.employees;
      renderCandidates(); renderRoster();
    } catch (e) { sfx('error'); }
  }

  async function fire(id) {
    if (!confirm('Let this person go?')) return;
    try {
      var d = await post('/api/game/fire_employee', { id: id });
      if (!d.success) { alert(d.msg || 'Could not fire.'); return; }
      sfx('deny');
      STAFF.roster = d.employees;
      $('p6StaffBills').textContent = money(d.weekly_bills);
      renderRoster();
    } catch (e) {}
  }

  function openTalk(id, name) {
    STAFF.talkTarget = id;
    $('p6TalkName').textContent = name;
    $('p6TalkPanel').style.display = '';
    $('p6TalkLog').innerHTML = '<div style="color:#5c7a99;">Say something to ' + esc(name) + '.</div>';
  }

  function closeTalk() { STAFF.talkTarget = null; $('p6TalkPanel').style.display = 'none'; }

  async function sendTalk() {
    var input = $('p6TalkInput');
    var msg = (input.value || '').trim();
    if (!msg || !STAFF.talkTarget) return;
    var log = $('p6TalkLog');
    log.innerHTML += '<div style="text-align:right;color:var(--pixel-cyan);margin:4px 0;">' + esc(msg) + '</div>';
    input.value = '';
    log.scrollTop = log.scrollHeight;
    try {
      var d = await post('/api/game/employees/talk', { id: STAFF.talkTarget, message: msg });
      var reply = d.success ? d.reply : (d.msg || 'No reply.');
      log.innerHTML += '<div class="p6-msg" style="margin:4px 0;">' + esc(reply) + speakBtn(reply) + '</div>';
      log.scrollTop = log.scrollHeight;
      autoSpeak(reply);
    } catch (e) {}
  }

  async function loadVacations() {
    var host = $('p6Vacations');
    try {
      var d = await api('/api/game/vacation/list');
      if (!d.success) return;
      STAFF.vacations = d.requests || [];
      var pending = STAFF.vacations.filter(function (r) { return r.status === 'pending'; });
      if (!host) return;
      if (!pending.length) { host.innerHTML = '<div style="color:#888;">No pending requests.</div>'; return; }
      host.innerHTML = pending.map(function (r) {
        return '<div class="p6-card">' +
          '<div class="p6-row"><b>' + esc(r.employee_name) + '</b><span class="p6-k">' + esc(r.role) + '</span></div>' +
          '<div class="p6-msg">' + esc(r.message) + speakBtn(r.message) + '</div>' +
          '<div class="p6-row" style="margin-top:6px;">' +
            '<button class="terminal-btn btn-start" style="font-size:10px;" onclick="AstraP6.vacationRespond(' + r.id + ',\'approve_paid\')">APPROVE PAID</button>' +
            '<button class="terminal-btn" style="font-size:10px;" onclick="AstraP6.vacationRespond(' + r.id + ',\'approve_unpaid\')">APPROVE UNPAID</button>' +
            '<button class="terminal-btn btn-warning" style="font-size:10px;" onclick="AstraP6.vacationRespond(' + r.id + ',\'deny\')">DENY</button>' +
          '</div>' +
        '</div>';
      }).join('');
      pending.forEach(function (r) { if (!r._spoken) { autoSpeak(r.message); r._spoken = true; } });
    } catch (e) {}
  }

  async function vacationRespond(id, decision) {
    try {
      var d = await post('/api/game/vacation/respond', { id: id, decision: decision });
      if (!d.success) { alert(d.msg || 'Could not resolve.'); return; }
      sfx(decision === 'deny' ? 'deny' : 'unlock');
      refreshBalanceEverywhere(d.balance);
      STAFF.roster = d.employees;
      renderRoster();
      loadVacations();
    } catch (e) {}
  }

  /* =================================================================
   * 3. TASKS - boss assignments with a per-kind solving UI. Grading is
   *    entirely server-side; the frontend never has the answer.
   * ================================================================= */

  var TASKS = { active: [], history: [] };

  function tasksView() {
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">BOSS ASSIGNMENTS</div>' +
        '<button class="terminal-btn" style="font-size:10px;" onclick="AstraP6.loadTasks()">REFRESH</button></div>' +
        '<div style="font-size:11px;color:#5c7a99;line-height:1.7;">' +
          'Occasional tasks from the boss, on top of your regular targets. Pass one for a cash ' +
          'bonus and a mood boost; fail or ignore one and both take a hit.' +
        '</div>' +
      '</div>' +
      '<div id="p6Tasks" style="font-size:12px;color:#888;">Loading...</div>' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">RECENT HISTORY</div></div>' +
        '<div id="p6TaskHistory" style="font-size:11px;color:#888;">Nothing yet.</div>' +
      '</div>';
  }

  async function loadTasks() {
    try {
      var d = await api('/api/game/assignments');
      if (!d.success) return;
      TASKS.active = d.assignments || [];
      TASKS.history = d.history || [];
      renderTasks();
      renderTaskHistory();
    } catch (e) {}
  }

  function renderTaskHistory() {
    var host = $('p6TaskHistory');
    if (!host) return;
    if (!TASKS.history.length) { host.innerHTML = '<div style="color:#888;">Nothing yet.</div>'; return; }
    host.innerHTML = TASKS.history.slice().reverse().map(function (h) {
      var cls = h.status === 'passed' ? 'p6-win' : 'p6-lose';
      return '<div class="p6-row"><span>' + esc(h.title) + ' (Day ' + h.day + ')</span>' +
        '<span class="' + cls + '">' + h.status.toUpperCase() + ' ' + (h.delta >= 0 ? '+' : '') + h.delta + '</span></div>';
    }).join('');
  }

  function renderTasks() {
    var host = $('p6Tasks');
    if (!host) return;
    if (!TASKS.active.length) { host.innerHTML = '<div class="terminal-panel" style="color:#888;">No active assignment. Check back after advancing a day.</div>'; return; }
    host.innerHTML = TASKS.active.map(renderOneTask).join('');
    TASKS.active.forEach(function (a) { if (!a._spoken) { autoSpeak(a.brief); a._spoken = true; } });
  }

  function renderOneTask(a) {
    var body = '';
    if (a.kind === 'reconcile') {
      body = '<div style="font-size:11px;color:#5c7a99;margin-bottom:6px;">Reported total: <b style="color:#fff;">' + money(a.reported_total) + '</b>. Which figure below is wrong?</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
        a.numbers.map(function (n, i) {
          return '<button class="p6-chip" onclick="AstraP6.submitTask(' + a.id + ',' + i + ')">' + money(n) + '</button>';
        }).join('') + '</div>';
    } else if (a.kind === 'spot_the_error') {
      body = '<div style="font-size:11px;color:#5c7a99;margin-bottom:6px;">One symbol below isn\'t in today\'s market. Flag it.</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
        a.rows.map(function (r, i) {
          return '<button class="p6-chip" onclick="AstraP6.submitTask(' + a.id + ',' + i + ')">' + esc(r.symbol) + ' x' + r.qty + '</button>';
        }).join('') + '</div>';
    } else if (a.kind === 'compliance_quiz') {
      body = '<div id="p6Quiz' + a.id + '">' + a.questions.map(function (q, qi) {
        return '<div style="margin-bottom:8px;">' +
          '<div style="font-size:11px;color:#ddd;margin-bottom:4px;">' + (qi + 1) + '. ' + esc(q.q) + '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
          q.options.map(function (opt, oi) {
            return '<button class="p6-chip" data-q="' + qi + '" onclick="AstraP6.quizPick(' + a.id + ',' + qi + ',' + oi + ',this)">' + esc(opt) + '</button>';
          }).join('') + '</div></div>';
      }).join('') + '<button class="terminal-btn btn-action" onclick="AstraP6.submitQuiz(' + a.id + ')">SUBMIT QUIZ</button>' +
      '</div>';
    } else if (a.kind === 'cold_call_sprint') {
      body = '<div style="font-size:11px;color:#5c7a99;margin-bottom:6px;">' +
        'Pitch at least ' + a.target_pitches + ' clients from the BROKER SIMULATOR call screen, then report back here.</div>' +
        '<button class="terminal-btn btn-action" onclick="AstraP6.submitTask(' + a.id + ',' + a.target_pitches + ')">REPORT PITCHES DONE</button>';
    }
    return '<div class="terminal-panel">' +
      '<div class="panel-header"><div class="panel-heading-title">' + esc(a.title) + '</div>' +
      '<span style="font-size:10px;color:var(--pixel-yellow);">Reward ' + money(a.reward) + ' / Penalty ' + money(a.penalty) + '</span></div>' +
      '<div class="p6-msg" style="margin-bottom:8px;">' + esc(a.brief) + speakBtn(a.brief) + '</div>' +
      body +
      '<div id="p6TaskResult' + a.id + '" style="font-size:11px;margin-top:8px;"></div>' +
    '</div>';
  }

  var quizAnswers = {};

  function quizPick(aid, qi, oi, btn) {
    quizAnswers[aid] = quizAnswers[aid] || {};
    quizAnswers[aid][qi] = oi;
    var siblings = btn.parentNode.querySelectorAll('[data-q="' + qi + '"]');
    siblings.forEach(function (s) { s.classList.remove('sel'); });
    btn.classList.add('sel');
  }

  async function submitQuiz(aid) {
    var task = TASKS.active.find(function (a) { return a.id === aid; });
    if (!task) return;
    var answers = quizAnswers[aid] || {};
    var arr = task.questions.map(function (_, qi) { return answers[qi] != null ? answers[qi] : -1; });
    await submitTask(aid, arr);
  }

  async function submitTask(aid, answer) {
    try {
      var d = await post('/api/game/assignments/submit', { id: aid, answer: answer });
      if (!d.success) { alert(d.msg || 'Could not submit.'); return; }
      sfx(d.correct ? 'cash' : 'deny');
      refreshBalanceEverywhere(d.balance);
      var out = $('p6TaskResult' + aid);
      if (out) out.innerHTML = '<span class="' + (d.correct ? 'p6-win' : 'p6-lose') + '">' +
        (d.correct ? 'PASSED' : 'FAILED') + ' (' + (d.delta >= 0 ? '+' : '') + money(d.delta) + ')</span>';
      setTimeout(loadTasks, 1400);
    } catch (e) {}
  }

  /* =================================================================
   * 4. INVESTOR INBOX - unsolicited, detailed AI messages from clients,
   *    separate from the live phone-call flow.
   * ================================================================= */

  var INBOX = { items: [] };

  function investorsView() {
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">INVESTOR INBOX</div>' +
        '<button class="terminal-btn" style="font-size:10px;" onclick="AstraP6.loadInbox()">REFRESH</button></div>' +
        '<div style="font-size:11px;color:#5c7a99;line-height:1.7;">' +
          'Written questions from clients, separate from live calls. A real, specific answer can ' +
          'still close the deal - a dodge will not.' +
        '</div>' +
      '</div>' +
      '<div id="p6Inbox" style="font-size:12px;color:#888;">Loading...</div>';
  }

  async function loadInbox() {
    var host = $('p6Inbox');
    try {
      var d = await api('/api/game/investors/inbox');
      if (!d.success) return;
      INBOX.items = d.inbox || [];
      if (!host) return;
      if (!INBOX.items.length) { host.innerHTML = '<div class="terminal-panel" style="color:#888;">Nothing in the inbox right now.</div>'; return; }
      host.innerHTML = INBOX.items.slice().reverse().map(renderInboxItem).join('');
      INBOX.items.forEach(function (m) { if (m.status === 'pending' && !m._spoken) { autoSpeak(m.message); m._spoken = true; } });
    } catch (e) {}
  }

  function renderInboxItem(m) {
    if (m.status === 'pending') {
      return '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">' + esc(m.client_name) + '</div></div>' +
        '<div class="p6-msg" style="margin-bottom:8px;">' + esc(m.message) + speakBtn(m.message) + '</div>' +
        '<div style="display:flex;gap:6px;">' +
          '<input type="text" id="p6Reply' + m.id + '" class="d-input" placeholder="Your reply..." style="flex-grow:1;">' +
          '<button class="terminal-btn btn-action" onclick="AstraP6.replyInbox(' + m.id + ')">SEND</button>' +
        '</div>' +
      '</div>';
    }
    var invested = m.invested;
    return '<div class="terminal-panel" style="opacity:.85;">' +
      '<div class="panel-header"><div class="panel-heading-title">' + esc(m.client_name) + '</div>' +
      '<span class="' + (invested ? 'p6-win' : 'p6-lose') + '" style="font-size:10px;">' + (invested ? 'INVESTED' : 'DECLINED') + '</span></div>' +
      '<div class="p6-msg" style="color:#888;margin-bottom:4px;">You: ' + esc(m.message) + '</div>' +
      '<div class="p6-msg">' + esc(m.reply) + '</div>' +
      (invested ? '<div class="p6-win" style="font-size:11px;margin-top:4px;">Commission: +' + money(m.commission) + '</div>' : '') +
    '</div>';
  }

  async function replyInbox(id) {
    var input = $('p6Reply' + id);
    var msg = (input.value || '').trim();
    if (!msg) return;
    try {
      var d = await post('/api/game/investors/reply', { id: id, message: msg });
      if (!d.success) { alert(d.msg || 'Could not send.'); return; }
      sfx(d.invests ? 'cash' : 'deny');
      refreshBalanceEverywhere(d.balance);
      loadInbox();
    } catch (e) {}
  }

  /* =================================================================
   * Boot
   * ================================================================= */

  var booted = false;

  async function boot() {
    if (booted) return;
    booted = true;
    injectStyles();

    addView('casino', casinoView());
    addView('staff', staffView());
    addView('tasks', tasksView());
    addView('investors', investorsView());
    addNavButton('casino', '[\u2660] CASINO');
    addNavButton('staff', '[\u2691] STAFF');
    addNavButton('tasks', '[\u2699] TASKS');
    addNavButton('investors', '[\u2709] INVESTOR INBOX');
    mountVoiceToggle();

    if (window.applyLanguage && window.currentLang) window.applyLanguage(window.currentLang);

    var origSwitch = window.switchView;
    if (typeof origSwitch === 'function') {
      window.switchView = function (name) {
        var r = origSwitch.apply(this, arguments);
        if (name === 'casino') loadCasino();
        if (name === 'staff') loadStaff();
        if (name === 'tasks') loadTasks();
        if (name === 'investors') loadInbox();
        return r;
      };
    }
  }

  window.AstraP6 = {
    speak: speak,
    playSlots: playSlots, pickCoin: pickCoin, playCoin: playCoin,
    pickDice: pickDice, playDice: playDice, playBlackjack: playBlackjack,
    loadStaff: loadStaff, hire: hire, fire: fire,
    openTalk: openTalk, closeTalk: closeTalk, sendTalk: sendTalk,
    vacationRespond: vacationRespond,
    loadTasks: loadTasks, submitTask: submitTask, quizPick: quizPick, submitQuiz: submitQuiz,
    loadInbox: loadInbox, replyInbox: replyInbox
  };

  window.addEventListener('astrax:ready', boot);
  setTimeout(boot, 6500);
})();
