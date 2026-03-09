// background.js — Auto-Loop Engine
// Scrapes DOM → calls Claude API → gets JSON → shows answer on badge

// ── Load API key ──
let API_KEY = "";
try {
  importScripts("config.js");
  API_KEY = (typeof CONFIG !== "undefined" && CONFIG.API_KEY) || "";
  console.log("[News Alerts] API key loaded:", API_KEY ? "YES (" + API_KEY.substring(0, 12) + "...)" : "MISSING!");
} catch (e) {
  console.error("[News Alerts] Failed to load config.js:", e);
}

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
  chrome.action.setBadgeText({ text: String(text) });
  chrome.action.setBadgeBackgroundColor({ color });
}

// ── Message listener ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_LOOP") {
    stopRequested = false;
    chrome.storage.local.set({ isRunning: true });
    // Use the key from popup if provided, otherwise from config
    const key = msg.apiKey || API_KEY;
    console.log("[News Alerts] START_LOOP received. Key present:", !!key, "TabId:", msg.tabId);
    runLoop(msg.tabId, key);
    sendResponse({ success: true });
  }
  if (msg.type === "STOP_LOOP") {
    stopRequested = true;
    chrome.storage.local.set({ isRunning: false });
    sendResponse({ success: true });
  }
  if (msg.type === "CLEAR_BADGE") {
    chrome.action.setBadgeText({ text: "" });
    sendResponse({ success: true });
  }
  return true;
});

// ══════════════════════════════════════════
//  AUTO-LOOP
//  DOM scrape → Claude API → JSON → badge
// ══════════════════════════════════════════
async function runLoop(tabId, apiKey) {
  console.log("[News Alerts] === LOOP STARTING ===");
  setBadge("L", "unknown");

  if (!apiKey) {
    console.error("[News Alerts] NO API KEY! Cannot call Claude.");
    setBadge("KEY", "low");
    finish();
    return;
  }

  try {
    // Step 1: Ensure content script is injected
    console.log("[News Alerts] Step 1: Injecting content script...");
    await ensureContentScript(tabId);
    console.log("[News Alerts] Content script ready.");

    // Step 2: Scrape ALL questions from the DOM
    console.log("[News Alerts] Step 2: Scraping all questions...");
    const scrapeData = await sendToTab(tabId, { type: "SCRAPE_ALL" });

    if (!scrapeData) {
      console.error("[News Alerts] SCRAPE_ALL returned null — content script not responding.");
      setBadge("ERR", "low");
      finish();
      return;
    }

    const questions = scrapeData.questions || [];
    const total = questions.length;
    console.log(`[News Alerts] Found ${total} questions on platform: ${scrapeData.platform}`);

    if (total === 0) {
      console.log("[News Alerts] No questions found. Trying single-page fallback...");
      setBadge("L", "unknown");
      await processSingleQuestion(tabId, apiKey, scrapeData.pageText, 1);
      finish();
      return;
    }

    // Step 3: Process each question — call Claude API for each one
    for (let i = 0; i < total; i++) {
      if (stopRequested) break;

      const qNum = i + 1;
      const q = questions[i];

      // Show loading for this question
      setBadge(`${qNum}L`, "unknown");
      console.log(`[News Alerts] ── Q${qNum}/${total} ──`);
      console.log(`[News Alerts]   Question: "${q.question?.substring(0, 80)}"`);
      console.log(`[News Alerts]   Choices: ${q.choices.length} options`);
      q.choices.forEach((c, j) => console.log(`[News Alerts]     ${String.fromCharCode(65 + j)}. ${c.text?.substring(0, 60)}`));

      try {
        // Step 3a: Call Claude API
        console.log(`[News Alerts]   Calling Claude API...`);
        const startTime = Date.now();

        const result = await askClaude({
          question: q.question,
          choices: q.choices,
          apiKey,
          questionNum: qNum,
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[News Alerts]   ✓ Claude responded in ${elapsed}s`);
        console.log(`[News Alerts]   Answer: ${result.answerLetter} (${result.confidence})`);
        console.log(`[News Alerts]   Reasoning: ${result.reasoning}`);

        // Step 3b: Show answer on badge
        const label = `${qNum}:${result.answerLetter || "?"}`;
        setBadge(label, result.confidence);

        // Step 3c: Highlight answer on page
        if (result.answerIndex >= 0) {
          await sendToTab(tabId, {
            type: "HIGHLIGHT",
            questionIndex: i,
            choiceIndex: result.answerIndex,
          });
        }

        // Step 3d: Keep answer visible for 4 seconds
        console.log(`[News Alerts]   Badge showing "${label}" for 4 seconds...`);
        await delay(4000);

      } catch (qErr) {
        console.error(`[News Alerts]   ✕ Q${qNum} FAILED:`, qErr.message);
        setBadge(`${qNum}?`, "low");
        await delay(2000);
      }

      // Single-question-per-page: advance
      if (total === 1) {
        const nextResult = await sendToTab(tabId, { type: "CLICK_NEXT" });
        if (nextResult?.success && !stopRequested) {
          await delay(1000);
          await runLoop(tabId, apiKey);
          return;
        }
      }
    }

    console.log("[News Alerts] === LOOP COMPLETE ===");
    // Last answer stays on the badge

  } catch (err) {
    console.error("[News Alerts] FATAL LOOP ERROR:", err);
    setBadge("ERR", "low");
  }

  finish();
}

async function processSingleQuestion(tabId, apiKey, pageText, qNum) {
  try {
    const scrape = await sendToTab(tabId, { type: "SCRAPE", questionIndex: 0 });
    if (!scrape) { setBadge("ERR", "low"); return; }

    console.log(`[News Alerts] Single Q: "${scrape.question?.substring(0, 60)}"`);
    const result = await askClaude({
      question: scrape.question,
      choices: scrape.choices,
      pageText: pageText || scrape.pageText,
      apiKey,
      questionNum: qNum,
    });

    setBadge(`${qNum}:${result.answerLetter || "?"}`, result.confidence);
    console.log(`[News Alerts] Answer: ${result.answerLetter}`);
  } catch (err) {
    console.error("[News Alerts] Single Q error:", err);
    setBadge(`${qNum}?`, "low");
  }
}

function finish() {
  chrome.storage.local.set({ isRunning: false });
  chrome.runtime.sendMessage({ type: "LOOP_DONE" }).catch(() => { });
}

// ══════════════════════════════════════════
//  CLAUDE API CALL
//  Sends question + choices → gets JSON back
// ══════════════════════════════════════════
async function askClaude({ question, choices, pageText, apiKey, questionNum }) {
  const choiceList = choices.length
    ? choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c.text}`).join("\n")
    : "No choices detected.";

  const prompt = `You are answering a quiz question. Pick the BEST answer.

QUESTION #${questionNum}:
${question || "(see page context)"}

CHOICES:
${choiceList}
${pageText ? `\nPAGE CONTEXT:\n${pageText.substring(0, 8000)}` : ""}

Reply with ONLY this JSON (no markdown, no backticks):
{"answerIndex": <0-based>, "answerLetter": "<A/B/C/D>", "confidence": "<High|Medium|Low>", "reasoning": "<why>", "questionSummary": "<summary>"}`;

  // 120 second timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

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
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: controller.signal,
  });

  clearTimeout(timer);

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`API ${resp.status}: ${body.substring(0, 200)}`);
  }

  const data = await resp.json();
  const raw = data.content?.[0]?.text || "{}";
  console.log(`[News Alerts] Raw API response: ${raw.substring(0, 200)}`);
  const clean = raw.replace(/```json|```/gi, "").trim();
  return JSON.parse(clean);
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
