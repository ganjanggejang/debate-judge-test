// collect.js가 저장한 raw 파일을 읽어 arm별 속도·비용·ICC를 비교하는 리포트를 출력하고
// icc/data/summary-<ts>.json으로 저장한다. API를 호출하지 않는다 (JEV_BENCHMARK_PLAN.md §4).
//
// openai-old arm은 raw에 들어 있어도 리포트에서 제외한다.
//
// 기존 raw 파일(schemaVersion 없음, version: "old" | "new", usage 없음)도 읽는다 ("new"만 표시).
// 이 경우 속도·비용 표는 N/A로 표시한다.
//
// 사용법:
//   npm run report                                # data/ 안의 가장 최신 raw 파일 사용
//   npm run report -- icc/data/raw-171234.json    # 특정 파일 지정 (.jsonl도 가능: 수집 도중 확인용)

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { computeICC1 } from "./icc-math.js";
import { summarize, median, mean } from "./stats.js";
import { costOf } from "./pricing.js";
import { metricsFor, kindOfArm, argmaxLevel } from "./scoring.js";
import { JEV_QUESTION_SET_HASH } from "./arms/jev-questions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

/** 이 크기(UTF-8 바이트) 이상인 토론을 "긴 토론"으로 본다. seed는 ≥15KB 3개, ≈3KB 7개로 나뉜다. */
const LONG_DEBATE_BYTES = 8 * 1024;
const GROUPS = ["전체", "긴 토론", "짧은 토론"];

const filePath = process.argv[2] ?? findLatestRawFile();
const raw = loadRaw(filePath);
const warnings = [];
const warn = (msg) => {
    warnings.push(msg);
    console.warn(`[경고] ${msg}`);
};

// openai-old(초기 버전 프롬프트)는 비교 대상에서 뺀다. raw에 들어 있어도 모든 표와 요약에서 제외한다.
const EXCLUDED_ARMS = ["openai-old"];
const armIds = raw.arms.filter((id) => !EXCLUDED_ARMS.includes(id));
const results = raw.results.filter((r) => !EXCLUDED_ARMS.includes(r.arm));
const ok = results.filter((r) => !r.error && r.output);
const groupOf = (subjectIdx) => {
    const bytes = raw.subjects?.[subjectIdx]?.jsonBytes;
    if (bytes === undefined) return null;
    return bytes >= LONG_DEBATE_BYTES ? "긴 토론" : "짧은 토론";
};
const inGroup = (r, g) => g === "전체" || groupOf(r.subjectIdx) === g;
const byArm = (id) => ok.filter((r) => r.arm === id);
const jevArms = armIds.filter((id) => kindOfArm(id) === "jev");
const openaiArms = armIds.filter((id) => kindOfArm(id) !== "jev");

// ---------------------------------------------------------------- 헤더
console.log(`파일: ${filePath}`);
console.log(
    `schemaVersion=${raw.schemaVersion ?? 1}, mode=${raw.mode ?? "(기존 수집)"}, subjects=${raw.numSubjects}, k=${raw.k}, ` +
        `arms=${armIds.join(",")}, 수집 시각=${raw.collectedAt}`
);
if (raw.subjects) {
    const counts = GROUPS.slice(1).map(
        (g) => `${g} ${raw.subjects.filter((_, i) => groupOf(i) === g).length}개`
    );
    console.log(`길이 그룹 (경계 ${LONG_DEBATE_BYTES / 1024}KB, UTF-8): ${counts.join(", ")}`);
}
console.log(
    "조건: 토론은 한국어 원문, Jev 질문·레벨은 영어. 비교 대상은 숫자 점수뿐이며(judge_reason 제외), " +
        "ICC는 반복 채점의 일관성만 나타낸다(채점의 타당성은 범위 밖)."
);
if (raw.mode === "latency") {
    console.log("측정 위치: 한국 → 각 API (TypeSafe 서버는 미국 서부). 순차 호출, 동시성 1.");
}
console.log();

// 데이터 점검
const failed = results.filter((r) => r.error);
if (failed.length) warn(`실패한 호출 ${failed.length}회는 모든 표에서 제외했습니다.`);
for (const id of armIds) {
    const models = new Set(byArm(id).map((r) => r.model).filter(Boolean));
    if (models.size > 1) warn(`${id}: 한 run 안에 모델 버전이 섞여 있습니다 (${[...models].join(", ")}).`);
}
if (raw.questionSetHash?.["jev-new"] && raw.questionSetHash["jev-new"] !== JEV_QUESTION_SET_HASH) {
    warn(
        "raw의 Jev 질문 세트 해시가 현재 jev-questions.js와 다릅니다. 점수 환산(레벨 수, 만점)이 수집 당시와 같은지 확인하세요."
    );
}

