// background.js — Service Worker
// Handles Claude API calls + icon badge updates

const BADGE_COLORS = {
  high: [34, 197, 94, 255],
  medium: [251, 191, 36, 255],
  low: [239, 68, 68, 255],
  unknown: [100, 116, 139, 255],
};

function setBadge(questionNum, answerLetter, confidence) {
  const key = (confidence || "unknown").toLowerCase();
  const color = BADGE_COLORS[key] || BADGE_COLORS.unknown;
  const text = `${questionNum}:${answerLetter || "?"}`;
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.storage.local.set({ badgeText: text, badgeColor: color, badgeConfidence: key });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
  chrome.storage.local.remove(["badgeText", "badgeColor", "badgeConfidence"]);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "ASK_CLAUDE") {
    const { questionNum } = msg.payload;
    askClaude(msg.payload)
      .then((result) => {
        setBadge(questionNum, result.answerLetter, result.confidence);
        sendResponse({ success: true, result });
      })
      .catch((err) => {
        setBadge(questionNum, "?", "low");
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
  if (msg.type === "SET_BADGE") {
    setBadge(msg.questionNum, msg.answerLetter, msg.confidence);
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === "CLEAR_BADGE") {
    clearBadge();
    sendResponse({ success: true });
    return true;
  }
});

// Load API key from config.js (never committed to git)
try { importScripts("config.js"); } catch (e) { }
const HARDCODED_KEY = (typeof CONFIG !== "undefined" && CONFIG.API_KEY) || "";

async function askClaude({ question, choices, pageText, apiKey }) {
  apiKey = apiKey || HARDCODED_KEY;
  const choiceList = choices.length
    ? choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c.text}`).join("\n")
    : "No multiple choice options detected.";

  const prompt = `You are analyzing an eLearning quiz question. Based ONLY on the content provided, identify the most likely correct answer.

QUESTION:
${question || "(Question text not detected — see page context below)"}

ANSWER CHOICES:
${choiceList}

PAGE CONTEXT (full page text):
${pageText || "N/A"}

Respond with a JSON object ONLY (no markdown, no preamble):
{
  "answerIndex": <0-based index of best answer, or -1 if unknown>,
  "answerLetter": "<A/B/C/D etc., or 'Unknown'>",
  "confidence": "<High|Medium|Low>",
  "reasoning": "<1-2 sentence explanation>",
  "questionSummary": "<10-word summary of the question>"
}`;

  // 120-second timeout so we never silently die
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
      throw new Error(`Claude API ${resp.status}: ${errBody}`);
    }

    const data = await resp.json();
    const raw = data.content?.[0]?.text || "{}";
    const clean = raw.replace(/```json|```/gi, "").trim();
    return JSON.parse(clean);
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      throw new Error("Request timed out (120s)");
    }
    throw err;
  }
}
