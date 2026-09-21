// 여러 채점기(arm)로 여러 토론(subject)을 각각 여러 번(repetition) 반복 채점시켜
// 원본 응답, 지연시간, 토큰 사용량을 저장한다 (JEV_BENCHMARK_PLAN.md §4, §7).
// 계산 자체는 report.js가 담당한다.
//
// arm 정의는 icc/arms/index.js에 있다. main.js / prompt.js는 수정하지 않는다.
//
// 측정 모드:
//   latency    (기본) 동시성 1, 순차 호출. 같은 (subject, rep) 안에서 arm 순서를 돌려가며
//              호출하고, arm마다 워밍업 1회를 버린다. 시작할 때 네트워크 기준선을 잰다.
//   throughput 동시성 N으로 호출해서 전체 소요 시간과 초당 호출 수를 잰다.
//
// 결과는 raw-<ts>.jsonl에 한 줄씩 쓰고, 끝나면 raw-<ts>.json으로 합친다.
// 도중에 끊기면 --resume으로 같은 jsonl에 이어서 수집한다 (성공한 호출은 건너뜀).
//
// 사용법:
//   npm run collect                                         # 기본값: openai-new,jev-new, subjects=10, k=10
//   npm run collect -- --arms openai-new,jev-new --subjects 1 --k 2   # 드라이런
//   npm run collect -- --mode throughput --concurrency 4
//   npm run collect -- --resume                             # 가장 최근 jsonl 이어서
//   npm run collect -- --resume icc/data/raw-171234.jsonl
//   SUBJECTS=1 K=2 ARMS=jev-new npm run collect             # 환경변수로도 지정 가능

import { KEEP_ALIVE_TIMEOUT_MS } from "./http-agent.js"; // 다른 import보다 먼저: 전역 HTTP 연결 설정
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getArms, DEFAULT_ARMS } from "./arms/index.js";
import { callJevBaseline } from "./arms/jev.js";
import { withRetry, describeError } from "./timing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const MAX_ATTEMPTS = 3;

const args = parseArgs(process.argv.slice(2));

const debateSeeds = JSON.parse(
    readFileSync(new URL("../debate-message.seed.json", import.meta.url))
);

// ---- 설정: 새 수집이면 CLI 인자, --resume이면 기존 jsonl의 헤더 ----
let jsonlPath;
let config;
let prior = { results: [], baselineCount: 0 };
if (args.resume !== undefined) {
    jsonlPath = args.resume === true ? findLatestJsonl() : path.resolve(args.resume);
    const lines = readJsonl(jsonlPath);
    const header = lines.find((l) => l.type === "header");
    if (!header) throw new Error(`${jsonlPath}에 헤더가 없습니다.`);
    config = pickConfig(header);
    prior = {
        results: lines.filter((l) => l.type === "result"),
        baselineCount: lines.filter((l) => l.type === "baseline" && !l.error).length,
    };
    console.log(`이어서 수집: ${jsonlPath} (CLI의 수집 설정은 무시하고 헤더 설정을 씁니다)`);
} else {
    config = {
        arms: args.arms ?? DEFAULT_ARMS,
        mode: args.mode ?? "latency",
        numSubjects: args.subjects ?? debateSeeds.length, // seed의 토론 전체(10개)가 기본값
        k: args.k ?? 10,
        concurrency: args.concurrency ?? 4,
        warmup: args.warmup ?? 1,
        baseline: args.baseline ?? 10,
    };
}
if (!["latency", "throughput"].includes(config.mode)) {
    throw new Error(`알 수 없는 mode: ${config.mode} (latency | throughput)`);
}

const arms = getArms(config.arms);
const subjects = debateSeeds.slice(0, config.numSubjects);
if (subjects.length < config.numSubjects) {
    console.warn(
        `[경고] seed 파일에 토론이 ${debateSeeds.length}개뿐입니다. ${subjects.length}개로 진행합니다.`
    );
    config.numSubjects = subjects.length;
}

function writeLine(obj) {
    appendFileSync(jsonlPath, JSON.stringify(obj) + "\n");
}

