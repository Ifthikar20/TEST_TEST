// content.js — Simple full-page scanner
// Grabs the entire page text and sends it to Claude. No fancy DOM parsing.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GRAB_PAGE") {
    // Grab EVERYTHING on the page
    const pageText = document.body.innerText;
    const pageHTML = document.body.innerHTML.substring(0, 50000); // first 50k chars of HTML
    sendResponse({
      text: pageText,
      html: pageHTML,
      url: location.href,
      title: document.title,
    });
  } else if (msg.type === "PING") {
    sendResponse({ alive: true });
  }
  return true;
});
