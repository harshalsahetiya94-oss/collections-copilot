// run-evals.mjs — prints the numbers and writes docs/EVALS.md. Needs `npm run build:lib`.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
if (!existsSync("dist/lib/index.js")) { console.error("run: npm run build:lib"); process.exit(1); }
const L = await import("../dist/lib/index.js");
const ledger = JSON.parse(readFileSync("public/demo/ledger.json", "utf8"));
const labels = JSON.parse(readFileSync("public/demo/labels.json", "utf8"));
const replies = JSON.parse(readFileSync("public/demo/replies.json", "utf8"));
const cfg = L.DEFAULT_CONFIG;
const d = L.evalDormancy(ledger, cfg, labels.dormant);
const c = L.evalCredits(ledger, labels.expectedCredits);
const k = L.evalClassification(replies);
const dr = L.evalDrafts(ledger, cfg);
const wl = L.worklist(ledger, cfg);
const md = `# Evals (synthetic ledger, ${ledger.asOf})

| Check | Result |
|---|---|
| Dormant detection vs hidden truth | precision ${d.precision}, recall ${d.recall}, F1 ${d.f1} (tp ${d.tp}, fp ${d.fp}, fn ${d.fn}) |
| Exact credit matches vs intended pairs | precision ${c.precision}, recall ${c.recall} (${c.proposed} applications proposed in total) |
| Reply classification, rules only | accuracy ${k.accuracy} on ${k.n} labelled replies |
| Drafts passing the fact check | ${dr.passing} of ${dr.drafts} |
| Worklist | ${wl.length} accounts; top score ${wl[0]?.score} (${wl[0]?.customer.name}) |

Misclassified replies (rules): ${k.misses.length ? "\n" + k.misses.map((m) => `- “${m.text}” expected ${m.expected}, got ${m.got}`).join("\n") : "none"}

Recall on dormancy is below 1 by design: the generator sometimes sends an automated statement to a silent customer, which resets "last contact" without anyone speaking to them. The rule treats that as contact; the truth label does not. That gap is the argument for logging *who* spoke, not just *that* something went out.
`;
writeFileSync("docs/EVALS.md", md);
console.log(md);
