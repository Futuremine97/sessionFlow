// scrape.js — injected into the active tab to read the current conversation
// straight from the page DOM. Returns a list of {role, content} turns plus a
// detected platform. Selectors are kept defensive: each site changes its DOM
// often, so we try a few strategies and fall back to a coarse text split.
//
// This function is self-contained because it is injected via
// chrome.scripting.executeScript and cannot reference outer scope.

function s2sScrape() {
  const host = location.hostname;
  let platform = "paste";
  if (/chatgpt\.com|openai\.com/.test(host)) platform = "chatgpt";
  else if (/claude\.ai/.test(host)) platform = "claude";
  else if (/gemini\.google\.com/.test(host)) platform = "gemini";

  const turns = [];
  const push = (role, el) => {
    const text = (el.innerText || el.textContent || "").trim();
    if (text) turns.push({ role, content: text });
  };

  try {
    if (platform === "chatgpt") {
      // ChatGPT marks each message with data-message-author-role
      document
        .querySelectorAll("[data-message-author-role]")
        .forEach((el) => {
          const role = el.getAttribute("data-message-author-role");
          push(role === "assistant" ? "assistant" : "user", el);
        });
    } else if (platform === "claude") {
      // Claude uses data-testid user/assistant message containers
      document
        .querySelectorAll(
          '[data-testid="user-message"], [data-testid="assistant-message"], ' +
          ".font-user-message, .font-claude-message"
        )
        .forEach((el) => {
          const t = el.getAttribute("data-testid") || el.className || "";
          const role = /user/.test(t) ? "user" : "assistant";
          push(role, el);
        });
    } else if (platform === "gemini") {
      // Gemini: user-query and model-response custom elements
      document.querySelectorAll("user-query, .query-text").forEach((el) =>
        push("user", el)
      );
      document
        .querySelectorAll("model-response, message-content, .response-content")
        .forEach((el) => push("assistant", el));
    }
  } catch (e) {
    /* fall through to fallback */
  }

  // Fallback: nothing matched -> hand back the whole visible text as one blob,
  // which the paste adapter on the Python side (or popup) can still use.
  if (turns.length === 0) {
    const main = document.querySelector("main") || document.body;
    return { platform, turns: [], raw: (main.innerText || "").trim() };
  }

  const title = (document.title || "").replace(/\s*[-|].*$/, "").trim();
  return { platform, turns, raw: "", title };
}
