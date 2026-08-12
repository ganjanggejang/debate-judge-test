import { readFileSync } from "node:fs";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { SYSTEM_PROMPT } from "./prompt";

const debateSeeds = JSON.parse(
    readFileSync(new URL("./debate-message.seed.json", import.meta.url))
);
const debate = debateSeeds.find(
    (seed) => seed.communityTopic === "기본소득 도입에 찬성하는가"
);

const openai = new OpenAI();

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

const response = await openai.responses.parse({
    model: "gpt-5.6-luna",
    input: [
        {
            role: "system",
            content: SYSTEM_PROMPT
        },
        { role: "user", content: JSON.stringify(debate) },
    ],
    text: {
        format: zodTextFormat(JudgingDebate, "judging_debate"),
    },
});

const judging_debate = response.output_parsed;
console.log(judging_debate);
