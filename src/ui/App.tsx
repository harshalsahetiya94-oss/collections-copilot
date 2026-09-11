import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  DEFAULT_CONFIG, type Config, type Ledger, type AccountView, type Thread, type CreditProposal, type Intent, type Classification,
  worklist, accountViews, aging, matchCredits, applyProposals, buildDraft, checkDraft, openThread, approve, reject, receiveReply, completeAction, overdueThreads,
  classifyReply, classifyWithLlm, personaliseDraft, simulateCustomerReply, evalDormancy, evalCredits, evalClassification, evalDrafts, money, round2, addDays,
} from "../lib";
import "./styles.css";

type Tab = "overview" | "worklist" | "approvals" | "inbox" | "credits" | "audit" | "evals";
interface LlmFixture { generatedAt: string; model: string; drafts: Record<string, { body: string; check: { ok: boolean; issues: string[] } }>; replies: Record<string, { persona: Intent; text: string }> }
interface Labels { dormant: Record<string, boolean>; expectedCredits: { creditId: string; invoiceId: string }[]; behaviour: Record<string, string> }
const scoreColor = (s: number) => (s >= 65 ? "#d9480f" : s >= 45 ? "#b45309" : "#0f8a5f");
const base = import.meta.env.BASE_URL;

export default function App() {
  const [ledger0, setLedger0] = useState<Ledger | null>(null);
  const [labels, setLabels] = useState<Labels | null>(null);
  const [replySet, setReplySet] = useState<{ intent: Intent; text: string }[]>([]);
  const [llm, setLlm] = useState<LlmFixture | null>(null);
  const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);
  const [tab, setTab] = useState<Tab>("overview");
  const [applied, setApplied] = useState<CreditProposal[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [today, setToday] = useState("2026-09-11");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [useModelDrafts, setUseModelDrafts] = useState(true);
  const [creditLog, setCreditLog] = useState<{ at: string; what: string }[]>([]);

  useEffect(() => {
    Promise.all([fetch(base + "demo/ledger.json").then((r) => r.json()), fetch(base + "demo/labels.json").then((r) => r.json()), fetch(base + "demo/replies.json").then((r) => r.json()), fetch(base + "demo/llm.json").then((r) => (r.ok ? r.json() : null)).catch(() => null)])
      .then(([l, lb, rp, lm]) => { setLedger0(l); setLabels(lb); setReplySet(rp); setLlm(lm); });
  }, []);

  const ledger = useMemo(() => (ledger0 ? applyProposals({ ...ledger0, asOf: today }, applied) : null), [ledger0, applied, today]);
  const views = useMemo(() => (ledger ? accountViews(ledger, cfg) : []), [ledger, cfg]);
  const wl = useMemo(() => (ledger ? worklist(ledger, cfg) : []), [ledger, cfg]);
  const opps = useMemo(() => (ledger ? matchCredits(ledger) : []), [ledger]);
  const byId = useMemo(() => Object.fromEntries(views.map((v) => [v.customer.id, v])), [views]);
  const bump = () => setThreads((t) => [...t]);
  const llmOpts = apiKey ? { apiKey } : null;

  if (!ledger || !labels) return <div className="wrap"><p className="muted">Loading the demo ledger…</p></div>;

  const dormantInvoices = views.flatMap((v) => v.dormant);
  const dormantAmount = round2(dormantInvoices.reduce((a, i) => a + i.openAmount, 0));
  const openAR = round2(ledger.invoices.reduce((a, i) => a + i.openAmount, 0));
  const overdueAR = round2(views.reduce((a, v) => a + v.totalOverdue, 0));
  const creditsAvail = round2(ledger.credits.reduce((a, k) => a + k.remaining, 0));
  const awaiting = threads.filter((t) => t.state === "awaiting_approval");
  const pendingAction = threads.filter((t) => t.state === "action_pending");
  const waitingReply = threads.filter((t) => t.state === "awaiting_reply");
  const late = overdueThreads(threads, today);

  async function draftFor(a: AccountView) {
    if (threads.some((t) => t.customerId === a.customer.id && !["closed", "rejected"].includes(t.state))) { setTab("approvals"); return; }
    const opp = opps.find((o) => o.customerId === a.customer.id) || null;
    let d = buildDraft(a, cfg, today, opp);
    if (useModelDrafts && llmOpts) {
      setBusy("Asking the model to personalise the draft…");
      try { d = await personaliseDraft(llmOpts, d, a); d.check = checkDraft(d, a, cfg); } catch (e) { alert(String(e)); }
      setBusy(null);
    } else if (useModelDrafts && llm?.drafts[a.customer.id]) {
      d = { ...d, body: llm.drafts[a.customer.id].body, source: "llm" }; d.check = checkDraft(d, a, cfg);
    }
    setThreads((t) => [...t, openThread(a, cfg, today, opp, d)]);
    setTab("approvals");
  }
  async function simulate(t: Thread) {
    const a = byId[t.customerId]; if (!a) return;
    let text = llm?.replies[t.customerId]?.text;
    if (llmOpts) { setBusy("Model is playing the customer…"); try { text = await simulateCustomerReply(llmOpts, t.messages[t.messages.length - 1].body, (["paid", "promise_to_pay", "dispute", "needs_copy", "apply_credit", "question"] as Intent[])[threads.indexOf(t) % 6], a); } catch (e) { alert(String(e)); } setBusy(null); }
    if (!text) text = replySet[(threads.indexOf(t) * 7) % replySet.length].text;
    await handleReply(t, text);
  }
  async function handleReply(t: Thread, text: string) {
    const a = byId[t.customerId]; if (!a) return;
    let c: Classification = classifyReply(text);
    if (c.confidence < 0.6 && llmOpts) { setBusy("Rules are unsure; asking the model…"); try { c = await classifyWithLlm(llmOpts, text); } catch (e) { alert(String(e)); } setBusy(null); }
    receiveReply(t, a, cfg, addDays(today, 2), text, c); bump(); setTab("inbox");
  }
  function chaseAgain(t: Thread) {
    const a = byId[t.customerId]; if (!a) return;
    t.state = "closed"; t.audit.push({ at: today, actor: "system", event: "no reply by follow-up date", detail: "new draft opened at the next stage" });
    const next: AccountView = { ...a, stage: a.stage === "reminder" ? "overdue" : a.stage === "overdue" ? "reignite" : "final" };
    setThreads((ts) => [...ts, openThread(next, cfg, today, opps.find((o) => o.customerId === a.customer.id) || null)]); setTab("approvals");
  }

  const evals = tab === "evals" ? { d: evalDormancy(ledger, cfg, labels.dormant), c: evalCredits(ledger0!, labels.expectedCredits), k: evalClassification(replySet), dr: evalDrafts(ledger, cfg) } : null;
  const selView = sel ? byId[sel] : null;

  return (
    <div className="wrap">
      <header>
        <div><h1>Collections Copilot</h1><p className="sub">Finds receivables that went quiet, spots credits that should be applied, re-opens the conversation with the invoice in hand, and turns every reply into a confirmed next step. A person approves every send.</p></div>
        <div className="privacy">Demo ledger is synthetic. Runs in your browser. Add your own model key below and nothing but that call leaves the tab.</div>
      </header>
      <nav className="tabs">
        {(["overview", "worklist", "approvals", "inbox", "credits", "audit", "evals"] as Tab[]).map((k) => {
          const n = k === "approvals" ? awaiting.length : k === "inbox" ? pendingAction.length + late.length : k === "credits" ? opps.filter((o) => o.proposals.length || o.netCredit > 0).length : 0;
          return <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k[0].toUpperCase() + k.slice(1)}{n > 0 && <span className="n">{n}</span>}</button>;
        })}
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>as of <input type="text" value={today} onChange={(e) => /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && setToday(e.target.value)} style={{ width: 110 }} /></span>
      </nav>
      {busy && <div className="panel" style={{ borderColor: "#c7d2fe" }}>{busy}</div>}

      {tab === "overview" && <>
        <div className="cards">
          <div className="card"><div className="k">Open receivables</div><div className="v">{money(openAR, ledger.currency)}</div></div>
          <div className="card"><div className="k">Overdue</div><div className="v out">{money(overdueAR, ledger.currency)}</div></div>
          <div className="card"><div className="k">Dormant tail</div><div className="v out">{money(dormantAmount, ledger.currency)}</div><div className="muted" style={{ fontSize: 12 }}>{dormantInvoices.length} invoices, {views.filter((v) => v.dormant.length).length} customers</div></div>
          <div className="card"><div className="k">Credits on hand</div><div className="v in">{money(creditsAvail, ledger.currency)}</div><div className="muted" style={{ fontSize: 12 }}>{opps.reduce((a, o) => a + o.proposals.length, 0)} applications proposed</div></div>
          <div className="card"><div className="k">Awaiting approval</div><div className="v">{awaiting.length}</div></div>
          <div className="card"><div className="k">Replies to act on</div><div className="v">{pendingAction.length}</div></div>
        </div>
        <div className="grid2">
          <div className="panel"><h2>Aging</h2>
            <ResponsiveContainer width="100%" height={220}><BarChart data={aging(ledger)} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}><XAxis dataKey="bucket" fontSize={12} /><YAxis fontSize={12} width={70} /><Tooltip formatter={(v: number) => money(v, ledger.currency)} /><Bar dataKey="amount" radius={[3, 3, 0, 0]}>{aging(ledger).map((_b, i) => <Cell key={i} fill={["#0f8a5f", "#65a30d", "#b45309", "#d9480f", "#b91c1c", "#7f1d1d"][i]} />)}</Bar></BarChart></ResponsiveContainer>
          </div>
          <div className="panel"><h2>How it decides</h2>
            <div className="how">
              <div className="card"><div className="k">Rules, about 80%</div><p>Dormancy ({cfg.dormantAfterDaysPastDue}+ days past due, {cfg.noContactDays}+ days silent), scoring, credit matching, stage, the draft's facts and the reply's intent when the wording is clear. Deterministic, testable, cannot invent anything.</p></div>
              <div className="card"><div className="k">Model, about 20%</div><p>Rewrites the template in a human voice and reads replies the rules cannot. Every model draft is checked against the ledger before it is shown; every model classification is labelled as such.</p></div>
              <div className="card"><div className="k">Human, 100% of sends</div><p>Nothing goes out without approval. Disputes, credits, resends and anything unclear stop for a person. Every step is in the audit trail.</p></div>
            </div>
            <div style={{ marginTop: 12, fontSize: 13 }} className="row">
              <label>Model key (optional, stays in memory): <input type="text" placeholder="sk-ant-…" value={apiKey} onChange={(e) => setApiKey(e.target.value.trim())} style={{ width: 220 }} /></label>
              <label><input type="checkbox" checked={useModelDrafts} onChange={(e) => setUseModelDrafts(e.target.checked)} /> use model-written drafts {llm && !apiKey && <span className="muted">(pre-generated with {llm.model})</span>}</label>
            </div>
            <div style={{ marginTop: 8, fontSize: 13 }} className="row">
              <label>Dormant after <input type="text" value={cfg.dormantAfterDaysPastDue} onChange={(e) => setCfg({ ...cfg, dormantAfterDaysPastDue: +e.target.value || 0 })} style={{ width: 50 }} /> days past due</label>
              <label>and <input type="text" value={cfg.noContactDays} onChange={(e) => setCfg({ ...cfg, noContactDays: +e.target.value || 0 })} style={{ width: 50 }} /> days without contact</label>
            </div>
          </div>
        </div>
        <div className="panel"><h2>Start here</h2><p className="muted" style={{ fontSize: 13, margin: 0 }}>Open <button className="btn link" onClick={() => setTab("worklist")}>Worklist</button>, pick the top account, read why it scored, draft the outreach. Approve it in <button className="btn link" onClick={() => setTab("approvals")}>Approvals</button>. Then in <button className="btn link" onClick={() => setTab("inbox")}>Inbox</button> simulate the customer's reply and see the loop turn it into a next step.</p></div>
      </>}

      {tab === "worklist" && <div className="grid2" style={{ gridTemplateColumns: selView ? "1.1fr 1fr" : "1fr" }}>
        <div className="panel"><h2>Worklist <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>best first</span> <button className="btn" style={{ marginLeft: 10 }} onClick={async () => { for (const a of wl.slice(0, 10)) await draftFor(a); }}>Draft the top 10</button></h2>
          <div style={{ overflowX: "auto" }}><table><thead><tr><th>Score</th><th>Customer</th><th>Stage</th><th className="num">Dormant</th><th className="num">Overdue</th><th className="num">Silent</th><th className="num">Credits</th></tr></thead>
            <tbody>{wl.map((a) => <tr key={a.customer.id} className={`click${sel === a.customer.id ? " sel" : ""}`} onClick={() => setSel(a.customer.id)}>
              <td><span className="score" style={{ background: scoreColor(a.score) }}>{a.score}</span></td><td>{a.customer.name}<div className="muted" style={{ fontSize: 11 }}>{a.customer.segment} · {a.customer.country}</div></td><td><span className="stage">{a.stage}</span></td>
              <td className="num out">{a.dormantAmount ? money(a.dormantAmount, ledger.currency) : "—"}</td><td className="num">{money(a.totalOverdue, ledger.currency)}</td><td className="num">{a.daysSinceContact == null ? "never" : a.daysSinceContact + "d"}</td><td className="num in">{a.creditsAvailable ? money(a.creditsAvailable, ledger.currency) : "—"}</td></tr>)}</tbody></table></div>
        </div>
        {selView && <div className="panel">
          <h2>{selView.customer.name} <span className="score" style={{ background: scoreColor(selView.score) }}>{selView.score}</span></h2>
          <div className="kv"><b>Contact</b> {selView.customer.contact} · {selView.customer.email}</div>
          <div className="kv"><b>Terms</b> {selView.customer.termsDays} days · <b style={{ minWidth: 0 }}>Stage</b> {selView.stage}</div>
          <ul className="meta">{selView.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <table><thead><tr><th>Invoice</th><th>Due</th><th>Status</th><th className="num">Open</th><th>Last contact</th></tr></thead>
            <tbody>{selView.invoices.map((i) => <tr key={i.id}><td>{i.number}<div className="muted" style={{ fontSize: 11 }}>{i.description}</div></td><td>{i.dueDate}</td><td>{i.status.replace("_", " ")}{selView.dormant.includes(i) && <span className="tag">dormant</span>}{i.disputeReason && <div className="muted" style={{ fontSize: 11 }}>{i.disputeReason}</div>}</td><td className="num">{money(i.openAmount, i.currency)}</td><td>{i.lastContact || <span className="muted">never</span>}</td></tr>)}</tbody></table>
          {selView.credits.length > 0 && <><h2 style={{ marginTop: 14 }}>Credits</h2><table><tbody>{selView.credits.map((k) => <tr key={k.id}><td>{k.number} <span className="muted">{k.kind.replace("_", " ")}</span></td><td>{k.date}</td><td className="num in">{money(k.remaining, ledger.currency)}</td></tr>)}</tbody></table></>}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => draftFor(selView)}>Draft outreach</button>
            {opps.find((o) => o.customerId === selView.customer.id)?.proposals.length ? <button className="btn" onClick={() => setTab("credits")}>See credit proposals</button> : null}
          </div>
        </div>}
      </div>}

      {tab === "approvals" && <div>
        {awaiting.length === 0 && <div className="panel"><div className="empty">Nothing waiting. Draft from the worklist.</div></div>}
        {awaiting.map((t) => <ApprovalCard key={t.id} t={t} a={byId[t.customerId]} cfg={cfg} today={today} onApprove={(body) => { approve(t, byId[t.customerId], cfg, today, body, "you"); bump(); }} onReject={(why) => { reject(t, today, why); bump(); }} />)}
      </div>}

      {tab === "inbox" && <div>
        {late.length > 0 && <div className="panel"><h2>No reply by the follow-up date</h2>{late.map((t) => <div key={t.id} className="row" style={{ fontSize: 13, marginBottom: 6 }}><span>{t.customerName}: sent {t.sentAt}, follow-up was {t.followUpOn}</span><button className="btn" onClick={() => { chaseAgain(t); }}>Chase again at the next stage</button></div>)}</div>}
        {pendingAction.length === 0 && waitingReply.length === 0 && late.length === 0 && <div className="panel"><div className="empty">Nothing sent yet. Approve a draft first.</div></div>}
        {pendingAction.map((t) => <ThreadCard key={t.id} t={t} cur={ledger.currency} onDone={() => { completeAction(t, today, "you"); bump(); }} />)}
        {waitingReply.length > 0 && <div className="panel"><h2>Waiting for a reply</h2>
          {waitingReply.map((t) => <ReplyBox key={t.id} t={t} onSimulate={() => simulate(t)} onPaste={(text) => handleReply(t, text)} fixture={llm?.replies[t.customerId]?.persona} />)}
        </div>}
      </div>}

      {tab === "credits" && <div className="panel"><h2>Credit opportunities</h2>
        <table><thead><tr><th>Customer</th><th className="num">Credits</th><th className="num">Open</th><th>Proposal</th><th></th></tr></thead>
          <tbody>{opps.filter((o) => o.proposals.length || o.netCredit > 0).map((o) => <tr key={o.customerId}><td>{o.customerName}<div className="muted" style={{ fontSize: 11 }}>{o.note}</div></td><td className="num in">{money(o.creditsAvailable, ledger.currency)}</td><td className="num">{money(o.openAmount, ledger.currency)}</td>
            <td>{o.proposals.map((p) => <div key={p.id} style={{ fontSize: 12 }}>{p.creditNumber} → {p.invoiceNumber}: {money(p.amount, ledger.currency)} <span className="pill">{p.kind}</span></div>)}</td>
            <td>{o.proposals.length > 0 && <button className="btn primary" onClick={() => { setApplied((ap) => [...ap, ...o.proposals]); setCreditLog((l) => [...l, { at: today, what: `${o.customerName}: applied ${o.proposals.length} credit application(s), ${money(o.proposals.reduce((a, p) => a + p.amount, 0), ledger.currency)}` }]); }}>Approve applications</button>}</td></tr>)}</tbody></table>
        {applied.length > 0 && <p className="muted" style={{ fontSize: 13 }}>{applied.length} applications approved this session; balances above are after application.</p>}
      </div>}

      {tab === "audit" && <div className="panel"><h2>Audit trail</h2>
        <table><thead><tr><th>When</th><th>Who</th><th>Customer</th><th>Event</th><th>Detail</th></tr></thead>
          <tbody>{[...creditLog.map((c) => ({ at: c.at, actor: "human", who: "", event: "credits applied", detail: c.what })), ...threads.flatMap((t) => t.audit.map((e) => ({ ...e, who: t.customerName })))].sort((a, b) => (a.at < b.at ? -1 : 1)).map((e, i) => <tr key={i}><td>{e.at}</td><td><span className="pill">{e.actor}</span></td><td>{e.who}</td><td>{e.event}</td><td className="muted" style={{ fontSize: 12 }}>{e.detail}</td></tr>)}</tbody></table>
        {threads.length === 0 && creditLog.length === 0 && <div className="empty">Nothing yet.</div>}
      </div>}

      {tab === "evals" && evals && <div className="panel"><h2>Numbers before claims</h2>
        <table><tbody>
          <tr><td>Dormant detection vs the generator's hidden truth</td><td>precision {evals.d.precision}, recall {evals.d.recall}, F1 {evals.d.f1} <span className="muted">(tp {evals.d.tp}, fp {evals.d.fp}, fn {evals.d.fn})</span></td></tr>
          <tr><td>Exact credit matches vs the intended pairs</td><td>precision {evals.c.precision}, recall {evals.c.recall} <span className="muted">({evals.c.proposed} applications proposed in total)</span></td></tr>
          <tr><td>Reply classification, rules only</td><td>accuracy {evals.k.accuracy} on {evals.k.n} labelled replies</td></tr>
          <tr><td>Drafts passing the fact check</td><td>{evals.dr.passing} of {evals.dr.drafts}</td></tr>
        </tbody></table>
        {evals.k.misses.length > 0 && <details style={{ marginTop: 8 }}><summary>{evals.k.misses.length} rules misses</summary><ul className="meta">{evals.k.misses.map((m, i) => <li key={i}>“{m.text}” expected {m.expected}, got {m.got}</li>)}</ul></details>}
        <p className="muted" style={{ fontSize: 13 }}>Recall on dormancy is below 1 on purpose: the generator sometimes sends an automated statement to a silent customer, which resets “last contact” without anyone speaking to them. The rule counts that as contact; the truth does not. The model-vs-rules comparison on the same replies is in the repo under docs/EVALS-LLM.md.</p>
      </div>}
      <footer>Open source, MIT. Built by Harshal Sahetiya. Synthetic data; no real customers, companies or people.</footer>
    </div>
  );
}

