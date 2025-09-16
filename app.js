(() => {
  "use strict";

  // ====== Konstanter / nycklar ======
  const WORDS_URL = "words.json";
  const STORAGE_KEY = "farsiflow.boxes.v1"; // { "<id>|fa2sv": 1..3, ... }
  const DIR = { FA2SV: "fa2sv", SV2FA: "sv2fa" };
  const MAX_BOX = 3;
  const MIN_BOX = 1;

  // Graderingsregler: hur långt fram vi stoppar tillbaka kortet
  // samt hur box-värdet justeras (enkelt SR-light, ej SM-2).
  const GRADE_RULES = {
    1: { // Svårt
      insertAfter: 2,        // kommer snart igen
      boxDelta: -1           // blir "närmare"
    },
    2: { // Okej
      insertAfter: 6,
      boxDelta: 0
    },
    3: { // Lätt
      insertAfter: 12,       // kommer senare
      boxDelta: +1
    }
  };

  const ANTI_STARVE_EVERY = 7; // ungefär var 7:e repetition
  const ANTI_STARVE_OFFSET = 3;

  // ====== State ======
  let words = [];           // hela däck
  let queue = [];           // dagens kö av index i "words"
  let currentIdx = -1;      // pekare i kön
  let repsThisSession = 0;
  let direction = DIR.FA2SV;
  let boxes = loadBoxes();  // { key: box }

  // ====== DOM ======
  const el = {
    modeToggle: document.getElementById("modeToggle"),
    modeLabel:  document.getElementById("modeLabel"),
    newSession: document.getElementById("newSession"),

    card:       document.getElementById("card"),
    front:      document.getElementById("front"),
    frontFa:    document.getElementById("front-fa"),
    revealBtn:  document.getElementById("revealBtn"),

    back:           document.getElementById("back"),
    backFa:         document.getElementById("back-fa"),
    backTranslit:   document.getElementById("back-translit"),
    backSv:         document.getElementById("back-sv"),
    exFa:           document.getElementById("ex-fa"),
    exTranslit:     document.getElementById("ex-translit"),
    exSv:           document.getElementById("ex-sv"),

    grading:    document.getElementById("grading"),
    gradeBtns:  Array.from(document.querySelectorAll(".grade")),

    progress:   document.getElementById("progress"),
    queueLeft:  document.getElementById("queueLeft"),
  };

  // ====== Init ======
  boot();

  async function boot() {
    words = await fetchWords();
    attachEvents();
    startNewSession(); // kör en direkt så du kommer igång
  }

  function attachEvents() {
    // Riktning
    el.modeToggle.addEventListener("click", () => {
      direction = direction === DIR.FA2SV ? DIR.SV2FA : DIR.FA2SV;
      el.modeLabel.textContent = direction === DIR.FA2SV ? "Farsi → Svenska" : "Svenska → Farsi";
      startNewSession();
    });

    // Ny session
    el.newSession.addEventListener("click", startNewSession);

    // Visa
    el.revealBtn.addEventListener("click", revealBack);

    // Gradering
    el.gradeBtns.forEach(btn => {
      btn.addEventListener("click", () => grade(parseInt(btn.dataset.grade, 10)));
    });

    // Tangentbord
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        toggleReveal();
        return;
      }
      if (["Digit1","Digit2","Digit3"].includes(e.code) && !el.grading.hidden) {
        const g = parseInt(e.code.slice(-1), 10);
        grade(g);
      }
    });
  }

  // ====== Data ======
  async function fetchWords() {
    const res = await fetch(WORDS_URL);
    if (!res.ok) throw new Error(`Kunde inte läsa ${WORDS_URL}`);
    const data = await res.json();

    // Av-duplicera på id om det skulle förekomma dubletter
    const seen = new Set();
    const unique = [];
    for (const w of data) {
      if (!seen.has(w.id)) { seen.add(w.id); unique.push(w); }
    }
    return unique;
  }

  function loadBoxes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  function saveBoxes() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(boxes));
  }
  function boxKey(wordId, dir) {
    return `${wordId}|${dir}`;
  }
  function getBox(wordId, dir) {
    const b = boxes[boxKey(wordId, dir)];
    return clamp(typeof b === "number" ? b : 1, MIN_BOX, MAX_BOX);
  }
  function setBox(wordId, dir, newBox) {
    boxes[boxKey(wordId, dir)] = clamp(newBox, MIN_BOX, MAX_BOX);
  }

  // ====== Session & kö ======
  function startNewSession() {
    // bygga kö: sortera ord efter box stigande, lätt shuffle inom samma box
    const withBox = words.map((w, i) => ({ i, box: getBox(w.id, direction) }));
    withBox.sort((a, b) => a.box - b.box || Math.random() - 0.5);

    queue = withBox.map(x => x.i);
    currentIdx = -1;
    repsThisSession = 0;

    updateProgress();
    nextCard();
  }

  function nextCard() {
    currentIdx++;
    if (currentIdx >= queue.length) {
      // Slut på kön – starta om en ny (liten “loop”) baserat på uppdaterade boxar
      startNewSession();
      return;
    }
    const w = words[queue[currentIdx]];
    // visa framsida
    renderFront(w);
  }

  function applyAntiStarvation() {
    if (repsThisSession % ANTI_STARVE_EVERY !== 0) return;
    // ta något långt bak och för upp det lite
    if (currentIdx + ANTI_STARVE_OFFSET + 1 >= queue.length) return;
    const takeFrom = queue.length - 1;
    const moved = queue.splice(takeFrom, 1)[0];
    queue.splice(currentIdx + ANTI_STARVE_OFFSET, 0, moved);
  }

  // ====== Rendering ======
  function renderFront(w) {
    // reset vy
    el.back.hidden = true;
    el.grading.hidden = true;
    el.revealBtn.hidden = false;
    el.front.hidden = false;

    // sätt framsida
    if (direction === DIR.FA2SV) {
      el.frontFa.textContent = w.fa;
      el.frontFa.dir = "rtl";
    } else {
      el.frontFa.textContent = w.sv;
      el.frontFa.dir = "ltr";
    }
    updateProgress();
  }

  function revealBack() {
    const w = words[queue[currentIdx]];
    // fyll baksida beroende på riktning
    if (direction === DIR.FA2SV) {
      el.backFa.textContent = w.fa;
      el.backFa.dir = "rtl";
      el.backTranslit.textContent = w.translit || "";
      el.backSv.textContent = w.sv || "";

      const ex = (w.examples && w.examples[0]) || {};
      el.exFa.textContent = ex.fa || "";
      el.exFa.dir = "rtl";
      el.exTranslit.textContent = ex.translit || "";
      el.exSv.textContent = ex.sv || "";
    } else {
      // sv→fa: framsidan var svenska; baksidan visar då facit på persiska + translit + svensk igen
      el.backFa.textContent = w.fa;
      el.backFa.dir = "rtl";
      el.backTranslit.textContent = w.translit || "";
      el.backSv.textContent = w.sv || "";

      const ex = (w.examples && w.examples[0]) || {};
      el.exFa.textContent = ex.fa || "";
      el.exFa.dir = "rtl";
      el.exTranslit.textContent = ex.translit || "";
      el.exSv.textContent = ex.sv || "";
    }

    // växla vyer
      el.revealBtn.hidden = true;
      el.front.hidden = true;    
      el.back.hidden = false;     
      el.grading.hidden = false;  
  }

  function toggleReveal() {
    if (el.back.hidden) {
      revealBack();
    } else {
      // gå tillbaka till framsidan
      const w = words[queue[currentIdx]];
      renderFront(w);
    }
  }

  function updateProgress() {
    el.progress.textContent = `${repsThisSession} repetitioner`;
    const left = Math.max(queue.length - (currentIdx + 1), 0);
    el.queueLeft.textContent = `${left} kvar`;
  }

  // ====== Gradering ======
  function grade(g) {
    const rule = GRADE_RULES[g];
    if (!rule) return;

    const wordIndex = queue[currentIdx];
    const w = words[wordIndex];

    // uppdatera box
    const cur = getBox(w.id, direction);
    setBox(w.id, direction, cur + rule.boxDelta);
    saveBoxes();

    // placera om kortet en bit fram i kön (om det finns plats)
    const insertPos = Math.min(currentIdx + rule.insertAfter, queue.length);
    queue.splice(insertPos, 0, wordIndex); // lägg in en kopia framåt

    repsThisSession++;
    applyAntiStarvation();
    nextCard();
  }

  // ====== Utils ======
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
})();
