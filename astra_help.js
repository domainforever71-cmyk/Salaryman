(function () {
  "use strict";
  if (window.__astraHelp) return; window.__astraHelp = true;
  var KEY = "astra_help_seen_v1";
  var CSS = "#astraHelpBtn{position:fixed;left:10px;bottom:56px;z-index:99990;width:34px;height:34px;border-radius:50%;border:1px solid #00ffcc;background:#061116;color:#00ffcc;font:bold 18px monospace;cursor:pointer;box-shadow:0 0 10px rgba(0,255,204,.35)}" +
    "#astraHelpBtn:hover{background:#00ffcc;color:#000}" +
    "#astraHelpOv{position:fixed;inset:0;z-index:99991;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:12px}" +
    "#astraHelpWin{max-width:640px;width:100%;max-height:88vh;overflow:auto;background:#05090d;border:1px solid #00ffcc;color:#d7e3ea;font:15px/1.5 'Share Tech Mono',monospace;padding:16px 20px;box-shadow:0 0 30px rgba(0,255,204,.25)}" +
    "#astraHelpWin h2{margin:0 0 8px;color:#00ffcc;font-size:20px}#astraHelpWin h3{margin:14px 0 4px;color:#ffbb00;font-size:15px}" +
    "#astraHelpWin ul{margin:0;padding-left:18px}#astraHelpWin li{margin-bottom:3px}" +
    "#astraHelpWin button{margin-top:14px;padding:6px 14px;background:#061116;color:#00ffcc;border:1px solid #00ffcc;font:inherit;cursor:pointer}";
  var HTML = "<h2>HOW TO PLAY</h2>" +
    "<h3>1. Create an account and start a career</h3><ul><li>Register on the login screen, then open the Broker Simulator / Career app and start a career. You begin unemployed - apply for a job (or found a company) to unlock more apps.</li></ul>" +
    "<h3>2. Earn and manage money</h3><ul><li>Salaries are paid per in-game day. Use the Work Desk to clock in to shifts, the Bank / Wallet for savings and currencies, and Markets / Stock Desk to invest.</li><li>Keep an eye on your Career HUD: wallet, health and hunger are shared with the Maps app.</li></ul>" +
    "<h3>3. Maps &amp; daily needs</h3><ul><li>Open MAPS to walk, drive or take a taxi around Astra City. Hunger falls over time - buy food at FreshMart or Pixel Plate Diner, heal at the City Clinic.</li><li>Driving: W/Up accelerate, S/Down brake, A D / arrows steer (on-screen buttons on phones). Avoid traffic - crashes cost health and money.</li></ul>" +
    "<h3>4. Play with others</h3><ul><li>Messages, friend requests, trades and hiring offers arrive live with a pop-up - no refresh needed.</li><li>The badge at the top-right shows your ping. Click it to see every server and join a faster one.</li></ul>" +
    "<h3>5. Tips</h3><ul><li>Your progress saves automatically to your account.</li><li>If something looks stuck, reload the page - trips and saves are recovered from the server.</li><li>Press <b>?</b> (the round button, bottom-left) any time to see this again.</li></ul>" +
    "<button id=\"astraHelpClose\" type=\"button\">GOT IT</button>";

  function open() {
    if (document.getElementById("astraHelpOv")) return;
    var ov = document.createElement("div"); ov.id = "astraHelpOv";
    ov.innerHTML = "<div id=\"astraHelpWin\" role=\"dialog\" aria-modal=\"true\">" + HTML + "</div>";
    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); document.removeEventListener("keydown", onKey, true); }
    function onKey(e) { if (e.key === "Escape") close(); }
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(ov);
    var b = document.getElementById("astraHelpClose"); if (b) { b.onclick = close; b.focus(); }
  }
  function init() {
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    var btn = document.createElement("button"); btn.id = "astraHelpBtn"; btn.type = "button"; btn.title = "How to play"; btn.setAttribute("aria-label", "How to play"); btn.textContent = "?";
    btn.onclick = open; document.body.appendChild(btn);
    try { if (!localStorage.getItem(KEY)) { localStorage.setItem(KEY, "1"); setTimeout(open, 1500); } } catch (e) {}
  }
  window.AstraHelp = { open: open };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
