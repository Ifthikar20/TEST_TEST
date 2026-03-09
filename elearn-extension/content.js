// ============================================================
// content.js — DOM Scanner with multi-question support
// Finds ALL questions on a page, extracts each individually
// ============================================================

const ADAPTERS = [
  {
    name: "Articulate Storyline / Rise",
    detect: () =>
      !!document.querySelector(
        ".slide-object-container, #storyline-wrapper, .rise-container, [class*='quiz-question']"
      ),
    extractAllQuestions: () => {
      const blocks = document.querySelectorAll(
        ".question-text, [class*='question-title'], [class*='quiz-question'], .slide-object-container"
      );
      return extractFromBlocks(blocks, ".choice-text, [class*='choice-label'], .answer-text, [class*='answer-option']");
    },
    clickChoice: (el) => el?.closest("label, button, [role='radio'], [role='checkbox']")?.click(),
    clickNext: () => clickBySelectors("[class*='next-button'], button[aria-label*='Next'], button[aria-label*='next'], .next-btn, #next-btn"),
  },

  {
    name: "Canvas LMS",
    detect: () =>
      !!document.querySelector("#quiz-instructions-form, .question.text_only_question, [class*='quiz_question'], #submit_quiz_form"),
    extractAllQuestions: () => {
      const blocks = document.querySelectorAll(".question, .quiz_question, .display_question");
      return blocks.length > 0 ? extractFromQuestionDivs(blocks) : [singleScrape()];
    },
    clickChoice: (el) => { const input = el?.querySelector("input[type='radio'], input[type='checkbox']"); input?.click(); },
    clickNext: () => clickBySelectors(".next-question, button[data-direction='next'], .quiz_next, .submit_button"),
  },

  {
    name: "Moodle Quiz",
    detect: () =>
      !!document.querySelector(".que.multichoice, .que.truefalse, .que.shortanswer, #page-mod-quiz-attempt"),
    extractAllQuestions: () => {
      const blocks = document.querySelectorAll(".que");
      return blocks.length > 0 ? extractFromQuestionDivs(blocks) : [singleScrape()];
    },
    clickChoice: (el) => { const input = el?.querySelector("input[type='radio'], input[type='checkbox']"); input?.click(); },
    clickNext: () => clickBySelectors("input[name='next'], button[name='next'], .submitbtns input[value*='Next']"),
  },

  {
    name: "Blackboard / Ultra",
    detect: () =>
      !!document.querySelector("#assessment-attempt, .question-container, [data-test-id='question-list'], .bb-body"),
    extractAllQuestions: () => {
      const blocks = document.querySelectorAll(".question-container, [data-test-id='question']");
      return blocks.length > 0 ? extractFromQuestionDivs(blocks) : [singleScrape()];
    },
    clickChoice: (el) => el?.click(),
    clickNext: () => clickBySelectors("[data-test-id='next-question'], button[aria-label='Next Question'], .next-question-button"),
  },

  {
    name: "Generic / Fallback",
    detect: () => true,
    extractAllQuestions: () => {
      // Strategy 1: Look for numbered question blocks
      const questions = findNumberedQuestions();
      if (questions.length > 0) return questions;

      // Strategy 2: Look for fieldsets (common in forms)
      const fieldsets = document.querySelectorAll("fieldset");
      if (fieldsets.length > 0) {
        return [...fieldsets].map(fs => {
          const qText = fs.querySelector("legend")?.innerText?.trim() || "";
          const choices = [...fs.querySelectorAll("label")].map((el, i) => ({
            index: i, text: el.innerText.trim(), el
          }));
          return { question: qText, choices };
        }).filter(q => q.question || q.choices.length > 0);
      }

      // Strategy 3: Look for groups of radio/checkbox inputs
      const groups = findRadioGroups();
      if (groups.length > 0) return groups;

      // Strategy 4: fallback — send entire page
      return [singleScrape()];
    },
    clickChoice: (el) => {
      const input = el?.querySelector("input") || el;
      input?.click();
    },
    clickNext: () => clickBySelectors("button, input[type='button'], input[type='submit'], a", true),
  },
];

// ══════════════════════════════════════════
//  QUESTION EXTRACTION HELPERS
// ══════════════════════════════════════════

