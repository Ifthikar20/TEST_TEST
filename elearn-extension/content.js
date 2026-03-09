// ============================================================
// content.js — eLearning DOM Scanner
// Injected into every page. Listens for messages from popup.
// ============================================================

// ---- Platform Adapters ----
// Each adapter knows how to extract questions/answers and navigate
// for a specific eLearning platform.

const ADAPTERS = [
  {
    name: "Articulate Storyline / Rise",
    detect: () =>
      !!document.querySelector(
        ".slide-object-container, #storyline-wrapper, .rise-container, [class*='quiz-question']"
      ),
    extractQuestion: () => {
      const q =
        document.querySelector(
          ".question-text, [class*='question-title'], [class*='quiz-question-text'], .slide-title"
        )?.innerText?.trim() ||
        document.querySelector(".text-object p")?.innerText?.trim();
      return q || null;
    },
    extractChoices: () =>
      [...document.querySelectorAll(".choice-text, [class*='choice-label'], .answer-text, [class*='answer-option']")]
        .map((el, i) => ({ index: i, text: el.innerText.trim(), el })),
    clickNext: () => {
      const btn = document.querySelector(
        "[class*='next-button'], button[aria-label*='Next'], button[aria-label*='next'], .next-btn, #next-btn"
      );
      btn?.click();
      return !!btn;
    },
    clickChoice: (index) => {
      const choices = document.querySelectorAll(
        ".choice-text, [class*='choice-label'], .answer-text, [class*='answer-option']"
      );
      choices[index]?.closest("label, button, [role='radio'], [role='checkbox']")?.click();
    },
  },

  {
    name: "Canvas LMS / Quizzes",
    detect: () =>
      !!document.querySelector(
        "#quiz-instructions-form, .question.text_only_question, [class*='quiz_question'], #submit_quiz_form"
      ),
    extractQuestion: () =>
      document.querySelector(".question_text, .quiz_question_stem")?.innerText?.trim() || null,
    extractChoices: () =>
      [...document.querySelectorAll(".answer label, .answer_label, .answer .answer_text")]
        .map((el, i) => ({ index: i, text: el.innerText.trim(), el })),
    clickNext: () => {
      const btn = document.querySelector(".next-question, button[data-direction='next'], .quiz_next");
      btn?.click();
      return !!btn;
    },
    clickChoice: (index) => {
      const inputs = document.querySelectorAll(".answer input[type='radio'], .answer input[type='checkbox']");
      inputs[index]?.click();
    },
  },

  {
    name: "Moodle Quiz",
    detect: () =>
      !!document.querySelector(".que.multichoice, .que.truefalse, .que.shortanswer, #page-mod-quiz-attempt"),
    extractQuestion: () =>
      document.querySelector(".qtext, .questiontext")?.innerText?.trim() || null,
    extractChoices: () =>
      [...document.querySelectorAll(".answer label, .answer .flex-wrap label")]
        .map((el, i) => ({ index: i, text: el.innerText.trim(), el })),
    clickNext: () => {
      const btn = document.querySelector(
        "input[name='next'], button[name='next'], .submitbtns input[value*='Next']"
      );
      btn?.click();
      return !!btn;
    },
    clickChoice: (index) => {
      const inputs = document.querySelectorAll(".answer input[type='radio'], .answer input[type='checkbox']");
      inputs[index]?.click();
    },
  },

  {
    name: "Blackboard / Ultra",
    detect: () =>
      !!document.querySelector(
        "#assessment-attempt, .question-container, [data-test-id='question-list'], .bb-body"
      ),
    extractQuestion: () =>
      document.querySelector(
        "[data-test-id='question-stem'], .question-stem, .question-text"
      )?.innerText?.trim() || null,
    extractChoices: () =>
      [...document.querySelectorAll("[data-test-id='answer-option'], .answer-option, .answer-choice")]
        .map((el, i) => ({ index: i, text: el.innerText.trim(), el })),
    clickNext: () => {
      const btn = document.querySelector(
        "[data-test-id='next-question'], button[aria-label='Next Question'], .next-question-button"
      );
      btn?.click();
      return !!btn;
    },
    clickChoice: (index) => {
      const btns = document.querySelectorAll(
        "[data-test-id='answer-option'], .answer-option, .answer-choice"
      );
      btns[index]?.click();
    },
  },

  {
    name: "Generic / Fallback",
    detect: () => true,
    extractQuestion: () => {
      // Try common question patterns — cast a wide net
      const selectors = [
        "h1.question", "h2.question", ".question h2", ".question h3",
        "[class*='question'][class*='text']",
        "[id*='question']",
        "p.question",
        "fieldset legend",
        "form p:first-of-type",
        // Broader fallbacks
        ".question", "[class*='prompt']", "[class*='stem']",
        "h1", "h2", "h3", "h4",
        "strong", "b",
        "label",
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        const txt = el?.innerText?.trim();
        if (txt && txt.length > 10 && txt.length < 2000) return txt;
      }
      return null;
    },
    extractChoices: () => {
      // Find all radio/checkbox labels on the page
      const radioLabels = [];
      const inputs = [...document.querySelectorAll("input[type='radio'], input[type='checkbox']")];
      inputs.forEach((input, i) => {
        const label =
          document.querySelector(`label[for="${input.id}"]`) ||
          input.closest("label") ||
          input.parentElement;
        if (label) {
          radioLabels.push({ index: i, text: label.innerText.trim(), el: label });
        }
      });

      // If no radio/checkbox found, try looking for clickable list items or buttons that look like choices
      if (radioLabels.length === 0) {
        const candidates = [...document.querySelectorAll("li, [role='option'], [role='radio'], [role='button']")];
        candidates.forEach((el, i) => {
          const txt = el.innerText?.trim();
          if (txt && txt.length > 0 && txt.length < 500) {
            radioLabels.push({ index: i, text: txt, el });
          }
        });
      }

      return radioLabels;
    },
    clickNext: () => {
      const candidates = [...document.querySelectorAll("button, input[type='button'], input[type='submit'], a")];
      const next = candidates.find((el) => {
        const t = (el.innerText || el.value || el.getAttribute("aria-label") || "").toLowerCase();
        return t.includes("next") || t.includes("continue") || t.includes("proceed");
      });
      next?.click();
      return !!next;
    },
    clickChoice: (index) => {
      const inputs = document.querySelectorAll("input[type='radio'], input[type='checkbox']");
      inputs[index]?.click();
    },
  },
];

