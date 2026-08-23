import { test } from "node:test";
import assert from "node:assert/strict";
import { computeICC1 } from "./icc-math.js";

// 검증 데이터셋: Shrout & Fleiss (1979) Table 2.
// 6 targets(subject) x 4 judges(repetition).
// 공인 참조값(R `psych::ICC` 패키지 문서/논문에서 보고된 값):
//   ICC(1,1) = 0.17, ICC(1,k) = 0.44
const SHROUT_FLEISS_1979 = [
    [9, 2, 5, 8],
    [6, 1, 3, 2],
    [8, 4, 6, 8],
    [7, 1, 2, 6],
    [10, 5, 6, 9],
    [6, 2, 4, 7],
];

test("computeICC1 matches Shrout & Fleiss (1979) reference values", () => {
    const result = computeICC1(SHROUT_FLEISS_1979);
    assert.equal(result.n, 6);
    assert.equal(result.k, 4);
    assert.ok(
        Math.abs(result.icc1_1 - 0.17) < 0.01,
        `icc1_1 expected ~0.17, got ${result.icc1_1}`
    );
    assert.ok(
        Math.abs(result.icc1_k - 0.44) < 0.01,
        `icc1_k expected ~0.44, got ${result.icc1_k}`
    );
});

test("computeICC1 returns 1.0 for perfectly consistent scores", () => {
    const perfect = [
        [10, 10, 10],
        [20, 20, 20],
        [30, 30, 30],
    ];
    const result = computeICC1(perfect);
    assert.ok(Math.abs(result.icc1_1 - 1) < 1e-9);
    assert.ok(Math.abs(result.icc1_k - 1) < 1e-9);
});

test("computeICC1 is lower when within-subject noise is larger relative to between-subject spread", () => {
    // 두 데이터셋 모두 subject 평균(0, 10, 20)은 동일하지만,
    // subject 내부 반복값의 흩어짐(잡음) 크기만 다르다.
    const lowNoise = [
        [-1, 1],
        [9, 11],
        [19, 21],
    ];
    const highNoise = [
        [-8, 8],
        [2, 18],
        [12, 28],
    ];
    const low = computeICC1(lowNoise);
    const high = computeICC1(highNoise);
    assert.ok(
        low.icc1_1 > high.icc1_1,
        `expected low-noise ICC(${low.icc1_1}) > high-noise ICC(${high.icc1_1})`
    );
    assert.ok(low.icc1_1 > 0.9, `low-noise icc1_1 expected close to 1, got ${low.icc1_1}`);
});

test("computeICC1 throws on fewer than 2 subjects", () => {
    assert.throws(() => computeICC1([[1, 2, 3]]));
});

test("computeICC1 throws on fewer than 2 repetitions", () => {
    assert.throws(() => computeICC1([[1], [2]]));
});

test("computeICC1 throws on unbalanced design", () => {
    assert.throws(() => computeICC1([[1, 2, 3], [4, 5]]));
});
