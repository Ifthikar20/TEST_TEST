// ============================================================
// content.js — DOM Scanner with Blackboard Classic support
// ============================================================

const ADAPTERS = [
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  BLACKBOARD CLASSIC  (highest priority)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: "Blackboard Classic",
    detect: () =>
      !!document.querySelector("#content_listContainer") ||
      !!document.querySelector(".contentListPlain .liItem") ||
      !!document.querySelector(".reviewQuestionsAnswerDiv"),

    extractAllQuestions: () => {
      const items = document.querySelectorAll("#content_listContainer > li.liItem");
      if (items.length === 0) return [];

      return [...items].map((li, idx) => {
        // ── Question text ──
        // The question text is in the first .vtbegenerated div inside the details table
        // Structure: .details > table > tbody > tr > td[colspan] > .vtbegenerated
        const detailsDiv = li.querySelector(".details");
        let questionText = "";

        if (detailsDiv) {
          // Get the question text from the first vtbegenerated div (not inside answer divs)
          const rows = detailsDiv.querySelectorAll("table > tbody > tr");
          for (const row of rows) {
            const cell = row.querySelector("td[colspan] .vtbegenerated");
            if (cell && !cell.closest(".reviewQuestionsAnswerDiv")) {
              questionText = cell.innerText.trim();
              break;
            }
          }
        }

        // Fallback: try the h3 question number
        if (!questionText) {
          const h3 = li.querySelector("h3");
          questionText = h3?.innerText?.trim() || `Question ${idx + 1}`;
        }

        // ── Answer choices ──
        const answerDivs = li.querySelectorAll(".reviewQuestionsAnswerDiv");
        const choices = [...answerDivs].map((div, i) => {
          // Get the letter label (a., b., c., d.)
          const letterSpan = div.querySelector(".answerNumLabelSpan");
          const letter = letterSpan?.innerText?.trim() || "";

          // Get the answer text from the label inside answerTextSpan
          const textSpan = div.querySelector(".answerTextSpan");
          const answerText = textSpan?.innerText?.trim() || "";

          // Get the clickable element (the label or radio input)
          const label = textSpan?.querySelector("label");
          const clickEl = label || textSpan || div;

          return {
            index: i,
            text: `${letter} ${answerText}`.trim(),
            el: clickEl,
          };
        }).filter(c => c.text.length > 0);

        return { question: questionText, choices };
      }).filter(q => q.question || q.choices.length > 0);
    },

    clickChoice: (el) => {
      // In Blackboard Classic review mode, choices may not be clickable
      // But during active quiz, try clicking the label or its radio input
      const input = el?.querySelector("input[type='radio'], input[type='checkbox']");
      if (input) { input.click(); return; }
      el?.click();
    },

    clickNext: () => {
      // Look for navigation buttons in Blackboard
      const selectors = [
        "a.backLink", ".backLink a",
        "input[value='Save and Submit']",
        "input[value*='Next']",
        "a[id*='next']",
        "button[id*='next']",
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn) { btn.click(); return true; }
      }
      return false;
    },
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  BLACKBOARD ULTRA
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: "Blackboard Ultra",
    detect: () =>
      !!document.querySelector("[data-test-id='question-list'], [data-test-id='assessment-attempt']"),
    extractAllQuestions: () => {
      const blocks = document.querySelectorAll("[data-test-id='question']");
      return [...blocks].map(block => {
        const qText = block.querySelector("[data-test-id='question-stem']")?.innerText?.trim() || "";
        const answerEls = block.querySelectorAll("[data-test-id='answer-option']");
        const choices = [...answerEls].map((el, i) => ({
          index: i, text: el.innerText.trim(), el,
        }));
        return { question: qText, choices };
      }).filter(q => q.question || q.choices.length > 0);
    },
    clickChoice: (el) => el?.click(),
    clickNext: () => {
      const btn = document.querySelector("[data-test-id='next-question'], button[aria-label='Next Question']");
      btn?.click();
      return !!btn;
    },
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  ARTICULATE STORYLINE / RISE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: "Articulate Storyline / Rise",
    detect: () =>
      !!document.querySelector(".slide-object-container, #storyline-wrapper, .rise-container, [class*='quiz-question']"),
    extractAllQuestions: () => {
      const blocks = document.querySelectorAll("[class*='quiz-question'], .slide-object-container");
      return [...blocks].map(block => {
        const qText = block.querySelector(".question-text, [class*='question-title']")?.innerText?.trim() || "";
        const choiceEls = block.querySelectorAll(".choice-text, [class*='choice-label'], .answer-text, [class*='answer-option']");
        const choices = [...choiceEls].map((el, i) => ({ index: i, text: el.innerText.trim(), el }));
        return { question: qText, choices };
      }).filter(q => q.question || q.choices.length > 0);
    },
    clickChoice: (el) => el?.closest("label, button, [role='radio']")?.click(),
    clickNext: () => {
      const btn = document.querySelector("[class*='next-button'], button[aria-label*='Next']");
      btn?.click();
      return !!btn;
    },
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CANVAS LMS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: "Canvas LMS",
    detect: () =>
      !!document.querySelector("#quiz-instructions-form, .question.text_only_question, [class*='quiz_question'], #submit_quiz_form"),
    extractAllQuestions: () => {
      const blocks = document.querySelectorAll(".question, .quiz_question, .display_question");
      return [...blocks].map(block => {
        const qText = block.querySelector(".question_text, .quiz_question_stem")?.innerText?.trim() || "";
        const choiceEls = block.querySelectorAll(".answer label, .answer_label");
        const choices = [...choiceEls].map((el, i) => ({ index: i, text: el.innerText.trim(), el }));
        return { question: qText, choices };
      }).filter(q => q.question || q.choices.length > 0);
    },
    clickChoice: (el) => { el?.querySelector("input")?.click(); },
    clickNext: () => {
      const btn = document.querySelector(".next-question, button[data-direction='next'], .submit_button");
      btn?.click();
      return !!btn;
    },
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  MOODLE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: "Moodle Quiz",
    detect: () =>
      !!document.querySelector(".que.multichoice, .que.truefalse, #page-mod-quiz-attempt"),
    extractAllQuestions: () => {
      const blocks = document.querySelectorAll(".que");
      return [...blocks].map(block => {
        const qText = block.querySelector(".qtext, .questiontext")?.innerText?.trim() || "";
        const choiceEls = block.querySelectorAll(".answer label");
        const choices = [...choiceEls].map((el, i) => ({ index: i, text: el.innerText.trim(), el }));
        return { question: qText, choices };
      }).filter(q => q.question || q.choices.length > 0);
    },
    clickChoice: (el) => { el?.querySelector("input")?.click(); },
    clickNext: () => {
      const btn = document.querySelector("input[name='next'], button[name='next']");
      btn?.click();
      return !!btn;
    },
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  GENERIC FALLBACK
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: "Generic Fallback",
    detect: () => true,
    extractAllQuestions: () => {
      // Try radio groups first
      const groups = findRadioGroups();
      if (groups.length > 0) return groups;

      // Fallback: single question from page text
      return [singleScrape()];
    },
    clickChoice: (el) => {
      const input = el?.querySelector("input") || el;
      input?.click();
    },
    clickNext: () => {
      const candidates = [...document.querySelectorAll("button, input[type='button'], input[type='submit'], a")];
      const next = candidates.find(el => {
        const t = (el.innerText || el.value || "").toLowerCase();
        return t.includes("next") || t.includes("continue") || t.includes("submit");
      });
      next?.click();
      return !!next;
    },
  },
];

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════

