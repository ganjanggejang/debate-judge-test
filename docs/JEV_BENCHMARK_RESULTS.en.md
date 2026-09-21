# Jev vs OpenAI Debate Grading Results: Per-Debate Scores and Winner Consistency

[한국어](JEV_BENCHMARK_RESULTS.kr.md) | **English**

> Date: 2026-09-21 · Data: `icc/data/raw-1789970405493.json` (main collection) · Design: `JEV_BENCHMARK_PLAN.md` (Korean)
> The tables can be regenerated with `npm run analyze -- icc/data/raw-1789970405493.json` (no API calls).

## Conditions

- 10 debates (all seeds, in Korean) × k=10 repetitions = 100 calls per judge, sequential calls (latency mode)
- Judges
    - `openai-new`: `gpt-5.6-luna` + `SYSTEM_PROMPT_PERFORMANCE`. Sum of 5 sub-scores (0–100)
    - `jev-new`: `jev-1.13.0`, 2 participants × 5 criteria = 10 Score questions (English, 5 levels). Converted in two ways
        - **jev continuous**: the expected level (`score`) is scaled to each criterion's maximum and summed
        - **jev discrete**: the most probable level (argmax) is scaled and summed. One level step equals 1/4 of the criterion's maximum, so scores are stepwise
- The **winner** is decided by comparing the host total and the opponent total. A difference of less than 0.01 points is treated as a tie (T).

## Key results

|                                                 | openai-new | jev continuous | jev discrete |
| ----------------------------------------------- | ---------- | -------------- | ------------ |
| Std. dev. of total across repetitions (mean)    | 3.19       | **0.22**       | 0.39         |
| Debates whose winner changed across repetitions | 6 / 10     | **0 / 10**     | 1 / 10       |

1. **Jev continuous scores moved only within about ±0.2 points on average when the same debate was graded 10 times, and the winner never changed.**
   `openai-new` changed winners across repetitions in 6 of the 10 debates, and in 25 of 100 calls it produced a winner different from the majority verdict.
