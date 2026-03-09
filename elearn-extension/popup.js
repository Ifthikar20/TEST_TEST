// popup.js — Auto-Scan Notification Badge
// Opens → scans → shows answer badge → done. No buttons needed.

// ── DOM refs ──
const badge = document.getElementById("answer-badge");
const statusEl = document.getElementById("status");
const qCounter = document.getElementById("q-counter");
const answerLog = document.getElementById("answer-log");

// Hidden compat refs (kept so Chrome doesn't throw on missing elements)
const apiKeyInput = document.getElementById("api-key");
const btnSaveKey = document.getElementById("btn-save-key");
const btnAuto = document.getElementById("btn-auto");
const btnScan = document.getElementById("btn-scan");
const btnNext = document.getElementById("btn-next");
const qText = document.getElementById("q-text");
const badgePreview = document.getElementById("badge-preview");
const pCur = document.getElementById("p-cur");
const pTot = document.getElementById("p-tot");
const progressFill = document.getElementById("progress-fill");
const countdownWrap = document.getElementById("countdown-wrap");
const ringProg = document.getElementById("ring-prog");
const ringNum = document.getElementById("ring-num");
const countdownMsg = document.getElementById("countdown-msg");
const btnClearLog = document.getElementById("btn-clear-log");

// ── State ──
let questionNum = 0;

// ── API key loaded from config.js (behind the scenes) ──
const API_KEY = (typeof CONFIG !== "undefined" && CONFIG.API_KEY) || "";

// ── Restore previous log on open ──
chrome.storage.local.get(["answerLog", "questionNum"], (data) => {
  if (data.questionNum) questionNum = data.questionNum;
  if (data.answerLog) restoreLog(data.answerLog);
  // Auto-scan immediately
  autoScan();
});

// ══════════════════════════════════════════
//  AUTO SCAN — runs on popup open
// ══════════════════════════════════════════
async function autoScan() {
  questionNum++;
  qCounter.textContent = `Q${questionNum}`;
  badge.className = "answer-badge scanning";
  badge.innerHTML = '<div class="spinner"></div>';
  statusEl.textContent = "scanning…";
  statusEl.className = "status scanning";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await ensureContentScript(tab.id);

    // 1. Scrape
    const scrape = await sendMessage(tab.id, { type: "SCRAPE" });
    if (!scrape) {
      showError("can't read page");
      return;
    }

    statusEl.textContent = "thinking…";

    // 2. Ask Claude
    const aiResp = await chrome.runtime.sendMessage({
      type: "ASK_CLAUDE",
      payload: {
        question: scrape.question,
        choices: scrape.choices,
        pageText: scrape.pageText,
        apiKey: API_KEY,
        questionNum,
      },
    });

    if (!aiResp.success) {
      showError(aiResp.error?.substring(0, 40) || "API error");
      addLog(questionNum, "?", "low", "Error");
      return;
    }

    const r = aiResp.result;
    const answerLabel = `${questionNum}:${r.answerLetter || "?"}`;
    const conf = (r.confidence || "low").toLowerCase();

    // 3. Show answer badge
    badge.className = `answer-badge ${conf}`;
    badge.textContent = answerLabel;

    statusEl.textContent = r.questionSummary || "answered";
    statusEl.className = "status success";

    // 4. Highlight on page
    if (r.answerIndex >= 0) {
      await sendMessage(tab.id, { type: "HIGHLIGHT", index: r.answerIndex });
    }

    // 5. Add to log
    addLog(questionNum, r.answerLetter, conf, r.questionSummary);

    // 6. Save state
    chrome.storage.local.set({ questionNum });

  } catch (err) {
    showError(err.message?.substring(0, 40) || "error");
  }
}

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════

function showError(msg) {
  badge.className = "answer-badge error";
  badge.textContent = "✕";
  statusEl.textContent = msg;
  statusEl.className = "status error";
}

function addLog(qNum, letter, confidence, summary) {
  const conf = (confidence || "low").toLowerCase();
  const row = document.createElement("div");
  row.className = "log-row";
  row.innerHTML = `
    <div class="log-pill ${conf}">${qNum}:${letter || "?"}</div>
    <div class="log-hint">${summary || "–"}</div>
  `;
  // Newest at top
  answerLog.prepend(row);

  // Persist (keep last 50)
  const items = [...answerLog.querySelectorAll(".log-row")].slice(0, 50);
  const data = items.map((el) => el.outerHTML);
  chrome.storage.local.set({ answerLog: data });
}

function restoreLog(items) {
  if (!Array.isArray(items)) return;
  answerLog.innerHTML = items.join("");
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendMessage(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      resolve(chrome.runtime.lastError ? null : resp);
    });
  });
}

async function ensureContentScript(tabId) {
  const alive = await sendMessage(tabId, { type: "PING" });
  if (alive?.alive) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  await delay(300);
}
