// raw 파일에서 토론별 점수 분포와 승자 일관성을 Markdown 표로 뽑는다. API를 호출하지 않는다.
//
//   1. 토론별 총점의 평균과 범위 (arm별, host / opponent)
//   2. 반복 간 표준편차
//   3. 토론별 점수 차 (host − opponent)
//   4. 토론별 승자 분포: k회 반복에서 host 승 / opponent 승 / 동점이 몇 번 나왔는지
//   5. arm 간 다수 판정 승자 비교
//
// 승자는 host 총점과 opponent 총점을 비교해서 정한다.
//
// 사용법:
//   npm run analyze                                 # data/ 안의 가장 최신 raw-*.json
//   npm run analyze -- icc/data/raw-171234.json

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DIMENSIONS } from "./arms/jev-questions.js";
import { jevPoints } from "./scoring.js";
import { mean } from "./stats.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const LONG_DEBATE_BYTES = 8 * 1024; // report.js와 같은 경계

const filePath = process.argv[2] ?? findLatestRawJson();
const raw = JSON.parse(readFileSync(filePath, "utf-8"));
if (raw.schemaVersion !== 2) throw new Error("schemaVersion 2 raw 파일만 지원합니다.");

// 비교할 점수 계열. Jev는 연속(기대값)과 이산(argmax) 두 가지로 읽는다.
const SERIES = [
    { id: "openai-new", arm: "openai-new", total: (o, p) => DIMENSIONS.reduce((s, d) => s + o[p][`${d}_score`], 0) },
    { id: "jev 연속", arm: "jev-new", total: (o, p) => jevTotal(o, p, "continuous") },
    { id: "jev 이산", arm: "jev-new", total: (o, p) => jevTotal(o, p, "discrete") },
].filter((s) => raw.arms.includes(s.arm));

function jevTotal(o, p, mode) {
    return DIMENSIONS.reduce((s, d) => s + jevPoints(o.answers[`${p}_${d}`], d, mode), 0);
}

const subjects = raw.subjects.map((s, i) => ({
    idx: i,
    ...s,
    group: s.jsonBytes >= LONG_DEBATE_BYTES ? "긴 토론" : "짧은 토론",
}));

/** 토론 i, 계열 s의 반복별 { host, opponent, winner } */
function repsOf(i, s) {
    return raw.results
        .filter((r) => r.arm === s.arm && r.subjectIdx === i && !r.error)
        .sort((a, b) => a.rep - b.rep)
        .map((r) => {
            const host = s.total(r.output, "host");
            const opponent = s.total(r.output, "opponent");
            // 부동소수 오차로 인한 가짜 승패를 막기 위해 0.01점 미만 차이는 동점으로 본다.
            const diff = host - opponent;
            const winner = Math.abs(diff) < 0.01 ? "tie" : diff > 0 ? "host" : "opponent";
            return { host, opponent, winner, output: r.output };
        });
}

const out = [];
const line = (s = "") => out.push(s);
const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const table = (header, rows) => {
    line(`| ${header.join(" | ")} |`);
    line(`|${header.map(() => "---").join("|")}|`);
    for (const r of rows) line(`| ${r.join(" | ")} |`);
    line();
};

line(`<!-- ${path.basename(filePath)}에서 icc/analyze.js로 생성 -->`);
line(`raw: \`${path.basename(filePath)}\` · subjects=${raw.numSubjects}, k=${raw.k}, 수집 ${raw.collectedAt}`);
line();

// ---- 0. 토론 목록
line("### 토론 목록");
line();
table(
    ["#", "주제", "길이 그룹", "메시지 수"],
    subjects.map((s) => [s.idx, s.topic, s.group, s.messageCount])
);

// ---- 1. 평균과 범위
for (const p of ["host", "opponent"]) {
    line(`### ${p} 총점: 평균 (최소~최대), ${raw.k}회 반복`);
    line();
    table(
        ["#", "주제", ...SERIES.map((s) => s.id)],
        subjects.map((subj) => [
            subj.idx,
            subj.topic,
            ...SERIES.map((s) => {
                const v = repsOf(subj.idx, s).map((r) => r[p]);
                return `${mean(v).toFixed(1)} (${fmt(Math.min(...v))}~${fmt(Math.max(...v))})`;
            }),
        ])
    );
}

// ---- 2. 반복 간 표준편차
line("### 반복 간 표준편차 (host / opponent)");
line();
const sd = (v) => {
    const m = mean(v);
    return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};