2. The reason lies in how output is produced. OpenAI generates fresh reasoning tokens every time before picking an integer, so each call yields a different sample.
   Jev does not generate; it computes a probability distribution over levels, and for the same input these probabilities come out nearly identical (for #0, per-level probabilities stayed within ±0.03 over 10 runs).
3. **Consistency does not imply correctness.** Among the short debates, Jev's score gap on #4 and #6–#9 is 0.7–2.6 points: stable, but the gap itself is small.
   Jev picks opponent as the winner in all five of these debates, whereas `openai-new` favors host in three of them (#6, #7, #9).
   This benchmark cannot tell which one is right.
4. **jev discrete is not suitable for deciding winners.** Since one level step is 1/4 of a criterion's maximum, the two participants easily end up with the same combination of levels.
   As a result, the majority verdict was a tie in 7 debates (the 6 short debates and #2) (62.5 : 62.5, and 85 : 85 for #2).

### Debate list

Topics are translated from Korean.

| #   | Topic                                                             | Length group | Messages |
| --- | ----------------------------------------------------------------- | ------------ | -------- |
| 0   | Do you support introducing a basic income?                        | Long         | 37       |
| 1   | Should the minimum age for election campaigning be lowered to 16? | Long         | 18       |
| 2   | Mandatory enrollment in the National Pension should be abolished  | Long         | 55       |
| 3   | Should smartphone use be completely banned in elementary schools? | Short        | 12       |
| 4   | Should deposits be mandatory on single-use plastic cups?          | Short        | 12       |
| 5   | Should content made by generative AI be mandatorily labeled?      | Short        | 12       |
| 6   | Should downtown parking be reduced and public transit expanded?   | Short        | 12       |
| 7   | Should the cap on university tuition be strengthened?             | Short        | 12       |
| 8   | Should public institutions pilot a four-day work week?            | Short        | 12       |
| 9   | Should pet registration and training be mandatory in cities?      | Short        | 12       |

- #0–#2 are long debates that appear to be real user debates; #3–#9 are short debates of 6 turns (12 messages) that are polite and contain no figures or examples.

## 1. Mean and range of total scores

### Host total: mean (min–max), 10 repetitions

| #   | Topic                                       | openai-new   | jev continuous   | jev discrete     |
| --- | ------------------------------------------- | ------------ | ---------------- | ---------------- |
| 0   | Basic income                                | 65.3 (58~74) | 63.5 (62.6~63.9) | 66.3 (66.3~66.3) |
| 1   | Campaigning age lowered to 16               | 83.6 (78~88) | 79.3 (78.8~79.6) | 81.3 (81.3~81.3) |
| 2   | Abolish mandatory National Pension          | 73.9 (70~79) | 79.9 (79.5~80.2) | 85.0 (85~85)     |
| 3   | Smartphone ban in elementary schools        | 65.1 (61~73) | 61.4 (61.1~61.8) | 61.8 (58.8~62.5) |
| 4   | Deposit on single-use plastic cups          | 75.5 (70~81) | 62.4 (62.2~62.5) | 62.5 (62.5~62.5) |
| 5   | Mandatory labeling of generative AI content | 74.8 (70~81) | 72.4 (71.9~72.9) | 75.0 (75~75)     |
| 6   | Less downtown parking, more public transit  | 77.4 (73~81) | 65.2 (64.9~65.4) | 62.5 (62.5~62.5) |
| 7   | Stronger university tuition cap             | 75.8 (72~82) | 64.2 (64~64.5)   | 62.5 (62.5~62.5) |
| 8   | Four-day week pilot in public institutions  | 79.9 (78~83) | 63.8 (63.6~64.2) | 62.5 (62.5~62.5) |
| 9   | Mandatory pet registration and training     | 77.9 (70~85) | 64.0 (63.8~64.2) | 62.5 (62.5~62.5) |

### Opponent total: mean (min–max), 10 repetitions

| #   | Topic                                       | openai-new   | jev continuous   | jev discrete     |
| --- | ------------------------------------------- | ------------ | ---------------- | ---------------- |
| 0   | Basic income                                | 81.6 (80~86) | 82.9 (82.4~83.4) | 88.5 (85~90)     |
| 1   | Campaigning age lowered to 16               | 62.1 (58~66) | 64.6 (64.2~65.3) | 58.4 (56.3~67.5) |
| 2   | Abolish mandatory National Pension          | 86.4 (85~89) | 82.9 (82.6~83.1) | 85.0 (85~85)     |
| 3   | Smartphone ban in elementary schools        | 74.5 (71~79) | 70.1 (69.4~70.8) | 62.5 (62.5~62.5) |
| 4   | Deposit on single-use plastic cups          | 76.7 (72~82) | 64.8 (64.7~64.9) | 62.5 (62.5~62.5) |
| 5   | Mandatory labeling of generative AI content | 74.7 (71~79) | 69.0 (68.6~69.4) | 62.5 (62.5~62.5) |
| 6   | Less downtown parking, more public transit  | 75.9 (70~83) | 66.7 (66.4~67.0) | 62.5 (62.5~62.5) |
| 7   | Stronger university tuition cap             | 75.5 (71~85) | 64.9 (64.6~65.0) | 62.5 (62.5~62.5) |
| 8   | Four-day week pilot in public institutions  | 80.4 (78~83) | 66.0 (65.8~66.3) | 62.5 (62.5~62.5) |
| 9   | Mandatory pet registration and training     | 77.3 (70~86) | 66.6 (66.3~67.0) | 62.5 (62.5~62.5) |

- The 10-run range of **jev continuous** is mostly within 1 point. Even the widest case, #3 opponent, is 69.4–70.8 (a 1.4-point spread).
- The range of `openai-new` is usually 8–16 points wide, and 4–5 points at its narrowest. For example, #0 host spans 58–74 and #9 opponent spans 70–86.

## 2. Score gap and winner

### Score gap host − opponent: mean (min–max)

Positive means host leads; negative means opponent leads. If the range crosses 0, the winner changes across repetitions.

| #   | Topic                                       | openai-new      | jev continuous      | jev discrete        |
| --- | ------------------------------------------- | --------------- | ------------------- | ------------------- |
| 0   | Basic income                                | -16.3 (-23~-10) | -19.4 (-20.3~-18.6) | -22.3 (-23.8~-18.8) |
| 1   | Campaigning age lowered to 16               | +21.5 (+12~+25) | +14.7 (+14.2~+15.3) | +22.9 (+13.8~+25)   |
| 2   | Abolish mandatory National Pension          | -12.5 (-17~-8)  | -3.0 (-3.4~-2.5)    | 0.0 (0~0)           |
| 3   | Smartphone ban in elementary schools        | -9.4 (-11~-6)   | -8.7 (-9.6~-8.3)    | -0.8 (-3.8~0)       |
| 4   | Deposit on single-use plastic cups          | -1.2 (-4~+1)    | -2.4 (-2.6~-2.2)    | 0.0 (0~0)           |
| 5   | Mandatory labeling of generative AI content | +0.1 (-3~+3)    | +3.5 (+2.9~+4.3)    | +12.5 (+12.5~+12.5) |
| 6   | Less downtown parking, more public transit  | +1.5 (-2~+4)    | -1.6 (-2.0~-1.2)    | 0.0 (0~0)           |
| 7   | Stronger university tuition cap             | +0.3 (-3~+3)    | -0.7 (-0.9~-0.3)    | 0.0 (0~0)           |
| 8   | Four-day week pilot in public institutions  | -0.5 (-4~+2)    | -2.2 (-2.6~-1.8)    | 0.0 (0~0)           |
| 9   | Mandatory pet registration and training     | +0.6 (-4~+3)    | -2.6 (-2.9~-2.2)    | 0.0 (0~0)           |

- For `openai-new`, the score-gap range crosses 0 in the 6 short debates (#4–#9). It sees the two participants as roughly equal,
  and since the gap swings by ±3–4 points each repetition, the winner changes.
- Jev continuous also gives mostly small gaps on the short debates (−0.7 to −2.6 points, except #3 at −8.7 and #5 at +3.5), but no debate has a 10-run range that crosses 0.
  Even the closest one, #7, stays at −0.9 to −0.3 points, so the winner is opponent every time.

### Winner distribution per debate (out of 10: host wins H / opponent wins O / tie T)

Bold cells are debates whose winner differed between repetitions. The number in parentheses is how many times the verdict flipped in repetition order.

| #   | Topic                                       | openai-new        | jev continuous | jev discrete   |
| --- | ------------------------------------------- | ----------------- | -------------- | -------------- |
| 0   | Basic income                                | O10               | O10            | O10            |
| 1   | Campaigning age lowered to 16               | H10               | H10            | H10            |
| 2   | Abolish mandatory National Pension          | O10               | O10            | T10            |
| 3   | Smartphone ban in elementary schools        | O10               | O10            | **O2 T8** (2×) |
| 4   | Deposit on single-use plastic cups          | **H2 O7 T1** (6×) | O10            | T10            |
| 5   | Mandatory labeling of generative AI content | **H4 O4 T2** (6×) | H10            | H10            |
| 6   | Less downtown parking, more public transit  | **H7 O2 T1** (3×) | O10            | T10            |
| 7   | Stronger university tuition cap             | **H5 O3 T2** (7×) | O10            | T10            |
| 8   | Four-day week pilot in public institutions  | **H5 O5** (4×)    | O10            | T10            |
| 9   | Mandatory pet registration and training     | **H7 O2 T1** (3×) | O10            | T10            |

Summary

|                                                 | openai-new | jev continuous | jev discrete |
| ----------------------------------------------- | ---------- | -------------- | ------------ |
| Debates whose winner changed across repetitions | 6 / 10     | 0 / 10         | 1 / 10       |
| Repetitions differing from the majority verdict | 25 / 100   | 0 / 100        | 2 / 100      |

- For `openai-new`, the debate whose winner changed the most is #7 (tuition cap): H5 O3 T2 out of 10, with the verdict flipping 7 times in repetition order.
  #5 (AI labeling) and #8 (four-day week) have equal numbers of host and opponent wins, so there is no majority verdict.
- In jev discrete, #3 is the debate whose winner changed: O2 T8. That is 2 repetitions where opponent led and 8 ties, caused by a single borderline criterion flipping between levels.

## 3. Winner comparison across judges

### Majority-verdict winners

| #   | Topic                                       | openai-new       | jev continuous  | jev discrete    |
| --- | ------------------------------------------- | ---------------- | --------------- | --------------- |
| 0   | Basic income                                | opponent (100%)  | opponent (100%) | opponent (100%) |
| 1   | Campaigning age lowered to 16               | host (100%)      | host (100%)     | host (100%)     |
| 2   | Abolish mandatory National Pension          | opponent (100%)  | opponent (100%) | tie (100%)      |
| 3   | Smartphone ban in elementary schools        | opponent (100%)  | opponent (100%) | tie (80%)       |
| 4   | Deposit on single-use plastic cups          | opponent (70%)   | opponent (100%) | tie (100%)      |
| 5   | Mandatory labeling of generative AI content | split (H4 O4 T2) | host (100%)     | host (100%)     |
| 6   | Less downtown parking, more public transit  | host (70%)       | opponent (100%) | tie (100%)      |
| 7   | Stronger university tuition cap             | host (50%)       | opponent (100%) | tie (100%)      |
| 8   | Four-day week pilot in public institutions  | split (H5 O5)    | opponent (100%) | tie (100%)      |
| 9   | Mandatory pet registration and training     | host (70%)       | opponent (100%) | tie (100%)      |

- **All judges picked the same winner for the 3 long debates (#0–#2)** (excluding the jev discrete tie on #2).
- **Verdicts diverge on the short debates.** On #4 and #6–#9, Jev (continuous) favors opponent in every case.
  `openai-new` favors host on #6, #7, and #9, opponent on #4, and is split on #8. On #5, `openai-new` is split while Jev favors host.
  On #3, all judges agree on opponent. The short debates were written with the two participants at a similar level, so it is hard to define a correct answer.
  This disagreement reflects differences in grading criteria, and which side is right is outside the scope of this benchmark.

## Caveats on interpretation

- ICC and winner consistency only show **whether re-grading the same input produces the same result**. We did not measure whether the grading is valid or agrees with human judgment.
- The debates are in Korean and the Jev questions are in English. Jev's primary language is English, so what Jev bases its verdicts on for Korean debates needs separate validation.
- The 7 short debates have nearly identical formats, so differences between subjects are small. Whether Jev giving them similar scores (61–72) is an accurate judgment that they are "similar"
  or a lack of discriminative power can only be distinguished with human-judged reference data.
- If you use Jev scores to decide winners, use the **continuous (expected value) scores**. Discrete scores produce many ties and flip on borderline criteria.
