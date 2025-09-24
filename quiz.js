(() => {
  "use strict";

  const state = {
    questions: [],
    currentIndex: 0,
    score: 0,
    total: 0,
    mistakes: [],
    almost: 0,
    awaiting: false
  };

  const el = {
    section: null,
    card: null,
    prompt: null,
    input: null,
    submit: null,
    skip: null,
    feedback: null,
    status: null,
    progress: null,
    results: null,
    nextBtn: null
  };

  function initDom() {
    if (el.section) return;
    el.section = document.getElementById("quiz");
    if (!el.section) return;

    el.card = el.section.querySelector(".quiz-card");
    el.prompt = document.getElementById("quiz-prompt");
    el.input = document.getElementById("quiz-input");
    el.submit = document.getElementById("quiz-submit");
    el.skip = document.getElementById("quiz-skip");
    el.feedback = document.getElementById("quiz-feedback");
    el.status = document.getElementById("quiz-status");
    el.progress = document.getElementById("quiz-progress");

    el.results = document.getElementById("quiz-results");
    if (!el.results) {
      el.results = document.createElement("div");
      el.results.id = "quiz-results";
      el.results.hidden = true;
      el.section.appendChild(el.results);
    }

    if (el.submit && el.skip && el.submit.parentElement === el.skip.parentElement) {
      el.submit.parentElement.appendChild(el.submit);
      el.submit.parentElement.insertBefore(el.skip, el.submit);
    }
    if (el.skip && !el.skip.dataset.bound) {
      el.skip.addEventListener("click", handleSkip);
      el.skip.dataset.bound = "1";
    }
    if (el.submit && !el.submit.dataset.bound) {
      el.submit.addEventListener("click", handleSubmit);
      el.submit.dataset.bound = "1";
    }
    if (!el.nextBtn) {
      el.nextBtn = document.getElementById("quiz-next") || document.createElement("button");
      if (!el.nextBtn.id) {
        el.nextBtn.id = "quiz-next";
        el.nextBtn.type = "button";
        el.nextBtn.textContent = "Nästa";
      }
    }
    if (el.nextBtn && !el.nextBtn.dataset.bound) {
      el.nextBtn.addEventListener("click", handleNext);
      el.nextBtn.dataset.bound = "1";
    }
    hideNextButton();
    if (el.input) {
      el.input.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") {
          evt.preventDefault();
          handleSubmit();
        }
      });
    }
  }

  function startQuiz(count = 10) {
    initDom();
    if (!el.section) return;

    const source = getWordPool();
    if (!source.length) {
      renderUnavailable();
      return;
    }

    shuffle(source);
    const desired = Math.min(count, source.length);

    state.questions = source.slice(0, desired);
    state.currentIndex = 0;
    state.score = 0;
    state.total = desired;
    state.mistakes = [];
    state.almost = 0;
    state.awaiting = false;

    if (el.results) {
      el.results.hidden = true;
      el.results.replaceChildren();
    }
    if (el.card) {
      el.card.hidden = false;
    }
    if (el.feedback) {
      el.feedback.replaceChildren();
      hideNextButton();
    }
    if (el.progress) {
      el.progress.textContent = desired ? `Fråga 1 av ${desired}` : "";
    }
    if (el.input) {
      el.input.value = "";
      el.input.disabled = false;
      el.input.focus();
    }
    if (el.skip) {
      el.skip.disabled = false;
    }
    if (el.submit) {
      el.submit.disabled = false;
    }

    renderQuestion();
  }

  function renderQuestion() {
    if (!state.questions.length || state.currentIndex >= state.total) {
      finishQuiz();
      return;
    }

    const word = state.questions[state.currentIndex];
    const prompt = word.fa || word.translit || "";

    if (el.prompt) {
      el.prompt.textContent = prompt;
      el.prompt.dir = word.fa ? "rtl" : "ltr";
    }
    if (el.feedback) {
      el.feedback.replaceChildren();
      hideNextButton();
    }
    if (el.input) {
      el.input.value = "";
      el.input.disabled = false;
      el.input.focus();
    }
    if (el.skip) {
      el.skip.disabled = false;
    }
    if (el.submit) {
      el.submit.disabled = false;
    }
    state.awaiting = false;
    updateProgress();
  }

  function handleSubmit() {
    if (state.awaiting) return;
    const answer = el.input ? el.input.value : "";
    checkAnswer(answer);
  }

  function handleSkip() {
    if (state.awaiting) return;
    checkAnswer("");
  }

  function handleNext() {
    if (!state.awaiting) return;
    state.awaiting = false;
    hideNextButton();
    state.currentIndex += 1;
    if (state.currentIndex >= state.total) {
      finishQuiz();
      return;
    }
    renderQuestion();
  }

  function checkAnswer(userInput) {
    if (!state.questions.length || state.currentIndex >= state.total) {
      finishQuiz();
      return;
    }

    const word = state.questions[state.currentIndex];
    const normalizedUser = normalize(userInput);
    const answers = buildAcceptedAnswers(word);
    const result = evaluateAnswer(normalizedUser, answers);

    if (result.status === "correct") {
      state.score += 1;
    } else if (result.status === "almost") {
      state.almost += 1;
      state.mistakes.push(word);
    } else {
      state.mistakes.push(word);
    }

    showFeedback(result, word, answers);

    state.awaiting = true;
    if (el.input) {
      el.input.disabled = true;
    }
    if (el.skip) {
      el.skip.disabled = true;
    }
    if (el.submit) {
      el.submit.disabled = true;
    }
  }

  function finishQuiz() {
    initDom();
    state.awaiting = false;

    if (el.card) {
      el.card.hidden = true;
    }
    if (el.feedback) {
      el.feedback.replaceChildren();
      hideNextButton();
    }
    if (el.input) {
      el.input.disabled = false;
    }
    if (el.skip) {
      el.skip.disabled = false;
    }
    if (el.submit) {
      el.submit.disabled = false;
    }

    const misses = dedupeById(state.mistakes);
    state.mistakes = misses;

    if (!el.results) return;
    el.results.hidden = false;
    el.results.replaceChildren(buildSummary(misses));

    if (el.progress) {
      el.progress.textContent = `Klart – ${state.score} av ${state.total} rätt`;
    }
  }

  function buildSummary(misses) {
    const fragment = document.createDocumentFragment();

    const summary = document.createElement("p");
    summary.textContent = `Du fick ${state.score} av ${state.total} rätt.`;
    fragment.appendChild(summary);

    if (misses.length) {
      const heading = document.createElement("p");
      heading.textContent = "Svåra ord:";
      fragment.appendChild(heading);

      const list = document.createElement("ul");
      misses.forEach((word) => {
        const item = document.createElement("li");

        const fa = document.createElement("span");
        fa.textContent = word.fa || word.translit || "";
        if (word.fa) {
          fa.dir = "rtl";
        }
        item.appendChild(fa);

        if (word.translit) {
          const translit = document.createElement("span");
          translit.textContent = ` (${word.translit})`;
          item.appendChild(translit);
        }

        const sv = document.createElement("span");
        sv.textContent = ` – ${word.sv}`;
        item.appendChild(sv);

        list.appendChild(item);
      });
      fragment.appendChild(list);
    }

    const actions = document.createElement("div");
    actions.className = "actions";

    const againBtn = document.createElement("button");
    againBtn.type = "button";
    againBtn.className = "btn primary";
    againBtn.textContent = "Öva dessa igen";
    againBtn.disabled = !misses.length;
    againBtn.addEventListener("click", () => {
      const api = window.farsiFlow;
      if (api && typeof api.startCustomSession === "function") {
        api.startCustomSession(misses);
      }
    });
    actions.appendChild(againBtn);

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "btn secondary";
    retryBtn.textContent = "Ny quiz";
    retryBtn.addEventListener("click", () => {
      const api = window.farsiFlow;
      if (api && typeof api.hideFlashcards === "function") {
        api.hideFlashcards();
      }
      startQuiz(state.total || 10);
    });
    actions.appendChild(retryBtn);

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "btn secondary";
    backBtn.textContent = "Tillbaka till kort";
    backBtn.addEventListener("click", () => {
      const api = window.farsiFlow;
      if (api && typeof api.startCustomSession === "function") {
        api.startCustomSession([]);
      }
    });
    actions.appendChild(backBtn);

    fragment.appendChild(actions);
    return fragment;
  }

  function showFeedback(result, word, answers) {
    initDom();
    if (!el.feedback) return;

    const heading = document.createElement("p");
    heading.className = `feedback-${result.status}`;
    heading.textContent =
      result.status === "correct"
        ? "Korrekt! Rätt svar är:"
        : result.status === "almost"
          ? "Nästan rätt! Rätt svar är:"
          : "Fel! Rätt svar är:";

    const answerLine = document.createElement("p");
    answerLine.className = "feedback-answer";
    const answerText = answers.display.length ? answers.display.join(" / ") : (word.sv || "");
    answerLine.textContent = answerText;

    el.feedback.replaceChildren(heading, answerLine);

    showNextButton();
  }

  function updateProgress() {
    if (!el.progress) return;
    const current = Math.min(state.currentIndex + 1, state.total);
    el.progress.textContent = `Fråga ${current} av ${state.total}`;
  }

  function renderUnavailable() {
    initDom();
    if (!el.section) return;

    if (el.card) {
      el.card.hidden = true;
    }
    if (el.nextBtn) {
      el.nextBtn.hidden = true;
    }
    if (!el.results) return;

    el.results.hidden = false;
    el.results.replaceChildren();

    const info = document.createElement("p");
    info.textContent = "Inga ord är tillgängliga för quiz ännu.";
    el.results.appendChild(info);
  }

  function getWordPool() {
    const api = window.farsiFlow;
    if (api && typeof api.getWords === "function") {
      return api.getWords().filter((word) => word && word.sv);
    }
    return [];
  }

  function buildAcceptedAnswers(word) {
    const variants = [];
    if (typeof word.sv === "string") {
      variants.push(...splitVariants(word.sv));
    }
    if (Array.isArray(word.alt)) {
      variants.push(...word.alt);
    }

    const display = [];
    const normalized = [];
    const seen = new Set();

    variants.forEach((entry) => {
      const trimmed = typeof entry === "string" ? entry.trim() : "";
      if (!trimmed) return;
      const norm = normalize(trimmed);
      if (seen.has(norm)) return;
      seen.add(norm);
      display.push(trimmed);
      normalized.push(norm);
    });

    return { display, normalized };
  }

  function evaluateAnswer(user, answers) {
    if (!answers.normalized.length) {
      return { status: user ? "wrong" : "wrong" };
    }
    for (let i = 0; i < answers.normalized.length; i += 1) {
      if (answers.normalized[i] === user) {
        return { status: "correct" };
      }
    }
    if (!user) {
      return { status: "wrong" };
    }
    let bestIndex = -1;
    let bestDistance = Infinity;

    answers.normalized.forEach((candidate, index) => {
      const distance = levenshtein(user, candidate);
      const threshold = fuzzyThreshold(candidate.length);
      if (distance <= threshold && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    if (bestIndex !== -1) {
      return { status: "almost" };
    }
    return { status: "wrong" };
  }

  function dedupeById(list) {
    const seen = new Set();
    const result = [];
    list.forEach((item) => {
      if (!item || typeof item.id !== "string") return;
      if (seen.has(item.id)) return;
      seen.add(item.id);
      result.push(item);
    });
    return result;
  }

  function splitVariants(text) {
    return text.split("/").map((part) => part.trim()).filter(Boolean);
  }

  function normalize(value) {
    if (typeof value !== "string") return "";
    return value.trim().toLowerCase().replace(/\s+/g, " ");
  }

  function fuzzyThreshold(length) {
    return length < 8 ? 2 : 3;
  }

  function hideNextButton() {
    if (!el.nextBtn) return;
    el.nextBtn.hidden = true;
    el.nextBtn.disabled = false;
    el.nextBtn.style.display = "none";
    if (el.nextBtn.isConnected) {
      el.nextBtn.remove();
    }
  }

  function showNextButton() {
    if (!el.nextBtn || !el.feedback) return;
    el.nextBtn.hidden = false;
    el.nextBtn.disabled = false;
    el.nextBtn.style.display = "flex";
    if (!el.nextBtn.isConnected) {
      el.feedback.appendChild(el.nextBtn);
    }
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function levenshtein(a, b) {
    const aLen = a.length;
    const bLen = b.length;
    if (!aLen) return bLen;
    if (!bLen) return aLen;

    const matrix = Array.from({ length: aLen + 1 }, () => new Array(bLen + 1));

    for (let i = 0; i <= aLen; i += 1) matrix[i][0] = i;
    for (let j = 0; j <= bLen; j += 1) matrix[0][j] = j;

    for (let i = 1; i <= aLen; i += 1) {
      for (let j = 1; j <= bLen; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[aLen][bLen];
  }

  window.farsiQuiz = {
    startQuiz,
    renderQuestion,
    checkAnswer,
    finishQuiz,
    levenshtein
  };
})();
