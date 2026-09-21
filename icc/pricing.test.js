import { test } from "node:test";
import assert from "node:assert/strict";
import { costOf, pricingKeyOf } from "./pricing.js";
import { percentile, summarize } from "./stats.js";
import { argmaxLevel, jevPoints, metricsFor } from "./scoring.js";

const near = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);

test("costOf openai splits input into uncached, cached, and cache-write parts", () => {
    const c = costOf("openai", "gpt-5.6-luna", {
        input_tokens: 10_000,
        input_tokens_details: { cached_tokens: 4_000, cache_write_tokens: 1_000 },
        output_tokens: 2_000,
        output_tokens_details: { reasoning_tokens: 500 },
    });
    near(c.parts.input, (5_000 * 0.2) / 1e6);
    near(c.parts.cached, (4_000 * 0.02) / 1e6);
    near(c.parts.cacheWrite, (1_000 * 0.25) / 1e6);
    near(c.parts.output, (2_000 * 1.2) / 1e6);
    near(c.usd, (5_000 * 0.2 + 4_000 * 0.02 + 1_000 * 0.25 + 2_000 * 1.2) / 1e6);
    near(c.usdNoCache, (10_000 * 0.2 + 2_000 * 1.2) / 1e6);
    assert.equal(c.usdRange, null);
    assert.equal(c.tokens.reasoning, 500);
});

test("costOf openai reports a range when cache-write tokens are missing", () => {
    const c = costOf("openai", "gpt-5.6-luna", {
        input_tokens: 1_000,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 0,
    });
    near(c.usdRange[0], (1_000 * 0.2) / 1e6);
    near(c.usdRange[1], (1_000 * 0.25) / 1e6);
});

test("costOf jev charges input only", () => {
    const c = costOf("typesafe", "jev-1.13.0", { input_tokens: 1_000_000, output_tokens: 999 });
    near(c.usd, 0.042);
    near(c.usdNoCache, 0.042);
});

test("pricingKeyOf maps dated snapshots to the base model", () => {
    assert.equal(pricingKeyOf("gpt-5.6-luna-2026-08-01"), "gpt-5.6-luna");
    assert.equal(pricingKeyOf("unknown-model"), null);
});

test("percentile uses linear interpolation (numpy default)", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    near(percentile(xs, 0.5), 5.5);
    near(percentile(xs, 0.9), 9.1);
    assert.equal(summarize([]), null);
});

test("jevPoints converts expected and argmax levels to dimension points", () => {
    const answer = { score: 2.5, probabilities: { 0: 0, 1: 0, 2: 0.5, 3: 0.5, 4: 0 } };
    near(jevPoints(answer, "logic", "continuous"), (2.5 / 4) * 30);
    assert.equal(argmaxLevel(answer), 2); // 동률이면 낮은 레벨
    near(jevPoints(answer, "logic", "discrete"), (2 / 4) * 30);
});

test("metricsFor jev totals sum all five dimensions to a 0-100 scale", () => {
    const top = { score: 4, probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 } };
    const answers = {};
    for (const p of ["host", "opponent"]) {
        for (const d of ["logic", "evidence", "rebuttal", "understanding", "clarity"]) {
            answers[`${p}_${d}`] = top;
        }
    }
    const totals = metricsFor("jev").filter((m) => m.metric.endsWith("_total"));
    assert.equal(totals.length, 4); // 참가자 2명 × (연속, 이산)
    for (const m of totals) near(m.extract({ answers }), 100, 1e-9);
});
