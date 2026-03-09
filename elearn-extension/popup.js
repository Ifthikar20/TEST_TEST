// popup.js — Just a start/stop toggle that talks to the background
const btn = document.getElementById("start-btn");
const API_KEY = (typeof CONFIG !== "undefined" && CONFIG.API_KEY) || "";

// Check if already running
chrome.storage.local.get(["isRunning"], (data) => {
  if (data.isRunning) {
    btn.textContent = "⏹";
    btn.classList.add("running");
  }
});

btn.addEventListener("click", async () => {
  const { isRunning } = await chrome.storage.local.get("isRunning");

  if (isRunning) {
    // Stop
    chrome.runtime.sendMessage({ type: "STOP_LOOP" });
    btn.textContent = "▶";
    btn.classList.remove("running");
  } else {
    // Start — get the active tab and kick off the loop
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.runtime.sendMessage({
      type: "START_LOOP",
      tabId: tab.id,
      apiKey: API_KEY,
    });
    btn.textContent = "⏹";
    btn.classList.add("running");
  }
});

// Listen for completion
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "LOOP_DONE") {
    btn.textContent = "▶";
    btn.classList.remove("running");
  }
});
