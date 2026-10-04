const PLACE_INFO = {
  apartmentsA: { name: "Neon Heights Apartments", kind: "HOME", keywords: "home apartment residential" },
  supermarket: { name: "FreshMart Supermarket", kind: "FOOD", keywords: "groceries market food hunger" },
  restaurant: { name: "Pixel Plate Diner", kind: "RESTAURANT", keywords: "food restaurant meal" },
  workdistrict: { name: "Brokerage Row", kind: "WORK", keywords: "office work business downtown" },
  carshop: { name: "Metro Motors", kind: "CAR SHOP", keywords: "car cars vehicle dealership" },
  hospital: { name: "City Clinic", kind: "HEALTH", keywords: "clinic hospital health" },
  downtown: { name: "Old Town Center", kind: "DOWNTOWN", keywords: "city downtown shops" },
  gasstation: { name: "Highway Fuel", kind: "GAS", keywords: "gas fuel station" },
  apartmentsC: { name: "Harbor Court Apartments", kind: "HOME", keywords: "home apartment residential" },
  parking: { name: "Central Parking", kind: "PARKING", keywords: "parking car park" },
  apartmentsB: { name: "Greenline Flats", kind: "HOME", keywords: "home apartment residential" },
  taxi_stand: { name: "Southside Taxi Stand", kind: "TAXI", keywords: "taxi cab pickup" },
  suburban_house: { name: "Maplewood House", kind: "HOUSE", keywords: "suburb house home residential" },
  highway: { name: "East Loop Highway", kind: "HIGHWAY", keywords: "highway road expressway" }
};
const BLOCK = {
  apartmentsA: [1, 1], supermarket: [3, 2], restaurant: [5, 1], workdistrict: [10, 1],
  carshop: [8, 2], hospital: [1, 3], downtown: [6, 4], gasstation: [10, 4],
  apartmentsC: [3, 5], parking: [5, 6], apartmentsB: [8, 6], taxi_stand: [1, 6],
  suburban_house: [10, 6], highway: [6, 0]
};
let W = 9600, H = 6000;
const P = 300, BS = 264, MAXS = 2.4;
const $ = (id) => document.getElementById(id);
const escapeHTML = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const overlay = $("overlay"), winTitle = $("winTitle"), winBody = $("winBody"), status = $("status"), svg = $("map");
const money = (n) => "$" + Math.round(n).toLocaleString();
const NAMES = Object.fromEntries(Object.entries(PLACE_INFO).map(([id, place]) => [id, place.name]));
const origin = (id) => [BLOCK[id][0] * P + 18, BLOCK[id][1] * P + 18];
const centerOf = (id) => { const [x, y] = origin(id); return [x + BS / 2, y + BS / 2]; };
const DOORS = Object.fromEntries(Object.keys(BLOCK).map((k) => [k, [BLOCK[k][0] * P + 150, BLOCK[k][1] * P]]));
let cityState = null, tripAnimation = null, driveScore = 0.72, driveSpeed = 0, driveResumeSpeed = 1, driveStopped = false;

function openWindow(title, html) { winTitle.textContent = title; winBody.innerHTML = html; overlay.hidden = false; $("winClose").focus(); }
function closeWindow() { overlay.hidden = true; }
$("winClose").onclick = closeWindow;
overlay.addEventListener("click", (e) => { if (e.target === overlay) closeWindow(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeWindow(); });
function renderHUD() {
  if (!cityState) return;
  $("wallet").textContent = money(cityState.balance);
  $("needs").textContent = `HP ${cityState.health}  /  HUNGER ${cityState.hunger}%`;
  $("wallet").title = cityState.career_active ? "Career wallet" : "Start a career to use city services";
}
async function requestState() {
  const response = await fetch("/api/game/city/state");
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.msg || "Unable to load career city data.");
  cityState = data;
  syncBusinesses(data.businesses || []);
  renderHUD();
  updatePlayerMarker();
  return data;
}
async function cityAction(action, values = {}) {
  const response = await fetch("/api/game/city/action", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...values })
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.msg || "Maps action failed.");
  cityState = data;
  syncBusinesses(data.businesses || []);
  renderHUD();
  updatePlayerMarker();
  return data;
}
function showMessage(element, message, good = false) {
  element.textContent = message;
  element.className = good ? "msg good" : "msg";
}

// ---------- rooftop art (top-down, hard shadows) ----------
const TERRA = ["#ee9a6c", "#d4794f", "#b5603e"], GREY = ["#9298a3", "#777d88", "#5d636d"], BROWN = ["#b07a52", "#93613f", "#76492f"], SLATE = ["#7d8aa0", "#66738a", "#4f5b70"];
const sh = (x, y, w, h) => `<rect class="sh" x="${x + 7}" y="${y + 9}" width="${w}" height="${h}" rx="2"/>`;
const poly = (p, c) => `<polygon points="${p.map((q) => q.join(",")).join(" ")}" fill="${c}"/>`;
function hip(x, y, w, h, c) {
  const m = Math.min(w, h) / 2, T = [x, y], R = [x + w, y], B = [x + w, y + h], L = [x, y + h]; let a, b, f;
  if (w >= h) { a = [x + m, y + h / 2]; b = [x + w - m, y + h / 2]; f = poly([T, R, b, a], c[0]) + poly([L, B, b, a], c[2]) + poly([T, L, a], c[1]) + poly([R, B, b], c[2]); }
  else { a = [x + w / 2, y + m]; b = [x + w / 2, y + h - m]; f = poly([T, L, b, a], c[0]) + poly([R, B, b, a], c[2]) + poly([T, R, a], c[1]) + poly([L, B, b], c[2]); }
  return sh(x, y, w, h) + f + `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="rgba(0,0,0,.4)"/><line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="rgba(0,0,0,.35)"/>`;
}
const flat = (x, y, w, h, c) => sh(x, y, w, h) + `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}" stroke="rgba(0,0,0,.45)" stroke-width="2"/><rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" fill="none" stroke="rgba(0,0,0,.18)"/>`;
const ac = (x, y) => `<rect x="${x + 3}" y="${y + 4}" width="14" height="14" fill="rgba(0,0,0,.4)"/><rect x="${x}" y="${y}" width="14" height="14" fill="#cfd3d6" stroke="rgba(0,0,0,.4)"/><circle cx="${x + 7}" cy="${y + 7}" r="4" fill="#8b949c"/>`;
const dormer = (x, y) => `<rect x="${x + 2}" y="${y + 3}" width="13" height="11" fill="rgba(0,0,0,.4)"/><rect x="${x}" y="${y}" width="13" height="11" fill="#efe3cf" stroke="rgba(0,0,0,.45)"/><line x1="${x + 6.5}" y1="${y}" x2="${x + 6.5}" y2="${y + 11}" stroke="rgba(0,0,0,.35)"/>`;
const car = (x, y, col, v) => v
  ? `<rect x="${x + 2}" y="${y + 2}" width="10" height="18" rx="3" fill="rgba(0,0,0,.45)"/><rect x="${x}" y="${y}" width="10" height="18" rx="3" fill="${col}"/><rect x="${x + 2}" y="${y + 5}" width="6" height="8" fill="rgba(0,0,0,.55)"/>`
  : `<rect x="${x + 2}" y="${y + 2}" width="18" height="10" rx="3" fill="rgba(0,0,0,.45)"/><rect x="${x}" y="${y}" width="18" height="10" rx="3" fill="${col}"/><rect x="${x + 5}" y="${y + 2}" width="8" height="6" fill="rgba(0,0,0,.55)"/>`;
