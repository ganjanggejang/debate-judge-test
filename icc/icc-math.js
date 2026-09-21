// One-way random effects ICC — Shrout & Fleiss (1979) 공식 구현.
//
// 용도: 동일한 대상(subject, 여기선 "토론")을 여러 번 반복 측정했을 때
// (여기선 "동일 프롬프트로 LLM을 k번 반복 호출"), 그 반복 측정치들이
// 얼마나 일관되는지를 나타내는 ICC(1,1) / ICC(1,k)를 계산한다.
//
// 반복 측정("rater" 역할)이 서로 구별되는 고정된 채점자가 아니라
// 상호교환 가능한 무작위 표본이므로 one-way random effects 모델을 쓴다.
// (반복 호출 #1, #2, ... 을 모든 subject에 공통되는 고정 효과로 볼 근거가 없음)
//
// 입력 데이터 형태: subject(행) x repetition(열) 행렬.
//   scores = [
//     [subject1_rep1, subject1_rep2, ...],
//     [subject2_rep1, subject2_rep2, ...],
//     ...
//   ]
// 모든 subject는 동일한 반복 횟수 k를 가져야 한다 (balanced design).

/**
 * @param {number[][]} scores  n(subject) x k(repetition) 행렬
 * @returns {{
 *   n: number, k: number,
 *   grandMean: number,
 *   BMS: number, WMS: number,
 *   dfBetween: number, dfWithin: number,
 *   status: "ok" | "no-within-variance" | "undefined",
 *   icc1_1: number | null, icc1_k: number | null,
 *   ci1_1: [number, number] | null, ci1_k: [number, number] | null,
 * }}
 * status가 "no-within-variance"(반복 간 변동 없음)이면 ICC = 1,
 * "undefined"(subject 간 분산 0)이면 ICC와 CI는 null이다.
 */
export function computeICC1(scores) {
    if (!Array.isArray(scores) || scores.length < 2) {
        throw new Error("ICC 계산에는 최소 2개 이상의 subject가 필요합니다.");
    }

    const n = scores.length; // subject 수
    const k = scores[0].length; // subject당 반복 횟수
    if (k < 2) {
        throw new Error("ICC 계산에는 subject당 최소 2회 이상의 반복 측정이 필요합니다.");
    }
    for (const row of scores) {
        if (row.length !== k) {
            throw new Error("모든 subject는 동일한 반복 횟수(k)를 가져야 합니다 (balanced design).");
        }
    }

    const allValues = scores.flat();
    const grandMean = mean(allValues);

    // Between-subjects mean square (BMS)
    const subjectMeans = scores.map(mean);
    const ssBetween = subjectMeans.reduce(
        (sum, m) => sum + k * (m - grandMean) ** 2,
        0
    );
    const dfBetween = n - 1;
    const BMS = ssBetween / dfBetween;

    // Within-subjects mean square (WMS) — one-way 모델에서는
    // "residual"과 "rater 주효과"를 분리하지 않고 합쳐서 오차항으로 취급.
    const ssWithin = scores.reduce(
        (sum, row) => sum + row.reduce((s, v) => s + (v - mean(row)) ** 2, 0),
        0
    );
    const dfWithin = n * (k - 1);
    const WMS = ssWithin / dfWithin;

    // 경계 조건. 부동소수 오차를 고려해 데이터 크기에 비례한 허용치로 0을 판정한다.
    const eps = 1e-12 * Math.max(1, grandMean ** 2);
    if (BMS <= eps) {
        // subject 간 분산이 0이면 ICC를 정의할 수 없다 (NaN 대신 null).
        return {
            n, k, grandMean, BMS, WMS, dfBetween, dfWithin,
            status: "undefined",
            icc1_1: null, icc1_k: null,
            ci1_1: null, ci1_k: null,
        };
    }
    if (WMS <= eps) {
        // 반복 간 변동이 전혀 없으면 ICC = 1로 정의한다. 신뢰구간도 [1, 1].
        return {
            n, k, grandMean, BMS, WMS, dfBetween, dfWithin,
            status: "no-within-variance",
            icc1_1: 1, icc1_k: 1,
            ci1_1: [1, 1], ci1_k: [1, 1],
        };
    }

    // ICC(1,1): 단일 측정(반복 1회)의 신뢰도
    const icc1_1 = (BMS - WMS) / (BMS + (k - 1) * WMS);

    // ICC(1,k): k회 반복 측정 평균의 신뢰도
    const icc1_k = (BMS - WMS) / BMS;

    // 95% 신뢰구간 — Shrout & Fleiss (1979), F분포 기반.
    //   F0 = BMS / WMS
    //   FL = F0 / F_{1-α/2}(n-1, n(k-1)),  FU = F0 · F_{1-α/2}(n(k-1), n-1)
    //   ICC(1,1): [(FL-1)/(FL+k-1), (FU-1)/(FU+k-1)]
    //   ICC(1,k): [1 - 1/FL, 1 - 1/FU]
    const F0 = BMS / WMS;
    const FL = F0 / fQuantile(1 - ALPHA / 2, dfBetween, dfWithin);
    const FU = F0 * fQuantile(1 - ALPHA / 2, dfWithin, dfBetween);
    const ci1_1 = [(FL - 1) / (FL + k - 1), (FU - 1) / (FU + k - 1)];
    const ci1_k = [1 - 1 / FL, 1 - 1 / FU];

    return {
        n, k, grandMean, BMS, WMS, dfBetween, dfWithin,
        status: "ok",
        icc1_1, icc1_k, ci1_1, ci1_k,
    };
}

