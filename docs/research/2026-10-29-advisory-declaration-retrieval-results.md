# Declaration retrieval comparison

The candidate improves retrieval coverage but fails the fresh-set precision rule. Keep it off develop and out of the release; stop tuning this iteration.

Measured code: `f4d0c2c9a6f39d4efc8fdd7ef28b901990e6d20b`, retained on local branch `fix/advisory-declaration-retrieval`. Source search v3 adds YAML field context, declaration precedence and complete bounded multi-line citations. Source admission and execution arithmetic are unchanged.

| Measure | Previous search | Candidate |
| --- | --- | --- |
| Old navigation questions with relevant hits | 11/27 | 16/27 |
| Old relevant returned hits | 28/46 (60.9%) | 43/64 (67.2%) |
| Fresh navigation questions with relevant hits | 5/14 | 8/14 |
| Fresh relevant returned hits | 13/21 (61.9%) | 16/31 (51.6%) |
| Fresh missing-evidence questions receiving hits | 0/4 | 0/4 |
| Fresh exact source citations | 21/21 | 31/31 |

Fresh selection kept all 48 observations: 18 admitted, 30 refused/unavailable, seven distinct admitted blobs with no overlap against old admitted blobs. Twenty independently agent-authored questions remained: 14 supported, four evaluable no-match and two unavailable for lack of inputs. An availability-only supplementary cohort was fixed before candidate lock; two incomplete reference sets were corrected in a separate blind-audited overlay before evaluation. Both original cohort freezes stayed unchanged.

The candidate was locked before the implementer opened fresh data. One comparison ran 111 actual CLI calls and verified all input freezes before/after, raw outputs, source references and 45 unchanged numeric pairs. Fresh acquisition previously used 125 public GitHub GETs; evaluation acquired nothing and sent no model requests. Three fresh tasks improved, none were lost; old cases had six gains and one loss. The three previously lost declaration forms were recovered. These are location-overlap proxies from agent labels, not human quality, complete answers, native-model benefit or time savings.

Verification passed full typecheck/lint/build, full core586/runner420/Action6 coverage tests and focused CLI194tests. Source-advisory coverage was 90.85% statements, 88.86% branches, 96.87% functions, 97.54% lines. The owner requested lean verification during the run: unrelated full-CLI optimization coverage was interrupted and is not claimed passed. Independent code review and its confirmed fixes were completed before the lock; no further audit/tuning cycle was added.

The precision rule failed despite higher task coverage. Product changes remain on the unmerged local candidate branch; develop receives documentation only. The owned worktree is disposable after preservation; the branch must remain. No push, production release, provider action or paid runner occurred. Existing source navigation remains available; no broader retrieval-quality claim is justified.

Local raw evidence: `docs/agents/source-retrieval-2026-10-29/`, especially `candidate-lock.json`, `gates.json`, `evaluation/evaluation-summary.json`, `evaluation/cli-invocations.jsonl`, the archived CLI, frozen corpora and review receipts. [Phase notes](../plans/2026-10-29-advisory-declaration-retrieval-notes.md) retain the exact decision and narrower verification scope.
