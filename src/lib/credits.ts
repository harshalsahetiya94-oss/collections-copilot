/** credits.ts — credit notes and unapplied cash that should be applied, refunded or explained. */
import { type Ledger, type Credit, type Invoice, round2 } from "./model.js";

export interface CreditProposal { id: string; customerId: string; creditId: string; creditNumber: string; invoiceId: string; invoiceNumber: string; amount: number; kind: "exact" | "partial"; rationale: string }
export interface CreditOpportunity { customerId: string; customerName: string; creditsAvailable: number; openAmount: number; proposals: CreditProposal[]; unappliedAfter: number; netCredit: number; note: string }

/** Exact matches first (a credit that equals an open invoice is almost always meant for it), then oldest credit to oldest invoice. */
export function matchCredits(ledger: Ledger): CreditOpportunity[] {
  const out: CreditOpportunity[] = [];
  for (const c of ledger.customers) {
    const credits = ledger.credits.filter((k) => k.customerId === c.id && k.remaining > 0.005).map((k) => ({ ...k })).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!credits.length) continue;
    const invoices = ledger.invoices.filter((i) => i.customerId === c.id && i.openAmount > 0.005 && i.status !== "disputed").map((i) => ({ ...i })).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    const proposals: CreditProposal[] = [];
    const propose = (k: Credit, i: Invoice, amount: number, kind: "exact" | "partial", why: string) => {
      proposals.push({ id: `cp_${k.id}_${i.id}`, customerId: c.id, creditId: k.id, creditNumber: k.number, invoiceId: i.id, invoiceNumber: i.number, amount: round2(amount), kind, rationale: why });
      k.remaining = round2(k.remaining - amount); i.openAmount = round2(i.openAmount - amount);
    };
    for (const k of credits) {
      const exact = invoices.find((i) => Math.abs(i.openAmount - k.remaining) < 0.01);
      if (exact) propose(k, exact, k.remaining, "exact", `${k.kind === "credit_note" ? "Credit note" : "Unapplied cash"} ${k.number} equals the open balance on ${exact.number}.`);
    }
    for (const k of credits) {
      for (const i of invoices) {
        if (k.remaining < 0.01) break;
        if (i.openAmount < 0.01) continue;
        const amt = Math.min(k.remaining, i.openAmount);
        propose(k, i, amt, "partial", `Oldest open invoice first: ${i.number} (due ${i.dueDate}).`);
      }
    }
    const creditsAvailable = round2(ledger.credits.filter((k) => k.customerId === c.id).reduce((a, k) => a + k.remaining, 0));
    const openAmount = round2(ledger.invoices.filter((i) => i.customerId === c.id).reduce((a, i) => a + i.openAmount, 0));
    const unappliedAfter = round2(credits.reduce((a, k) => a + k.remaining, 0));
    const netCredit = round2(Math.max(0, creditsAvailable - openAmount));
    const note = netCredit > 0 ? `Customer is in net credit by ${netCredit}: refund or hold, and tell them.` : proposals.length ? `${proposals.length} application${proposals.length === 1 ? "" : "s"} proposed; ${unappliedAfter} left unapplied.` : "Credits exist but every open item is disputed.";
    out.push({ customerId: c.id, customerName: c.name, creditsAvailable, openAmount, proposals, unappliedAfter, netCredit, note });
  }
  return out.sort((a, b) => b.creditsAvailable - a.creditsAvailable);
}

/** Apply approved proposals to a copy of the ledger. */
export function applyProposals(ledger: Ledger, proposals: CreditProposal[]): Ledger {
  const l: Ledger = { ...ledger, invoices: ledger.invoices.map((i) => ({ ...i })), credits: ledger.credits.map((k) => ({ ...k })) };
  for (const p of proposals) {
    const k = l.credits.find((x) => x.id === p.creditId); const i = l.invoices.find((x) => x.id === p.invoiceId);
    if (!k || !i) continue;
    const amt = Math.min(p.amount, k.remaining, i.openAmount);
    k.remaining = round2(k.remaining - amt); i.openAmount = round2(i.openAmount - amt); i.lastActivity = l.asOf;
    if (i.openAmount < 0.01 && i.status !== "disputed") i.status = "open";
  }
  return l;
}