const tree = (x, y, r) => `<circle cx="${x + 5}" cy="${y + 6}" r="${r}" fill="rgba(0,0,0,.4)"/><circle cx="${x}" cy="${y}" r="${r}" fill="#5aa83a"/><circle cx="${x - r / 3}" cy="${y - r / 3}" r="${r / 2}" fill="#86cf5c"/>`;
const CC = ["#e0b341", "#3d78c9", "#d9d9d9", "#c2423f", "#8a5bd6", "#00ffcc", "#ff3366"];
const lot = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#14171b" stroke="#000"/>`;

// all art is drawn inside a 264 x 264 block, (0,0) = block corner
const ART = {
  apartmentsA: () => hip(20, 26, 224, 104, TERRA) + hip(20, 120, 104, 110, BROWN) + dormer(44, 34) + dormer(112, 34) + dormer(180, 34) + dormer(36, 140) + tree(190, 196, 14) + tree(222, 222, 11) + car(150, 214, "#3d78c9"),
  apartmentsB: () => flat(16, 24, 232, 170, "#ddd7c5") + flat(28, 36, 44, 34, "#bcb5a2") + ac(100, 40) + ac(134, 40) + ac(190, 40) + ac(210, 150)
    + `<rect x="30" y="100" width="90" height="80" fill="#2f5f9a" stroke="#000" stroke-opacity=".5"/><path d="M30 120H120M30 140H120M30 160H120M60 100V180M90 100V180" stroke="#9fc2ea" stroke-opacity=".6"/>`
    + `<rect x="140" y="96" width="76" height="46" rx="8" fill="#38b6d8" stroke="#fff" stroke-opacity=".7" stroke-width="3"/><path d="M150 112H206M150 126H206" stroke="#fff" stroke-opacity=".3"/>`
    + lot(16, 204, 232, 46) + car(30, 216, "#e0b341") + car(90, 216, "#d9d9d9") + car(150, 216, "#c2423f") + car(206, 216, "#3d78c9"),
  apartmentsC: () => hip(14, 18, 236, 150, SLATE) + dormer(38, 30) + dormer(90, 30) + dormer(142, 30) + dormer(194, 30) + dormer(66, 130) + dormer(166, 130)
    + `<rect x="120" y="76" width="16" height="16" fill="#5a4a44" stroke="#000" stroke-opacity=".5"/>` + lot(14, 180, 160, 66) + car(26, 196, "#00ffcc") + car(80, 196, "#ff3366") + car(134, 196, "#d9d9d9") + tree(210, 214, 16) + tree(238, 190, 11),
  supermarket: () => {
    let s = flat(14, 14, 236, 118, "#e6e3d8") + `<rect x="14" y="126" width="236" height="6" fill="#ff3366"/>`;
    for (let i = 0; i < 5; i++) s += `<rect x="${30 + i * 36}" y="28" width="24" height="50" fill="#6fb3a0" stroke="#000" stroke-opacity=".35"/>`;
    s += ac(40, 94) + ac(70, 94) + ac(200, 94) + ac(200, 28) + lot(14, 142, 236, 104);
    for (let i = 0; i <= 10; i++) s += `<line x1="${18 + i * 22}" y1="148" x2="${18 + i * 22}" y2="188" stroke="#fff" stroke-opacity=".35"/><line x1="${18 + i * 22}" y1="200" x2="${18 + i * 22}" y2="240" stroke="#fff" stroke-opacity=".35"/>`;
    for (let i = 0; i < 10; i += 2) s += car(24 + i * 22, 152, CC[i % 7]) + (i % 4 ? car(24 + i * 22, 212, CC[(i + 3) % 7]) : "");
    return s;
  },
  carshop: () => {
    let s = flat(14, 14, 150, 108, "#8d939c") + `<rect x="14" y="14" width="150" height="14" fill="#ff3366"/>` + ac(30, 40) + ac(60, 40) + `<rect x="100" y="40" width="48" height="50" fill="#5d636d" stroke="#000" stroke-opacity=".4"/>`;
    for (let i = 0; i < 3; i++) s += `<rect x="${24 + i * 46}" y="116" width="34" height="6" fill="#0c0f13"/>`;
    s += lot(172, 14, 78, 232) + lot(14, 132, 150, 114);
    for (let i = 0; i < 5; i++) s += car(180, 22 + i * 44, CC[i], 1) + (i % 2 ? "" : car(212, 22 + i * 44, CC[i + 2], 1));
    for (let i = 0; i < 3; i++) s += car(24 + i * 46, 142, CC[i + 1]) + car(24 + i * 46, 196, CC[i + 3]);
    return s;
  },
};
const PLACE_COLORS = {
  restaurant: "#c2423f", workdistrict: "#47a1d8", hospital: "#e6e3d8",
  downtown: "#b874d1", gasstation: "#e0b341", parking: "#777d88",
  taxi_stand: "#ffbb00", suburban_house: "#93613f", highway: "#4a7190"
};
Object.keys(PLACE_INFO).forEach((id) => {
  if (ART[id]) return;
  ART[id] = () => {
    const color = PLACE_COLORS[id] || "#7d8aa0";
    return flat(18, 18, 228, 154, color) +
      `<rect x="30" y="32" width="204" height="28" fill="#081018" stroke="#000"/>` +
      `<rect x="38" y="76" width="54" height="54" fill="#172c3a" stroke="#000"/>` +
      `<rect x="104" y="76" width="54" height="54" fill="#172c3a" stroke="#000"/>` +
      `<rect x="170" y="76" width="54" height="54" fill="#172c3a" stroke="#000"/>` +
      lot(18, 184, 228, 62) + car(40, 204, CC[2]) + car(104, 204, CC[0]) + car(168, 204, CC[1]);
  };
});
const LABEL = Object.fromEntries(Object.keys(PLACE_INFO).map((id) => [id, [132, 90]]));
function drawPlaces() {
  $("places").innerHTML = Object.keys(ART).map((id) => {
    const [ox, oy] = origin(id), [lx, ly] = LABEL[id];
    const business = id.startsWith("business_");
    return `<g class="place${business ? " business-place" : ""}" id="${id}" tabindex="0" role="button" aria-label="${NAMES[id]}" transform="translate(${ox} ${oy})"><g class="art">${ART[id]()}</g>
      <rect class="hit" x="4" y="4" width="256" height="256"/><text class="plabel" x="${lx}" y="${ly}">${escapeHTML(NAMES[id].toUpperCase())}</text>
      <text class="ptag${business && PLACE_INFO[id].status === "open" ? " own" : ""}" x="${lx}" y="${ly + 22}">${escapeHTML(PLACE_INFO[id].kind)}</text></g>`;
  }).join("");
  document.querySelectorAll(".place").forEach((g) => {
    g.addEventListener("click", () => openPlace(g.id));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPlace(g.id); } });
  });
}

