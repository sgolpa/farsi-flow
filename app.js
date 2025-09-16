/* Minimal men utbyggbar flashcard-MVP med två riktningar och enkel repetition.
   - Space = visa/dölj
   - 1/2/3 = Igen / Okej / Lätt
   - Lokal “repetition”: vi stoppar kortet längre fram i kön beroende på betyg.
   - Persistens (frivillig, enkel): sparar box-nivå per kort+rikting i localStorage.
*/

const ui = {
  mode: document.getElementById("mode"),
  reset: document.getElementById("reset"),
  counter: document.getElementById("counter"),
  queueLen: document.getElementById("queueLen"),
  front: document.getElementById("front"),
  back: document.getElementById("back"),
  backMeaning: document.getElementById("backMeaning"),
  backTranslit: document.getElementById("backTranslit"),
  examples: document.getElementById("examples"),
  reveal: document.getElementById("reveal"),
  g1: document.getElementById("g1"),
  g2: document.getElementById("g2"),
  g3: document.getElementById("g3"),
};

let ALL_WORDS = [];
let queue = [];         // aktuella kort i denna session
let current = null;     // nuvarande kort-objekt
let shownBack = false;  // om baksidan är synlig
let reviewsToday = 0;   // endast session-baserat (nollställs vid "Ny session")

// ———————————— Persistence (enkel) ————————————
const STORAGE_KEY = "farsi-cards-boxes-v1";
// Struktur: { "talash-kardan|fa2sv": 1..3, ... }
function loadBoxes() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
}
function saveBoxes(boxes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(boxes));
}
const boxes = loadBoxes();

// ———————————— Hjälpare ————————————
function byIdDir(id, dir) { return `${id}|${dir}`; }
function getBox(id, dir) {
  const key = byIdDir(id, dir);
  return boxes[key] || 1; // default box 1
}
function setBox(id, dir, val) {
  const key = byIdDir(id, dir);
  boxes[key] = Math.max(1, Math.min(3, val));
  saveBoxes(boxes);
}

function el(tag, attrs={}, children=[]) {
  const node = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(c);
  return node;
}

