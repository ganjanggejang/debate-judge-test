import { test } from "node:test";
import assert from "node:assert/strict";
import { computeICC1, fQuantile, fCdf } from "./icc-math.js";

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

// 95% CI 참조값: R `psych::ICC(sf)`가 같은 Shrout & Fleiss (1979) 데이터에 대해 보고하는 값.
//   ICC1:  lower -0.13, upper 0.72
//   ICC1k: lower -0.88, upper 0.91
test("computeICC1 confidence intervals match psych::ICC reference values", () => {
    const { status, ci1_1, ci1_k } = computeICC1(SHROUT_FLEISS_1979);
    assert.equal(status, "ok");
    const near = (actual, expected) =>
        assert.ok(Math.abs(actual - expected) < 0.01, `expected ~${expected}, got ${actual}`);
    near(ci1_1[0], -0.13);
    near(ci1_1[1], 0.72);
    near(ci1_k[0], -0.88);
    near(ci1_k[1], 0.91);
});

test("fQuantile matches F distribution table values", () => {
    // F_{0.95}(1, 10) = 4.9646, F_{0.975}(5, 18) = 3.3820, F_{0.99}(2, 10) = 7.5594
    assert.ok(Math.abs(fQuantile(0.95, 1, 10) - 4.9646) < 1e-3);
    assert.ok(Math.abs(fQuantile(0.975, 5, 18) - 3.382) < 1e-3);
    assert.ok(Math.abs(fQuantile(0.99, 2, 10) - 7.5594) < 1e-3);
    // 분위수와 누적분포함수는 서로 역함수
    assert.ok(Math.abs(fCdf(fQuantile(0.9, 4, 7), 4, 7) - 0.9) < 1e-9);
});

test("computeICC1 CI contains the point estimate", () => {
    const data = [
        [70, 72, 71],
        [80, 79, 83],
        [65, 66, 64],
        [90, 88, 91],
    ];
    const { icc1_1, icc1_k, ci1_1, ci1_k } = computeICC1(data);
    assert.ok(ci1_1[0] <= icc1_1 && icc1_1 <= ci1_1[1]);
    assert.ok(ci1_k[0] <= icc1_k && icc1_k <= ci1_k[1]);
});

test("computeICC1 defines ICC = 1 when there is no within-subject variance", () => {
    const result = computeICC1([
        [10, 10, 10],
        [20, 20, 20],
        [35, 35, 35],
    ]);
    assert.equal(result.status, "no-within-variance");
    assert.equal(result.icc1_1, 1);
    assert.equal(result.icc1_k, 1);
    assert.deepEqual(result.ci1_1, [1, 1]);
});

test("computeICC1 returns undefined status (not NaN) when there is no between-subject variance", () => {
    for (const data of [
        [
            [5, 5],
            [5, 5],
        ],
        [
            [4, 6],
            [6, 4],
        ],
    ]) {
        const result = computeICC1(data);
        assert.equal(result.status, "undefined");
        assert.equal(result.icc1_1, null);
        assert.equal(result.icc1_k, null);
        assert.equal(result.ci1_1, null);
    }
});

test("computeICC1 treats floating-point noise as zero within-subject variance", () => {
    const x = 0.1 + 0.2; // 0.30000000000000004
    const result = computeICC1([
        [x, 0.3],
        [1.5, 1.5],
    ]);
    assert.equal(result.status, "no-within-variance");
});