async function main() {
    mkdirSync(DATA_DIR, { recursive: true });
    if (!jsonlPath) {
        jsonlPath = path.join(DATA_DIR, `raw-${Date.now()}.jsonl`);
        writeLine({
            type: "header",
            schemaVersion: 2,
            collectedAt: new Date().toISOString(),
            ...config,
            concurrency: config.mode === "latency" ? 1 : config.concurrency,
            questionSetHash: Object.fromEntries(
                arms.filter((a) => a.questionSetHash).map((a) => [a.id, a.questionSetHash])
            ),
            subjects: subjects.map((d) => ({
                topic: d.communityTopic,
                jsonBytes: Buffer.byteLength(JSON.stringify(d)),
                messageCount: d.messages.length,
            })),
            node: process.version,
            keepAliveTimeoutMs: KEEP_ALIVE_TIMEOUT_MS,
        });
    }

    // ---- 작업 목록 ----
    const done = new Set(
        prior.results.filter((r) => !r.error).map((r) => key(r.subjectIdx, r.rep, r.arm))
    );
    const jobs = [];
    for (let rep = 0; rep < config.k; rep++) {
        for (let subjectIdx = 0; subjectIdx < subjects.length; subjectIdx++) {
            // 같은 (subject, rep) 안에서 arm 순서를 돌려서, 호출 순서의 영향이 한 arm에 쏠리지 않게 한다.
            const offset = (rep * subjects.length + subjectIdx) % arms.length;
            const ordered = [...arms.slice(offset), ...arms.slice(0, offset)];
            for (const arm of ordered) {
                if (!done.has(key(subjectIdx, rep, arm.id))) jobs.push({ subjectIdx, rep, arm });
            }
        }
    }
    const total = subjects.length * config.k * arms.length;
    console.log(
        `수집 설정: mode=${config.mode}, arms=${config.arms.join(",")}, subjects=${subjects.length}, k=${config.k}` +
            ` → 총 ${total}회 중 남은 호출 ${jobs.length}회`
    );
    console.log(`기록 파일: ${jsonlPath}`);

    // ---- 네트워크 기준선 (§4.1): Jev에 아주 작은 요청 ----
    const baselineTodo = Math.max(0, config.baseline - prior.baselineCount);
    if (baselineTodo > 0 && config.mode === "latency") {
        console.log(`네트워크 기준선 측정 ${baselineTodo}회 (연결 수립용 1회는 버림)`);
        await measure(() => callJevBaseline(), "baseline warmup");
        for (let i = 0; i < baselineTodo; i++) {
            const rec = await measure(() => callJevBaseline(), "baseline");
            writeLine({ type: "baseline", ...rec, output: undefined });
        }
    }

    // ---- 워밍업: arm마다 첫 호출을 버린다 (연결 수립, DNS, TLS 등) ----
    if (config.mode === "latency" && jobs.length > 0) {
        const warmArms = arms.filter((a) => jobs.some((j) => j.arm.id === a.id));
        for (const arm of warmArms) {
            for (let i = 0; i < config.warmup; i++) {
                const rec = await measure(() => arm.call(subjects[0]), `warmup arm=${arm.id}`);
                writeLine({ type: "warmup", arm: arm.id, provider: arm.provider, ...rec });
                console.log(`[워밍업] ${arm.id} ${fmtMs(rec.latencyMs)}`);
            }
        }
    }

    // ---- 본 수집 ----
    let finished = 0;
    const runJob = async (job) => {
        const label = `subject=${job.subjectIdx} rep=${job.rep} arm=${job.arm.id}`;
        const rec = await measure(() => job.arm.call(subjects[job.subjectIdx]), label);
        writeLine({
            type: "result",
            subjectIdx: job.subjectIdx,
            rep: job.rep,
            arm: job.arm.id,
            provider: job.arm.provider,
            ...rec,
        });
        finished++;
        const status = rec.error ? `실패 (${rec.error})` : fmtMs(rec.latencyMs);
        console.log(`[${finished}/${jobs.length}] ${label} ${status}`);
    };

    const wallStart = performance.now();
    if (config.mode === "latency") {
        for (const job of jobs) await runJob(job);
    } else {
        await runWithConcurrency(jobs.map((job) => () => runJob(job)), config.concurrency);
    }
    const wallMs = performance.now() - wallStart;
    writeLine({
        type: "footer",
        finishedAt: new Date().toISOString(),
        wallMs,
        calls: jobs.length,
        callsPerSec: jobs.length / (wallMs / 1000),
    });

    const outPath = mergeJsonl(jsonlPath);
    const failed = readJson(outPath).results.filter((r) => r.error).length;
    console.log(`저장 완료: ${outPath}`);
    if (failed > 0) {
        console.warn(`[경고] 실패한 호출 ${failed}회가 남아 있습니다. --resume ${path.relative(process.cwd(), jsonlPath)} 로 다시 시도하세요.`);
    }
}

