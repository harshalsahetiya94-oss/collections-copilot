/** evals.ts — numbers before claims. Each function takes labelled data and returns a score you can print. */
import type { Ledger, Config } from "./model.js";
import { accountViews, isDormant } from "./dormancy.js";
import { matchCredits } from "./credits.js";
import { buildDraft } from "./outreach.js";
import { classifyReply, type Intent } from "./conversation.js";

export interface PRF { precision: number; recall: number; f1: number; tp: number; fp: number; fn: number }
const prf = (tp: number, fp: number, fn: number): PRF => { const p = tp + fp ? tp / (tp + fp) : 0, r = tp + fn ? tp / (tp + fn) : 0; return { precision: +p.toFixed(3), recall: +r.toFixed(3), f1: +(p + r ? (2 * p * r) / (p + r) : 0).toFixed(3), tp, fp, fn }; };

/** labels: invoiceId → true when the generator marked the customer as having gone silent on it. */
export function evalDormancy(ledger: Ledger, cfg: Config, labels: Record<string, boolean>): PRF {
  let tp = 0, fp = 0, fn = 0;
  for (const i of ledger.invoices) {
    if (i.openAmount <= 0.005) continue;
    const pred = isDormant(i, ledger.asOf, cfg), truth = !!labels[i.id];
    if (pred && truth) tp++; else if (pred && !truth) fp++; else if (!pred && truth) fn++;
  }
  return prf(tp, fp, fn);
}

/** expected: the (creditId, invoiceId) pairs the generator intended. */
export function evalCredits(ledger: Ledger, expected: { creditId: string; invoiceId: string }[]): PRF & { proposed: number } {
  const props = matchCredits(ledger).flatMap((o) => o.proposals);
  const key = (p: { creditId: string; invoiceId: string }) => `${p.creditId}|${p.invoiceId}`;
  const exp = new Set(expected.map(key)), got = new Set(props.filter((p) => p.kind === "exact").map(key));
  let tp = 0; for (const k of exp) if (got.has(k)) tp++;
  return { ...prf(tp, got.size - tp, exp.size - tp), proposed: props.length };
}

export interface ClassEval { accuracy: number; n: number; confusion: Record<string, Record<string, number>>; misses: { text: string; expected: Intent; got: Intent }[] }
export function evalClassification(samples: { text: string; intent: Intent }[], classify: (t: string) => { intent: Intent } = classifyReply): ClassEval {
  const confusion: Record<string, Record<string, number>> = {}; const misses: ClassEval["misses"] = []; let ok = 0;
  for (const s of samples) {
    const got = classify(s.text).intent;
    (confusion[s.intent] = confusion[s.intent] || {})[got] = (confusion[s.intent][got] || 0) + 1;
    if (got === s.intent) ok++; else misses.push({ text: s.text, expected: s.intent, got });
  }
  return { accuracy: +(ok / Math.max(1, samples.length)).toFixed(3), n: samples.length, confusion, misses };
}

export function evalDrafts(ledger: Ledger, cfg: Config): { drafts: number; passing: number; issues: Record<string, number> } {
  const issues: Record<string, number> = {}; let passing = 0, n = 0;
  for (const a of accountViews(ledger, cfg)) {
    if (!a.totalOverdue) continue;
    const d = buildDraft(a, cfg, ledger.asOf, matchCredits(ledger).find((o) => o.customerId === a.customer.id) || null);
    n++; if (d.check.ok) passing++; for (const i of d.check.issues) issues[i] = (issues[i] || 0) + 1;
  }
  return { drafts: n, passing, issues };
}
