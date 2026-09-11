/**
 * llm.ts — optional. Personalises a draft, classifies a free-text reply, and can play the customer in the demo.
 * Works in Node and in the browser with a user-supplied key (the key never leaves the tab).
 * Every LLM draft still goes through checkDraft(); every LLM classification carries source: "llm".
 */
import type { Classification, Intent } from "./conversation.js";
import type { AccountView } from "./dormancy.js";
import type { Draft } from "./outreach.js";

export interface LlmOptions { apiKey: string; model?: string; fetchImpl?: typeof fetch }

async function call(opts: LlmOptions, system: string, user: string, maxTokens = 900): Promise<string> {
  const f = opts.fetchImpl || fetch;
  const r = await f("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: opts.model || "claude-haiku-4-5-20251001", max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.content || []).map((c: { text?: string }) => c.text || "").join("");
}

const json = <T,>(s: string): T => JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));

/** Rewrites the template body in a warmer, specific voice. Facts are fixed; the checker enforces that afterwards. */
export async function personaliseDraft(opts: LlmOptions, draft: Draft, a: AccountView): Promise<Draft> {
  const system = `You write short, plain, courteous accounts-receivable emails for ${a.customer.segment} customers. Rules: keep every invoice number, date and amount exactly as given; keep the four numbered reply options; no threats, no legal language, no urgency words; no stock openers such as 'I hope this email finds you well'; start with the point; under 220 words; British English; sign off exactly as in the draft.`;
  const user = `Customer: ${a.customer.name} (${a.customer.country}). Contact: ${a.customer.contact}. Stage: ${a.stage}. Days since last contact: ${a.daysSinceContact ?? "never"}.\n\nRewrite this email:\n\n${draft.body}`;
  const body = await call(opts, system, user);
  return { ...draft, body: body.trim(), source: "llm" };
}

export async function classifyWithLlm(opts: LlmOptions, text: string): Promise<Classification> {
  const system = `Classify a customer's reply to an accounts-receivable email. Return JSON only: {"intent": one of ["paid","promise_to_pay","dispute","needs_copy","apply_credit","question","unclear"], "confidence": 0-1, "extracted": {"date"?: string, "amount"?: number, "reference"?: string, "reason"?: string}, "rationale": string under 20 words}.`;
  const out = json<Omit<Classification, "source">>(await call(opts, system, text, 300));
  const intents: Intent[] = ["paid", "promise_to_pay", "dispute", "needs_copy", "apply_credit", "question", "unclear"];
  return { intent: intents.includes(out.intent) ? out.intent : "unclear", confidence: Math.max(0, Math.min(1, +out.confidence || 0)), extracted: out.extracted || {}, rationale: out.rationale || "", source: "llm" };
}

/** Demo only: the LLM plays a customer with a given disposition so the loop can be exercised end to end. */
export async function simulateCustomerReply(opts: LlmOptions, email: string, persona: Intent, a: AccountView): Promise<string> {
  const system = `You are ${a.customer.contact}, accounts payable at ${a.customer.name}. Reply to the supplier's email in 2-5 sentences as a real, slightly busy person would. Your situation: ${persona.replace(/_/g, " ")}. Include one concrete detail (a date, a reference, a reason or a name). No sign-off block.`;
  return (await call(opts, system, email, 300)).trim();
}
