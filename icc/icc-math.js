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
 *   icc1_1: number, icc1_k: number,
 *   dfBetween: number, dfWithin: number,
 * }}
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

    // ICC(1,1): 단일 측정(반복 1회)의 신뢰도
    const icc1_1 = (BMS - WMS) / (BMS + (k - 1) * WMS);

    // ICC(1,k): k회 반복 측정 평균의 신뢰도
    const icc1_k = (BMS - WMS) / BMS;

    return { n, k, grandMean, BMS, WMS, icc1_1, icc1_k, dfBetween, dfWithin };
}

function mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}
