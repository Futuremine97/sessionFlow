// s2s.js — a compact, dependency-free port of the Python pipeline's compress
// + rehydrate stages, so the extension produces the same kind of Capsule and
// primer fully client-side. (The Python package remains the reference impl;
// this mirrors its behavior for the in-browser path.)

const S2S = (() => {
  const DECISION = /(let'?s (use|go with|do)|we(?:'ll| will| should| decided to)? (use|pick|choose|go with)|going with|decided to|plan is to|we are using)|(하기로|쓰기로|사용하기로|가기로)\s*(했|함|결정)|(로|으로)\s*(결정|정했|선택)/i;
  const OPEN = /(^|\s)(todo|to-do)\s*[:：-]|\b(next step|still need|need to|haven'?t|not yet|unfinished|remaining|follow up|left to do|pending|open question|tbd|will (add|implement|fix|do))\b|(아직|남았|해야|다음 단계|할 일|미완|필요해|필요합니다)/i;
  const PREF = /\b(i prefer|i like|i want|i'?d like|please (always|never)|don'?t|do not|make sure|i'?m a|my (role|job|stack|preference)|always|never)\b|(선호|좋아|원해|원합니다|항상|절대|해주세요|해줘|하지 ?마)/i;
  const FACT = /\b(is|are|uses|runs on|built (with|in|on)|written in)\b|(이름은|프로젝트는|코드네임|코드명).{0,40}(이다|야|입니다|에요|예요|임)/i;
  const PATH = /((?:\.{0,2}\/)?[\w\-./]+\.(?:py|js|ts|tsx|jsx|md|json|html|css|ya?ml|txt|sql|sh|go|rs|java|docx|xlsx|pdf|csv))\b/g;

  const clip = (s, n) => {
    s = (s || "").replace(/\s+/g, " ").trim();
    return s.length <= n ? s : s.slice(0, n - 1) + "…";
  };
  const sentences = (t) =>
    t.split(/(?<=[.!?。])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const dedupe = (arr, lim) => {
    const seen = new Set(), out = [];
    for (const x of arr) {
      const k = x.toLowerCase();
      if (k && !seen.has(k)) { seen.add(k); out.push(x); }
      if (out.length >= lim) break;
    }
    return out;
  };

  function compress(cap) {
    const facts = [], decisions = [], opens = [], prefs = [];
    const artifacts = {};
    for (const turn of cap.transcript) {
      let m;
      PATH.lastIndex = 0;
      while ((m = PATH.exec(turn.content))) {
        if (!artifacts[m[1]]) artifacts[m[1]] = { path: m[1], kind: "file", status: "referenced" };
      }
      for (const sent of sentences(turn.content)) {
        if (sent.length < 8) continue;
        if (turn.role === "user" && PREF.test(sent)) prefs.push(sent);
        else if (DECISION.test(sent)) decisions.push(sent);
        else if (OPEN.test(sent)) opens.push(sent);
        else if (turn.role === "user" && FACT.test(sent) && sent.length < 200) facts.push(sent);
      }
    }
    const users = cap.transcript.filter((t) => t.role === "user").map((t) => t.content);
    const assts = cap.transcript.filter((t) => t.role === "assistant").map((t) => t.content);
    const summaryBits = [];
    if (users[0]) summaryBits.push(`The session opened with: "${clip(users[0], 240)}"`);
    if (users.length > 1) summaryBits.push(`Latest user request: "${clip(users[users.length - 1], 200)}"`);
    if (assts.length) summaryBits.push(`Assistant's most recent state: "${clip(assts[assts.length - 1], 240)}"`);

    cap.context = {
      summary: summaryBits.join(" "),
      key_facts: dedupe(facts, 12),
      decisions: dedupe(decisions, 10).map((d) => ({ statement: clip(d, 220) })),
      open_threads: dedupe(opens, 10),
      user_profile: dedupe(prefs, 8).map((p) => clip(p, 160)),
    };
    cap.artifacts = Object.values(artifacts);
    return cap;
  }

  const STYLE = {
    claude: { opener: "You are picking up an in-progress working session previously handled by another AI assistant. Continue it seamlessly. Here is the handoff context:", closer: "Acknowledge briefly that you have the context, then continue from the open threads.", xml: true },
    chatgpt: { opener: "Context handoff from a previous AI session. Read it, then continue the work as if you had been here the whole time.", closer: "Confirm you're up to speed in one line, then proceed.", xml: false },
    gemini: { opener: "You are continuing a session started with another AI assistant. Use this transferred context to keep going without losing state.", closer: "Give a one-line confirmation, then take the next step.", xml: false },
    generic: { opener: "Handoff context transferred from a previous AI session. Continue the work seamlessly.", closer: "Confirm understanding briefly, then continue.", xml: false },
  };

  function primer(cap, target, includeFull) {
    const st = STYLE[target] || STYLE.generic;
    const c = cap.context;
    const L = [st.opener, ""];
    if (st.xml) L.push("<handoff>");
    L.push("## Origin", `- Transferred from: ${cap.source_platform}${cap.source_model ? " / " + cap.source_model : ""}`, `- Session title: ${cap.title || "Untitled"}`, `- Captured: ${cap.captured_at}`, "");
    if (c.summary) L.push("## Summary", c.summary, "");
    if (c.user_profile.length) { L.push("## User profile & preferences"); c.user_profile.forEach((v) => L.push(`- ${v}`)); L.push(""); }
    if (c.key_facts.length) { L.push("## Key facts"); c.key_facts.forEach((v) => L.push(`- ${v}`)); L.push(""); }
    if (c.decisions.length) { L.push("## Decisions made"); c.decisions.forEach((d) => L.push(`- ${d.statement}`)); L.push(""); }
    if (cap.artifacts.length) { L.push("## Artifacts / files in play"); cap.artifacts.forEach((a) => L.push(`- [${a.status}] ${a.path} (${a.kind})`)); L.push(""); }
    if (c.open_threads.length) { L.push("## Open threads — pick up here"); c.open_threads.forEach((o) => L.push(`- ${o}`)); L.push(""); }
    if (st.xml) L.push("</handoff>", "");
    L.push(st.closer);
    if (includeFull && cap.transcript.length) {
      L.push("", "## Full transcript (verbatim)", "");
      cap.transcript.forEach((t) => L.push(`### ${t.role.toUpperCase()}`, t.content, ""));
    }
    return L.join("\n").trim() + "\n";
  }

  function buildCapsule(scraped) {
    return {
      schema_version: "1.0",
      source_platform: scraped.platform,
      source_model: null,
      title: scraped.title || "Captured session",
      captured_at: new Date().toISOString(),
      transcript: scraped.turns,
      context: {},
      artifacts: [],
    };
  }

  return { compress, primer, buildCapsule };
})();