const businessIds = new Set();
function syncBusinesses(businesses) {
  businessIds.forEach((id) => {
    delete PLACE_INFO[id];
    delete BLOCK[id];
    delete DOORS[id];
    delete NAMES[id];
    delete ART[id];
    delete LABEL[id];
  });
  businessIds.clear();
  businesses.forEach((business) => {
    const id = business.id;
    const type = String(business.type || "General Business").slice(0, 40);
    const kind = business.status === "open" ? type.toUpperCase() : `${type.toUpperCase()} · BUILDING`;
    PLACE_INFO[id] = {
      name: business.name,
      kind,
      keywords: `${type} ${business.name} ${business.owner} business company hiring ${business.status}`,
      status: business.status
    };
    BLOCK[id] = [business.x, business.y];
    NAMES[id] = business.name;
    DOORS[id] = [business.x * P + 150, business.y * P];
    LABEL[id] = [132, 176];
    ART[id] = () => {
      const underConstruction = business.status !== "open";
      const sign = underConstruction ? "#ffbb00" : "#00ff66";
      return lot(8, 8, 248, 248) +
        `<rect x="28" y="34" width="208" height="134" fill="#586370" stroke="#080c12" stroke-width="5"/>` +
        `<path d="M28 84H236V168H28Z" fill="#172c3a" stroke="#000" stroke-width="3"/>` +
        `<path d="M48 102H104V150H48ZM122 102H176V150H122ZM194 102H216V150H194Z" fill="#89c6d8" stroke="#071019" stroke-width="4"/>` +
        `<rect x="52" y="16" width="160" height="34" fill="${sign}" stroke="#000" stroke-width="3"/>` +
        (underConstruction
          ? `<path d="M198 12V-28M168 -28H236M212 -28L232 20M198 -10L174 20" stroke="#ffbb00" stroke-width="5"/>`
          : `<path d="M44 176H220M54 188H210" stroke="#00ff66" stroke-width="5"/>`) +
        lot(14, 202, 236, 42) + car(38, 216, "#e0b341") + car(124, 216, "#3d78c9") + car(204, 216, "#c2423f");
    };
    businessIds.add(id);
  });
  drawPlaces();
  $("miniBusinesses").innerHTML = businesses.map((business) => {
    const color = business.status === "open" ? "#00ff66" : "#ffbb00";
    return `<rect x="${business.x * P + 18}" y="${business.y * P + 18}" width="${BS}" height="${BS}" fill="${color}"><title>${escapeHTML(business.name)} · ${escapeHTML(business.owner)}</title></rect>`;
  }).join("");
}

// ---------- build the big city ----------
(function build() {
  let seed = 11; const r = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const used = Object.fromEntries(Object.values(BLOCK).map(([i, j]) => [i + "," + j, 1]));
  const pal = [TERRA, GREY, BROWN, SLATE];
  let ground = `<rect width="${W}" height="${H}" fill="#14171b"/>`, fill = "", mini = `<rect width="${W}" height="${H}" fill="#0c0f13"/>`;
  const rows = H / P, columns = W / P;
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const bx = i * P + 18, by = j * P + 18, key = i + "," + j, park = key === "4,4" || key === "5,4";
    const tint = park ? "#1b2a21" : i <= 3 ? "#232a30" : i <= 7 ? "#272a33" : i < 12 ? "#2a2825" : "#22302c";
    ground += `<rect x="${bx}" y="${by}" width="${BS}" height="${BS}" fill="${tint}"/>`;
    mini += `<rect x="${bx}" y="${by}" width="${BS}" height="${BS}" fill="${park ? "#1f4a30" : "#222a31"}"/>`;
    if (used[key]) continue;
    let o = "";
    if (key === "4,4") o += `<ellipse cx="${132 + 8}" cy="${138}" rx="108" ry="78" fill="#10394a"/><ellipse cx="132" cy="132" rx="104" ry="74" fill="#1d6a86" stroke="#38b6d8" stroke-width="3"/><ellipse cx="116" cy="118" rx="50" ry="26" fill="#2b86a6" opacity=".6"/>` + [...Array(8)].map(() => tree(r() * 250 + 6, r() * 250 + 6, 7 + r() * 5)).join("");
    else if (key === "5,4") for (let k = 0; k < 26; k++) o += tree(14 + r() * 236, 14 + r() * 236, 8 + r() * 7);
    else if (i >= 8) { // industrial warehouses
      o += flat(14, 14, 236, 96, "#9aa0a8") + ac(30, 28) + ac(60, 28) + ac(200, 28) + `<path d="M14 62H250M14 84H250" stroke="rgba(0,0,0,.25)"/>` + flat(14, 124, 110, 120, "#848a93") + lot(136, 124, 114, 120) + car(146, 136, "#e0b341", 1) + car(176, 136, "#d9d9d9", 1) + car(206, 136, "#c2423f", 1);
    } else {
      const cols = 2, rows = r() > .35 ? 2 : 1, cw0 = (BS - 20) / cols, ch0 = (BS - 20) / rows;
      for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
        const w = cw0 - 12 - r() * 12, h = ch0 - 12 - r() * 28, x = 10 + a * cw0 + 4 + r() * 6, y = 10 + b * ch0 + 4 + r() * 8;
        o += r() > .35 ? hip(x, y, w, h, pal[Math.floor(r() * 4)]) : flat(x, y, w, h, "#d8d2c0") + ac(x + 8, y + 8);
        if (r() > .6) o += tree(x + w + 2, y + h - 6, 7);
      }
    }
    fill += `<g transform="translate(${bx} ${by})">${o}</g>`;
  }
  // roads, lane lines
  let roads = `<g class="roads">`, dash = `<g class="dash">`, lab = "";
  const hn = ["BROKER AVE", "MARKET ST", "WALL ST", "EAST LOOP HIGHWAY", "HARBOR AVE", "CHARTER RD", "MAPLE ROAD"];
  for (let j = 1; j < rows; j++) { const y = j * P, wide = j === 4 ? 52 : 36; roads += `<rect x="0" y="${y - wide / 2}" width="${W}" height="${wide}"${j === 4 ? ' fill="#151b22"' : ""}/>`; dash += `<line x1="0" y1="${y}" x2="${W}" y2="${y}"${j === 4 ? ' stroke-width="4"' : ""}/>`; for (let k = 0; k < Math.ceil(W / 1200); k++) lab += `<text class="st" x="${300 + k * 1200}" y="${y + 5}">${hn[(j - 1) % hn.length]}</text>`; mini += `<rect x="0" y="${y - 10}" width="${W}" height="20" fill="#0a0d11"/>`; }
  for (let i = 1; i < columns; i++) { const x = i * P, wide = i === 6 ? 52 : 36; roads += `<rect x="${x - wide / 2}" y="0" width="${wide}" height="${H}"${i === 6 ? ' fill="#151b22"' : ""}/>`; dash += `<line x1="${x}" y1="0" x2="${x}" y2="${H}"${i === 6 ? ' stroke-width="4"' : ""}/>`; for (let k = 0; k < Math.ceil(H / 1200); k++) lab += `<text class="st" transform="translate(${x + 5} ${300 + k * 1200}) rotate(90)">${i}${["TH", "ST", "ND", "RD"][i > 3 ? 0 : i % 4] || "TH"} ST</text>`; mini += `<rect x="${x - 10}" y="0" width="20" height="${H}" fill="#0a0d11"/>`; }
  roads += "</g>"; dash += "</g>";
  [["SUBURBS", 450, 2050], ["DOWNTOWN", 1950, 1050], ["CITY PARK", 1350, 1450], ["BUSINESS DISTRICT", 3000, 620], ["INDUSTRIAL", 3300, 1800], ["NEW BUSINESS PARK", 4800, 450], ["EASTSIDE BUSINESS PARK", 7800, 450]].forEach(([t, x, y]) => (lab += `<text class="dist" x="${x}" y="${y}">${t}</text>`));
  $("ground").innerHTML = ground + roads + dash; $("fillers").innerHTML = fill; $("labels").innerHTML = lab;
  $("border").innerHTML = `<rect class="limit" x="0" y="0" width="${W}" height="${H}"/><rect class="limit2" x="12" y="12" width="${W - 24}" height="${H - 24}"/>` + [[W / 2, 34], [W / 2, H - 22]].map(([x, y]) => `<text class="limtxt" x="${x}" y="${y}">CITY LIMIT</text>`).join("");
  drawPlaces();
  const cols = { supermarket: "#00ff66", carshop: "#ff3366", restaurant: "#ffbb00", hospital: "#ff3366", gasstation: "#e0b341" };
  Object.keys(BLOCK).forEach((id) => { const [x, y] = origin(id); mini += `<rect x="${x}" y="${y}" width="${BS}" height="${BS}" fill="${cols[id] || "#00ffcc"}"/>`; });
  $("mini").setAttribute("viewBox", `0 0 ${W} ${H}`);
  $("mini").innerHTML = mini + `<g id="miniBusinesses"></g><rect id="mv" fill="rgba(255,187,0,.12)" stroke="#ffbb00" stroke-width="14"/><circle id="mt" r="45" fill="#ffbb00" hidden/>`;
})();