const summary = {
    source: path.relative(process.cwd(), filePath),
    generatedAt: new Date().toISOString(),
    meta: {
        schemaVersion: raw.schemaVersion ?? 1,
        mode: raw.mode ?? null,
        numSubjects: raw.numSubjects,
        k: raw.k,
        arms: armIds,
        questionSetHash: raw.questionSetHash ?? null,
        longDebateBytes: LONG_DEBATE_BYTES,
        models: Object.fromEntries(armIds.map((id) => [id, [...new Set(byArm(id).map((r) => r.model))]])),
    },
    speed: null,
    cost: null,
    icc: null,
    jevDiagnostics: null,
    warnings,
};

// ---------------------------------------------------------------- 1. 속도
console.log("━━━ 1. 속도: 호출당 end-to-end 지연시간 (ms, 성공한 시도 1회) ━━━");
const hasLatency = ok.some((r) => typeof r.latencyMs === "number");
if (!hasLatency) {
    console.log("N/A (이 raw 파일에는 지연시간 기록이 없습니다)\n");
} else {
    if (raw.mode === "throughput") {
        console.log("주의: throughput 모드 수집이라 지연시간에 대기열 효과가 섞여 있습니다. 주 지표는 latency 모드입니다.");
    }
    const speed = { byArm: {}, ratios: [], networkBaselineMs: null, runs: raw.runs ?? [] };
    const rows = [];
    for (const id of armIds) {
        speed.byArm[id] = {};
        for (const g of GROUPS) {
            const s = summarize(byArm(id).filter((r) => inGroup(r, g)).map((r) => r.latencyMs));
            speed.byArm[id][g] = s;
            if (!s) continue;
            rows.push({
                arm: id, 그룹: g, n: s.n,
                mean: fmt(s.mean, 0), p50: fmt(s.p50, 0), p90: fmt(s.p90, 0),
                p99: fmt(s.p99, 0), min: fmt(s.min, 0), max: fmt(s.max, 0),
            });
        }
    }
    console.table(rows);

    const retried = ok.filter((r) => r.attempts > 1);
    if (retried.length) {
        console.log(`재시도가 있었던 호출 ${retried.length}회 (latencyMs는 성공한 시도만, totalMs에 재시도 포함)`);
    }

    if (jevArms.length && openaiArms.length) {
        const ratioRows = [];
        for (const o of openaiArms) {
            for (const j of jevArms) {
                const row = { 비교: `${o} / ${j}` };
                const entry = { openai: o, jev: j };
                for (const g of GROUPS) {
                    const a = speed.byArm[o][g]?.p50;
                    const b = speed.byArm[j][g]?.p50;
                    const ratio = a && b ? a / b : null;
                    row[`p50 배수 (${g})`] = ratio ? `${fmt(ratio, 1)}×` : "N/A";
                    entry[g] = ratio;
                }
                // 토론별로 짝지은 배수: 같은 토론에서 OpenAI 중앙값 / Jev 중앙값
                const paired = subjectIndices()
                    .map((s) => {
                        const la = byArm(o).filter((r) => r.subjectIdx === s).map((r) => r.latencyMs);
                        const lb = byArm(j).filter((r) => r.subjectIdx === s).map((r) => r.latencyMs);
                        return la.length && lb.length ? median(la) / median(lb) : null;
                    })
                    .filter((x) => x !== null);
                if (paired.length) {
                    row["토론별 배수 min / 중앙값 / max"] =
                        `${fmt(Math.min(...paired), 1)}× / ${fmt(median(paired), 1)}× / ${fmt(Math.max(...paired), 1)}×`;
                    entry.paired = { min: Math.min(...paired), median: median(paired), max: Math.max(...paired), values: paired };
                }
                ratioRows.push(row);
                speed.ratios.push(entry);
            }
        }
        console.log("속도 배수 = OpenAI p50 / Jev p50 (클수록 Jev가 빠름)");
        console.table(ratioRows);
    }

    if (raw.networkBaselineMs?.length) {
        const s = summarize(raw.networkBaselineMs);
        speed.networkBaselineMs = s;
        const jevP50 = jevArms.length ? speed.byArm[jevArms[0]]["전체"]?.p50 : null;
        console.log(
            `네트워크 기준선 (Jev 초소형 요청 ${s.n}회): p50 ${fmt(s.p50, 0)}ms, min ${fmt(s.min, 0)}ms, max ${fmt(s.max, 0)}ms` +
                (jevP50 ? ` (기준선 p50 / Jev p50 = ${fmt((100 * s.p50) / jevP50, 0)}%)` : "")
        );
    }
    for (const run of raw.runs ?? []) {
        console.log(`수집 run: ${run.calls}회, 전체 ${fmt(run.wallMs / 1000, 1)}s, 초당 ${fmt(run.callsPerSec, 2)}회`);
    }
    summary.speed = speed;
    console.log();
}

