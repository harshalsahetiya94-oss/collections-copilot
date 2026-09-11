/** model.ts — the ledger and the configuration. Plain data; no behaviour. */

export type Segment = "enterprise" | "mid" | "small";
export type InvoiceStatus = "open" | "partially_paid" | "disputed";
export type CreditKind = "credit_note" | "unapplied_cash";

export interface Customer { id: string; name: string; email: string; contact: string; termsDays: number; segment: Segment; country: string }
export interface Invoice {
  id: string; customerId: string; number: string; issueDate: string; dueDate: string; amount: number; openAmount: number;
  currency: string; status: InvoiceStatus; description: string;
  /** Last posting or note on the invoice (payment, dispute note, reminder). */
  lastActivity: string;
  /** Last time anyone spoke to the customer about it. null = never. */
  lastContact: string | null;
  disputeReason?: string;
}
export interface Credit { id: string; customerId: string; number: string; date: string; amount: number; remaining: number; kind: CreditKind; reference?: string }
export interface Ledger { asOf: string; currency: string; customers: Customer[]; invoices: Invoice[]; credits: Credit[] }

export interface Config {
  /** An invoice is dormant when it is at least this many days past due… */
  dormantAfterDaysPastDue: number;
  /** …and nobody has spoken to the customer about it for this many days (or ever). */
  noContactDays: number;
  /** Days to wait for a reply before the next step. */
  replyWaitDays: number;
  sender: { name: string; title: string; company: string; email: string; phone: string };
  bannedWords: string[];
}

export const DEFAULT_CONFIG: Config = {
  dormantAfterDaysPastDue: 90,
  noContactDays: 30,
  replyWaitDays: 7,
  sender: { name: "Collections Team", title: "Accounts Receivable", company: "Northwind Supplies Ltd", email: "ar@northwind.example", phone: "+353 61 000 000" },
  bannedWords: ["legal action", "debt collector", "final warning", "immediately", "urgent", "asap", "failure to", "penalt", "solicitor", "court"],
};

export const DAY = 864e5;
export function daysBetween(from: string, to: string): number { return Math.round((Date.parse(to) - Date.parse(from)) / DAY); }
export function addDays(date: string, n: number): string { return new Date(Date.parse(date) + n * DAY).toISOString().slice(0, 10); }
export function money(n: number, currency = "EUR"): string {
  return `${currency} ${n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function round2(n: number): number { return Math.round(n * 100) / 100; }
let _seq = 0;
export function newId(prefix: string): string { _seq += 1; return `${prefix}_${Date.now().toString(36)}${_seq.toString(36)}`; }
