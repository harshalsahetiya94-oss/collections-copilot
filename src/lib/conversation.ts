/** conversation.ts — the loop: draft → approve → send → wait → reply → classify → next step. A person approves every send. */
import { type Config, addDays, daysBetween, newId } from "./model.js";
import type { AccountView, Stage } from "./dormancy.js";
import { type Draft, buildDraft, checkDraft } from "./outreach.js";
import type { CreditOpportunity } from "./credits.js";

export type Intent = "paid" | "promise_to_pay" | "dispute" | "needs_copy" | "apply_credit" | "question" | "unclear";
export interface Classification { intent: Intent; confidence: number; extracted: { date?: string; amount?: number; reference?: string; reason?: string }; rationale: string; source: "rules" | "llm" }
export type ActionType = "verify_payment" | "schedule_followup" | "route_dispute" | "resend_with_copy" | "apply_credit" | "answer_question" | "escalate" | "close" | "chase_again";
export interface NextAction { type: ActionType; dueDate?: string; note: string; requiresApproval: boolean }
export type ThreadState = "awaiting_approval" | "rejected" | "sent" | "awaiting_reply" | "replied" | "action_pending" | "closed";
export interface Message { id: string; from: "us" | "customer"; at: string; subject?: string; body: string; classification?: Classification }
export interface AuditEntry { at: string; actor: "system" | "human" | "llm"; event: string; detail?: string }
export interface Thread {
  id: string; customerId: string; customerName: string; stage: Stage; state: ThreadState;
  draft: Draft; messages: Message[]; nextAction?: NextAction; outcome?: Intent; followUpOn?: string; sentAt?: string; audit: AuditEntry[];
}

const log = (t: Thread, at: string, actor: AuditEntry["actor"], event: string, detail?: string) => { t.audit.push({ at, actor, event, detail }); };

export function openThread(a: AccountView, cfg: Config, asOf: string, creditOpp?: CreditOpportunity | null, draft?: Draft): Thread {
  const d = draft || buildDraft(a, cfg, asOf, creditOpp);
  const t: Thread = { id: newId("th"), customerId: a.customer.id, customerName: a.customer.name, stage: a.stage, state: "awaiting_approval", draft: d, messages: [], audit: [] };
  log(t, asOf, "system", "drafted", `${d.source} draft, ${d.invoiceIds.length} invoice(s), checks ${d.check.ok ? "passed" : "FAILED: " + d.check.issues.join("; ")}`);
  return t;
}

export function approve(t: Thread, a: AccountView, cfg: Config, at: string, editedBody?: string, who = "human"): Thread {
  if (editedBody != null && editedBody !== t.draft.body) {
    t.draft = { ...t.draft, body: editedBody };
    t.draft.check = checkDraft(t.draft, a, cfg);
    log(t, at, "human", "edited", `checks ${t.draft.check.ok ? "passed" : "FAILED: " + t.draft.check.issues.join("; ")}`);
  }
  if (!t.draft.check.ok) { log(t, at, "system", "blocked", "draft did not pass checks; not sent"); return t; }
  t.messages.push({ id: newId("m"), from: "us", at, subject: t.draft.subject, body: t.draft.body });
  t.state = "awaiting_reply"; t.sentAt = at; t.followUpOn = addDays(at, cfg.replyWaitDays);
  log(t, at, "human", "approved and sent", `by ${who}; follow up on ${t.followUpOn}`);
  return t;
}

export function reject(t: Thread, at: string, reason: string): Thread {
  t.state = "rejected"; log(t, at, "human", "rejected", reason); return t;
}

// ── reply classification (rules; the LLM path in llm.ts returns the same shape) ──

