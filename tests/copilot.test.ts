import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_CONFIG, accountViews, worklist, isDormant, aging, matchCredits, applyProposals, buildDraft, checkDraft, classifyReply, openThread, approve, reject, receiveReply, completeAction, overdueThreads, parseLooseDate, evalDormancy, evalCredits, evalClassification, evalDrafts, type Ledger } from "../src/lib";

const ledger: Ledger = JSON.parse(readFileSync(new URL("../public/demo/ledger.json", import.meta.url), "utf8"));
const labels = JSON.parse(readFileSync(new URL("../public/demo/labels.json", import.meta.url), "utf8"));
const replies = JSON.parse(readFileSync(new URL("../public/demo/replies.json", import.meta.url), "utf8"));
const cfg = DEFAULT_CONFIG;

describe("dormancy", () => {
  it("flags only past-due, silent, undisputed items", () => {
    const asOf = "2026-09-11";
    const base = { id: "x", customerId: "c", number: "INV-1", issueDate: "2026-04-01", dueDate: "2026-05-01", amount: 100, openAmount: 100, currency: "EUR", status: "open" as const, description: "", lastActivity: "2026-04-01", lastContact: null };
    expect(isDormant(base, asOf, cfg)).toBe(true);
    expect(isDormant({ ...base, lastContact: "2026-09-01" }, asOf, cfg)).toBe(false);
    expect(isDormant({ ...base, dueDate: "2026-08-01" }, asOf, cfg)).toBe(false);
    expect(isDormant({ ...base, status: "disputed" }, asOf, cfg)).toBe(false);
  });
  it("worklist is sorted by score and every account has reasons", () => {
    const wl = worklist(ledger, cfg);
    expect(wl.length).toBeGreaterThan(10);
    for (let i = 1; i < wl.length; i++) expect(wl[i - 1].score).toBeGreaterThanOrEqual(wl[i].score);
    expect(wl[0].reasons.length).toBeGreaterThan(0);
  });
  it("aging buckets add up to the open book", () => {
    const total = ledger.invoices.reduce((a, i) => a + i.openAmount, 0);
    const buckets = aging(ledger);
    expect(Math.abs(buckets.reduce((a, b) => a + b.amount, 0) - total)).toBeLessThan(0.05);
  });
  it("beats a naive baseline on the labelled truth", () => {
    const e = evalDormancy(ledger, cfg, labels.dormant);
    expect(e.precision).toBeGreaterThan(0.85);
    expect(e.recall).toBeGreaterThan(0.6);
  });
});

describe("credits", () => {
  it("finds every intended exact match and proposes partial applications", () => {
    const e = evalCredits(ledger, labels.expectedCredits);
    expect(e.recall).toBe(1);
    expect(e.proposed).toBeGreaterThan(labels.expectedCredits.length);
  });
  it("names net-credit customers", () => {
    expect(matchCredits(ledger).filter((o) => o.netCredit > 0).length).toBeGreaterThanOrEqual(2);
  });
  it("applying proposals reduces both sides", () => {
    const opp = matchCredits(ledger).find((o) => o.proposals.length)!;
    const after = applyProposals(ledger, opp.proposals);
    const p = opp.proposals[0];
    expect(after.credits.find((k) => k.id === p.creditId)!.remaining).toBeLessThan(ledger.credits.find((k) => k.id === p.creditId)!.remaining);
    expect(after.invoices.find((i) => i.id === p.invoiceId)!.openAmount).toBeLessThan(ledger.invoices.find((i) => i.id === p.invoiceId)!.openAmount);
  });
});

describe("drafts", () => {
  const a = worklist(ledger, cfg)[0];
  it("builds a draft that passes its own checks and asks for confirmation", () => {
    const d = buildDraft(a, cfg, ledger.asOf, matchCredits(ledger).find((o) => o.customerId === a.customer.id) || null);
    expect(d.check.ok).toBe(true);
    expect(d.body).toMatch(/reply with one of the following/i);
    expect(d.attachments.length).toBe(d.invoiceIds.length);
  });
  it("catches a fabricated invoice number, a wrong amount and a banned word", () => {
    const d = buildDraft(a, cfg, ledger.asOf);
    const bad = { ...d, body: d.body + "\nAlso INV-99999 for EUR 123,456.78 is due immediately." };
    const c = checkDraft(bad, a, cfg);
    expect(c.ok).toBe(false);
    expect(c.issues.join(" ")).toMatch(/INV-99999/);
    expect(c.issues.join(" ")).toMatch(/123,456.78/);
    expect(c.issues.join(" ")).toMatch(/immediately/);
  });
  it("every account's draft passes", () => {
    const e = evalDrafts(ledger, cfg);
    expect(e.passing).toBe(e.drafts);
  });
});

describe("replies", () => {
  it("classifies the labelled set well with rules alone", () => {
    const e = evalClassification(replies);
    expect(e.accuracy).toBeGreaterThanOrEqual(0.85);
  });
  it("extracts references and dates", () => {
    const c = classifyReply("Hi, this was paid on 2 September, remittance ref RM-448812.");
    expect(c.intent).toBe("paid"); expect(c.extracted.reference).toBe("RM-448812"); expect(c.extracted.date).toMatch(/2 September/);
  });
  it("turns loose dates into ISO", () => {
    expect(parseLooseDate("20 September", "2026-09-11")).toBe("2026-09-20");
    expect(parseLooseDate("Sept 25", "2026-09-11")).toBe("2026-09-25");
    expect(parseLooseDate("28/08/2026", "2026-09-11")).toBe("2026-08-28");
  });
});

describe("conversation loop", () => {
  const a = worklist(ledger, cfg)[1];
  it("draft → approve → send → reply → action → close, with an audit trail", () => {
    const t = openThread(a, cfg, ledger.asOf);
    expect(t.state).toBe("awaiting_approval");
    approve(t, a, cfg, "2026-09-11", undefined, "Harshal");
    expect(t.state).toBe("awaiting_reply"); expect(t.followUpOn).toBe("2026-09-18"); expect(t.messages.length).toBe(1);
    receiveReply(t, a, cfg, "2026-09-13", "Paid on 10 Sept, ref PAY-5521.");
    expect(t.state).toBe("action_pending"); expect(t.nextAction?.type).toBe("verify_payment");
    completeAction(t, "2026-09-14", "Harshal");
    expect(t.state).toBe("closed");
    expect(t.audit.map((e) => e.event)).toEqual(["drafted", "approved and sent", "reply classified", "action done: verify_payment"]);
  });
  it("an edited draft that fails the checks is blocked, not sent", () => {
    const t = openThread(a, cfg, ledger.asOf);
    approve(t, a, cfg, "2026-09-11", t.draft.body + "\nWe will take legal action.");
    expect(t.state).toBe("awaiting_approval"); expect(t.audit.at(-1)?.event).toBe("blocked");
  });
  it("a promise schedules a follow-up the day after; silence surfaces as overdue", () => {
    const t = openThread(a, cfg, ledger.asOf); approve(t, a, cfg, "2026-09-11");
    receiveReply(t, a, cfg, "2026-09-12", "We will pay this on 20 September.");
    expect(t.nextAction?.dueDate).toBe("2026-09-21");
    completeAction(t, "2026-09-12"); expect(t.state).toBe("awaiting_reply");
    const t2 = openThread(a, cfg, ledger.asOf); approve(t2, a, cfg, "2026-09-01");
    expect(overdueThreads([t, t2], "2026-09-11").map((x) => x.id)).toEqual([t2.id]);
    reject(t2, "2026-09-11", "wrong contact"); expect(t2.state).toBe("rejected");
  });
});
