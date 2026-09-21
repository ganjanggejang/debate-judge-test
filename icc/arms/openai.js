// OpenAI Structured Output arm.
//
// 스키마와 프롬프트는 기존 collect.js(= main.js)와 동일하게 유지한다.
// prompt.js는 수정하지 않고 SYSTEM_PROMPT_* 상수만 import한다.

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { SYSTEM_PROMPT_PREVIOUS, SYSTEM_PROMPT_PERFORMANCE } from "../../prompt.js";
import { toJevState } from "./jev-state.js";

export const OPENAI_MODEL = "gpt-5.6-luna";

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

let client;
function getClient() {
    // 재시도는 timing.js의 withRetry가 담당하므로 SDK 재시도는 끈다.
    client ??= new OpenAI({
        maxRetries: 0,
        timeout: Number(process.env.OPENAI_TIMEOUT_MS) || 120_000,
    });
    return client;
}

async function parse({ systemPrompt, userContent, format, reasoning }) {
    const res = await getClient().responses.parse({
        model: OPENAI_MODEL,
        input: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
        ],
        text: { format },
        ...(reasoning ? { reasoning } : {}),
    });
    return {
        output: res.output_parsed,
        usage: res.usage ?? null, // cached/reasoning 토큰 등 usage 객체를 통째로 저장
        model: res.model,
        requestId: res._request_id ?? null,
    };
}

/** 초기 버전 (8/12): SYSTEM_PROMPT_PREVIOUS */
export function callOld(debate) {
    return parse({
        systemPrompt: SYSTEM_PROMPT_PREVIOUS,
        userContent: JSON.stringify(debate),
        format: zodTextFormat(JudgingDebate, "judging_debate"),
    });
}

/** 개선 버전 (8/20): SYSTEM_PROMPT_PERFORMANCE */
export function callNew(debate) {
    return parse({
        systemPrompt: SYSTEM_PROMPT_PERFORMANCE,
        userContent: JSON.stringify(debate),
        format: zodTextFormat(JudgingDebatePerformance, "judging_debate_performance"),
    });
}

/** 선택 실험: Jev와 같은 전처리 state를 입력으로 쓰는 개선 버전 (§5.1) */
export function callNewNormalized(debate) {
    return parse({
        systemPrompt: SYSTEM_PROMPT_PERFORMANCE,
        userContent: JSON.stringify(toJevState(debate)),
        format: zodTextFormat(JudgingDebatePerformance, "judging_debate_performance"),
    });
}

/** 선택 실험: 추론 강도 low인 개선 버전 (Phase 6) */
export function callNewLowReasoning(debate) {
    return parse({
        systemPrompt: SYSTEM_PROMPT_PERFORMANCE,
        userContent: JSON.stringify(debate),
        format: zodTextFormat(JudgingDebatePerformance, "judging_debate_performance"),
        reasoning: { effort: "low" },
    });
}