function findRadioGroups() {
  const radios = [...document.querySelectorAll("input[type='radio']")];
  const groups = {};
  radios.forEach(r => {
    const name = r.getAttribute("name") || "default";
    if (!groups[name]) groups[name] = [];
    const label = document.querySelector(`label[for="${r.id}"]`) || r.closest("label") || r.parentElement;
    groups[name].push({ index: groups[name].length, text: label?.innerText?.trim() || "", el: label || r });
  });

  return Object.keys(groups).filter(n => groups[n].length >= 2).map(name => {
    const firstRadio = document.querySelector(`input[name="${name}"]`);
    const container = firstRadio?.closest("div, fieldset, section");
    const qText = container?.querySelector("p, h2, h3, h4, legend, strong")?.innerText?.trim() || "";
    return { question: qText, choices: groups[name] };
  });
}

function singleScrape() {
  let question = "";
  for (const sel of ["h1", "h2", "h3", ".question", "strong", "p"]) {
    const el = document.querySelector(sel);
    const txt = el?.innerText?.trim();
    if (txt && txt.length > 10 && txt.length < 2000) { question = txt; break; }
  }
  const inputs = [...document.querySelectorAll("input[type='radio'], input[type='checkbox']")];
  const choices = inputs.map((input, i) => {
    const label = document.querySelector(`label[for="${input.id}"]`) || input.closest("label") || input.parentElement;
    return { index: i, text: label?.innerText?.trim() || "", el: label || input };
  });
  return { question, choices };
}