// ---------------------------------------------------------------- 2. 비용
console.log("━━━ 2. 비용: 호출당 USD ━━━");
const hasUsage = ok.some((r) => r.usage);
if (!hasUsage) {
    console.log("N/A (이 raw 파일에는 토큰 사용량 기록이 없습니다)\n");
} else {
    const cost = { byArm: {}, ratios: [] };
    const rows = [];
    const breakdownRows = [];
    let overLimit = 0;
    let unknownCacheWrite = false;
    for (const id of armIds) {
        cost.byArm[id] = {};
        for (const g of GROUPS) {
            const cs = byArm(id)
                .filter((r) => inGroup(r, g) && r.usage)
                .map((r) => costOf(r.provider, r.model, r.usage));
            if (!cs.length) continue;
            overLimit += g === "전체" ? cs.filter((c) => c.overShortContext).length : 0;
            const ranged = cs.filter((c) => c.usdRange);
            if (ranged.length) unknownCacheWrite = true;
            const entry = {
                n: cs.length,
                usd: mean(cs.map((c) => c.usd)),
                usdNoCache: mean(cs.map((c) => c.usdNoCache)),
                usdRange: ranged.length
                    ? [mean(cs.map((c) => (c.usdRange ?? [c.usd, c.usd])[0])), mean(cs.map((c) => (c.usdRange ?? [c.usd, c.usd])[1]))]
                    : null,
                parts: {
                    input: mean(cs.map((c) => c.parts.input)),
                    cached: mean(cs.map((c) => c.parts.cached)),
                    cacheWrite: mean(cs.map((c) => c.parts.cacheWrite)),
                    output: mean(cs.map((c) => c.parts.output)),
                },
                tokens: {
                    input: mean(cs.map((c) => c.tokens.input)),
                    cached: mean(cs.map((c) => c.tokens.cached)),
                    output: mean(cs.map((c) => c.tokens.output)),
                    reasoning: mean(cs.map((c) => c.tokens.reasoning)),
                },
            };
            cost.byArm[id][g] = entry;
            rows.push({
                arm: id, 그룹: g, n: entry.n,
                "USD/호출 (실제 캐시)": usd(entry.usd),
                "USD/호출 (캐시 없음)": usd(entry.usdNoCache),
                "1,000건 (실제 캐시)": `$${fmt(entry.usd * 1000, 3)}`,
                "1,000건 (캐시 없음)": `$${fmt(entry.usdNoCache * 1000, 3)}`,
                ...(entry.usdRange ? { "범위 (캐시 쓰기 미상)": `${usd(entry.usdRange[0])} ~ ${usd(entry.usdRange[1])}` } : {}),
            });
            if (g === "전체") {
                breakdownRows.push({
                    arm: id,
                    "입력 tok": fmt(entry.tokens.input, 0),
                    "캐시 적중 tok": fmt(entry.tokens.cached, 0),
                    "출력 tok": fmt(entry.tokens.output, 0),
                    "(추론 tok)": fmt(entry.tokens.reasoning, 0),
                    "입력 USD": usd(entry.parts.input),
                    "캐시 적중 USD": usd(entry.parts.cached),
                    "캐시 쓰기 USD": usd(entry.parts.cacheWrite),
                    "출력 USD (추론 포함)": usd(entry.parts.output),
                });
            }
        }
    }
    console.table(rows);
    console.log("호출당 평균 토큰과 비용 항목 (전체). 토크나이저가 달라 토큰 수는 arm 간에 직접 비교하지 않는다.");
    console.table(breakdownRows);
    if (overLimit) warn(`OpenAI 입력이 272k 토큰을 넘는 호출이 ${overLimit}회 있습니다. short context 단가가 맞지 않습니다.`);
    if (unknownCacheWrite) console.log("캐시 쓰기 토큰 필드가 없는 호출이 있어 [하한, 상한] 범위를 함께 표시했습니다.");

    if (jevArms.length && openaiArms.length) {
        const ratioRows = [];
        for (const o of openaiArms) {
            for (const j of jevArms) {
                const row = { 비교: `${o} / ${j}` };
                const entry = { openai: o, jev: j };
                for (const g of GROUPS) {
                    const a = cost.byArm[o][g];
                    const b = cost.byArm[j][g];
                    if (!a || !b) continue;
                    entry[g] = { actual: a.usd / b.usd, noCache: a.usdNoCache / b.usdNoCache };
                    row[`배수 (${g}, 실제 캐시)`] = `${fmt(a.usd / b.usd, 1)}×`;
                    row[`배수 (${g}, 캐시 없음)`] = `${fmt(a.usdNoCache / b.usdNoCache, 1)}×`;
                }
                ratioRows.push(row);
                cost.ratios.push(entry);
            }
        }
        console.log("비용 배수 = OpenAI USD / Jev USD (클수록 Jev가 쌈)");
        console.table(ratioRows);
    }
    summary.cost = cost;
    console.log();
}

