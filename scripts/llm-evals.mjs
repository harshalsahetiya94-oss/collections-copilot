// llm-evals.mjs — model-only vs rules-only vs rules-first hybrid on the labelled replies. Needs ANTHROPIC_API_KEY. Not run in CI.
import { readFileSync, writeFileSync } from "node:fs";
const L = await import("../dist/lib/index.js");
const key = process.env.ANTHROPIC_API_KEY; if (!key) { console.error("ANTHROPIC_API_KEY missing"); process.exit(1); }
const replies = JSON.parse(readFileSync("public/demo/replies.json", "utf8"));
const opts = { apiKey: key };
const llm = new Map();
for (const r of replies) { try { llm.set(r.text, await L.classifyWithLlm(opts, r.text)); } catch (e) { llm.set(r.text, { intent: "unclear", confidence: 0, extracted: {}, rationale: "error " + e.message, source: "llm" }); } }
const rules = L.evalClassification(replies);
const modelOnly = L.evalClassification(replies, (t) => llm.get(t));
const hybrid = L.evalClassification(replies, (t) => { const r = L.classifyReply(t); return r.confidence >= 0.6 ? r : llm.get(t); });
const usedModel = replies.filter((r) => L.classifyReply(r.text).confidence < 0.6).length;
const md = `# Rules vs model vs rules-first (reply classification, ${replies.length} labelled replies)

| Approach | Accuracy | Model calls |
|---|---|---|
| Rules only | ${rules.accuracy} | 0 |
| Model only (claude-haiku-4-5) | ${modelOnly.accuracy} | ${replies.length} |
| Rules first, model when rules are unsure (confidence < 0.6) | ${hybrid.accuracy} | ${usedModel} |

Rules-only misses: ${rules.misses.map((m) => `“${m.text}” → ${m.got} (wanted ${m.expected})`).join("; ") || "none"}
Model-only misses: ${modelOnly.misses.map((m) => `“${m.text}” → ${m.got} (wanted ${m.expected})`).join("; ") || "none"}
Hybrid misses: ${hybrid.misses.map((m) => `“${m.text}” → ${m.got} (wanted ${m.expected})`).join("; ") || "none"}

The point is not that rules beat the model. It is that rules handle the ${replies.length - usedModel} replies they are sure about for free and with no way to invent anything, and the model is only asked about the ${usedModel} it cannot read. Every draft the model writes is still checked against the ledger before a person sees it.
`;
writeFileSync("docs/EVALS-LLM.md", md); console.log(md);