const DATE_RE = /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+\d{4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i;
const REF_RE = /\b(?:ref(?:erence)?|remittance|payment id|transaction)\s*[:#]?\s*([A-Z0-9-]{5,})/i;
const AMT_RE = /(?:EUR|GBP|USD|€|£|\$)\s?([\d,]+(?:\.\d{2})?)/i;

export function classifyReply(text: string): Classification {
  const s = text.toLowerCase();
  const has = (re: RegExp) => re.test(s);
  const extracted: Classification["extracted"] = {};
  const dm = text.match(DATE_RE); if (dm) extracted.date = dm[1];
  const rm = text.match(REF_RE); if (rm) extracted.reference = rm[1];
  const am = text.match(AMT_RE); if (am) extracted.amount = parseFloat(am[1].replace(/,/g, ""));
  const pick = (intent: Intent, confidence: number, rationale: string): Classification => ({ intent, confidence, extracted, rationale, source: "rules" });
  const future = has(/\b(will|going to|plan to|scheduled|next|by the|by end|end of|in \d+ days|next week|next month|commit)\b/) || (has(/\bpayment run\b/) && !has(/\b(was|were|been|went)\b/));
  const past = has(/\b(was|were|has been|have been|had been|already|yesterday|last week|went out)\b/);
  if (has(/\b(copy of|resend|re-send|send (me|us) (the|a) (copy|invoice)|never received|didn't receive|did not receive|don't have (the|a copy|the invoice)|do not have (the|a copy|the invoice)|missing invoice|wrong (email|address|person)|not the right person|no longer (works|here)|left the company|new (ap|accounts) (email|address|contact)|po number on it|with our po)\b/)) return pick("needs_copy", 0.85, "asks for the invoice or a new contact route");
  if (has(/\b(dispute|disput|incorrect|wrong|overcharg|do not agree|don't agree|never ordered|damaged|short.?shipped|not what we ordered|price was|pricing|quoted|cancelled|returned|no po number|remove it)\b/)) {
    const why = text.match(/(?:because|as|since)\s+([^.\n]{10,120})/i); if (why) extracted.reason = why[1].trim();
    return pick("dispute", 0.9, "disagreement language");
  }
  if (has(/\b(apply the credit|use the credit|offset|net (it|them|this) off|against the credit|credit note against|credit first)\b/)) return pick("apply_credit", 0.9, "asks to apply the credit");
  if (has(/\b(paid|payment (was|has been) (made|sent)|remitted|remittance|transferred|settled|cleared|went out)\b/) && (!future || past)) return pick("paid", extracted.reference || extracted.date ? 0.9 : 0.7, "says it is paid" + (extracted.reference ? ", with a reference" : ""));
  if (future && (has(/\b(pay|paying|pays|payment|settle|clear|transfer|process)\b/) || extracted.date)) return pick("promise_to_pay", extracted.date ? 0.85 : 0.65, "commits to a payment" + (extracted.date ? " on a date" : ", no date given"));
  if (has(/\?/) || has(/\b(can you|could you|what|why|how|which|who)\b/)) return pick("question", 0.6, "asks a question");
  return pick("unclear", 0.3, "no recognisable intent");
}

export function nextActionFor(c: Classification, a: AccountView, cfg: Config, at: string): NextAction {
  switch (c.intent) {
    case "paid": return { type: "verify_payment", note: `Trace the payment${c.extracted.reference ? " ref " + c.extracted.reference : ""}${c.extracted.date ? " dated " + c.extracted.date : ""}; close if it lands, otherwise ask for the remittance.`, requiresApproval: false };
    case "promise_to_pay": { const due = c.extracted.date ? parseLooseDate(c.extracted.date, at) : addDays(at, 14); return { type: "schedule_followup", dueDate: addDays(due, 1), note: `Promise to pay ${c.extracted.date ? "on " + c.extracted.date : "(no date)"}; check the day after.`, requiresApproval: false }; }
    case "dispute": return { type: "route_dispute", note: `Log a dispute${c.extracted.reason ? ": " + c.extracted.reason : ""}; pause chasing on these items; ask sales/ops to confirm the facts.`, requiresApproval: true };
    case "needs_copy": return { type: "resend_with_copy", note: "Resend the invoices to the contact they name; confirm the AP mailbox on the master record.", requiresApproval: true };
    case "apply_credit": return { type: "apply_credit", note: `Apply ${a.creditsAvailable} in credits as proposed, then send the updated balance.`, requiresApproval: true };
    case "question": return { type: "answer_question", note: "Answer the question; keep the four options in the reply.", requiresApproval: true };
    default: return { type: "escalate", note: "Reply does not say what happens next; a person reads it.", requiresApproval: true };
  }
}

export function receiveReply(t: Thread, a: AccountView, cfg: Config, at: string, text: string, classification?: Classification): Thread {
  const c = classification || classifyReply(text);
  t.messages.push({ id: newId("m"), from: "customer", at, body: text, classification: c });
  t.state = "action_pending"; t.outcome = c.intent; t.nextAction = nextActionFor(c, a, cfg, at);
  log(t, at, c.source === "llm" ? "llm" : "system", "reply classified", `${c.intent} (${Math.round(c.confidence * 100)}%): ${c.rationale}`);
  return t;
}

export function completeAction(t: Thread, at: string, who = "human"): Thread {
  const n = t.nextAction; if (!n) return t;
  if (n.type === "schedule_followup") { t.state = "awaiting_reply"; t.followUpOn = n.dueDate; }
  else if (n.type === "verify_payment" || n.type === "close") t.state = "closed";
  else if (n.type === "route_dispute") t.state = "closed";
  else t.state = "awaiting_reply", t.followUpOn = addDays(at, 7);
  log(t, at, "human", `action done: ${n.type}`, `by ${who}`);
  return t;
}

/** Threads whose wait has expired with no reply: chase again or step up a stage. */
export function overdueThreads(threads: Thread[], asOf: string): Thread[] {
  return threads.filter((t) => t.state === "awaiting_reply" && t.followUpOn && daysBetween(t.followUpOn, asOf) >= 0);
}

export function parseLooseDate(s: string, ref: string): string {
  const M: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const y = +ref.slice(0, 4);
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return s;
  if ((m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*(?:\s+(\d{4}))?/i))) return new Date(Date.UTC(m[3] ? +m[3] : y, M[m[2].toLowerCase()], +m[1])).toISOString().slice(0, 10);
  if ((m = s.match(/([a-z]{3})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i))) return new Date(Date.UTC(m[3] ? +m[3] : y, M[m[1].toLowerCase()], +m[2])).toISOString().slice(0, 10);
  if ((m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) { const yy = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return new Date(Date.UTC(yy, +m[2] - 1, +m[1])).toISOString().slice(0, 10); }
  return addDays(ref, 14);
}