// ---------- camera: drag, keys, wheel, minimap, hard city limits ----------
const cam = { x: 0, y: 0, s: 0.9 }; let cw = 1, ch = 1, minS = 0.4, dirty = true;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
function flash(side) {
  const e = document.querySelector(".edge." + side); e.classList.add("on"); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove("on"), 280);
  status.textContent = "CITY LIMIT - you can't go any further that way.";
}
function view(report) {
  const vw = cw / cam.s, vh = ch / cam.s, mx = Math.max(0, W - vw), my = Math.max(0, H - vh);
  if (report) { if (cam.x < -0.5) flash("left"); else if (cam.x > mx + 0.5) flash("right"); if (cam.y < -0.5) flash("top"); else if (cam.y > my + 0.5) flash("bottom"); }
  cam.x = clamp(cam.x, 0, mx); cam.y = clamp(cam.y, 0, my);
  svg.setAttribute("viewBox", `${cam.x} ${cam.y} ${vw} ${vh}`);
  const mv = $("mv"); mv.setAttribute("x", cam.x); mv.setAttribute("y", cam.y); mv.setAttribute("width", vw); mv.setAttribute("height", vh);
}
function resize() { const b = svg.getBoundingClientRect(); cw = b.width; ch = b.height; minS = Math.max(cw / W, ch / H); cam.s = clamp(cam.s, minS, MAXS); view(false); }
svg.setAttribute("preserveAspectRatio", "none");
new ResizeObserver(resize).observe(svg);
function zoomAt(px, py, ns) { ns = clamp(ns, minS, MAXS); const wx = cam.x + px / cam.s, wy = cam.y + py / cam.s; cam.s = ns; cam.x = wx - px / ns; cam.y = wy - py / ns; view(false); }
let anim = null, follow = false;
function flyTo(wx, wy, s, done) { anim = { t0: performance.now(), dur: 750, fx: cam.x + cw / 2 / cam.s, fy: cam.y + ch / 2 / cam.s, fs: cam.s, tx: wx, ty: wy, ts: clamp(s, minS, MAXS), done }; follow = false; }
$("zIn").onclick = () => zoomAt(cw / 2, ch / 2, cam.s * 1.3);
$("zOut").onclick = () => zoomAt(cw / 2, ch / 2, cam.s / 1.3);
$("zHome").onclick = () => {
  if (tripAnimation?.mode === "drive") return;
  flyTo(...centerOf(cityState?.location || "apartmentsA"), 0.9);
};

function isForcedDriving() { return Boolean(tripAnimation && tripAnimation.mode === "drive"); }

