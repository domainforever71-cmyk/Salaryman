/* ===========================================================================
 * astra_consolidate.js - Stage 7 pass, partially superseded in Stage 10.
 *
 * Originally three jobs, none of which touch game logic:
 *
 *   1. NAVIGATION CONSOLIDATION. Phase 5/6 each bolted on their own top-level
 *      tab, so this used to fold DASHBOARD / MARKETS / OMNI-BOTS / CASINO /
 *      STAFF / TASKS / INVESTORS / EXCHANGE / CALC / BANK into sub-tab pills
 *      inside one BROKER SIMULATOR view, to keep the (pre-WinOS) flat nav bar
 *      from growing to nine buttons.
 *
 *      Stage 10 removes this job on purpose. astra_winos.js's desktop shell
 *      is the real navigation surface now - every app already has its own
 *      icon glyph, category accent, and Start-menu tile defined in
 *      APP_META/ICONS there. Folding ten of those apps back into one "NEW
 *      GAME" window just to save desktop-icon count fights the window
 *      manager's own design instead of using it: the desktop already
 *      supports far more than nine icons (icons wrap into columns, and the
 *      Start menu has search plus a pinned show-more/less collapse), so
 *      there's no real crowding problem left to solve by hiding apps.
 *      Un-hiding these nav buttons is what lets astra_winos.js's
 *      discoverApps() see them and give each one its own draggable window
 *      and desktop icon again, per the operator's request to fragment the
 *      "NEW GAME" tab back out into separate apps. Nothing about the views
 *      themselves changes - same DOM nodes, same backend calls - only which
 *      script decides how they're presented.
 *   2. DEDUPLICATION. The side-drawer's old raw "type a role and a salary"
 *      hire box duplicated the named-candidate Staff office added in phase 6.
 *      That box was replaced in index.html; this file has nothing to do
 *      there, it's mentioned for context.
 *   3. CRT-BEZEL CHROME + a first hook for a future lowpoly-3D pass. Purely
 *      decorative additions layered on top of the existing cyan/dark theme -
 *      no colors are changed, nothing here is yellow. Still active.
 *
 * Loads last, after astra_extras/phase5/phase6, and before astra_winos.js.
 * Does not touch executeTrade, advanceGameDay or sendOmniConsole (index.html's
 * integrity check snapshots exactly those three off astrax:ready).
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  /* =====================================================================
   * 1. SUB-NAV CONSOLIDATION
   * ===================================================================== */

  // Every one of these used to be its own top-level tab. They now render
  // as sub-tabs of BROKER SIMULATOR. Order here is the order of the pills.
  var GAME_GROUP = [
    { id: 'game',      label: 'TRADING DESK' },
    { id: 'dashboard', label: 'OVERVIEW' },
    { id: 'markets',   label: 'MARKETS' },
    { id: 'bots',      label: 'OMNI-BOTS' },
    { id: 'casino',    label: 'CASINO' },
    { id: 'staff',     label: 'STAFF' },
    { id: 'tasks',     label: 'ASSIGNMENTS' },
    { id: 'investors', label: 'INVESTORS' },
    { id: 'exchange',  label: 'EXCHANGE' },
    { id: 'calc',      label: 'MINING CALC' },
    { id: 'bank',      label: 'BANK' }
  ];
  var GAME_IDS = GAME_GROUP.map(function (g) { return g.id; });
  var lastGameSub = 'game';
  var subnavEl = null;

  function requiredNodesPresent() {
    // Wait for phase5 + phase6 to have actually built their views/nav
    // buttons before we touch anything - both boot async off the same
    // astrax:ready event, so there's no guaranteed order between them.
    return GAME_IDS.every(function (id) { return $('view-' + id); }) &&
           $('nav-game');
  }

  function buildSubnav() {
    if (subnavEl) return;
    var header = document.querySelector('header');
    if (!header) return;
    subnavEl = document.createElement('div');
    subnavEl.id = 'simSubnav';
    subnavEl.className = 'sim-subnav';
    subnavEl.innerHTML = GAME_GROUP.map(function (g) {
      return '<button class="sim-subtab" id="simsub-' + g.id + '" data-target="' + g.id + '">' +
             g.label + '</button>';
    }).join('');
    header.parentNode.insertBefore(subnavEl, header.nextSibling);
    subnavEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.sim-subtab');
      if (!btn) return;
      window.switchView(btn.getAttribute('data-target'));
    });
  }

  function highlightSubtab(name) {
    if (!subnavEl) return;
    var buttons = subnavEl.querySelectorAll('.sim-subtab');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].getAttribute('data-target') === name);
    }
  }

  function hideTopNavButton(id) {
    var btn = $('nav-' + id);
    if (btn) btn.style.display = 'none';
  }

  function wireConsolidation() {
    // Stage 10: fragmented back out. This used to call buildSubnav(), hide
    // nav-dashboard/markets/bots/casino/staff/tasks/investors/exchange/calc/
    // bank, and re-point nav-game at a "last sub-tab" pill row. All of that
    // is deliberately switched off now so those ten nav-<id> buttons stay
    // visible, which is what lets astra_winos.js's discoverApps() treat each
    // one as its own desktop app/window again instead of a tab buried inside
    // "NEW GAME". GAME_GROUP/GAME_IDS are kept above only as a record of
    // which ids used to be folded together, in case a future pass wants to
    // group them into a desktop "folder" instead of flat icons.
  }

  /* =====================================================================
   * 2. CRT-BEZEL CHROME
   * ===================================================================== */

  function injectBezelStyles() {
    var css = document.createElement('style');
    css.textContent = [
      /* --- sub-nav pill row --- */
      '.sim-subnav{display:none;gap:6px;flex-wrap:wrap;padding:8px 22px;',
      'background:#000;border-bottom:1px solid var(--border-color);}',
      '.sim-subtab{background:#000;border:1px solid var(--border-color);color:var(--text-main);',
      'font-family:inherit;font-size:10.5px;letter-spacing:.5px;padding:6px 11px;cursor:pointer;}',
      '.sim-subtab:hover{border-color:var(--pixel-cyan);color:#fff;}',
      '.sim-subtab.active{background:rgba(0,255,204,.12);border-color:var(--pixel-cyan);color:var(--pixel-cyan);}',

      /* --- old fat CRT PC: bezel, vents, scanlines, vignette, flicker --- */
      'html,body{background:#050505;}',
      '#crtChassis{position:fixed;inset:0;pointer-events:none;z-index:99998;}',
      '#crtChassis .crt-corner{position:absolute;width:34px;height:34px;border:2px solid rgba(115,165,201,.35);}',
      '#crtChassis .crt-tl{top:6px;left:6px;border-right:none;border-bottom:none;}',
      '#crtChassis .crt-tr{top:6px;right:6px;border-left:none;border-bottom:none;}',
      '#crtChassis .crt-bl{bottom:6px;left:6px;border-right:none;border-top:none;}',
      '#crtChassis .crt-br{bottom:6px;right:6px;border-left:none;border-top:none;}',
      '#crtChassis .crt-hud{position:absolute;top:10px;left:50px;right:50px;display:flex;',
      'justify-content:space-between;font-size:9.5px;letter-spacing:1.5px;color:rgba(115,165,201,.55);}',
      '#crtChassis .crt-hud span{background:rgba(1,3,6,.4);padding:2px 6px;}',
      '#crtChassis .crt-vignette{position:absolute;inset:0;',
      'box-shadow:inset 0 0 140px 40px rgba(0,0,0,.75);}',
      '#crtChassis .crt-scan{position:absolute;inset:0;opacity:.05;',
      'background:repeating-linear-gradient(0deg,#000 0px,#000 1px,transparent 1px,transparent 3px);}',
      '#crtChassis .crt-flicker{position:absolute;inset:0;background:#fff;opacity:0;',
      'animation:crtFlicker 7s infinite;}',
      '@keyframes crtFlicker{0%,96%,100%{opacity:0;}97%{opacity:.015;}98%{opacity:0;}99%{opacity:.025;}}',
    ].join('');
    document.head.appendChild(css);
  }

  function buildBezel() {
    if ($('crtChassis')) return;
    var wrap = document.createElement('div');
    wrap.id = 'crtChassis';
    wrap.innerHTML =
      '<div class="crt-corner crt-tl"></div><div class="crt-corner crt-tr"></div>' +
      '<div class="crt-corner crt-bl"></div><div class="crt-corner crt-br"></div>' +
      '<div class="crt-hud"><span id="crtHudLeft">CHANNEL: SECURE</span>' +
      '<span id="crtHudRight">SIGNAL \u2588\u2588\u2588\u2591</span></div>' +
      '<div class="crt-scan"></div><div class="crt-flicker"></div><div class="crt-vignette"></div>';
    document.body.appendChild(wrap);

    // Not just decoration - the HUD reflects something real: whether the
    // AI layer (OpenAI/OpenRouter) is actually connected right now.
    fetch('/api/status').then(function (r) { return r.json(); }).then(function (d) {
      var right = $('crtHudRight');
      if (right && typeof d.ai_live !== 'undefined') {
        right.textContent = d.ai_live ? 'SIGNAL \u2588\u2588\u2588\u2588' : 'SIGNAL \u2588\u2591\u2591\u2591';
      }
    }).catch(function () {});
  }

  /* =====================================================================
   * 3. LOWPOLY-3D READINESS HOOK
   *
   * Not a 3D game yet - one small, real, working proof that the pipeline
   * is there: a lowpoly Three.js mesh rendered into a canvas panel, loaded
   * from the same pinned-version UMD build a full 3D pass would use later.
   * window.Astra3D.mount(container) is the seam - point a future office /
   * avatar / trading-floor scene at any container through this same call
   * instead of writing bespoke Three.js bootstrapping per view.
   * ===================================================================== */

  var THREE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  var threeLoading = null;

  function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (threeLoading) return threeLoading;
    threeLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = THREE_SRC;
      s.onload = function () { resolve(window.THREE); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return threeLoading;
  }

  window.Astra3D = {
    /* Mounts a small rotating lowpoly icosahedron "terminal core" into
     * `container`. Returns a {stop} handle. Silently no-ops on failure -
     * this is a cosmetic groundwork piece, never a hard dependency. */
    mount: function (container, opts) {
      opts = opts || {};
      var handle = { stop: function () {} };
      if (!container) return handle;
      loadThree().then(function (THREE) {
        if (!THREE || !container.isConnected) return;
        var w = container.clientWidth || 160, h = container.clientHeight || 160;
        var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(w, h);
        container.innerHTML = '';
        container.appendChild(renderer.domElement);

        var scene = new THREE.Scene();
        var camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
        camera.position.z = 3.2;

        var geo = new THREE.IcosahedronGeometry(1, 0); // lowpoly on purpose
        var mat = new THREE.MeshBasicMaterial({
          color: opts.color || 0x00ffcc, wireframe: true,
        });
        var mesh = new THREE.Mesh(geo, mat);
        // Three.js's default IcosahedronGeometry orientation points a vertex
        // down, which reads as an upside-down pentagon face-on. Flip it to a
        // vertex-up starting pose; it still spins continuously from here.
        mesh.rotation.z = Math.PI;
        scene.add(mesh);

        var raf = null;
        var stopped = false;
        function tick() {
          if (stopped) return;
          mesh.rotation.x += 0.006;
          mesh.rotation.y += 0.009;
          renderer.render(scene, camera);
          raf = requestAnimationFrame(tick);
        }
        tick();

        handle.stop = function () {
          stopped = true;
          if (raf) cancelAnimationFrame(raf);
          renderer.dispose();
        };
      }).catch(function () { /* no WebGL / offline CDN - leave container empty */ });
      return handle;
    }
  };

  function mountProfile3D() {
    // Profile is a good first home for this: low-traffic view, and it
    // already has a card layout with room for one more small panel. Wait
    // for the profile view to exist (astra_extras builds it) and for it to
    // actually be opened once, rather than paying the Three.js download on
    // every session regardless of whether the tab is ever visited.
    var origSwitch = window.switchView;
    window.switchView = function (name) {
      var r = origSwitch(name);
      if (name === 'profile') {
        var host = $('astra3dProfileMount');
        if (!host) {
          var panel = document.querySelector('#view-profile .terminal-panel, #view-profile');
          if (panel) {
            host = document.createElement('div');
            host.id = 'astra3dProfileMount';
            host.style.cssText = 'width:100%;height:160px;margin-top:10px;border:1px solid var(--border-color);';
            var label = document.createElement('div');
            label.style.cssText = 'font-size:9.5px;color:#556b85;margin-top:4px;';
            label.textContent = '3D groundwork preview \u2014 early scaffold for a future lowpoly build.';
            panel.appendChild(host);
            panel.appendChild(label);
          }
        }
        if (host && !host.dataset.mounted) {
          host.dataset.mounted = '1';
          window.Astra3D.mount(host);
        }
      }
      return r;
    };
  }

  /* =====================================================================
   * Boot
   * ===================================================================== */

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    injectBezelStyles();
    buildBezel();
    wireConsolidation();
    mountProfile3D();
    if (window.applyLanguage && window.currentLang) window.applyLanguage(window.currentLang);
  }

  function waitAndBoot(triesLeft) {
    if (requiredNodesPresent()) { boot(); return; }
    if (triesLeft <= 0) { boot(); return; } // boot anyway - degrades gracefully
    setTimeout(function () { waitAndBoot(triesLeft - 1); }, 150);
  }

  window.addEventListener('astrax:ready', function () { waitAndBoot(40); });
  setTimeout(function () { waitAndBoot(1); }, 8000); // last-resort fallback
})();
