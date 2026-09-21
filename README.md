# debate-judge-test

[한국어](README.kr.md) | **English**

Measures how consistent the scores are when an LLM grades the same debate script multiple times,
and compares the **speed, cost, and consistency** of an OpenAI Structured Output judge and a TypeSafe Jev judge.

- For the report from the Sep 21 test run on sample data, see [`docs/JEV_BENCHMARK_RESULTS.en.md`](docs/JEV_BENCHMARK_RESULTS.en.md).

## Setup

Requires Node 20 or later.

```
npm install
```

Put your API keys in `.env` (`.env` is gitignored).

```
OPENAI_API_KEY=...
TYPESAFE_API_KEY=...
```

Verify the keys and model access (makes at least one call with each SDK):

```
npm run check-env
```

Save 10 debates as JSON files in the project root directory (this repo does not ship the data).

## Judges (arms)

| arm                                | Judge                                                                       | Output                                       |
| ---------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| `openai-new`                       | `gpt-5.6-luna` + `SYSTEM_PROMPT_PERFORMANCE` (improved version)             | 5 sub-scores                                 |
| `jev-new`                          | `jev-1.13.0`, 10 Score questions (2 participants × 5 criteria) in 1 request | Level probability distribution per criterion |
| `openai-new-normalized` (optional) | `openai-new` with the same preprocessed state input as Jev                  | 5 sub-scores                                 |
| `openai-new-low` (optional)        | `openai-new` with low reasoning effort                                      | 5 sub-scores                                 |

The Jev question set lives in `icc/arms/jev-questions.js`. Editing the questions changes their hash, which is recorded in the raw data.
After editing the questions, run the probe script to check the level distribution and confidence before collecting a benchmark.

```
node --env-file=.env icc/jev-probe.js        # 1 call per debate across the 10 debates, nothing saved
```

## Collection

Defaults: arms=`openai-new,jev-new`, subjects=10 (all seeds), k=10, latency mode
→ **200** calls in total.

```
npm run collect
```

- `latency` mode (default): calls sequentially with concurrency 1. Within the same (debate, repetition), the arm order
  is rotated, and one warm-up call per arm is discarded. At startup, a tiny Jev request measures the network baseline.
- `throughput` mode: calls with concurrency N and measures total elapsed time and calls per second.

```
npm run collect -- --arms openai-new,jev-new --subjects 1 --k 2      # dry run
npm run collect -- --mode throughput --concurrency 4
SUBJECTS=3 K=5 ARMS=jev-new npm run collect                          # environment variables work too
```

Results are written line by line to `icc/data/raw-<ts>.jsonl` and merged into `raw-<ts>.json` when finished.
If a run is interrupted or some calls failed, you can resume collection (successful calls are skipped):

```
npm run collect -- --resume                              # most recent jsonl
npm run collect -- --resume icc/data/raw-171234.jsonl
```

## Report

Uses the most recent raw file automatically (also reads the jsonl if collection is in progress). Older v1 raw files
can also be read; in that case speed and cost are shown as N/A.

```
npm run report
npm run report -- icc/data/raw-171234.json
```

Output tables:

1. **Speed**: per-arm latency mean/p50/p90/p99 (overall, long debates, short debates), speed ratio (OpenAI p50 / Jev p50),
   per-debate paired ratios, network baseline
2. **Cost**: USD per call (actual cache state / assuming no cache), scaled to 1,000 calls, breakdown by token and cost item, cost ratio.
   Unit prices are in `icc/pricing.js` and are applied at report time.
3. **Consistency (ICC)**: ICC(1,1) and ICC(1,k) with 95% confidence intervals per arm × metric (total, per criterion). Jev is reported both as continuous (expected value) and discrete (argmax)
4. **Jev response diagnostics**: per-question confidence and argmax level distribution

The summary is also saved to `icc/data/summary-<ts>.json`.

## Results summary (2026-09-21, `raw-1789970405493.json`)

Conditions: 10 debates (Korean) × k=10, 100 calls per judge, latency mode, measured from Korea. Jev questions and levels are in English.

| Metric                               | `openai-new`     | `jev-new`                                                |
| ------------------------------------ | ---------------- | -------------------------------------------------------- |
| Latency p50 / p90                    | 5,034 / 7,461 ms | **284 / 618 ms**                                         |
| Cost per call (assuming no cache)    | $0.00107         | **$0.00025**                                             |
| Cost per call (actual cache state)   | $0.00069         | $0.00025                                                 |
| Total score ICC(1,1) host / opponent | 0.719 / 0.786    | **0.999 / 0.999** (continuous), 0.997 / 0.982 (discrete) |

- **Speed**: Jev is about 18× faster than `openai-new` at p50 (15–20× per debate). Most of Jev's latency (baseline p50 259 ms)
  is the Korea ↔ US West network round trip.
- **Cost**: Assuming no cache, Jev is about 4.2× cheaper. In the actual state, where repeated calls with the same input hit the OpenAI
  prompt cache, it is about 2.7× cheaper, and 1.6× for long debates only. Jev uses more input tokens than OpenAI (average 6,052 vs 2,728),
  which appears to be due to differences in Korean tokenization and the wording of the 10 Score questions being included in the input.
  About 75% of OpenAI's cost comes from output tokens (including reasoning).
- **Consistency**: Jev continuous scores have ICC(1,1) ≥ 0.995 on every criterion. Discrete (argmax) scores are mostly 1, but on criteria
  where almost every debate falls on a single level (`opponent_rebuttal` 0.691, `host_understanding` 0.846), a single borderline debate
  flipping between levels is enough to pull the value down. ICC only measures **consistency**; whether the grading is valid is outside the scope of this benchmark.

Per-debate score distributions, winner changes across repetitions, and winner comparisons between judges are in
[`docs/JEV_BENCHMARK_RESULTS.en.md`](docs/JEV_BENCHMARK_RESULTS.en.md).
The same tables can be regenerated from the raw file with `npm run analyze` (no API calls).

## Tests

```
npm test
```