// ---------------------------------------------------------------- 3. ICC
console.log("━━━ 3. 일관성: ICC (one-way random, 95% CI) ━━━");
const iccRows = [];
const iccOut = [];
for (const id of armIds) {
    const kind = kindOfArm(id);
    const { matrixOf, used, dropped } = buildMatrices(id);
    if (dropped.length) {
        warn(`${id}: 성공한 반복이 k=${raw.k}회에 못 미치는 토론 ${dropped.join(", ")}번은 ICC에서 제외했습니다.`);
    }
    for (const m of metricsFor(kind)) {
        const label = m.variant ? `${id} (${m.variant === "continuous" ? "연속" : "이산"})` : id;
        let res;
        try {
            res = computeICC1(matrixOf(m.extract));
        } catch (err) {
            iccRows.push({ arm: label, 지표: m.metric, 비고: err.message });
            iccOut.push({ arm: id, variant: m.variant, metric: m.metric, error: err.message });
            continue;
        }
        iccRows.push({
            arm: label,
            지표: m.metric,
            n: res.n,
            k: res.k,
            "ICC(1,1)": fmtIcc(res.icc1_1),
            "95% CI (1,1)": fmtCi(res.ci1_1),
            "ICC(1,k)": fmtIcc(res.icc1_k),
            "95% CI (1,k)": fmtCi(res.ci1_k),
            비고: statusNote(res.status),
        });
        iccOut.push({
            arm: id, variant: m.variant, metric: m.metric, subjects: used,
            n: res.n, k: res.k, status: res.status,
            icc1_1: res.icc1_1, ci1_1: res.ci1_1, icc1_k: res.icc1_k, ci1_k: res.ci1_k,
            BMS: res.BMS, WMS: res.WMS, grandMean: res.grandMean,
        });
    }
}
console.table(iccRows);
if (jevArms.length) {
    console.log(
        "Jev 연속 = Score 기대값을 만점으로 환산, 이산 = argmax 레벨을 환산. 항목별 ICC는 선형 환산에 불변이다."
    );
}
summary.icc = iccOut;
console.log();

// ---------------------------------------------------------------- 4. Jev 응답 진단
for (const id of jevArms) {
    const rs = byArm(id);
    if (!rs.length) continue;
    console.log(`━━━ 4. Jev 응답 진단 (${id}): 질문별 confidence와 argmax 레벨 분포 ━━━`);
    const qids = Object.keys(rs[0].output.answers);
    const diag = qids.map((q) => {
        const answers = rs.map((r) => r.output.answers[q]);
        const counts = {};
        for (const a of answers) {
            const l = argmaxLevel(a);
            counts[l] = (counts[l] ?? 0) + 1;
        }
        return {
            질문: q,
            "평균 confidence": fmt(mean(answers.map((a) => a.confidence)), 2),
            "최소 confidence": fmt(Math.min(...answers.map((a) => a.confidence)), 2),
            "argmax 레벨 분포": Object.entries(counts)
                .sort(([a], [b]) => a - b)
                .map(([l, c]) => `L${l}:${c}`)
                .join(" "),
        };
    });
    console.table(diag);
    summary.jevDiagnostics = { ...(summary.jevDiagnostics ?? {}), [id]: diag };
}

