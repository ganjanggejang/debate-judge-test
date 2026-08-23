// 초기 버전(SYSTEM_PROMPT_PREVIOUS)과 개선 버전(SYSTEM_PROMPT_PERFORMANCE) 프롬프트로
// 여러 토론(subject)을 각각 여러 번(repetition) 반복 채점시켜 원본 응답을 저장한다.
// ICC 계산에 필요한 원시 데이터를 만드는 것이 목적이며, 계산 자체는 report.js가 담당한다.
//
// main.js / prompt.js는 수정하지 않고 SYSTEM_PROMPT_* 상수만 import한다.
// zod 스키마는 main.js와 동일한 구조를 여기서 별도로 재정의한다 (기존 파일 무수정 원칙).
//
// 사용법:
//   node icc/collect.js                 # subjects=all(3), k=10 (기본값)
//   node icc/collect.js --subjects 1 --k 2   # 드라이런
//   SUBJECTS=1 K=2 node icc/collect.js       # 환경변수로도 지정 가능

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { SYSTEM_PROMPT_PREVIOUS, SYSTEM_PROMPT_PERFORMANCE } from "../prompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

// ---- CLI 인자 / 기본값 ----
const args = parseArgs(process.argv.slice(2));
const NUM_SUBJECTS = args.subjects ?? 3; // seed 파일의 토론 전체(3개)가 기본값
const K = args.k ?? 10; // 토론당 반복 호출 횟수
const CONCURRENCY = args.concurrency ?? 4; // 동시 호출 제한
const MAX_RETRIES = 3;

// ---- main.js와 동일한 zod 스키마 (재정의) ----
const ParticipantJudging = z.object({
    score: z.number().int().min(60).max(100),
    winner: z.enum(["host", "opponent"]),
    judge_reason: z.array(z.string()).min(1).max(3),
    penalty_score: z.number().int().min(0).max(10),
    penalty_evidence: z.array(z.string()).max(5),
});
const JudgingDebate = z.object({
    host: ParticipantJudging,
    opponent: ParticipantJudging,
});

const DebatePerformance = z.object({
    logic_score: z.number().int().min(0).max(30),
    evidence_score: z.number().int().min(0).max(25),
    rebuttal_score: z.number().int().min(0).max(20),
    understanding_score: z.number().int().min(0).max(15),
    clarity_score: z.number().int().min(0).max(10),
    judge_reason: z.array(z.string()).min(1).max(3),
});
const JudgingDebatePerformance = z.object({
    host: DebatePerformance,
    opponent: DebatePerformance,
});

// ---- 토론(subject) 로드 ----
const debateSeeds = JSON.parse(
    readFileSync(new URL("../debate-message.seed.json", import.meta.url))
);
const subjects = debateSeeds.slice(0, NUM_SUBJECTS);
if (subjects.length < NUM_SUBJECTS) {
    console.warn(
        `[경고] seed 파일에 토론이 ${debateSeeds.length}개뿐입니다. ${subjects.length}개로 진행합니다.`
    );
}

const openai = new OpenAI();

async function callOld(debate) {
    const res = await openai.responses.parse({
        model: "gpt-5.6-luna",
        input: [
            { role: "system", content: SYSTEM_PROMPT_PREVIOUS },
            { role: "user", content: JSON.stringify(debate) },
        ],
        text: { format: zodTextFormat(JudgingDebate, "judging_debate") },
    });
    return res.output_parsed;
}

async function callNew(debate) {
    const res = await openai.responses.parse({
        model: "gpt-5.6-luna",
        input: [
            { role: "system", content: SYSTEM_PROMPT_PERFORMANCE },
            { role: "user", content: JSON.stringify(debate) },
        ],
        text: {
            format: zodTextFormat(JudgingDebatePerformance, "judging_debate_performance"),
        },
    });
    return res.output_parsed;
}

async function withRetry(fn, label) {
    let lastErr;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            console.warn(`[재시도 ${attempt}/${MAX_RETRIES}] ${label}: ${err.message}`);
        }
    }
    throw lastErr;
}

// 동시성 제한 러너
async function runWithConcurrency(tasks, limit) {
    const results = new Array(tasks.length);
    let next = 0;
    async function worker() {
        while (next < tasks.length) {
            const i = next++;
            results[i] = await tasks[i]();
        }
    }
    await Promise.all(Array.from({ length: limit }, worker));
    return results;
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i].replace(/^--/, "");
        if (["subjects", "k", "concurrency"].includes(key)) {
            out[key] = Number(argv[++i]);
        }
    }
    if (process.env.SUBJECTS) out.subjects = Number(process.env.SUBJECTS);
    if (process.env.K) out.k = Number(process.env.K);
    if (process.env.CONCURRENCY) out.concurrency = Number(process.env.CONCURRENCY);
    return out;
}

async function main() {
    console.log(
        `수집 시작: subjects=${subjects.length}, k=${K}, 총 호출 수=${subjects.length * K * 2}`
    );

    const jobs = [];
    subjects.forEach((debate, subjectIdx) => {
        for (let rep = 0; rep < K; rep++) {
            jobs.push({ subjectIdx, rep, version: "old", debate });
            jobs.push({ subjectIdx, rep, version: "new", debate });
        }
    });

    let done = 0;
    const tasks = jobs.map((job) => async () => {
        const label = `subject=${job.subjectIdx} rep=${job.rep} version=${job.version}`;
        const output =
            job.version === "old"
                ? await withRetry(() => callOld(job.debate), label)
                : await withRetry(() => callNew(job.debate), label);
        done++;
        console.log(`[${done}/${jobs.length}] ${label} 완료`);
        return { ...job, output };
    });

    const results = await runWithConcurrency(tasks, CONCURRENCY);

    mkdirSync(DATA_DIR, { recursive: true });
    const outPath = path.join(DATA_DIR, `raw-${Date.now()}.json`);
    writeFileSync(
        outPath,
        JSON.stringify(
            {
                collectedAt: new Date().toISOString(),
                numSubjects: subjects.length,
                k: K,
                subjectTopics: subjects.map((s) => s.communityTopic),
                results,
            },
            null,
            2
        )
    );
    console.log(`저장 완료: ${outPath}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
