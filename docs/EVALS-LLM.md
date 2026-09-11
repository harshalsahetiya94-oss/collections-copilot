# Rules vs model vs rules-first (reply classification, 36 labelled replies)

| Approach | Accuracy | Model calls |
|---|---|---|
| Rules only | 1 | 0 |
| Model only (claude-haiku-4-5) | 0.889 | 36 |
| Rules first, model when rules are unsure (confidence < 0.6) | 1 | 3 |

Rules-only misses: none
Model-only misses: “We settled INV-10412 last week, payment reference 7781-AC. Should show by Friday.” → promise_to_pay (wanted paid); “Wrong email address, I'm not the right person. Try our accounts team.” → unclear (wanted needs_copy); “Which of these relate to the Cork site? We have two accounts with you.” → unclear (wanted question); “Hi Collections Team, our records show this as paid on 15 Aug, ref 2026-0815-PAY. Might be sitting in your unallocated cash.” → dispute (wanted paid)
Hybrid misses: none

The point is not that rules beat the model. It is that rules handle the 33 replies they are sure about for free and with no way to invent anything, and the model is only asked about the 3 it cannot read. Every draft the model writes is still checked against the ledger before a person sees it.
