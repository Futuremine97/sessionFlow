// popup.js — wires the UI to scrape -> compress -> primer.

let capsule = null;
let primerText = "";

const $ = (id) => document.getElementById(id);
const setStatus = (msg, err = false) => {
  const el = $("status");
  el.textContent = msg;
  el.className = err ? "err" : "";
};

// scrape function source (kept as a string so we can inject the named fn)
async function scrapeActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab.");
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["scrape.js"],
  }).then(() =>
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => s2sScrape(),
    })
  );
  return result;
}

function rebuildPrimer() {
  if (!capsule) return;
  primerText = S2S.primer(capsule, $("target").value, $("full").checked);
}

$("capture").addEventListener("click", async () => {
  setStatus("Capturing…");
  try {
    const scraped = await scrapeActiveTab();
    if (!scraped || (scraped.turns.length === 0 && !scraped.raw)) {
      throw new Error("Couldn't read this page. Open a ChatGPT/Claude/Gemini chat.");
    }
    if (scraped.turns.length === 0 && scraped.raw) {
      // fallback: whole-page text becomes a single user turn
      scraped.turns = [{ role: "user", content: scraped.raw }];
    }
    capsule = S2S.compress(S2S.buildCapsule(scraped));
    rebuildPrimer();
    $("copy").disabled = false;
    $("download").disabled = false;
    setStatus(
      `Captured ${capsule.transcript.length} turns from ${capsule.source_platform}.`
    );
  } catch (e) {
    setStatus(e.message, true);
  }
});

["target", "full"].forEach((id) =>
  $(id).addEventListener("change", () => {
    rebuildPrimer();
    if (capsule) setStatus("Primer updated for " + $("target").value + ".");
  })
);

$("copy").addEventListener("click", async () => {
  if (!primerText) return;
  await navigator.clipboard.writeText(primerText);
  setStatus("Primer copied — paste it into your new " + $("target").value + " chat.");
});

$("download").addEventListener("click", () => {
  if (!capsule) return;
  const blob = new Blob([JSON.stringify(capsule, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (capsule.title || "session").replace(/\W+/g, "_") + ".capsule.json";
  a.click();
  URL.revokeObjectURL(url);
  setStatus("Capsule downloaded.");
});
