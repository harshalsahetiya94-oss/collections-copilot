// pregen-demo.mjs — uses a real model once, offline, so the live demo can show model-written drafts and customer replies without a key. Needs ANTHROPIC_API_KEY.
import { readFileSync, writeFileSync } from "node:fs";
const L = await import("../dist/lib/index.js");
const key = process.env.ANTHROPIC_API_KEY; if (!key) { console.error("ANTHROPIC_API_KEY missing"); process.exit(1); }
const ledger = JSON.parse(readFileSync("public/demo/ledger.json", "utf8"));
const labels = JSON.parse(readFileSync("public/demo/labels.json", "utf8"));
const cfg = L.DEFAULT_CONFIG; const opts = { apiKey: key };
const wl = L.worklist(ledger, cfg).slice(0, 14);
const opps = L.matchCredits(ledger);
const out = { generatedAt: new Date().toISOString(), model: "claude-haiku-4-5-20251001", drafts: {}, replies: {} };
const personas = { responsive: ["paid", "promise_to_pay", "question"], silent: ["needs_copy", "promise_to_pay", "unclear"], messy: ["dispute", "apply_credit", "needs_copy"] };
let i = 0;
for (const a of wl) {
  const opp = opps.find((o) => o.customerId === a.customer.id) || null;
  const d = L.buildDraft(a, cfg, ledger.asOf, opp);
  try {
    const pd = await L.personaliseDraft(opts, d, a);
    const check = L.checkDraft(pd, a, cfg);
    out.drafts[a.customer.id] = { body: pd.body, check };
    const persona = personas[labels.behaviour[a.customer.id]][i % 3];
    const reply = await L.simulateCustomerReply(opts, pd.body, persona, a);
    out.replies[a.customer.id] = { persona, text: reply };
    console.log(a.customer.name, "| draft check", check.ok ? "ok" : "FAIL " + check.issues.join("; "), "| reply persona", persona);
  } catch (e) { console.error(a.customer.name, "error", e.message); }
  i++;
}
writeFileSync("public/demo/llm.json", JSON.stringify(out, null, 1));
console.log("wrote public/demo/llm.json:", Object.keys(out.drafts).length, "drafts,", Object.keys(out.replies).length, "replies");
