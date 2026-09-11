/** dormancy.ts — which receivables have gone quiet, and who to work first. */
import { type Config, type Customer, type Invoice, type Credit, type Ledger, daysBetween, round2 } from "./model.js";

export type Stage = "current" | "reminder" | "overdue" | "reignite" | "final";

export interface AccountView {
  customer: Customer;
  invoices: Invoice[];            // open items
  credits: Credit[];              // with remaining > 0
  totalOpen: number;
  totalOverdue: number;
  oldestDaysPastDue: number;
  daysSinceContact: number | null; // across open items; null = never contacted
  dormant: Invoice[];
  dormantAmount: number;
  disputed: Invoice[];
  creditsAvailable: number;
  netExposure: number;
  stage: Stage;
  score: number;
  reasons: string[];
}

export function daysPastDue(inv: Invoice, asOf: string): number { return Math.max(0, daysBetween(inv.dueDate, asOf)); }

export function isDormant(inv: Invoice, asOf: string, cfg: Config): boolean {
  if (inv.status === "disputed") return false;
  if (daysPastDue(inv, asOf) < cfg.dormantAfterDaysPastDue) return false;
  const silent = inv.lastContact == null ? Infinity : daysBetween(inv.lastContact, asOf);
  return silent >= cfg.noContactDays;
}

export function stageFor(oldestDaysPastDue: number): Stage {
  if (oldestDaysPastDue <= 0) return "current";
  if (oldestDaysPastDue < 30) return "reminder";
  if (oldestDaysPastDue < 90) return "overdue";
  if (oldestDaysPastDue <= 180) return "reignite";
  return "final";
}

/** 0–100. Amount, age and silence push it up; credits on hand make it an easy win; a disputed book routes elsewhere. */
export function scoreAccount(a: Omit<AccountView, "score" | "reasons" | "stage">, cfg: Config): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let s = 0;
  const amt = Math.min(40, 10 * Math.log10(1 + a.dormantAmount / 100 + a.totalOverdue / 500));
  s += amt; if (a.dormantAmount > 0) reasons.push(`${round2(a.dormantAmount)} dormant across ${a.dormant.length} invoice${a.dormant.length === 1 ? "" : "s"}`);
  const age = Math.min(30, a.oldestDaysPastDue / 10);
  s += age; if (a.oldestDaysPastDue >= cfg.dormantAfterDaysPastDue) reasons.push(`oldest item ${a.oldestDaysPastDue} days past due`);
  const silence = a.daysSinceContact == null ? 20 : Math.min(20, a.daysSinceContact / 5);
  s += silence; reasons.push(a.daysSinceContact == null ? "never contacted" : `last contact ${a.daysSinceContact} days ago`);
  if (a.creditsAvailable > 0) { s += 10; reasons.push(`${round2(a.creditsAvailable)} in credits waiting to be applied`); }
  if (a.invoices.length && a.disputed.length === a.invoices.length) { s -= 25; reasons.push("every open item is disputed: dispute desk, not chasing"); }
  return { score: Math.max(0, Math.min(100, Math.round(s))), reasons };
}

export function accountViews(ledger: Ledger, cfg: Config): AccountView[] {
  const out: AccountView[] = [];
  for (const c of ledger.customers) {
    const invoices = ledger.invoices.filter((i) => i.customerId === c.id && i.openAmount > 0.005);
    if (!invoices.length) continue;
    const credits = ledger.credits.filter((k) => k.customerId === c.id && k.remaining > 0.005);
    const overdue = invoices.filter((i) => daysPastDue(i, ledger.asOf) > 0);
    const dormant = invoices.filter((i) => isDormant(i, ledger.asOf, cfg));
    const disputed = invoices.filter((i) => i.status === "disputed");
    const contacts = invoices.map((i) => (i.lastContact ? daysBetween(i.lastContact, ledger.asOf) : null));
    const known = contacts.filter((x): x is number => x != null);
    const base = {
      customer: c, invoices, credits,
      totalOpen: round2(invoices.reduce((a, i) => a + i.openAmount, 0)),
      totalOverdue: round2(overdue.reduce((a, i) => a + i.openAmount, 0)),
      oldestDaysPastDue: overdue.reduce((a, i) => Math.max(a, daysPastDue(i, ledger.asOf)), 0),
      daysSinceContact: known.length ? Math.min(...known) : null,
      dormant, dormantAmount: round2(dormant.reduce((a, i) => a + i.openAmount, 0)), disputed,
      creditsAvailable: round2(credits.reduce((a, k) => a + k.remaining, 0)),
      netExposure: 0,
    };
    base.netExposure = round2(base.totalOpen - base.creditsAvailable);
    const { score, reasons } = scoreAccount(base, cfg);
    out.push({ ...base, stage: stageFor(base.oldestDaysPastDue), score, reasons });
  }
  return out;
}

/** Accounts worth working, best first. */
export function worklist(ledger: Ledger, cfg: Config): AccountView[] {
  return accountViews(ledger, cfg).filter((a) => a.totalOverdue > 0 || a.creditsAvailable > 0).sort((a, b) => b.score - a.score);
}

export interface AgingBucket { bucket: string; count: number; amount: number }
export function aging(ledger: Ledger): AgingBucket[] {
  const B: [string, number, number][] = [["Current", -Infinity, 0], ["1–30", 1, 30], ["31–60", 31, 60], ["61–90", 61, 90], ["91–180", 91, 180], ["180+", 181, Infinity]];
  const rows = B.map(([bucket]) => ({ bucket, count: 0, amount: 0 }));
  for (const i of ledger.invoices) {
    if (i.openAmount <= 0.005) continue;
    const d = daysPastDue(i, ledger.asOf);
    const k = B.findIndex(([, lo, hi]) => d >= lo && d <= hi);
    rows[k].count++; rows[k].amount = round2(rows[k].amount + i.openAmount);
  }
  return rows;
}