// drag to move
let drag = null, moved = false;
svg.addEventListener("pointerdown", (e) => { if (e.button || isForcedDriving()) return; drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y }; moved = false; anim = null; follow = false; });
window.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!moved && Math.hypot(dx, dy) > 5) { moved = true; svg.classList.add("grabbing"); }
  if (moved) { cam.x = drag.cx - dx / cam.s; cam.y = drag.cy - dy / cam.s; view(true); }
});
window.addEventListener("pointerup", () => { drag = null; svg.classList.remove("grabbing"); });
svg.addEventListener("click", (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
svg.addEventListener("wheel", (e) => { e.preventDefault(); if (isForcedDriving()) return; const b = svg.getBoundingClientRect(); zoomAt(e.clientX - b.left, e.clientY - b.top, cam.s * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
svg.addEventListener("mousemove", (e) => {
  if (e.target.closest(".place") || drag) return;
  const b = svg.getBoundingClientRect(); status.textContent = `Grid X:${Math.round(cam.x + (e.clientX - b.left) / cam.s)} Y:${Math.round(cam.y + (e.clientY - b.top) / cam.s)}`;
});
// minimap: click or drag to jump
let mdrag = false;
const jump = (e) => { if (isForcedDriving()) return; const b = $("mini").getBoundingClientRect(); cam.x = ((e.clientX - b.left) / b.width) * W - cw / 2 / cam.s; cam.y = ((e.clientY - b.top) / b.height) * H - ch / 2 / cam.s; anim = null; follow = false; view(false); };
$("mini").addEventListener("pointerdown", (e) => { mdrag = true; jump(e); });
window.addEventListener("pointermove", (e) => { if (mdrag) jump(e); });
window.addEventListener("pointerup", () => (mdrag = false));
// keyboard
const keys = new Set(), driveControls = new Set(); let vx = 0, vy = 0;
const typing = () => /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || !overlay.hidden;
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (tripAnimation && tripAnimation.mode === "drive") {
    if (typing()) return;
    const control = ({ arrowleft: "left", a: "left", arrowright: "right", d: "right", arrowup: "accelerate", w: "accelerate", arrowdown: "brake", s: "brake" })[k];
    if (control) { driveControls.add(control); e.preventDefault(); }
  } else if (!typing()) {
    if ("wasd".includes(k) && k.length === 1 || k.startsWith("arrow") || "+=-_".includes(k)) { keys.add(k); e.preventDefault(); }
    if (k === "0" || k === "home") $("zHome").click();
  }
});
window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
  const control = ({ arrowleft: "left", a: "left", arrowright: "right", d: "right", arrowup: "accelerate", w: "accelerate", arrowdown: "brake", s: "brake" })[k];
  if (control) driveControls.delete(control);
});
window.addEventListener("blur", () => { keys.clear(); driveControls.clear(); });
document.querySelectorAll("[data-drive]").forEach((button) => {
  const control = button.dataset.drive;
  button.addEventListener("pointerdown", (event) => { event.preventDefault(); driveControls.add(control); button.classList.add("active"); });
  ["pointerup", "pointerleave", "pointercancel"].forEach((name) => button.addEventListener(name, () => {
    driveControls.delete(control); button.classList.remove("active");
  }));
});
window.addEventListener("pointerup", () => {
  document.querySelectorAll("[data-drive].active").forEach((button) => {
    driveControls.delete(button.dataset.drive);
    button.classList.remove("active");
  });
});

// ---------- ambient traffic ----------
const traffic = [];
const vehicleTypes = ["sedan", "van", "taxi", "truck", "bus"];
const localHour = new Date().getHours();
const trafficCount = [7, 8, 9, 16, 17, 18].includes(localHour) ? 54 : 30 + Math.floor(Math.random() * 13);
for (let n = 0; n < trafficCount; n++) {
  const horiz = n % 2 === 0, road = 1 + Math.floor(Math.random() * (horiz ? H / P - 1 : W / P - 1)), dir = Math.random() < .5 ? 1 : -1;
  traffic.push({
    horiz, road, dir, sp: 45 + Math.random() * 72, p: Math.random() * (horiz ? W : H),
    col: n % 9 === 0 ? "#00ffcc" : CC[n % 7], type: vehicleTypes[n % vehicleTypes.length], operator: n % 9 === 0,
    laneChangeAt: 1 + Math.floor(Math.random() * 5)
  });
}
$("traffic").innerHTML = traffic.map((c) => {
  const size = c.type === "bus" ? [27, 12] : c.type === "truck" ? [24, 11] : c.type === "van" ? [21, 11] : [18, 10];
  return `<g class="tc ${c.operator ? "operator" : ""}"><title>${c.operator ? "Operator NPC" : c.type} vehicle</title><rect x="-10" y="-6" width="${size[0]}" height="${size[1]}" rx="3" fill="${c.col}"/><rect x="-5" y="-4" width="8" height="6" fill="rgba(0,0,0,.55)"/></g>`;
}).join("");
const tEls = [...document.querySelectorAll(".tc")];

// ---------- main loop ----------
let last = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (typing()) keys.clear();
  if (!tripAnimation || tripAnimation.mode !== "drive") {
    const ax = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0), ay = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
    const sp = 700 / cam.s; vx += (ax * sp - vx) * Math.min(1, dt * 10); vy += (ay * sp - vy) * Math.min(1, dt * 10);
    if (Math.abs(vx) > 2 || Math.abs(vy) > 2) { cam.x += vx * dt; cam.y += vy * dt; anim = null; follow = false; view(true); }
  }
  const z = (keys.has("+") || keys.has("=") ? 1 : 0) - (keys.has("-") || keys.has("_") ? 1 : 0);
  if (z) zoomAt(cw / 2, ch / 2, cam.s * Math.exp(z * dt * 1.4));
  if (anim) {
    const t = Math.min(1, (now - anim.t0) / anim.dur), e = t < .5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    cam.s = anim.fs + (anim.ts - anim.fs) * e; cam.x = anim.fx + (anim.tx - anim.fx) * e - cw / 2 / cam.s; cam.y = anim.fy + (anim.ty - anim.fy) * e - ch / 2 / cam.s; view(false);
    if (t === 1) { const d = anim.done; anim = null; if (d) d(); }
  }
  if (tripAnimation) {
    const R = tripAnimation;
    if (R.mode === "drive") {
      const activeCar = cityState.cars.find((car) => car.id === cityState.current_car);
      const acceleration = activeCar?.acceleration || 0.8;
      const maxSpeed = 1.25 + (activeCar?.speed || 1) * 0.35;
      if (driveControls.has("accelerate")) {
        driveStopped = false;
        driveSpeed = Math.min(maxSpeed, driveSpeed + dt * acceleration);
      } else if (driveControls.has("brake")) {
        driveSpeed = Math.max(0, driveSpeed - dt * 1.5);
        if (driveSpeed === 0) driveStopped = true;
      }
      if (driveSpeed > 0) driveResumeSpeed = driveSpeed;
      const steering = (driveControls.has("right") ? 1 : 0) - (driveControls.has("left") ? 1 : 0);
      const handling = activeCar?.handling || 0.8;
      R.laneOffset = clamp(R.laneOffset + steering * dt * 55 * handling, -46, 46);
      if (R.progress < 1 && !driveStopped) R.progress = clamp(R.progress + (dt * 1000 / R.dur) * driveSpeed, 0, 1);
      $("driveReadout").textContent = `SPEED ${Math.round(driveSpeed * 60)}  /  FUEL ${Math.round(activeCar?.fuel || 0)}%`;
      $("driveMeter").style.width = `${Math.round(R.progress * 100)}%`;
      $("driveStop").textContent = driveStopped ? "RESUME" : "STOP CAR";
    } else {
      R.progress = clamp((now - R.t0) / R.dur, 0, 1);
    }
    const t = R.progress, path = $("route"), p = path.getPointAtLength(t * R.len), q = path.getPointAtLength(Math.min(t * R.len + 2, R.len));
    const radians = Math.atan2(q.y - p.y, q.x - p.x);
    const laneOffset = R.mode === "drive" ? R.laneOffset || 0 : 0;
    const markerX = p.x - Math.sin(radians) * laneOffset;
    const markerY = p.y + Math.cos(radians) * laneOffset;
    if (R.mode === "drive") {
      const turnAhead = R.turns.some((distance) => Math.abs(distance - t * R.len) < 55);
      if (turnAhead && driveSpeed > 1.15 && !driveControls.has("brake")) {
        driveScore = Math.max(0, driveScore - dt * 0.12);
        status.textContent = "Sharp turn ahead · ease off the accelerator.";
      } else if (turnAhead && driveControls.has("brake")) {
        driveScore = Math.min(1, driveScore + dt * 0.1);
      }
      if (!driveStopped && driveSpeed > 0 && now - (R.lastTrafficCheck || 0) > 350) {
        R.lastTrafficCheck = now;
        const closeCar = traffic.find((vehicle) => Math.hypot(vehicle.x - markerX, vehicle.y - markerY) < 22);
        if (closeCar) {
          if (driveControls.has("left") || driveControls.has("right") || driveSpeed < 0.9) {
            driveScore = Math.min(1, driveScore + 0.08);
            status.textContent = `${closeCar.operator ? "Operator car" : closeCar.type} passed · nice control.`;
          } else {
            driveScore = Math.max(0, driveScore - 0.14);
            driveSpeed = Math.max(0.25, driveSpeed * 0.72);
            status.textContent = "Traffic close · steer around it or slow down.";
          }
        }
      }
    }
    const angle = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    const marker = R.mode === "taxi" ? $("taxi") : R.mode === "walk" ? $("walker") : $("player");
    marker.hidden = false;
    $("taxi").hidden = R.mode !== "taxi";
    $("player").hidden = R.mode !== "drive";
    $("walker").hidden = R.mode !== "walk";
    if (R.mode === "drive") {
      const currentCar = cityState.cars.find((car) => car.id === cityState.current_car);
      marker.style.setProperty("--vehicle-color", currentCar?.paint || "var(--pixel-cyan)");
      $("playerName").textContent = (currentCar?.driver_name || cityState.name || "DRIVER").slice(0, 12);
    }
    marker.setAttribute("transform", `translate(${markerX} ${markerY}) rotate(${angle})`);
    const mt = $("mt"); mt.hidden = false; mt.setAttribute("cx", p.x); mt.setAttribute("cy", p.y);
    if (follow || R.mode === "drive") {
      if (R.mode === "drive") {
        cam.s = clamp(Math.max(minS, 1.08), minS, MAXS);
        cam.x = markerX - cw / 2 / cam.s;
        cam.y = markerY - ch / 2 / cam.s;
      } else {
        cam.x += (p.x - cw / 2 / cam.s - cam.x) * Math.min(1, dt * 4);
        cam.y += (p.y - ch / 2 / cam.s - cam.y) * Math.min(1, dt * 4);
      }
      view(false);
    }
    if (t >= 1 && !R.finishing) { R.finishing = true; finishTrip(); }
  }
  traffic.forEach((c, k) => {
    c.p += c.dir * c.sp * dt; const lim = c.horiz ? W : H; if (c.p > lim + 20) c.p = -20; if (c.p < -20) c.p = lim + 20;
    const block = Math.floor(c.p / P);
    if (block !== c.lastBlock) {
      c.lastBlock = block;
      if (Math.random() < 0.08) c.dir = -c.dir;
      if (Math.random() < 0.12) c.sp *= 0.68;
    }
    c.sp += (70 - c.sp) * dt * 0.05;
    const lane = c.road * P + c.dir * 9, x = c.horiz ? c.p : lane, y = c.horiz ? lane : c.p;
    c.x = x; c.y = y;
    tEls[k].setAttribute("transform", `translate(${x} ${y}) rotate(${c.horiz ? (c.dir > 0 ? 0 : 180) : c.dir > 0 ? 90 : -90})`);
  });
  requestAnimationFrame(tick);
}
resize(); flyTo(...centerOf("apartmentsA"), 0.9); anim.dur = 1; requestAnimationFrame(tick);