const outPath = path.join(DATA_DIR, `summary-${Date.now()}.json`);
writeFileSync(outPath, JSON.stringify(summary, null, 2));
console.log(`\n요약 저장: ${outPath}`);

// ================================================================ 헬퍼

/** arm의 성공한 결과를 subject × rep 행렬로. 반복이 k회에 못 미치는 subject는 뺀다. */
function buildMatrices(armId) {
    const bySubject = new Map();
    for (const r of byArm(armId)) {
        if (r.rep >= raw.k) continue;
        if (!bySubject.has(r.subjectIdx)) bySubject.set(r.subjectIdx, new Map());
        bySubject.get(r.subjectIdx).set(r.rep, r.output);
    }
    const used = [];
    const dropped = [];
    for (const s of subjectIndices()) {
        if (bySubject.get(s)?.size === raw.k) used.push(s);
        else dropped.push(s);
    }
    const matrixOf = (extract) =>
        used.map((s) => [...bySubject.get(s).entries()].sort(([a], [b]) => a - b).map(([, o]) => extract(o)));
    return { matrixOf, used, dropped };
}

function subjectIndices() {
    return Array.from({ length: raw.numSubjects }, (_, i) => i);
}

/** .json(v1/v2) 또는 수집 중인 .jsonl을 v2 형태로 읽는다. */
function loadRaw(file) {
    const text = readFileSync(file, "utf-8");
    if (file.endsWith(".jsonl")) {
        const lines = text.split("\n").filter((l) => l.trim()).flatMap((l) => {
            try {
                return [JSON.parse(l)];
            } catch {
                return [];
            }
        });
        const { type, ...header } = lines.find((l) => l.type === "header");
        const byKey = new Map();
        for (const { type: t, ...r } of lines.filter((l) => l.type === "result")) {
            const k = `${r.subjectIdx}|${r.rep}|${r.arm}`;
            if (byKey.has(k) && !byKey.get(k).error && r.error) continue;
            byKey.set(k, r);
        }
        return {
            ...header,
            networkBaselineMs: lines.filter((l) => l.type === "baseline" && !l.error).map((l) => l.latencyMs),
            runs: lines.filter((l) => l.type === "footer"),
            results: [...byKey.values()],
        };
    }
    const data = JSON.parse(text);
    if (data.schemaVersion >= 2) return data;
    // 기존 수집 (v1): version "old" | "new" → arm, 지연시간·usage 없음
    return {
        ...data,
        arms: ["openai-old", "openai-new"],
        subjects: null,
        results: data.results.map((r) => ({
            subjectIdx: r.subjectIdx,
            rep: r.rep,
            arm: `openai-${r.version}`,
            provider: "openai",
            output: r.output,
            error: null,
        })),
    };
}

function findLatestRawFile() {
    // raw-<ts>.json을 우선 쓰고, 같은 ts의 .json이 아직 없으면(수집 중) .jsonl을 쓴다.
    const files = readdirSync(DATA_DIR).filter((f) => /^raw-\d+\.jsonl?$/.test(f));
    if (files.length === 0) {
        throw new Error(`${DATA_DIR}에 raw-*.json 파일이 없습니다. 먼저 icc/collect.js를 실행하세요.`);
    }
    const ts = (f) => Number(f.match(/^raw-(\d+)/)[1]);
    files.sort((a, b) => ts(a) - ts(b) || (a.endsWith(".json") ? 1 : -1));
    return path.join(DATA_DIR, files[files.length - 1]);
}

function fmt(x, digits) {
    return x === null || x === undefined || Number.isNaN(x) ? "N/A" : x.toFixed(digits);
}
function usd(x) {
    return `$${x.toFixed(6)}`;
}
function fmtIcc(x) {
    return x === null ? "정의 불가" : x.toFixed(3);
}
function fmtCi(ci) {
    return ci ? `[${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}]` : "-";
}
function statusNote(status) {
    if (status === "no-within-variance") return "반복 간 변동 없음 (ICC=1로 정의)";
    if (status === "undefined") return "정의 불가 (subject 간 분산 0)";
    return "";
}