/** 호출 1회를 재시도와 함께 실행하고 raw 레코드 필드를 만든다. 실패해도 던지지 않는다. */
async function measure(fn, label) {
    const startedAt = new Date().toISOString();
    try {
        const r = await withRetry(fn, { maxAttempts: MAX_ATTEMPTS, label });
        return {
            model: r.value.model ?? null,
            requestId: r.value.requestId ?? null,
            startedAt,
            latencyMs: r.latencyMs,
            totalMs: r.totalMs,
            attempts: r.attempts,
            attemptLog: r.attemptLog,
            usage: r.value.usage ?? null,
            output: r.value.output,
            error: null,
        };
    } catch (err) {
        return {
            model: null,
            requestId: err.requestId ?? null,
            startedAt,
            latencyMs: null,
            totalMs: err.totalMs ?? null,
            attempts: err.attempts ?? MAX_ATTEMPTS,
            attemptLog: err.attemptLog ?? [],
            usage: null,
            output: null,
            error: describeError(err),
        };
    }
}

/** jsonl을 헤더가 붙은 raw-<ts>.json(스키마 v2)으로 합친다. 같은 호출이 여러 번 있으면 마지막 것을 쓴다. */
function mergeJsonl(file) {
    const lines = readJsonl(file);
    const header = lines.find((l) => l.type === "header");
    const byKey = new Map();
    for (const l of lines) {
        if (l.type !== "result") continue;
        const { type, ...rest } = l;
        const k = key(l.subjectIdx, l.rep, l.arm);
        // 성공한 결과는 이후의 실패로 덮어쓰지 않는다.
        if (byKey.has(k) && !byKey.get(k).error && rest.error) continue;
        byKey.set(k, rest);
    }
    const results = [...byKey.values()].sort(
        (a, b) => a.rep - b.rep || a.subjectIdx - b.subjectIdx || a.arm.localeCompare(b.arm)
    );
    const footers = lines.filter((l) => l.type === "footer");
    const { type, ...meta } = header;
    const merged = {
        ...meta,
        networkBaselineMs: lines
            .filter((l) => l.type === "baseline" && !l.error)
            .map((l) => l.latencyMs),
        warmups: lines.filter((l) => l.type === "warmup").map(({ type, output, ...w }) => w),
        runs: footers.map(({ type, ...f }) => f),
        results,
    };
    const outPath = file.replace(/\.jsonl$/, ".json");
    writeFileSync(outPath, JSON.stringify(merged, null, 2));
    return outPath;
}

function key(subjectIdx, rep, arm) {
    return `${subjectIdx}|${rep}|${arm}`;
}

function pickConfig(header) {
    const { arms, mode, numSubjects, k, concurrency, warmup, baseline } = header;
    return { arms, mode, numSubjects, k, concurrency, warmup, baseline };
}

function readJson(file) {
    return JSON.parse(readFileSync(file, "utf-8"));
}

function readJsonl(file) {
    if (!existsSync(file)) throw new Error(`파일이 없습니다: ${file}`);
    return readFileSync(file, "utf-8")
        .split("\n")
        .filter((l) => l.trim())
        .flatMap((l) => {
            try {
                return [JSON.parse(l)];
            } catch {
                console.warn(`[경고] 깨진 줄을 건너뜁니다 (중단 시점의 마지막 줄일 수 있음): ${l.slice(0, 80)}`);
                return [];
            }
        });
}

function findLatestJsonl() {
    const files = existsSync(DATA_DIR)
        ? readdirSync(DATA_DIR).filter((f) => /^raw-\d+\.jsonl$/.test(f))
        : [];
    if (files.length === 0) throw new Error(`${DATA_DIR}에 이어서 수집할 raw-*.jsonl 파일이 없습니다.`);
    files.sort();
    return path.join(DATA_DIR, files[files.length - 1]);
}

// 동시성 제한 러너
async function runWithConcurrency(tasks, limit) {
    let next = 0;
    async function worker() {
        while (next < tasks.length) {
            const i = next++;
            await tasks[i]();
        }
    }
    await Promise.all(Array.from({ length: limit }, worker));
}

function fmtMs(ms) {
    return `${ms.toFixed(0)}ms`;
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i].replace(/^--/, "");
        if (["subjects", "k", "concurrency", "warmup", "baseline"].includes(k)) {
            out[k] = Number(argv[++i]);
        } else if (k === "arms") {
            out.arms = argv[++i].split(",").map((s) => s.trim());
        } else if (k === "mode") {
            out.mode = argv[++i];
        } else if (k === "resume") {
            const nextArg = argv[i + 1];
            out.resume = nextArg && !nextArg.startsWith("--") ? argv[++i] : true;
        } else {
            throw new Error(`알 수 없는 인자: ${argv[i]}`);
        }
    }
    if (process.env.SUBJECTS) out.subjects = Number(process.env.SUBJECTS);
    if (process.env.K) out.k = Number(process.env.K);
    if (process.env.CONCURRENCY) out.concurrency = Number(process.env.CONCURRENCY);
    if (process.env.ARMS) out.arms = process.env.ARMS.split(",").map((s) => s.trim());
    if (process.env.MODE) out.mode = process.env.MODE;
    return out;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