// ---------- city services, travel, and daily needs ----------
function updatePlayerMarker() {
  if (!cityState || !DOORS[cityState.location]) return;
  const [x, y] = DOORS[cityState.location];
  if (!tripAnimation) {
    const currentCar = cityState.cars?.find((car) => car.id === cityState.current_car);
    const parkedCar = $("player");
    parkedCar.hidden = !currentCar;
    if (currentCar) {
      parkedCar.style.setProperty("--vehicle-color", currentCar.paint || "var(--pixel-cyan)");
      $("playerName").textContent = (currentCar.driver_name || cityState.name || "DRIVER").slice(0, 12);
      parkedCar.setAttribute("transform", `translate(${x + 42} ${y + 22})`);
    }
    const walker = $("walker");
    walker.hidden = false;
    walker.setAttribute("transform", `translate(${x} ${y})`);
  }
  const current = $("mt");
  if (current) { current.hidden = false; current.setAttribute("cx", x); current.setAttribute("cy", y); }
}

function serviceMessage() {
  if (!cityState.career_active) return '<p class="msg">Start a career from the Career app before making purchases or travelling.</p>';
  return "";
}

function openPlace(id) {
  if (!PLACE_INFO[id]) return;
  if (tripAnimation) {
    status.textContent = `En route to ${NAMES[tripAnimation.destination]}. Finish this trip before planning another.`;
    return;
  }
  document.querySelectorAll(".hl").forEach((e) => e.classList.remove("hl"));
  $(id).classList.add("hl");
  status.textContent = `${NAMES[id]} · ${PLACE_INFO[id].kind}`;
  const business = cityState?.businesses?.find((place) => place.id === id);
  if (business) {
    const stateText = business.status === "open" ? "OPEN FOR BUSINESS" : "UNDER CONSTRUCTION";
    const hiringText = business.hiring
      ? `<p class="ok">HIRING · ${escapeHTML(business.hiring_role)} · ${money(business.hiring_salary)}/week. Apply from the Career job board.</p>`
      : "";
    const routeButton = cityState.location === id
      ? '<p class="ok">You are at this business.</p>'
      : `<button class="btn warn" onclick="MapsGame.travelOptions('${id}')">PLAN TRIP HERE</button>`;
    openWindow(escapeHTML(business.name).toUpperCase(),
      `<h3>${escapeHTML(business.type)} · ${stateText}</h3><p>Operator: ${escapeHTML(business.owner)}</p>${hiringText}${routeButton}`);
    return;
  }
  if (cityState && cityState.location !== id) {
    openWindow(NAMES[id].toUpperCase(), `<h3>${PLACE_INFO[id].kind} DESTINATION</h3><p>${escapeHTML(NAMES[id])} · Choose a travel mode and see route time, traffic, and services on arrival.</p><button class="btn warn" onclick="MapsGame.travelOptions('${id}')">PLAN TRIP HERE</button>`);
    return;
  }
  if (id === "supermarket") return openSupermarket();
  if (id === "carshop") return openCarShop();
  if (id === "gasstation") return openFuelStop();
  if (id === "restaurant") return openDiner();
  if (id === "hospital") return openClinic();
  openWindow(NAMES[id].toUpperCase(), `<h3>${PLACE_INFO[id].kind}</h3><p>${escapeHTML(NAMES[id])} is part of the connected city network.</p>${serviceMessage()}<button class="btn" onclick="MapsGame.travelOptions('${id}')">PLAN A TRIP HERE</button>`);
}

function openSupermarket() {
  const food = cityState.food || {};
  const inventoryRows = Object.entries(cityState.inventory || {}).filter(([, count]) => count > 0).map(([id, count]) =>
    `<div class="row"><span>${escapeHTML(food[id]?.name || id)} · ${count}</span><button class="btn" onclick="MapsGame.eat('${id}')">EAT ONE</button></div>`).join("");
  const products = Object.entries(food).map(([id, item]) =>
    `<div class="row"><span>${escapeHTML(item.name)} · +${item.hunger} hunger</span><span><b>${money(item.price)}</b> <button class="btn" onclick="MapsGame.buyFood('${id}')">BUY</button></span></div>`).join("");
  openWindow("FRESHMART SUPERMARKET", `<h3>Food for your week</h3><p>Keep hunger up to protect your health. Groceries stay in your bag until you eat them.</p>${serviceMessage()}<h3>SHOP</h3>${products}<h3>YOUR BAG</h3>${inventoryRows || '<p>Nothing packed yet.</p>'}<div class="msg" id="serviceMsg"></div>`);
}

function openCarShop() {
  const catalog = cityState.car_catalog || {};
  const owned = new Set((cityState.cars || []).map((car) => car.id));
  const rows = Object.entries(catalog).map(([id, car]) => {
    const own = owned.has(id);
    return `<div class="car-card"><b><i class="paint" style="background:${car.paint}"></i>${escapeHTML(car.name)}</b><span>${escapeHTML(car.class)} · $${car.price.toLocaleString()}</span><small>Speed ${car.speed.toFixed(2)} · acceleration ${car.acceleration.toFixed(2)} · handling ${car.handling.toFixed(2)} · economy ${car.efficiency.toFixed(2)}</small><button class="btn" onclick="MapsGame.${own ? "selectCar" : "buyCar"}('${id}')">${own ? (cityState.current_car === id ? "IN USE" : "SELECT") : "BUY CAR"}</button></div>`;
  }).join("");
  const fuel = (cityState.cars || []).find((car) => car.id === cityState.current_car)?.fuel;
  openWindow("METRO MOTORS", `<h3>Pick your ride</h3><p>Your car affects travel speed, handling and fuel. A basic car is enough to get around.</p>${fuel == null ? "" : `<p>Current car fuel: ${Math.round(fuel)}%</p><button class="btn" onclick="MapsGame.orderFuel(35)">ORDER FUEL DELIVERY</button>`}${serviceMessage()}<div class="car-list">${rows}</div><div class="msg" id="serviceMsg"></div>`);
}

function openFuelStop() {
  const fuel = (cityState.cars || []).find((car) => car.id === cityState.current_car)?.fuel;
  openWindow("HIGHWAY FUEL", `<h3>Fuel stop</h3><p>Current vehicle fuel: ${fuel == null ? "No car selected" : `${Math.round(fuel)}%`}.</p><p>Refill 35% for $15, or order a 35% delivery anywhere for $36.50.</p>${serviceMessage()}<button class="btn warn" onclick="MapsGame.refuel()">REFILL HERE · $15</button><button class="btn" onclick="MapsGame.orderFuel(35)">ORDER FUEL · $36.50</button><div class="msg" id="serviceMsg"></div>`);
}

function openDiner() {
  openWindow("PIXEL PLATE DINER", `<h3>Hot meal · $16</h3><p>Eat now to restore 42 hunger and 2 health.</p>${serviceMessage()}<button class="btn warn" onclick="MapsGame.buyMeal()">ORDER MEAL</button><div class="msg" id="serviceMsg"></div>`);
}

function openClinic() {
  openWindow("CITY CLINIC", `<h3>Basic care · $30</h3><p>Recover 15 health.</p>${serviceMessage()}<button class="btn warn" onclick="MapsGame.clinic()">GET CARE</button><div class="msg" id="serviceMsg"></div>`);
}

