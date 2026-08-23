// collect.js가 저장한 raw JSON을 읽어 초기 버전 vs 개선 버전의 ICC를 계산하고
// 비교 리포트를 출력한다. API를 호출하지 않는다.
//
// 사용법:
//   node icc/report.js                          # data/ 안의 가장 최신 raw-*.json 사용
//   node icc/report.js icc/data/raw-171234.json  # 특정 파일 지정

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { computeICC1 } from "./icc-math.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

const filePath = process.argv[2] ?? findLatestRawFile();
const raw = JSON.parse(readFileSync(filePath, "utf-8"));

console.log(`파일: ${filePath}`);
console.log(
    `subjects=${raw.numSubjects}, k=${raw.k}, 수집 시각=${raw.collectedAt}\n`
);

// subjectIdx x rep 행렬 형태로 변환하는 헬퍼
function buildMatrix(results, version, extractScore) {
    const bySubject = new Map();
    for (const r of results) {
        if (r.version !== version) continue;
        if (!bySubject.has(r.subjectIdx)) bySubject.set(r.subjectIdx, []);
        bySubject.get(r.subjectIdx)[r.rep] = extractScore(r.output);
    }
    const subjectIndices = [...bySubject.keys()].sort((a, b) => a - b);
    return subjectIndices.map((idx) => bySubject.get(idx));
}

function newTotal(participant) {
    return (
        participant.logic_score +
        participant.evidence_score +
        participant.rebuttal_score +
        participant.understanding_score +
        participant.clarity_score
    );
}

const metrics = [
    {
        label: "초기 버전 — host.score",
        matrix: buildMatrix(raw.results, "old", (o) => o.host.score),
    },
    {
        label: "초기 버전 — opponent.score",
        matrix: buildMatrix(raw.results, "old", (o) => o.opponent.score),
    },
    {
        label: "개선 버전 — host_total (5개 하위점수 합)",
        matrix: buildMatrix(raw.results, "new", (o) => newTotal(o.host)),
    },
    {
        label: "개선 버전 — opponent_total (5개 하위점수 합)",
        matrix: buildMatrix(raw.results, "new", (o) => newTotal(o.opponent)),
    },
];

const rows = [];
for (const { label, matrix } of metrics) {
    try {
        const { icc1_1, icc1_k, n, k } = computeICC1(matrix);
        rows.push({
            지표: label,
            n_subjects: n,
            k_reps: k,
            "ICC(1,1)": icc1_1.toFixed(3),
            "ICC(1,k)": icc1_k.toFixed(3),
        });
    } catch (err) {
        rows.push({ 지표: label, 오류: err.message });
    }
}

console.table(rows);

function findLatestRawFile() {
    const files = readdirSync(DATA_DIR).filter((f) => f.startsWith("raw-"));
    if (files.length === 0) {
        throw new Error(
            `${DATA_DIR}에 raw-*.json 파일이 없습니다. 먼저 icc/collect.js를 실행하세요.`
        );
    }
    files.sort();
    return path.join(DATA_DIR, files[files.length - 1]);
}