// ---- Detect active adapter ----
function getAdapter() {
  return ADAPTERS.find((a) => a.detect()) || ADAPTERS[ADAPTERS.length - 1];
}

// ---- Scrape current question data ----
function scrapeQuestion() {
  const adapter = getAdapter();
  const question = adapter.extractQuestion();
  const choices = adapter.extractChoices();
  const pageText = document.body.innerText.substring(0, 10000); // more context for AI
  return {
    platform: adapter.name,
    question,
    choices: choices.map((c) => ({ index: c.index, text: c.text })),
    pageText,
    url: location.href,
    title: document.title,
  };
}

// ---- Click a specific answer choice ----
function clickChoice(index) {
  const adapter = getAdapter();
  adapter.clickChoice(index);
}

// ---- Click next button ----
function clickNext() {
  const adapter = getAdapter();
  return adapter.clickNext();
}

// ---- Highlight correct answer on page ----
function highlightAnswer(index) {
  // Remove any previous highlights
  document.querySelectorAll("[data-el-highlight]").forEach((el) => {
    el.style.outline = "";
    el.style.backgroundColor = "";
    delete el.dataset.elHighlight;
  });

  const adapter = getAdapter();
  const choices = adapter.extractChoices();
  if (choices[index]) {
    const el = choices[index].el;
    el.style.outline = "3px solid #22c55e";
    el.style.backgroundColor = "rgba(34,197,94,0.15)";
    el.dataset.elHighlight = "true";
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// ---- Message listener ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "SCRAPE") {
    sendResponse(scrapeQuestion());
  } else if (msg.type === "CLICK_NEXT") {
    const success = clickNext();
    sendResponse({ success });
  } else if (msg.type === "CLICK_CHOICE") {
    clickChoice(msg.index);
    sendResponse({ success: true });
  } else if (msg.type === "HIGHLIGHT") {
    highlightAnswer(msg.index);
    sendResponse({ success: true });
  } else if (msg.type === "PING") {
    sendResponse({ alive: true });
  }
  return true; // keep channel open for async
});