function openFoodBag() {
  const food = cityState.food || {};
  const rows = Object.entries(cityState.inventory || {}).filter(([, count]) => count > 0).map(([id, count]) =>
    `<div class="row"><span>${escapeHTML(food[id]?.name || id)} · ${count} · +${food[id]?.hunger || 0} hunger</span><button class="btn" onclick="MapsGame.eat('${id}')">EAT</button></div>`).join("");
  openWindow("FOOD BAG", `<h3>Hunger ${cityState.hunger}% · Health ${cityState.health} HP</h3>${rows || "<p>Your bag is empty. Visit FreshMart or Pixel Plate Diner.</p>"}<button class="btn" onclick="MapsGame.travelOptions('supermarket')">GO TO FRESHMART</button><div class="msg" id="serviceMsg"></div>`);
}

function openBusinessDirectory() {
  const businesses = cityState?.businesses || [];
  const rows = businesses.length ? businesses.map((business) => {
    const statusText = business.status === "open" ? "OPEN" : "UNDER CONSTRUCTION";
    const hiring = business.hiring
      ? `<small class="hiring-tag">HIRING · ${escapeHTML(business.hiring_role)} · ${money(business.hiring_salary)}/week</small>`
      : "";
    const button = business.id === cityState.location
      ? '<span class="ok">YOU ARE HERE</span>'
      : `<button class="btn" onclick="MapsGame.travelOptions('${business.id}')">ROUTE THERE</button>`;
    return `<div class="business-card"><b>${escapeHTML(business.name)}</b><span>${escapeHTML(business.type)} · ${statusText}</span><small>Owner: ${escapeHTML(business.owner)}</small>${hiring}${button}</div>`;
  }).join("") : '<p>No player-owned businesses yet. Found one in the Career app to claim a city plot.</p>';
  openWindow("CITY BUSINESS DIRECTORY", `<h3>Operator-owned places</h3><p>Businesses appear in the Eastside Business Park after their land is purchased. Construction completes in 1-2 in-game days.</p><div class="business-list">${rows}</div>`);
}

async function getQuotes(destination) {
  const response = await fetch(`/api/game/city/quotes?destination=${encodeURIComponent(destination)}`);
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.msg || "Could not plan that route.");
  return data;
}

async function travelWindow(destination, taxiOnly = false) {
  if (!cityState.career_active) {
    openWindow("CAREER REQUIRED", `<h3>Start your career first</h3><p>Maps connects to your career wallet, health and hunger. Start a career, then come back here.</p>`);
    return;
  }
  try {
    const data = await getQuotes(destination);
    const selected = taxiOnly ? ["taxi"] : ["walk", "drive", "taxi"];
    const cards = selected.map((mode) => {
      const quote = data.quotes[mode];
      const labels = { walk: "WALK", drive: "DRIVE YOUR CAR", taxi: "TAKE A TAXI" };
      const fuelInfo = mode === "drive" && quote.fuel_needed != null
        ? `<small>Fuel needed: ${quote.fuel_needed}% · tank: ${quote.current_fuel}%</small>` : "";
      const fuelAction = mode === "drive" && quote.delivery_percent
        ? `<button class="btn" onclick="MapsGame.orderFuel(${quote.delivery_percent},'${destination}')">ORDER ${quote.delivery_percent}% FUEL</button>` : "";
      if (!quote.available) return `<div class="travel-card unavailable"><b>${labels[mode]}</b><p>${escapeHTML(quote.reason)}</p>${fuelInfo}${fuelAction}</div>`;
      return `<div class="travel-card"><b>${labels[mode]}</b><span>${quote.eta_seconds}s · ${quote.distance_km} km</span><small>${quote.traffic} traffic${quote.highway ? " · highway" : ""}${quote.event ? " · road delay possible" : ""}</small>${fuelInfo}<strong>${quote.price ? money(quote.price) : "FREE"}</strong><button class="btn ${mode === "taxi" ? "warn" : ""}" onclick="MapsGame.startTrip('${destination}','${mode}')">${mode === "taxi" ? "CALL TAXI" : mode === "drive" ? "START DRIVE" : "START WALK"}</button></div>`;
    }).join("");
    const current = NAMES[cityState.location] || "Current location";
    openWindow(taxiOnly ? "CALL A TAXI" : `TRAVEL TO ${NAMES[destination].toUpperCase()}`, `<h3>${escapeHTML(current)} → ${escapeHTML(data.name)}</h3><p>Choose your route. Time includes distance, traffic and road conditions.</p><div class="travel-options">${cards}</div><div class="msg" id="serviceMsg"></div>`);
  } catch (error) {
    openWindow("ROUTE UNAVAILABLE", `<p>${escapeHTML(error.message)}</p>`);
  }
}

function makeRoute(from, to) {
  const a = DOORS[from], b = DOORS[to];
  const ax = Math.round(a[0] / P) * P, by = Math.round(b[1] / P) * P, bx = Math.round(b[0] / P) * P;
  const points = [a, [ax, a[1]], [ax, by], [bx, by], b];
  return points.filter((point, index) => !index || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]);
}

function routeTurns(points) {
  const turns = [];
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1], next = points[i];
    distance += Math.hypot(next[0] - previous[0], next[1] - previous[1]);
    if (i < points.length - 1) {
      const after = points[i + 1];
      const currentHorizontal = previous[1] === next[1], nextHorizontal = next[1] === after[1];
      if (currentHorizontal !== nextHorizontal) turns.push(distance);
    }
  }
  return turns;
}

async function startTrip(destination, mode) {
  try {
    const result = await cityAction("travel", { destination, mode });
    closeWindow();
    driveScore = 0.72;
    driveSpeed = 1;
    driveResumeSpeed = 1;
    driveStopped = false;
    driveControls.clear();
    if (mode === "taxi") status.textContent = "Taxi dispatched · pickup in a few seconds.";
    else status.textContent = mode === "drive" ? "Driving · accelerate on clear roads, brake for turns." : "Walking · the city is passing by.";
    const delay = mode === "taxi" ? 2400 : 0;
    setTimeout(() => {
      if (!cityState?.active_trip) return;
      const trip = cityState.active_trip;
      const points = makeRoute(cityState.location, destination);
      const route = $("route");
      route.setAttribute("d", "M" + points.map((point) => point.join(" ")).join("L"));
      const duration = Math.max(5, (trip.eta_seconds - delay / 1000) * 1000);
      tripAnimation = {
        mode, destination, t0: performance.now(), dur: duration,
        len: route.getTotalLength(), progress: 0, laneOffset: 0,
        traffic: trip.traffic || "normal", finishing: false, turns: routeTurns(points)
      };
      $("driveHud").hidden = mode !== "drive";
      $("driveTitle").textContent = `${cityState.cars.find((car) => car.id === cityState.current_car)?.name || "CAR"} · ${NAMES[destination]}`;
      $("driveStop").textContent = "STOP CAR";
      $("taxi").hidden = mode !== "taxi";
      $("player").hidden = mode !== "drive";
      $("walker").hidden = mode !== "walk";
      anim = null;
      if (mode === "drive") cam.s = clamp(Math.max(minS, 1.08), minS, MAXS);
      follow = true;
    }, delay);
  } catch (error) {
    const message = $("serviceMsg");
    if (message) showMessage(message, error.message);
    else status.textContent = error.message;
  }
}