// Find questions by looking for numbered patterns (Q1, 1., Question 1, etc.)
function findNumberedQuestions() {
  const allElements = document.querySelectorAll("p, div, span, h1, h2, h3, h4, h5, li, td, label, strong");
  const qPattern = /^(?:Q(?:uestion)?\s*\.?\s*)?(\d{1,3})\s*[\.\)\:]?\s+/i;
  const questions = [];
  let currentQ = null;

  for (const el of allElements) {
    const text = el.innerText?.trim();
    if (!text || text.length < 5) continue;

    const match = text.match(qPattern);
    if (match && text.length > 10) {
      // This looks like a question
      if (currentQ) questions.push(currentQ);
      currentQ = {
        question: text,
        choices: [],
        choiceEls: [],
      };
    } else if (currentQ) {
      // Check if this is a choice (A., B., a), 1), etc.)
      const choiceMatch = text.match(/^[A-Ea-e][\.\)\:]?\s+/);
      if (choiceMatch || (el.tagName === "LABEL" && el.querySelector("input"))) {
        currentQ.choices.push({
          index: currentQ.choices.length,
          text: text,
          el: el,
        });
      }
    }
  }
  if (currentQ) questions.push(currentQ);

  return questions.filter(q => q.choices.length >= 2);
}

// Find radio button groups (grouped by name attribute)
function findRadioGroups() {
  const radios = [...document.querySelectorAll("input[type='radio']")];
  const groups = {};

  radios.forEach(r => {
    const name = r.getAttribute("name") || "default";
    if (!groups[name]) groups[name] = [];
    const label = document.querySelector(`label[for="${r.id}"]`) || r.closest("label") || r.parentElement;
    groups[name].push({
      index: groups[name].length,
      text: label?.innerText?.trim() || "",
      el: label || r,
    });
  });

  const groupNames = Object.keys(groups).filter(n => groups[n].length >= 2);

  return groupNames.map(name => {
    // Try to find the question text near this group
    const firstRadio = document.querySelector(`input[name="${name}"]`);
    const container = firstRadio?.closest("div, fieldset, section, form, li, tr");
    let qText = "";

    if (container) {
      // Look for text before the first radio
      const prevSibling = container.querySelector("p, h1, h2, h3, h4, h5, label, legend, strong, span");
      qText = prevSibling?.innerText?.trim() || "";
    }

    return { question: qText, choices: groups[name] };
  });
}

// Extract from question divs (for structured LMS pages)
function extractFromQuestionDivs(blocks) {
  return [...blocks].map(block => {
    const qText =
      block.querySelector(".question_text, .qtext, .questiontext, [data-test-id='question-stem'], .question-stem, p, h3, h4")?.innerText?.trim() || "";
    const choiceEls = block.querySelectorAll(
      ".answer label, .answer_label, .answer .answer_text, [data-test-id='answer-option'], .answer-option, li, label"
    );
    const choices = [...choiceEls].map((el, i) => ({
      index: i,
      text: el.innerText.trim(),
      el,
    })).filter(c => c.text.length > 0);

    return { question: qText, choices };
  }).filter(q => q.question || q.choices.length > 0);
}

function extractFromBlocks(blocks, choiceSelector) {
  return [...blocks].map(block => {
    const qText = block.innerText?.trim() || "";
    const container = block.closest(".slide-object-container, .quiz-question, div") || block.parentElement;
    const choiceEls = container ? container.querySelectorAll(choiceSelector) : [];
    const choices = [...choiceEls].map((el, i) => ({
      index: i, text: el.innerText.trim(), el,
    }));
    return { question: qText, choices };
  }).filter(q => q.question || q.choices.length > 0);
}

// Single scrape fallback — grabs entire page context
function singleScrape() {
  const selectors = [
    "h1", "h2", "h3", ".question", "[class*='question']",
    "[class*='prompt']", "p", "strong", "label",
  ];
  let question = "";
  for (const sel of selectors) {
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

function clickBySelectors(selectors, textMatch = false) {
  if (textMatch) {
    const candidates = [...document.querySelectorAll(selectors)];
    const next = candidates.find(el => {
      const t = (el.innerText || el.value || el.getAttribute("aria-label") || "").toLowerCase();
      return t.includes("next") || t.includes("continue") || t.includes("proceed") || t.includes("submit");
    });
    next?.click();
    return !!next;
  }
  const sels = selectors.split(",").map(s => s.trim());
  for (const sel of sels) {
    const btn = document.querySelector(sel);
    if (btn) { btn.click(); return true; }
  }
  return false;
}

// ── Detect active adapter ──
function getAdapter() {
  return ADAPTERS.find(a => a.detect()) || ADAPTERS[ADAPTERS.length - 1];
}

// ── Highlight correct answer on page ──
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
    // Return ALL questions found on the page
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
    // Legacy single-question scrape
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
