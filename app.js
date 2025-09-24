(() => {
  "use strict";

  // ====== Konstanter / nycklar ======
  const WORDS_URL = "words.json";
  const STORAGE_KEY = "farsiflow.boxes.v1"; // { "<id>|fa2sv": { box, due }, ... }
  const DIR = { FA2SV: "fa2sv", SV2FA: "sv2fa" };
  const MAX_BOX = 3;
  const MIN_BOX = 1;

  // Graderingsregler: hur långt fram vi stoppar tillbaka kortet
  // samt hur box-värdet justeras (enkelt SR-light, ej SM-2).
  const GRADE_RULES = {
    1: { // Svårt
      insertAfter: 1,        // kommer mycket snart igen
      boxDelta: -1
    },
    2: { // Okej
      insertAfter: 6,
      boxDelta: 0
    },
    3: { // Lätt
      insertAfter: 12,
      boxDelta: +1
    }
  };

  const ANTI_STARVE_EVERY = 7; // ungefär var 7:e repetition
  const ANTI_STARVE_OFFSET = 3;
  const BOX_INTERVALS = {
    1: 5 * 60 * 1000,              // 5 minuter
    2: 24 * 60 * 60 * 1000,        // 1 dag
    3: 3 * 24 * 60 * 60 * 1000     // 3 dagar
  };
  const SESSION_TARGET = 20;
  const MIN_SESSION_SIZE = 10;

  // ====== State ======
  let words = [];           // hela däck
  let queue = [];           // dagens kö av index i "words"
  let currentIdx = -1;      // pekare i kön
  let repsThisSession = 0;
  let direction = DIR.FA2SV;
  let boxes = loadBoxes();  // { key: { box, due } }
  const exampleOffsets = Object.create(null);
  let revealedCardKey = null;
  let revealedExample = null;

  // ====== DOM ======
  const el = {
    modeToggle: document.getElementById("modeToggle"),
    modeLabel:  document.getElementById("modeLabel"),
    newSession: document.getElementById("newSession"),
    startQuizBtn: document.getElementById("startQuizBtn"),

    main:       document.querySelector("main"),
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
    quiz:       document.getElementById("quiz"),
    footer:     document.querySelector("footer"),
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
    el.newSession.addEventListener("click", () => {
      showFlashcards();
      startNewSession();
    });

    if (el.startQuizBtn) {
      el.startQuizBtn.addEventListener("click", () => {
        hideFlashcards();
        if (window.farsiQuiz && typeof window.farsiQuiz.startQuiz === "function") {
          window.farsiQuiz.startQuiz();
        }
      });
    }

    // Visa
    el.revealBtn.addEventListener("click", revealBack);

    // Gradering
    el.gradeBtns.forEach(btn => {
      btn.addEventListener("click", () => grade(parseInt(btn.dataset.grade, 10)));
    });

    // Tangentbord
    window.addEventListener("keydown", (e) => {
      if (isQuizActive()) return;
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
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return {};
      const normalized = {};
      for (const [key, value] of Object.entries(parsed)) {
        normalized[key] = normalizeBoxValue(value);
      }
      return normalized;
    } catch {
      return {};
    }
  }
  function saveBoxes() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(boxes));
  }
  function normalizeBoxValue(val) {
    if (typeof val === "number") {
      return { box: clamp(val, MIN_BOX, MAX_BOX), due: 0 };
    }
    if (val && typeof val === "object") {
      const box = clamp(typeof val.box === "number" ? val.box : 1, MIN_BOX, MAX_BOX);
      const due = typeof val.due === "number" ? val.due : 0;
      return { box, due };
    }
    return { box: 1, due: 0 };
  }
  function ensureBoxEntry(wordId, dir) {
    const key = boxKey(wordId, dir);
    const current = boxes[key];
    if (!current) {
      boxes[key] = { box: 1, due: 0 };
      return boxes[key];
    }
    const normalized = normalizeBoxValue(current);
    boxes[key] = normalized;
    return normalized;
  }
  function boxKey(wordId, dir) {
    return `${wordId}|${dir}`;
  }
  function getBox(wordId, dir) {
    return ensureBoxEntry(wordId, dir).box;
  }
  function setBox(wordId, dir, newBox, newDue) {
    const entry = ensureBoxEntry(wordId, dir);
    entry.box = clamp(newBox, MIN_BOX, MAX_BOX);
    if (typeof newDue === "number") {
      entry.due = newDue;
    }
  }

  // ====== Session & kö ======
  function startNewSession(queueOverride) {
    if (Array.isArray(queueOverride) && queueOverride.length) {
      queue = queueOverride.slice();
      currentIdx = -1;
       repsThisSession = 0;

       updateProgress();
        nextCard();
        return;
    }
    const now = Date.now();
    const due = [];
    const upcoming = [];

    words.forEach((w, i) => {
      const entry = ensureBoxEntry(w.id, direction);
      const item = { index: i, box: entry.box, due: entry.due };
      if (item.due <= now) {
        due.push(item);
      } else {
        upcoming.push(item);
      }
    });

    due.sort((a, b) => (a.due - b.due) || (a.box - b.box));
    let session = due.slice(0, SESSION_TARGET);

    if (session.length < MIN_SESSION_SIZE) {
      upcoming.sort((a, b) => a.due - b.due);
      const needed = MIN_SESSION_SIZE - session.length;
      if (needed > 0) {
        session = session.concat(upcoming.slice(0, needed));
      }
    }

    if (!session.length) {
      upcoming.sort((a, b) => a.due - b.due);
      session = upcoming.slice(0, SESSION_TARGET);
    }

    const grouped = new Map();
    session.forEach(item => {
      const bucket = grouped.get(item.box) || [];
      bucket.push(item);
      grouped.set(item.box, bucket);
    });

    const ordered = [];
    for (let box = MIN_BOX; box <= MAX_BOX; box++) {
      const bucket = grouped.get(box);
      if (!bucket) continue;
      shuffle(bucket);
      bucket.forEach(item => ordered.push(item.index));
    }

    if (!ordered.length) {
      queue = [];
      currentIdx = -1;
      repsThisSession = 0;
      updateProgress();
      return;
    }

    queue = ordered;
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
    revealedCardKey = null;
    revealedExample = null;

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
    const cardKey = `${w.id}|${direction}`;
    if (revealedCardKey !== cardKey) {
      revealedExample = nextExample(w);
      revealedCardKey = cardKey;
    }
    fillBack(w, revealedExample);

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
    const left = uniqueRemaining();
    el.queueLeft.textContent = `${left} kort kvar`;
  }

  // ====== Gradering ======
  function grade(g) {
    const rule = GRADE_RULES[g];
    if (!rule) return;

    const wordIndex = queue[currentIdx];
    const w = words[wordIndex];

    // uppdatera box och duedatum
    const cur = getBox(w.id, direction);
    const nextBox = clamp(cur + rule.boxDelta, MIN_BOX, MAX_BOX);
    const interval = BOX_INTERVALS[nextBox] || 0;
    const due = Date.now() + interval;
    setBox(w.id, direction, nextBox, due);
    saveBoxes();

    // placera om kortet en bit fram i kön (om det finns plats)
    const insertPos = Math.min(currentIdx + rule.insertAfter, queue.length);
    queue.splice(insertPos, 0, wordIndex); // lägg in en kopia framåt

    repsThisSession++;
    applyAntiStarvation();
    nextCard();
  }

  // ====== Utils ======
  function fillBack(w, example) {
    el.backFa.textContent = w.fa || "";
    el.backFa.dir = "rtl";
    el.backTranslit.textContent = w.translit || "";
    el.backSv.textContent = w.sv || "";

    if (example) {
      el.exFa.textContent = example.fa || "";
      el.exFa.dir = "rtl";
      el.exTranslit.textContent = example.translit || "";
      el.exSv.textContent = example.sv || "";
    } else {
      el.exFa.textContent = "";
      el.exTranslit.textContent = "";
      el.exSv.textContent = "";
    }
  }
  function nextExample(word) {
    if (!word || !Array.isArray(word.examples) || !word.examples.length) {
      return null;
    }
    const key = `${word.id}|${direction}`;
    let offset = exampleOffsets[key];
    if (typeof offset !== "number") {
      offset = Math.floor(Math.random() * word.examples.length);
    }
    const example = word.examples[offset % word.examples.length] || null;
    exampleOffsets[key] = (offset + 1) % word.examples.length;
    return example;
  }
  function startCustomSession(targets) {
      const ids = Array.isArray(targets) ? targets.map(normalizeTarget).filter(Boolean) : [];
    if (!words.length) {
      showFlashcards();
      startNewSession();
      return;
    }
    const seen = new Set();
    const indexes = [];
    ids.forEach((id) => {
      if (seen.has(id)) return;
      seen.add(id);
      const idx = words.findIndex((word) => word.id === id);
      if (idx !== -1) {
        indexes.push(idx);
      }
    });
    if (!indexes.length) {
      showFlashcards();
      startNewSession();
      return;
    }
    showFlashcards();
    startNewSession(indexes);
  }
  function getWordsSnapshot() {
    return words.slice();
  }
  function normalizeTarget(value) {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && typeof value.id === "string") {
      return value.id;
    }
    return null;
  }
  function showFlashcards() {
    setNodeVisible(el.card, true);
    setNodeVisible(el.grading, true);
    setNodeVisible(el.footer, true);
    setQuizVisible(false);
  }
  function hideFlashcards() {
    setNodeVisible(el.card, false);
    setNodeVisible(el.grading, false);
    setNodeVisible(el.footer, false);
    setQuizVisible(true);
  }
  function setQuizVisible(visible) {
    if (!el.quiz) return;
    el.quiz.hidden = !visible;
  }
  function isQuizActive() {
    return el.quiz && !el.quiz.hidden;
  }
  function toggleHidden(node, shouldShow) {
    if (!node) return;
    node.hidden = !shouldShow;
  }
  function setNodeVisible(node, shouldShow) {
    if (!node) return;
    node.hidden = !shouldShow;
    node.style.display = shouldShow ? "" : "none";
  }

  function uniqueRemaining() {
    if (!queue.length) return 0;
    const upcoming = queue.slice(Math.max(currentIdx + 1, 0));
    const uniq = new Set(upcoming);
    return uniq.size;
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  window.farsiFlow = {
    getWords: getWordsSnapshot,
    startCustomSession,
    showFlashcards,
    hideFlashcards
  };

})();