async function finishTrip() {
  const current = tripAnimation;
  if (!current) return;
  try {
    const result = await cityAction("arrive", { drive_score: driveScore });
    tripAnimation = null;
    driveControls.clear();
    $("driveHud").hidden = true;
    $("taxi").hidden = true;
    $("player").hidden = true;
    $("walker").hidden = false;
    $("mt").hidden = true;
    $("route").setAttribute("d", "");
    follow = false;
    updatePlayerMarker();
    status.textContent = result.message;
    openPlace(current.destination);
  } catch (error) {
    current.finishing = false;
    status.textContent = error.message;
    setTimeout(() => { if (tripAnimation === current && current.progress >= 1) finishTrip(); }, 1000);
  }
}

function openTaxiRequest() {
  const options = Object.entries(NAMES).filter(([id]) => id !== cityState.location)
    .map(([id, name]) => `<option value="${id}">${escapeHTML(name)}</option>`).join("");
  openWindow("CALL A TAXI", `<h3>Pickup · ${escapeHTML(NAMES[cityState.location] || "Current location")}</h3><label class="field">Destination<select id="taxiDestination">${options}</select></label><button class="btn warn" onclick="MapsGame.taxiDestination()">GET FARE & ETA</button><div class="msg" id="serviceMsg"></div>`);
}

$("taxiBtn").addEventListener("click", openTaxiRequest);
$("businessesBtn").addEventListener("click", openBusinessDirectory);
$("bagBtn").addEventListener("click", openFoodBag);
$("orderFuelBtn").addEventListener("click", () => window.MapsGame.orderFuel(35));
$("driveStop").addEventListener("click", () => {
  if (!tripAnimation || tripAnimation.mode !== "drive") return;
  driveStopped = !driveStopped;
  if (driveStopped) {
    driveResumeSpeed = Math.max(driveSpeed, 0.35);
    driveSpeed = 0;
    driveControls.clear();
    document.querySelectorAll("[data-drive].active").forEach((button) => button.classList.remove("active"));
    status.textContent = "Stopped. Press RESUME or accelerate when you are ready.";
  } else {
    driveSpeed = Math.max(driveResumeSpeed, 0.35);
    status.textContent = "Driving resumed at your previous speed.";
  }
  $("driveStop").textContent = driveStopped ? "RESUME" : "STOP CAR";
});
const input = $("homeSearch"), results = $("results");
function matchedPlaces(query) {
  return Object.entries(PLACE_INFO).filter(([id, place]) => `${id} ${place.name} ${place.kind} ${place.keywords}`.toLowerCase().includes(query));
}
function showResults() {
  const query = input.value.trim().toLowerCase();
  if (!query) { results.hidden = true; return; }
  const hits = matchedPlaces(query);
  results.innerHTML = hits.length ? hits.map(([id, place]) => `<li data-id="${id}"><span>${escapeHTML(place.name)} · ${escapeHTML(place.kind)}</span><small>${cityState?.location === id ? "HERE" : "ROUTE"}</small></li>`).join("")
    : `<li class="none">No destinations found.</li>`;
  results.hidden = false;
}
function openDestination(id) {
  results.hidden = true;
  input.blur();
  document.querySelectorAll(".hl").forEach((e) => e.classList.remove("hl"));
  $(id)?.classList.add("hl");
  status.textContent = `Planning route to ${NAMES[id]}...`;
  const [cx, cy] = centerOf(id);
  flyTo(cx, cy, 1.05, () => openPlace(id));
}
input.addEventListener("input", showResults);
input.addEventListener("keydown", (e) => { if (e.key === "Enter") { const place = matchedPlaces(input.value.trim().toLowerCase())[0]; if (place) openDestination(place[0]); } });
results.addEventListener("click", (e) => { const li = e.target.closest("li[data-id]"); if (li) openDestination(li.dataset.id); });
document.addEventListener("click", (e) => { if (!e.target.closest(".searchrow")) results.hidden = true; });

window.MapsGame = {
  travelOptions: (id) => travelWindow(id),
  openBusinesses: openBusinessDirectory,
  startTrip,
  buyFood: async (item) => { try { await cityAction("buy_food", { item }); openSupermarket(); } catch (error) { showMessage($("serviceMsg"), error.message); } },
  eat: async (item) => { try { await cityAction("eat", { item }); openFoodBag(); } catch (error) { showMessage($("serviceMsg"), error.message); } },
  buyMeal: async () => { try { await cityAction("buy_meal"); openDiner(); } catch (error) { showMessage($("serviceMsg"), error.message); } },
  clinic: async () => { try { await cityAction("clinic"); openClinic(); } catch (error) { showMessage($("serviceMsg"), error.message); } },
  buyCar: async (car) => { try { await cityAction("buy_car", { car }); openCarShop(); } catch (error) { showMessage($("serviceMsg"), error.message); } },
  selectCar: async (car) => { try { await cityAction("select_car", { car }); openCarShop(); } catch (error) { showMessage($("serviceMsg"), error.message); } },
  refuel: async () => { try { await cityAction("refuel"); openFuelStop(); } catch (error) { showMessage($("serviceMsg"), error.message); } },
  orderFuel: async (amount, destination) => {
    try {
      const currentCar = cityState.cars.find((car) => car.id === cityState.current_car);
      if (!currentCar) throw new Error("Buy a car before ordering fuel.");
      const deliveryAmount = Math.min(Number(amount) || 35, 100 - currentCar.fuel);
      if (deliveryAmount < 1) throw new Error("Your fuel tank is already full.");
      await cityAction("order_fuel", { amount: deliveryAmount });
      if (destination) await travelWindow(destination);
      else if (cityState.location === "carshop") openCarShop();
      else if (cityState.location === "gasstation") openFuelStop();
      else openWindow("FUEL DELIVERY", `<h3>Fuel delivered</h3><p>${deliveryAmount}% added to your ${escapeHTML(currentCar.name)}. Tank: ${Math.round(cityState.cars.find((car) => car.id === cityState.current_car)?.fuel || 0)}%.</p>`);
    } catch (error) {
      const message = $("serviceMsg");
      if (message) showMessage(message, error.message);
      else status.textContent = error.message;
    }
  },
  taxiDestination: () => travelWindow($("taxiDestination").value, true)
};

requestState().then((data) => {
  if (!data.career_active) status.textContent = "Start a career to connect Maps to your wallet, health and hunger.";
  else if (data.active_trip) {
    anim = null;
    const trip = data.active_trip;
    const elapsed = Math.max(0, (Date.now() / 1000 - trip.started_at));
    const points = makeRoute(data.location, trip.destination);
    const route = $("route");
    route.setAttribute("d", "M" + points.map((point) => point.join(" ")).join("L"));
    const mode = trip.mode;
    tripAnimation = { mode, destination: trip.destination, t0: performance.now() - elapsed * 1000, dur: trip.eta_seconds * 1000, len: route.getTotalLength(), progress: mode === "drive" ? 0 : elapsed / trip.eta_seconds, laneOffset: 0, traffic: trip.traffic || "normal", finishing: false, turns: routeTurns(points) };
    driveSpeed = mode === "drive" ? 1 : 0;
    driveResumeSpeed = 1;
    driveStopped = false;
    driveControls.clear();
    if (mode === "drive") $("driveStop").textContent = "STOP CAR";
    $("driveHud").hidden = mode !== "drive";
    $("taxi").hidden = mode !== "taxi";
    $("player").hidden = mode !== "drive";
    $("walker").hidden = mode !== "walk";
    follow = true;
  } else flyTo(...centerOf(data.location), 0.9);
}).catch((error) => { status.textContent = error.message; });
setInterval(() => { if (!tripAnimation) requestState().catch((error) => { status.textContent = error.message; }); }, 15000);
