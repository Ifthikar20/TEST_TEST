// background.js — Simple: grab page → one Claude call → show answers on badge

// Load API key
let API_KEY = "";
try {
  importScripts("config.js");
  API_KEY = (typeof CONFIG !== "undefined" && CONFIG.API_KEY) || "";
} catch (e) { }

console.log("[NA] Key:", API_KEY ? "loaded" : "MISSING");

const COLORS = {
  high: [34, 197, 94, 255],
  medium: [251, 191, 36, 255],
  low: [239, 68, 68, 255],
  wait: [100, 116, 139, 255],
};

let stopRequested = false;

function badge(text, color) {
  chrome.action.setBadgeText({ text: String(text) });
  chrome.action.setBadgeBackgroundColor({ color: COLORS[color] || COLORS.wait });
}

// ── Listen for start/stop ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_LOOP") {
    stopRequested = false;
    chrome.storage.local.set({ isRunning: true });
    const key = msg.apiKey || API_KEY;
    console.log("[NA] START. Key present:", !!key);
    run(msg.tabId, key);
    sendResponse({ ok: true });
  }
  if (msg.type === "STOP_LOOP") {
    stopRequested = true;
    chrome.storage.local.set({ isRunning: false });
    sendResponse({ ok: true });
  }
  return true;
});

// ══════════════════════════════════════════
//  MAIN FLOW
//  1. Grab full page text
//  2. Send ALL of it to Claude in ONE call
//  3. Get back ALL answers as JSON array
//  4. Show each answer on badge, timed
// ══════════════════════════════════════════
async function run(tabId, apiKey) {
  badge("L", "wait");

  if (!apiKey) {
    console.error("[NA] No API key!");
    badge("KEY", "low");
    done();
    return;
  }

  try {
    // Step 1: Make sure content script is there
    await inject(tabId);

    // Step 2: Grab the ENTIRE page
    badge("L", "wait");
    console.log("[NA] Grabbing page content...");
    const page = await tab(tabId, { type: "GRAB_PAGE" });

    if (!page || !page.text) {
      console.error("[NA] Could not read page. Got:", page);
      badge("ERR", "low");
      done();
      return;
    }

    console.log("[NA] Page grabbed:", page.text.length, "chars. Title:", page.title);

    // Step 3: Send it ALL to Claude — one big call
    badge("AI", "wait");
    console.log("[NA] Calling Claude with full page text...");
    const startTime = Date.now();

    const answers = await callClaude(page.text, apiKey);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`[NA] Claude responded in ${elapsed}s with ${answers.length} answers:`);
    answers.forEach(a => console.log(`  Q${a.q}: ${a.answer} (${a.confidence})`));

    // Step 4: Show each answer on the badge, one at a time
    for (let i = 0; i < answers.length; i++) {
      if (stopRequested) break;

      const a = answers[i];
      const conf = (a.confidence || "medium").toLowerCase();
      const label = `${a.q}:${a.answer}`;

      badge(label, conf);
      console.log(`[NA] Badge → ${label}`);

      // Show each answer for 3 seconds
      await delay(3000);
    }

    // Keep last answer showing
    console.log("[NA] Done! Last answer stays on badge.");

  } catch (err) {
    console.error("[NA] Error:", err);
    badge("ERR", "low");
  }

  done();
}

function done() {
  chrome.storage.local.set({ isRunning: false });
  chrome.runtime.sendMessage({ type: "LOOP_DONE" }).catch(() => { });
}

// ══════════════════════════════════════════
//  CLAUDE API — one call, all answers
// ══════════════════════════════════════════
async function callClaude(pageText, apiKey) {
  const prompt = `You are looking at a quiz/test page. Find ALL the questions and their answer choices in the text below, then determine the CORRECT answer for each one.

PAGE CONTENT:
${pageText.substring(0, 30000)}

Return a JSON ARRAY with one entry per question. No markdown, no backticks, ONLY the JSON array:
[
  {"q": 1, "answer": "C", "confidence": "High", "reasoning": "brief reason"},
  {"q": 2, "answer": "A", "confidence": "High", "reasoning": "brief reason"},
  ...
]

Rules:
- "q" is the question number (1, 2, 3...)
- "answer" is the letter (A, B, C, D, etc.)
- "confidence" is High, Medium, or Low
- Include ALL questions you can find
- Be accurate — think carefully about each answer`;

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
      max_tokens: 4096,
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
  const raw = data.content?.[0]?.text || "[]";
  console.log("[NA] Raw response:", raw.substring(0, 300));

  // Clean and parse
  const clean = raw.replace(/```json|```/gi, "").trim();
  const parsed = JSON.parse(clean);

  // Ensure it's an array
  return Array.isArray(parsed) ? parsed : [parsed];
}

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function tab(tabId, msg) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, msg, resp => {
      resolve(chrome.runtime.lastError ? null : resp);
    });
  });
}

async function inject(tabId) {
  const alive = await tab(tabId, { type: "PING" });
  if (alive?.alive) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  await delay(500);
}
