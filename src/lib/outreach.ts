/** outreach.ts — the email that re-opens the conversation, and the checks it must pass before anyone sees it. */
import { type Config, money, addDays } from "./model.js";
import type { AccountView, Stage } from "./dormancy.js";
import type { CreditOpportunity } from "./credits.js";

export interface DraftCheck { ok: boolean; issues: string[] }
export interface Draft {
  id: string; customerId: string; stage: Stage; subject: string; body: string;
  invoiceIds: string[]; attachments: string[]; createdAt: string; source: "template" | "llm"; check: DraftCheck;
}

const OPENERS: Record<Stage, string> = {
  current: "A quick note on your account with us.",
  reminder: "A friendly reminder that the invoice below is now past its due date.",
  overdue: "The invoices below are now more than a month past due and we have not received payment or heard from you about them.",
  reignite: "We have not heard from you about the invoices below for some time. It is possible they slipped through, or that something on our side needs fixing, so this is a check-in rather than a chase.",
  final: "The invoices below have been open for more than six months without a response. Before we take this any further internally, we would like to hear from you directly.",
};

export function buildDraft(a: AccountView, cfg: Config, asOf: string, creditOpp?: CreditOpportunity | null): Draft {
  const items = (a.dormant.length ? a.dormant : a.invoices.filter((i) => i.status !== "disputed")).slice().sort((x, y) => (x.dueDate < y.dueDate ? -1 : 1));
  const cur = items[0]?.currency || "EUR";
  const total = items.reduce((s, i) => s + i.openAmount, 0);
  const first = (a.customer.contact || "there").split(" ")[0];
  const lines = items.map((i) => `  • ${i.number}  dated ${i.issueDate}, due ${i.dueDate}: ${money(i.openAmount, i.currency)}${i.status === "partially_paid" ? " (balance after part-payment)" : ""}`);
  const creditLine = creditOpp && creditOpp.creditsAvailable > 0
    ? `\nWe also hold ${money(creditOpp.creditsAvailable, cur)} in credit on your account${creditOpp.proposals.length ? `, which we can apply against ${creditOpp.proposals.map((p) => p.invoiceNumber).filter((v, i, arr) => arr.indexOf(v) === i).join(", ")} if you confirm` : ""}. Say the word and we will do that first.\n`
    : "";
  const body = `Hi ${first},

${OPENERS[a.stage]}

${lines.join("\n")}

Total outstanding: ${money(total, cur)}. Copies are attached.
${creditLine}
Could you reply with one of the following, so we can close this out properly?
  1. Paid: the date and the payment reference, and we will trace it.
  2. Scheduled: the date you can commit to, and we will note it.
  3. Something is wrong: what does not match on your side (amount, PO, delivery, pricing).
  4. Missing: you never received the invoice, and we will resend it to the right person.

If none of those fit, a one-line reply is enough and I will pick it up from there.

Kind regards,
${cfg.sender.name}
${cfg.sender.title}, ${cfg.sender.company}
${cfg.sender.email} · ${cfg.sender.phone}`;
  const subject = items.length === 1 ? `${cfg.sender.company}: invoice ${items[0].number}, ${money(items[0].openAmount, cur)} outstanding` : `${cfg.sender.company}: ${items.length} invoices outstanding, ${money(total, cur)}`;
  const draft: Draft = {
    id: `d_${a.customer.id}_${asOf}`, customerId: a.customer.id, stage: a.stage, subject, body,
    invoiceIds: items.map((i) => i.id), attachments: items.map((i) => `${i.number}.pdf`), createdAt: asOf, source: "template", check: { ok: true, issues: [] },
  };
  draft.check = checkDraft(draft, a, cfg);
  return draft;
}

/** Verify, never claim: every invoice number and amount in the text must exist on this account; no banned words; the ask must be there. */
export function checkDraft(d: Draft, a: AccountView, cfg: Config): DraftCheck {
  const issues: string[] = [];
  const text = d.subject + "\n" + d.body;
  const numbers = new Set(a.invoices.map((i) => i.number).concat(a.credits.map((k) => k.number)));
  for (const m of text.matchAll(/\b(INV|CN|UC)-\d{4,}\b/g)) if (!numbers.has(m[0])) issues.push(`mentions ${m[0]}, which is not on this account`);
  const amounts = new Set<string>();
  for (const i of a.invoices) amounts.add(i.openAmount.toFixed(2)), amounts.add(i.amount.toFixed(2));
  for (const k of a.credits) amounts.add(k.remaining.toFixed(2)), amounts.add(k.amount.toFixed(2));
  const total = a.invoices.filter((i) => d.invoiceIds.includes(i.id)).reduce((s, i) => s + i.openAmount, 0);
  amounts.add(total.toFixed(2)); amounts.add(a.creditsAvailable.toFixed(2)); amounts.add(a.totalOpen.toFixed(2)); amounts.add(a.dormantAmount.toFixed(2));
  for (const m of text.matchAll(/(?:EUR|GBP|USD)\s?([\d,]+\.\d{2})/g)) { const v = m[1].replace(/,/g, ""); if (!amounts.has(v)) issues.push(`amount ${m[1]} does not match the ledger`); }
  for (const w of cfg.bannedWords) if (text.toLowerCase().includes(w)) issues.push(`uses “${w}”`);
  const asks = /(reply with|let (me|us) know|could you (confirm|tell)|please confirm|which of (these|the following)|one of the following)/i.test(text);
  const options = /\b1[.)]/.test(text) && /\b2[.)]/.test(text) && /\b3[.)]/.test(text);
  if (!asks || !options) issues.push("does not ask for a confirmation with the numbered options");
  if (d.body.length > 2600) issues.push("too long");
  if (!d.invoiceIds.length) issues.push("no invoices referenced");
  return { ok: issues.length === 0, issues };
}

export function followUpDate(asOf: string, cfg: Config): string { return addDays(asOf, cfg.replyWaitDays); }