const sdRows = subjects.map((subj) => [
    subj.idx,
    ...SERIES.map((s) => {
        const reps = repsOf(subj.idx, s);
        return `${sd(reps.map((r) => r.host)).toFixed(1)} / ${sd(reps.map((r) => r.opponent)).toFixed(1)}`;
    }),
]);
const sdMean = SERIES.map((s) => {
    const all = subjects.flatMap((subj) => {
        const reps = repsOf(subj.idx, s);
        return [sd(reps.map((r) => r.host)), sd(reps.map((r) => r.opponent))];
    });
    return `**${mean(all).toFixed(2)}**`;
});
table(["#", ...SERIES.map((s) => s.id)], [...sdRows, ["평균", ...sdMean]]);

// ---- 3. 점수 차
line("### 점수 차 host − opponent: 평균 (최소~최대)");
line();
line("양수면 host 우세, 음수면 opponent 우세입니다. 범위가 0을 가로지르면 반복에 따라 승자가 바뀝니다.");
line();
const signed = (x) => (x > 0 ? "+" : "") + fmt(x);
table(
    ["#", "주제", ...SERIES.map((s) => s.id)],
    subjects.map((subj) => [
        subj.idx,
        subj.topic,
        ...SERIES.map((s) => {
            const v = repsOf(subj.idx, s).map((r) => r.host - r.opponent);
            const m = mean(v);
            return `${m > 0 ? "+" : ""}${m.toFixed(1)} (${signed(Math.min(...v))}~${signed(Math.max(...v))})`;
        }),
    ])
);

// ---- 4. 승자 분포
line(`### 토론별 승자 분포 (${raw.k}회 중 host 승 H / opponent 승 O / 동점 T)`);
line();
line("굵게 표시한 칸은 반복 사이에 승자가 달라진 토론입니다. 괄호 안은 반복 순서대로 판정이 바뀐 횟수입니다.");
line();
const winnerInfo = (reps) => {
    const c = { host: 0, opponent: 0, tie: 0 };
    for (const r of reps) c[r.winner]++;
    let flips = 0;
    for (let i = 1; i < reps.length; i++) if (reps[i].winner !== reps[i - 1].winner) flips++;
    const [first, second] = Object.entries(c).sort((a, b) => b[1] - a[1]);
    return {
        c,
        flips,
        majority: first[1] === second[1] ? "갈림" : first[0], // 1위가 동률이면 다수 판정 없음
        majorityShare: first[1] / reps.length,
    };
};
const label = { host: "H", opponent: "O", tie: "T" };
const splitCount = Object.fromEntries(SERIES.map((s) => [s.id, 0]));
const minorityCount = Object.fromEntries(SERIES.map((s) => [s.id, 0]));
table(
    ["#", "주제", ...SERIES.map((s) => s.id)],
    subjects.map((subj) => [
        subj.idx,
        subj.topic,
        ...SERIES.map((s) => {
            const w = winnerInfo(repsOf(subj.idx, s));
            const parts = ["host", "opponent", "tie"].filter((k) => w.c[k]).map((k) => `${label[k]}${w.c[k]}`);
            const split = parts.length > 1;
            minorityCount[s.id] += Math.round((1 - w.majorityShare) * raw.k);
            if (split) splitCount[s.id]++;
            return split ? `**${parts.join(" ")}** (${w.flips}회)` : parts.join(" ");
        }),
    ])
);
line("요약");
line();
table(
    ["", ...SERIES.map((s) => s.id)],
    [
        ["승자가 반복마다 달라진 토론 수", ...SERIES.map((s) => `${splitCount[s.id]} / ${subjects.length}`)],
        [
            "다수 판정과 다른 반복 수",
            ...SERIES.map((s) => `${minorityCount[s.id]} / ${subjects.length * raw.k}`),
        ],
    ]
);

// ---- 5. arm 간 다수 판정 비교
line("### 다수 판정 승자 비교");
line();
table(
    ["#", "주제", ...SERIES.map((s) => s.id)],
    subjects.map((subj) => [
        subj.idx,
        subj.topic,
        ...SERIES.map((s) => {
            const w = winnerInfo(repsOf(subj.idx, s));
            return w.majority === "갈림"
                ? `갈림 (${["host", "opponent", "tie"].filter((k) => w.c[k]).map((k) => label[k] + w.c[k]).join(" ")})`
                : `${w.majority} (${Math.round(w.majorityShare * 100)}%)`;
        }),
    ])
);

console.log(out.join("\n"));

function findLatestRawJson() {
    const files = readdirSync(DATA_DIR).filter((f) => /^raw-\d+\.json$/.test(f)).sort();
    if (!files.length) throw new Error(`${DATA_DIR}에 raw-*.json 파일이 없습니다.`);
    return path.join(DATA_DIR, files[files.length - 1]);
}
