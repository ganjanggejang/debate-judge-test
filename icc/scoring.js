// arm별 출력 → 비교용 숫자 점수 추출 (JEV_BENCHMARK_PLAN.md §4.3, §5.3).
//
// 모든 extractor는 raw 레코드의 output을 받아 숫자를 반환한다.
// 합산과 가중치는 여기(코드)에서 한다.

import { DIMENSIONS, DIMENSION_MAX, PARTICIPANTS, NUM_LEVELS } from "./arms/jev-questions.js";

/** Score 응답의 argmax 레벨 (0부터). 동률이면 낮은 레벨. */
export function argmaxLevel(answer) {
    let best = 0;
    let bestP = -Infinity;
    for (const [level, p] of Object.entries(answer.probabilities)) {
        if (p > bestP) {
            bestP = p;
            best = Number(level);
        }
    }
    return best;
}

/** Jev Score 응답 → 항목 점수. mode: "continuous"(기대값) | "discrete"(argmax) */
export function jevPoints(answer, dim, mode) {
    const level = mode === "discrete" ? argmaxLevel(answer) : answer.score;
    return (level / (NUM_LEVELS - 1)) * DIMENSION_MAX[dim];
}

/**
 * arm 종류별로 ICC를 계산할 지표 목록을 만든다.
 * @param {"openai-old" | "openai-perf" | "jev"} kind
 * @returns {{ metric: string, variant: string | null, extract: (output) => number }[]}
 */
export function metricsFor(kind) {
    if (kind === "openai-old") {
        return PARTICIPANTS.map((p) => ({
            metric: `${p}.score`,
            variant: null,
            extract: (o) => o[p].score,
        }));
    }
    if (kind === "openai-perf") {
        return PARTICIPANTS.flatMap((p) => [
            {
                metric: `${p}_total`,
                variant: null,
                extract: (o) => DIMENSIONS.reduce((s, d) => s + o[p][`${d}_score`], 0),
            },
            ...DIMENSIONS.map((d) => ({
                metric: `${p}_${d}`,
                variant: null,
                extract: (o) => o[p][`${d}_score`],
            })),
        ]);
    }
    if (kind === "jev") {
        return ["continuous", "discrete"].flatMap((mode) =>
            PARTICIPANTS.flatMap((p) => [
                {
                    metric: `${p}_total`,
                    variant: mode,
                    extract: (o) =>
                        DIMENSIONS.reduce((s, d) => s + jevPoints(o.answers[`${p}_${d}`], d, mode), 0),
                },
                ...DIMENSIONS.map((d) => ({
                    metric: `${p}_${d}`,
                    variant: mode,
                    extract: (o) => jevPoints(o.answers[`${p}_${d}`], d, mode),
                })),
            ])
        );
    }
    throw new Error(`알 수 없는 arm 종류: ${kind}`);
}

/** arm id → 출력 형식 */
export function kindOfArm(armId) {
    if (armId === "openai-old") return "openai-old";
    if (armId.startsWith("openai-new")) return "openai-perf";
    if (armId.startsWith("jev")) return "jev";
    throw new Error(`알 수 없는 arm: ${armId}`);
}
