import { readFileSync } from "node:fs";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { SYSTEM_PROMPT_PERFORMANCE, SYSTEM_PROMPT_PREVIOUS, SYSTEM_PROMPT_VIOLATION } from "./prompt.js";

const debateSeeds = JSON.parse(
    readFileSync(new URL("./debate-message.seed.json", import.meta.url))
);
const debate = debateSeeds.find(
    (seed) => seed.communityTopic === "선거운동 가능 연령을 16세로 하향하여야 하는가"
);

const openai = new OpenAI();

// 초기 버전 (8/12)
const ParticipantJudging = z.object({
    score: z.number().int().min(60).max(100),
    winner: z.enum(["host", "opponent"]),
    judge_reason: z.array(z.string()).min(1).max(3),
    penalty_score: z.number().int().min(0).max(10),
    penalty_evidence: z.array(z.string()).max(5)
});

const JudgingDebate = z.object({
    host: ParticipantJudging,
    opponent: ParticipantJudging,
});

const response_old = await openai.responses.parse({
    model: "gpt-5.6-luna",
    input: [
        {
            role: "system",
            content: SYSTEM_PROMPT_PREVIOUS
        },
        { role: "user", content: JSON.stringify(debate) },
    ],
    text: {
        format: zodTextFormat(JudgingDebate, "judging_debate"),
    },
});

console.log(JSON.stringify(response_old.output_parsed, null, 2));


// 개선된 버전 (8/20)

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

const Violation = z.object({
    type: z.enum([
        "profanity",
        "personal_attack",
        "disrespect",
        "off_topic",
        "threat",
    ]),
    severity: z.enum([
        "none",
        "minor",
        "moderate",
        "high",
        "severe",
    ]),
    evidence: z.string(),
});

const ParticipantViolation = z.object({
    violations: z.array(Violation),
});

const DetectDebateViolations = z.object({
    host: ParticipantViolation,
    opponent: ParticipantViolation,
});

const response_performance = await openai.responses.parse({
    model: "gpt-5.6-luna",
    input: [
        {
            role: "system",
            content: SYSTEM_PROMPT_PERFORMANCE
        },
        { role: "user", content: JSON.stringify(debate) },
    ],
    text: {
        format: zodTextFormat(JudgingDebatePerformance, "judging_debate_performance"),
    },
});

console.log(JSON.stringify(response_performance.output_parsed, null, 2));

const response_violation = await openai.responses.parse({
    model: "gpt-5.6-luna",
    input: [
        {
            role: "system",
            content: SYSTEM_PROMPT_VIOLATION
        },
        { role: "user", content: JSON.stringify(debate) },
    ],
    text: {
        format: zodTextFormat(DetectDebateViolations, "detect_debate_violations"),
    },
});

console.log(JSON.stringify(response_violation.output_parsed, null, 2));