// ── Detect active adapter ──
function getAdapter() {
  return ADAPTERS.find(a => a.detect()) || ADAPTERS[ADAPTERS.length - 1];
}

// ── Highlight answer ──
function highlightAnswer(choiceEl) {
  document.querySelectorAll("[data-el-highlight]").forEach(el => {
    el.style.outline = "";
    el.style.backgroundColor = "";
    delete el.dataset.elHighlight;
  });
  if (choiceEl) {
    choiceEl.style.outline = "3px solid #22c55e";
    choiceEl.style.backgroundColor = "rgba(34,197,94,0.15)";
    choiceEl.dataset.elHighlight = "true";
    choiceEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// ── Message listener ──
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const adapter = getAdapter();

  if (msg.type === "SCRAPE_ALL") {
    const questions = adapter.extractAllQuestions();
    const pageText = document.body.innerText.substring(0, 12000);
    sendResponse({
      platform: adapter.name,
      questions: questions.map(q => ({
        question: q.question,
        choices: q.choices.map(c => ({ index: c.index, text: c.text })),
      })),
      pageText,
      url: location.href,
      title: document.title,
      totalQuestions: questions.length,
    });
  } else if (msg.type === "SCRAPE") {
    const questions = adapter.extractAllQuestions();
    const q = questions[msg.questionIndex || 0] || questions[0] || singleScrape();
    const pageText = document.body.innerText.substring(0, 12000);
    sendResponse({
      platform: adapter.name,
      question: q.question,
      choices: q.choices.map(c => ({ index: c.index, text: c.text })),
      pageText,
    });
  } else if (msg.type === "CLICK_CHOICE") {
    const questions = adapter.extractAllQuestions();
    const q = questions[msg.questionIndex || 0];
    if (q && q.choices[msg.choiceIndex]) {
      const el = q.choices[msg.choiceIndex].el;
      adapter.clickChoice(el);
      highlightAnswer(el);
    }
    sendResponse({ success: true });
  } else if (msg.type === "CLICK_NEXT") {
    const success = adapter.clickNext();
    sendResponse({ success });
  } else if (msg.type === "HIGHLIGHT") {
    const questions = adapter.extractAllQuestions();
    const q = questions[msg.questionIndex || 0];
    if (q && q.choices[msg.choiceIndex]) {
      highlightAnswer(q.choices[msg.choiceIndex].el);
    }
    sendResponse({ success: true });
  } else if (msg.type === "PING") {
    sendResponse({ alive: true });
  }
  return true;
});
