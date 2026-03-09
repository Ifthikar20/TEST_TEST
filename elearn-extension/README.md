# eLearning AI Assistant — Chrome Extension

A Chrome extension that scans eLearning quiz pages, detects questions and answer choices, uses Claude AI to find the best answer, and lets you step through questions with one click.

---

## 📁 File Structure

```
elearn-extension/
├── manifest.json      # Chrome extension config (MV3)
├── content.js         # Injected into eLearning pages — DOM scanner
├── background.js      # Service worker — handles Claude API calls
├── popup.html         # Extension popup UI
├── popup.js           # Popup logic / controller
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## 🚀 Installation (Chrome / Edge)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer Mode** (toggle top-right)
3. Click **"Load unpacked"**
4. Select the `elearn-extension/` folder
5. The extension icon will appear in your toolbar

---

## ⚙️ Setup

1. Get an **Anthropic API key** from https://console.anthropic.com
2. Click the extension icon
3. Paste your API key in the field and click **SAVE**

---

## 🎮 Usage

1. Open your eLearning course (Articulate, Canvas, Moodle, Blackboard, etc.)
2. Navigate to a quiz question
3. Click the extension icon → **"⚡ Scan & Solve"**
4. Claude AI analyzes the page and highlights the best answer
5. Click **"→ Next Question"** to advance to the next slide/question

---

## 🧠 How It Works

### Architecture

```
[eLearning Page]
      │
      ▼
[content.js]  ──── DOM scraping ────► question text + choices
      │
      ▼
[popup.js]    ──── sends to ────────► [background.js]
                                           │
                                           ▼
                                    [Claude API]
                                    (claude-sonnet)
                                           │
                                           ▼
                                    JSON: answerIndex,
                                    confidence, reasoning
      │
      ▼
[content.js]  ◄─── highlight + click correct answer
```

### Platform Adapters (`content.js`)

The scanner has built-in adapters for:

| Platform | Detection |
|---|---|
| Articulate Storyline/Rise | `.slide-object-container`, `.quiz-question` |
| Canvas LMS | `#quiz-instructions-form`, `.question_text` |
| Moodle | `#page-mod-quiz-attempt`, `.qtext` |
| Blackboard/Ultra | `#assessment-attempt`, `[data-test-id]` |
| **Generic Fallback** | Radio/checkbox inputs + fieldset legends |

### Adding a Custom Platform

Edit `content.js` and add a new entry to the `ADAPTERS` array:

```javascript
{
  name: "My Custom LMS",
  detect: () => !!document.querySelector(".my-lms-class"),
  extractQuestion: () => document.querySelector(".question-body")?.innerText,
  extractChoices: () => [...document.querySelectorAll(".option")]
    .map((el, i) => ({ index: i, text: el.innerText.trim(), el })),
  clickNext: () => {
    document.querySelector(".btn-next")?.click();
    return true;
  },
  clickChoice: (index) => {
    document.querySelectorAll(".option")[index]?.click();
  }
}
```

---

## 🔒 Security Notes

- The API key is stored in `chrome.storage.local` (device-local only)
- The extension only reads page DOM — it never modifies or submits anything without your click
- The "Next Question" button optionally auto-clicks the detected answer before advancing

---

## 🛠 Troubleshooting

| Issue | Fix |
|---|---|
| "Could not read page content" | Reload the eLearning page, then try again |
| Question text not detected | The generic fallback will still pass page text to Claude |
| Next button not found | Click the next button manually on the page |
| API error 401 | Check your API key is correct and has credits |

---

## 📝 Customization Tips

- **Auto-advance**: In `popup.js`, the `btnNext` handler auto-clicks the detected answer. Remove that block if you only want highlighting.
- **Model**: Change `claude-sonnet-4-20250514` in `background.js` to `claude-haiku-4-5-20251001` for faster/cheaper responses.
- **More context**: Increase the `pageText.substring(0, 4000)` limit in `background.js` for longer courses.