function ApprovalCard({ t, a, cfg, today, onApprove, onReject }: { t: Thread; a: AccountView; cfg: Config; today: string; onApprove: (body: string) => void; onReject: (why: string) => void }) {
  const [body, setBody] = useState(t.draft.body);
  const check = useMemo(() => checkDraft({ ...t.draft, body }, a, cfg), [body, t.draft, a, cfg]);
  return (
    <div className="panel">
      <h2>{t.customerName} <span className="stage">{t.stage}</span> <span className="pill">{t.draft.source === "llm" ? "model-written" : "template"}</span></h2>
      <div className="kv"><b>To</b> {a.customer.contact} &lt;{a.customer.email}&gt;</div>
      <div className="kv"><b>Subject</b> {t.draft.subject}</div>
      <div className="kv"><b>Attachments</b> {t.draft.attachments.join(", ")}</div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} />
      <div style={{ fontSize: 13, margin: "8px 0" }}>{check.ok ? <span className="ok">✓ every invoice number and amount matches the ledger; no banned words; asks for a confirmation</span> : <span className="bad">✗ {check.issues.join("; ")}</span>}</div>
      <div className="row"><button className="btn primary" disabled={!check.ok} onClick={() => onApprove(body)}>Approve and send</button><button className="btn" onClick={() => onReject(prompt("Why?") || "no reason given")}>Reject</button><span className="muted" style={{ fontSize: 12 }}>sending is simulated; follow-up on {addDays(today, cfg.replyWaitDays)}</span></div>
    </div>
  );
}

