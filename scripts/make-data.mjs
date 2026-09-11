// make-data.mjs — a synthetic receivables ledger with hidden truth for the evals. Deterministic. No real names, no real companies.
import { writeFileSync, mkdirSync } from "node:fs";
let seed = 20260911; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)]; const between = (lo, hi) => lo + rnd() * (hi - lo); const r2 = (n) => Math.round(n * 100) / 100;
const AS_OF = "2026-09-11"; const DAY = 864e5;
const addDays = (d, n) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
const A = ["Ardent", "Bluebell", "Cedar", "Dunmore", "Ember", "Fallon", "Glenveagh", "Harbour", "Ironwood", "Juniper", "Kestrel", "Lough", "Marlow", "Nordic", "Orchard", "Pembroke", "Quayside", "Rathmore", "Silvermine", "Tolka", "Umber", "Vale", "Westport", "Yewtree", "Zephyr", "Ashgrove", "Brackley", "Clonmel", "Derrylea", "Eskgrove", "Foyle", "Greystone", "Hazelford", "Inchmore", "Kilbride", "Larkhill", "Moyross", "Newbridge", "Oakfield", "Portmore", "Redcliff", "Shannonside"];
const B = ["Logistics", "Foods", "Engineering", "Pharma", "Retail", "Hospitality", "Construction", "Media", "Dental", "Motors", "Analytics", "Textiles", "Packaging", "Marine", "Energy", "Print"];
const FIRST = ["Aoife", "Brian", "Ciara", "Declan", "Eimear", "Fionn", "Grainne", "Hugh", "Isla", "James", "Katie", "Liam", "Maeve", "Niall", "Orla", "Padraig", "Roisin", "Sean", "Tara", "Una", "Anja", "Bram", "Chloe", "Dev", "Priya", "Tom", "Sara", "Lukas"];
const LAST = ["Byrne", "Walsh", "Kelly", "Murphy", "Doyle", "Nolan", "Quinn", "Ryan", "Brennan", "Keane", "Fitzgerald", "Hayes", "Moran", "de Vries", "Schmidt", "Patel", "Novak", "Lynch"];
const ITEMS = ["Q2 catering supplies", "Packaging run 1140", "Maintenance contract, monthly", "Safety equipment order", "Consulting days, June", "Spare parts, order 8821", "Printed materials", "Cleaning services, monthly", "Software licences, annual", "Freight, week 27", "Uniforms, batch 3", "Training day, on site", "Kitchen equipment", "Signage installation", "Monthly service fee"];