const ALPHA = 0.05;

// ---- F분포 분위수 ----
// F ~ F(d1, d2)일 때 P(F ≤ x) = I_{d1·x/(d1·x+d2)}(d1/2, d2/2) (정규화 불완전 베타 함수).
// 베타 분위수를 이분법으로 구한 뒤 F 값으로 되돌린다.

/** F(d1, d2) 분포의 p 분위수 */
export function fQuantile(p, d1, d2) {
    const a = d1 / 2;
    const b = d2 / 2;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (betaInc(mid, a, b) < p) lo = mid;
        else hi = mid;
    }
    const x = (lo + hi) / 2;
    return (d2 * x) / (d1 * (1 - x));
}

/** F(d1, d2) 분포의 누적분포함수 */
export function fCdf(x, d1, d2) {
    if (x <= 0) return 0;
    return betaInc((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2);
}

/** 정규화 불완전 베타 함수 I_x(a, b) (Numerical Recipes 6.4, 연분수 전개) */
function betaInc(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lnFront =
        logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
    const front = Math.exp(lnFront);
    if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(x, a, b)) / a;
    return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

function betaContinuedFraction(x, a, b) {
    const TINY = 1e-300;
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 - (qab * x) / qap;
    if (Math.abs(d) < TINY) d = TINY;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 1000; m++) {
        const m2 = 2 * m;
        let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
        d = 1 + aa * d;
        if (Math.abs(d) < TINY) d = TINY;
        c = 1 + aa / c;
        if (Math.abs(c) < TINY) c = TINY;
        d = 1 / d;
        h *= d * c;
        aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
        d = 1 + aa * d;
        if (Math.abs(d) < TINY) d = TINY;
        c = 1 + aa / c;
        if (Math.abs(c) < TINY) c = TINY;
        d = 1 / d;
        const del = d * c;
        h *= del;
        if (Math.abs(del - 1) < 1e-15) break;
    }
    return h;
}

/** ln Γ(z), Lanczos 근사 (g = 7, n = 9) */
function logGamma(z) {
    const g = 7;
    const coef = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
        -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
        1.5056327351493116e-7,
    ];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
    z -= 1;
    let x = coef[0];
    for (let i = 1; i < g + 2; i++) x += coef[i] / (z + i);
    const t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}
