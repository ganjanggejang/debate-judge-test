// Phase 1: Jev 질문 세트 점검 (JEV_BENCHMARK_PLAN.md §5.2).
//
// 토론마다 Jev를 1회 호출해서 질문별로 두 가지를 본다.
//   1. confidence가 낮은(확률이 인접 레벨 여러 개에 퍼진) 항목이 있는가
//   2. 토론 10개가 모두 한 레벨로 몰려 변별력이 없는 항목이 있는가
// 벤치마크 데이터는 저장하지 않는다.
//
// 사용법:
//   node --env-file=.env icc/jev-probe.js            # 토론 10개 전부
//   node --env-file=.env icc/jev-probe.js 2 3        # 특정 토론 idx만

import { readFileSync } from "node:fs";
import { callJev } from "./arms/jev.js";
import { JEV_QUESTIONS, JEV_QUESTION_SET_HASH } from "./arms/jev-questions.js";
import { argmaxLevel } from "./scoring.js";

const seeds = JSON.parse(readFileSync(new URL("../debate-message.seed.json", import.meta.url)));
const indices = process.argv.slice(2).map(Number);
const targets = indices.length ? indices : seeds.map((_, i) => i);

console.log(`질문 세트: ${JEV_QUESTION_SET_HASH}\n`);

const perSubject = [];
for (const idx of targets) {
    const t0 = performance.now();
    const res = await callJev(seeds[idx]);
    const ms = performance.now() - t0;
    perSubject.push({ idx, res });
    console.log(
        `[${idx}] ${seeds[idx].communityTopic} — ${ms.toFixed(0)}ms, input_tokens=${res.usage.input_tokens}, model=${res.model}`
    );
}

const rows = Object.keys(JEV_QUESTIONS).map((qid) => {
    const answers = perSubject.map(({ res }) => res.output.answers[qid]);
    const levels = answers.map(argmaxLevel);
    const confs = answers.map((a) => a.confidence);
    const row = {
        질문: qid,
        "평균 confidence": mean(confs).toFixed(2),
        "최소 confidence": Math.min(...confs).toFixed(2),
        "서로 다른 argmax 레벨 수": new Set(levels).size,
    };
    perSubject.forEach(({ idx }, i) => {
        row[`#${idx}`] = `${levels[i]} (${answers[i].score.toFixed(2)})`;
    });
    return row;
});
console.log("\n셀 = argmax 레벨 (기대값 score)");
console.table(rows);

function mean(a) {
    return a.reduce((s, v) => s + v, 0) / a.length;
}