// Generera kort för vald riktning
function buildDeck(words, mode) {
  const deck = [];
  for (const w of words) {
    if (mode === "fa2sv" || mode === "mixed") {
      deck.push({
        id: w.id,
        dir: "fa2sv",
        front: () => faSpan(w.fa),
        back: () => ({
          meaning: w.sv,
          translit: w.translit || "",
          examples: w.examples || []
        })
      });
    }
    if (mode === "sv2fa" || mode === "mixed") {
      deck.push({
        id: w.id,
        dir: "sv2fa",
        front: () => svSpan(w.sv),
        back: () => ({
          meaning: w.fa,
          translit: w.translit || "",
          examples: w.examples || []
        })
      });
    }
  }

  // Lägg de med högre box sist (visas mer sällan)
  deck.sort((a,b) => getBox(a.id, a.dir) - getBox(b.id, b.dir));

  // Liten blandning för variation
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function faSpan(text){
  const span = el("span", { lang:"fa", dir:"rtl", text });
  return span;
}
function svSpan(text){
  const span = el("span", { lang:"sv", dir:"ltr", text });
  return span;
}

function updateProgress(){
  ui.counter.textContent = String(reviewsToday);
  ui.queueLen.textContent = String(queue.length);
}

function showCardFront(card){
  ui.front.innerHTML = "";
  ui.front.appendChild(card.front());
  ui.back.hidden = true;
  ui.reveal.setAttribute("aria-expanded", "false");
  ui.reveal.disabled = false;
  shownBack = false;
  // Lås betyg tills baksidan visas
  ui.g1.disabled = ui.g2.disabled = ui.g3.disabled = true;
}

function showCardBack(card){
  const data = card.back();
  ui.backMeaning.textContent = data.meaning || "";
  ui.backTranslit.textContent = data.translit || "";
  ui.examples.innerHTML = "";

  (data.examples || []).forEach(ex => {
    const pFa = el("p", {}, [el("span", {class:"fa", lang:"fa", dir:"rtl", text: ex.fa})]);
    const pSv = el("p", {class:"muted"}, [el("span", {lang:"sv", dir:"ltr", text: ex.sv})]);
    ui.examples.appendChild(pFa);
    if (ex.translit) {
      const pTr = el("p", {class:"translit"}, [el("span", {text: ex.translit})]);
      ui.examples.appendChild(pTr);
    }
    ui.examples.appendChild(pSv);
  });

  ui.back.hidden = false;
  ui.reveal.setAttribute("aria-expanded", "true");
  shownBack = true;
  ui.g1.disabled = ui.g2.disabled = ui.g3.disabled = false;
}

// Enkel schemaläggning: stoppa tillbaka kort längre fram i kön
function requeue(card, grade){
  const prev = getBox(card.id, card.dir);
  const next = grade === 1 ? 1 : grade === 2 ? Math.max(prev,2) : 3;
  setBox(card.id, card.dir, next);

  // Dynamisk placering beroende på hur lång kön är:
  const tail = queue.length;
  let idx;
  if (grade === 1) {
    // Igen → snart igen (men inte direkt nästa)
    idx = Math.min(3, tail);
  } else if (grade === 2) {
    // Okej → ungefär halvvägs bak i kön
    idx = Math.floor(tail * 0.5);
  } else {
    // Lätt → långt bak så nya kort hinner fram
    idx = Math.floor(tail * 0.85);
  }
  queue.splice(idx, 0, card);
}

let antiStarve = 0;  // liten räknare för att undvika fastna på få kort

function nextCard(){
  if (queue.length === 0) {
    ui.front.innerHTML = "<p>Klart för nu! Lägg gärna till fler ord i <code>words.json</code> och starta ny session.</p>";
    ui.back.hidden = true;
    ui.reveal.disabled = true;
    ui.g1.disabled = ui.g2.disabled = ui.g3.disabled = true;
    updateProgress();
    return;
  }

  const card = queue.shift();

  // 🔄 Anti-svält: då och då lyft fram ett kort som ligger långt bak
  antiStarve++;
  if (antiStarve % 7 === 0 && queue.length > 8) {
    const late = queue.pop();        // ta ett som låg sist
    queue.splice(3, 0, late);        // lägg in det tidigt i kön
  }

  current = card;
  showCardFront(card);
  updateProgress();
}

function startSession(mode){
  queue = buildDeck(ALL_WORDS, mode);
  reviewsToday = 0;
  nextCard();
}

// ———————————— Event wiring ————————————
ui.reveal.addEventListener("click", () => {
  if (!current) return;
  if (!shownBack) showCardBack(current);
  else { // om baksidan redan syns, dölja igen (valfritt)
    showCardFront(current);
  }
});

function grade(g){
  if (!current || !shownBack) return;
  reviewsToday += 1;
  requeue(current, g);
  nextCard();
}

ui.g1.addEventListener("click", () => grade(1));
ui.g2.addEventListener("click", () => grade(2));
ui.g3.addEventListener("click", () => grade(3));

ui.mode.addEventListener("change", () => startSession(ui.mode.value));
ui.reset.addEventListener("click", () => startSession(ui.mode.value));

// Tangentbordsstöd
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") { e.preventDefault(); ui.reveal.click(); }
  if (e.key === "1") ui.g1.click();
  if (e.key === "2") ui.g2.click();
  if (e.key === "3") ui.g3.click();
});

// ———————————— Boot ————————————
async function boot(){
  try{
    const res = await fetch("words.json");
    if (!res.ok) throw new Error(`Kunde inte läsa words.json (HTTP ${res.status})`);
    ALL_WORDS = await res.json();
  }catch(err){
    console.error(err);
    ALL_WORDS = [];
  }
  startSession(ui.mode.value);
}
boot();
