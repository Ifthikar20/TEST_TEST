// background.js — Auto-Loop Engine
// Processes each question individually, shows answers on icon badge

// Load API key from config.js
try { importScripts("config.js"); } catch (e) { }
const DEFAULT_KEY = (typeof CONFIG !== "undefined" && CONFIG.API_KEY) || "";

// ── Badge colors ──
const BADGE_COLORS = {
  high: [34, 197, 94, 255],   // green
  medium: [251, 191, 36, 255],   // yellow
  low: [239, 68, 68, 255],   // red
  unknown: [100, 116, 139, 255],   // gray
};

// ── State ──
let stopRequested = false;

function setBadge(text, confidence) {
  const key = (confidence || "unknown").toLowerCase();
  const color = BADGE_COLORS[key] || BADGE_COLORS.unknown;
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

// ── Message listener ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_LOOP") {
    stopRequested = false;
    chrome.storage.local.set({ isRunning: true });
    runLoop(msg.tabId, msg.apiKey || DEFAULT_KEY);
    sendResponse({ success: true });
  }
  if (msg.type === "STOP_LOOP") {
    stopRequested = true;
    chrome.storage.local.set({ isRunning: false });
    sendResponse({ success: true });
  }
  if (msg.type === "ASK_CLAUDE") {
    const { questionNum } = msg.payload;
    askClaude(msg.payload)
      .then((result) => {
        const label = `${questionNum}:${result.answerLetter || "?"}`;
        setBadge(label, result.confidence);
        sendResponse({ success: true, result });
      })
      .catch((err) => {
        setBadge(`${questionNum}:?`, "low");
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
  if (msg.type === "CLEAR_BADGE") {
    clearBadge();
    sendResponse({ success: true });
  }
  return true;
});

// ══════════════════════════════════════════
//  AUTO-LOOP — processes all questions
// ══════════════════════════════════════════
async function runLoop(tabId, apiKey) {
  setBadge("...", "unknown");

  try {
    // Ensure content script is loaded
    await ensureContentScript(tabId);

    // Scrape all questions from the page
    const scrapeData = await sendToTab(tabId, { type: "SCRAPE_ALL" });
    if (!scrapeData || !scrapeData.questions) {
      setBadge("✕", "low");
      finish();
      return;
    }

    const questions = scrapeData.questions;
    const total = questions.length;

    if (total === 0) {
      // No structured questions found — try single-page mode
      await processSingleQuestion(tabId, apiKey, scrapeData.pageText, 1);
      finish();
      return;
    }

    // Process each question individually
    for (let i = 0; i < total; i++) {
      if (stopRequested) break;

      const qNum = i + 1;
      const q = questions[i];

      setBadge(`${qNum}…`, "unknown");

      // Build just this question's context for Claude
      const result = await askClaude({
        question: q.question,
        choices: q.choices,
        pageText: scrapeData.pageText,
        apiKey,
        questionNum: qNum,
      });

      const answerLabel = `${qNum}:${result.answerLetter || "?"}`;
      setBadge(answerLabel, result.confidence);

      // Click the answer on the page
      if (result.answerIndex >= 0) {
        await sendToTab(tabId, {
          type: "CLICK_CHOICE",
          questionIndex: i,
          choiceIndex: result.answerIndex,
        });
      }

      // Small delay between questions
      await delay(1500);

      // If single-question-per-page, click next
      if (total === 1) {
        const nextResult = await sendToTab(tabId, { type: "CLICK_NEXT" });
        if (nextResult?.success) {
          await delay(1000);
          // Re-scan for next page
          if (!stopRequested) {
            await runLoop(tabId, apiKey);
            return;
          }
        }
      }
    }

    // Show final answer on badge
    if (!stopRequested) {
      setBadge("✓", "high");
    }

  } catch (err) {
    console.error("Loop error:", err);
    setBadge("✕", "low");
  }

  finish();
}

async function processSingleQuestion(tabId, apiKey, pageText, qNum) {
  try {
    const scrape = await sendToTab(tabId, { type: "SCRAPE", questionIndex: 0 });
    if (!scrape) {
      setBadge("✕", "low");
      return;
    }

    const result = await askClaude({
      question: scrape.question,
      choices: scrape.choices,
      pageText: pageText || scrape.pageText,
      apiKey,
      questionNum: qNum,
    });

    const answerLabel = `${qNum}:${result.answerLetter || "?"}`;
    setBadge(answerLabel, result.confidence);

    if (result.answerIndex >= 0) {
      await sendToTab(tabId, {
        type: "CLICK_CHOICE",
        questionIndex: 0,
        choiceIndex: result.answerIndex,
      });
    }
  } catch (err) {
    setBadge(`${qNum}:?`, "low");
  }
}

function finish() {
  chrome.storage.local.set({ isRunning: false });
  // Notify popup (if still open)
  chrome.runtime.sendMessage({ type: "LOOP_DONE" }).catch(() => { });
}

// ══════════════════════════════════════════
//  CLAUDE API
// ══════════════════════════════════════════
async function askClaude({ question, choices, pageText, apiKey, questionNum }) {
  apiKey = apiKey || DEFAULT_KEY;

  const choiceList = choices.length
    ? choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c.text}`).join("\n")
    : "No multiple choice options detected — look for answer choices in the page context.";

  const prompt = `You are analyzing ONE specific quiz question. Identify the correct answer.

IMPORTANT: Focus ONLY on this specific question. Do NOT confuse it with other questions on the page.

QUESTION #${questionNum}:
${question || "(Question text not detected — extract the question from page context below)"}

ANSWER CHOICES:
${choiceList}

PAGE CONTEXT (for reference):
${(pageText || "").substring(0, 10000)}

Respond with a JSON object ONLY (no markdown, no code fences, no preamble):
{
  "answerIndex": <0-based index of best answer, or -1 if unknown>,
  "answerLetter": "<A/B/C/D etc.>",
  "confidence": "<High|Medium|Low>",
  "reasoning": "<1-2 sentence explanation>",
  "questionSummary": "<10-word summary>"
}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`API ${resp.status}: ${errBody}`);
    }

    const data = await resp.json();
    const raw = data.content?.[0]?.text || "{}";
    const clean = raw.replace(/```json|```/gi, "").trim();
    return JSON.parse(clean);
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") throw new Error("Timeout (120s)");
    throw err;
  }
}

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function sendToTab(tabId, msg) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, msg, resp => {
      resolve(chrome.runtime.lastError ? null : resp);
    });
  });
}

async function ensureContentScript(tabId) {
  const alive = await sendToTab(tabId, { type: "PING" });
  if (alive?.alive) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  await delay(500);
}
