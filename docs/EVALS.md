# Evals (synthetic ledger, 2026-09-11)

| Check | Result |
|---|---|
| Dormant detection vs hidden truth | precision 0.962, recall 0.926, F1 0.943 (tp 25, fp 1, fn 2) |
| Exact credit matches vs intended pairs | precision 1, recall 1 (41 applications proposed in total) |
| Reply classification, rules only | accuracy 1 on 36 labelled replies |
| Drafts passing the fact check | 42 of 42 |
| Worklist | 42 accounts; top score 75 (Greystone Construction Ltd) |

Misclassified replies (rules): none

Recall on dormancy is below 1 by design: the generator sometimes sends an automated statement to a silent customer, which resets "last contact" without anyone speaking to them. The rule treats that as contact; the truth label does not. That gap is the argument for logging *who* spoke, not just *that* something went out.