function ReplyBox({ t, onSimulate, onPaste, fixture }: { t: Thread; onSimulate: () => void; onPaste: (text: string) => void; fixture?: Intent }) {
  const [text, setText] = useState("");
  return (
    <div className="row" style={{ fontSize: 13, marginBottom: 8, alignItems: "flex-start" }}>
      <div style={{ minWidth: 220 }}>{t.customerName}<div className="muted" style={{ fontSize: 11 }}>sent {t.sentAt}, follow-up {t.followUpOn}</div></div>
      <button className="btn" onClick={onSimulate}>Simulate the customer's reply{fixture ? ` (${fixture.replace("_", " ")})` : ""}</button>
      <input type="text" placeholder="or paste a reply" value={text} onChange={(e) => setText(e.target.value)} style={{ minWidth: 280 }} />
      <button className="btn" disabled={!text.trim()} onClick={() => { onPaste(text); setText(""); }}>Classify</button>
    </div>
  );
}

function ThreadCard({ t, cur, onDone }: { t: Thread; cur: string; onDone: () => void }) {
  const last = t.messages[t.messages.length - 1]; const c = last.classification!;
  return (
    <div className="panel">
      <h2>{t.customerName} <span className={`pill ${c.intent}`}>{c.intent.replace("_", " ")}</span> <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{Math.round(c.confidence * 100)}% · {c.source} · {c.rationale}</span></h2>
      {t.messages.map((m) => <div key={m.id} className={`msg ${m.from}`}><div className="who">{m.from === "us" ? "Us" : t.customerName} · {m.at}</div>{m.from === "us" ? <details><summary>{m.subject}</summary>{m.body}</details> : m.body}</div>)}
      {Object.keys(c.extracted).length > 0 && <div className="kv"><b>Extracted</b> {Object.entries(c.extracted).map(([k, v]) => `${k}: ${k === "amount" ? money(Number(v), cur) : v}`).join(" · ")}</div>}
      <div className="kv" style={{ marginTop: 6 }}><b>Next step</b> <strong>{t.nextAction?.type.replace(/_/g, " ")}</strong>{t.nextAction?.dueDate ? ` on ${t.nextAction.dueDate}` : ""} — {t.nextAction?.note} {t.nextAction?.requiresApproval && <span className="pill">needs a person</span>}</div>
      <div className="row" style={{ marginTop: 8 }}><button className="btn primary" onClick={onDone}>Mark done</button></div>
    </div>
  );
}