const customers = [], invoices = [], credits = [], labels = {}, expectedCredits = [];
const truth = {}; // customerId -> behaviour
let inv = 10400, cn = 700, uc = 300;
for (let c = 0; c < 42; c++) {
  const name = `${A[c]} ${pick(B)} Ltd`; const id = `c${String(c + 1).padStart(3, "0")}`;
  const segment = pick(["enterprise", "mid", "mid", "small", "small", "small"]);
  const country = pick(["IE", "IE", "IE", "UK", "UK", "DE", "NL", "US"]);
  const terms = pick([30, 30, 45, 60]);
  const contact = `${pick(FIRST)} ${pick(LAST)}`;
  customers.push({ id, name, email: `ap@${A[c].toLowerCase()}-${B.indexOf(name.split(" ")[1]) + 1}.example`, contact, termsDays: terms, segment, country });
  const behaviour = truth[id] = pick(["responsive", "responsive", "responsive", "silent", "silent", "messy"]);
  const n = 3 + Math.floor(rnd() * 8);
  for (let k = 0; k < n; k++) {
    const bucket = pick(["current", "current", "current", "current", "1-30", "1-30", "31-60", "61-90", "91-180", "91-180", "180+"]);
    const dpd = bucket === "current" ? -Math.floor(between(1, 28)) : bucket === "1-30" ? Math.floor(between(1, 30)) : bucket === "31-60" ? Math.floor(between(31, 60)) : bucket === "61-90" ? Math.floor(between(61, 90)) : bucket === "91-180" ? Math.floor(between(91, 180)) : Math.floor(between(181, 400));
    const due = addDays(AS_OF, -dpd), issue = addDays(due, -terms);
    const base = segment === "enterprise" ? between(2500, 24000) : segment === "mid" ? between(600, 9000) : between(180, 2400);
    const amount = r2(Math.round(base / 5) * 5 + pick([0, 0, 0.5, 0.2, 0.75]));
    let status = "open", openAmount = amount, disputeReason;
    const roll = rnd();
    if (roll < 0.06 && dpd > 20) { status = "disputed"; disputeReason = pick(["Quantity delivered was short", "PO number missing", "Pricing differs from quote", "Goods returned in July"]); }
    else if (roll < 0.14) { status = "partially_paid"; openAmount = r2(amount * between(0.3, 0.7)); }
    const currency = country === "UK" ? "GBP" : country === "US" ? "USD" : "EUR";
    let lastContact = null, lastActivity = issue, dormantTruth = false;
    if (dpd > 0) {
      if (behaviour === "responsive") { lastContact = addDays(AS_OF, -Math.floor(between(1, 24))); lastActivity = lastContact; }
      else if (behaviour === "silent") { if (dpd >= 90) { dormantTruth = status !== "disputed"; lastContact = rnd() < 0.55 ? null : addDays(AS_OF, -Math.floor(between(45, 200))); if (rnd() < 0.1) { lastContact = addDays(AS_OF, -Math.floor(between(2, 20))); } /* noise: an automated statement went out, nobody spoke */ } else { lastContact = rnd() < 0.5 ? null : addDays(AS_OF, -Math.floor(between(10, 40))); } }
      else { lastContact = rnd() < 0.4 ? null : addDays(AS_OF, -Math.floor(between(5, 120))); if (dpd >= 90 && (lastContact == null || Date.parse(AS_OF) - Date.parse(lastContact) > 30 * DAY)) dormantTruth = status !== "disputed" && rnd() < 0.8; }
      if (lastContact) lastActivity = lastContact;
    }
    const number = `INV-${inv++}`; const iid = `i${inv}`;
    invoices.push({ id: iid, customerId: id, number, issueDate: issue, dueDate: due, amount, openAmount, currency, status, description: pick(ITEMS), lastActivity, lastContact, ...(disputeReason ? { disputeReason } : {}) });
    labels[iid] = dormantTruth;
  }
}
// credits: exact matches, partial unapplied cash, net-credit customers, all-disputed customers
const open = invoices.filter((i) => i.openAmount > 0 && i.status !== "disputed");
for (let k = 0; k < 8; k++) { const i = pick(open.filter((x) => !credits.some((c) => c.customerId === x.customerId))); const cid = `k${cn}`; credits.push({ id: cid, customerId: i.customerId, number: `CN-${cn++}`, date: addDays(i.dueDate, Math.floor(between(-10, 30))), amount: i.openAmount, remaining: i.openAmount, kind: "credit_note", reference: `Credit against ${i.number}` }); expectedCredits.push({ creditId: cid, invoiceId: i.id }); }
for (let k = 0; k < 12; k++) { const i = pick(open); const amt = r2(Math.round(i.openAmount * between(0.15, 0.9))); credits.push({ id: `u${uc}`, customerId: i.customerId, number: `UC-${uc++}`, date: addDays(AS_OF, -Math.floor(between(3, 120))), amount: amt, remaining: amt, kind: "unapplied_cash", reference: `Remittance ${Math.floor(between(100000, 999999))}` }); }
for (const c of customers.slice(0, 3)) { const tot = invoices.filter((i) => i.customerId === c.id).reduce((a, i) => a + i.openAmount, 0); const amt = r2(tot + between(200, 900)); credits.push({ id: `k${cn}`, customerId: c.id, number: `CN-${cn++}`, date: addDays(AS_OF, -20), amount: amt, remaining: amt, kind: "credit_note", reference: "Annual rebate" }); }
const ledger = { asOf: AS_OF, currency: "EUR", customers, invoices, credits };
const replies = [
  ["paid", "Hi, this was paid on 2 September, remittance ref RM-448812. Can you check on your side?"],
  ["paid", "We settled INV-10412 last week, payment reference 7781-AC. Should show by Friday."],
  ["paid", "Payment went out on 28/08/2026 via BACS. Let me know if it hasn't landed."],
  ["paid", "All three were cleared in our payment run on 5 Sept."],
  ["paid", "Transferred yesterday, EUR 4,250.00, ref NW-2201."],
  ["promise_to_pay", "Apologies for the delay. This will be paid in our next payment run on 20 September."],
  ["promise_to_pay", "We can commit to paying the full balance by end of month."],
  ["promise_to_pay", "Cash is tight this month; we plan to clear INV-10430 next week and the rest in October."],
  ["promise_to_pay", "Scheduled for 25th Sept, sorry for the wait."],
  ["promise_to_pay", "Our AP will process this within 10 days once the director signs off."],
  ["dispute", "We don't agree with this invoice. The quantity delivered was short by 40 units, so the amount is wrong."],
  ["dispute", "This was cancelled in June and the goods were returned. We shouldn't be billed."],
  ["dispute", "The pricing differs from what was quoted (we were quoted 1,150 not 1,400). Please issue a corrected invoice."],
  ["dispute", "There is no PO number on INV-10455 so our system rejected it. We dispute it until it is re-issued with PO 88123."],
  ["dispute", "Some of these items were damaged on arrival, we raised this with your driver."],
  ["needs_copy", "I don't have a copy of these invoices. Can you resend them to accounts@example-ap.test?"],
  ["needs_copy", "We never received INV-10470. Please send it again to me directly."],
  ["needs_copy", "Maria left the company in July, please send all invoices to ap-team@example.test from now on."],
  ["needs_copy", "Could you re-send the invoice with our PO number on it? Our system won't accept it without one."],
  ["needs_copy", "Wrong email address, I'm not the right person. Try our accounts team."],
  ["apply_credit", "Please apply the credit note CN-702 against INV-10401 and send us the updated balance."],
  ["apply_credit", "Can you offset the unapplied cash you're holding against the oldest invoice? Then we'll pay the remainder."],
  ["apply_credit", "Use the credit first, then tell us what's left."],
  ["question", "Which of these relate to the Cork site? We have two accounts with you."],
  ["question", "Can you confirm whether INV-10488 includes VAT?"],
  ["question", "What bank details should we use, the ones on the invoice look different from before?"],
  ["unclear", "Thanks, noted."],
  ["unclear", "Forwarding to the relevant team."],
  ["unclear", "Received."],
  ["paid", "Hi Collections Team, our records show this as paid on 15 Aug, ref 2026-0815-PAY. Might be sitting in your unallocated cash."],
  ["promise_to_pay", "Will pay by the 30th."],
  ["dispute", "Never ordered this. Please remove it."],
  ["needs_copy", "Do not have the invoice. Resend?"],
  ["question", "Why are there two invoices for the same delivery?"],
  ["promise_to_pay", "Payment run is on the 15th, it will go then."],
  ["paid", "Already paid. Check your bank."],
];
mkdirSync("public/demo", { recursive: true });
writeFileSync("public/demo/ledger.json", JSON.stringify(ledger, null, 1));
writeFileSync("public/demo/labels.json", JSON.stringify({ dormant: labels, expectedCredits, behaviour: truth }, null, 1));
writeFileSync("public/demo/replies.json", JSON.stringify(replies.map(([intent, text]) => ({ intent, text })), null, 1));
console.log(`customers ${customers.length}, invoices ${invoices.length}, credits ${credits.length}, dormant-labelled ${Object.values(labels).filter(Boolean).length}, replies ${replies.length}`);
