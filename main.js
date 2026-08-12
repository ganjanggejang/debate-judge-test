import { readFileSync } from "node:fs";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

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
            content:
                "입력은 일대일 토론 대화 스크립트이며, 답변은 토론 대결의 결과 판정이다. 이때 penalty_score 필드에는 만약 토론자가 욕설, 토론과 관계없는 발언, 예의없는 발언을 했을 때 재량으로 최대 10점을 부여하도록 한다. penalty를 크게 부여할수록 점수를 크게 부여한다. 그러한 사항이 없으면 0점이다. ",
        },
        { role: "user", content: JSON.stringify(debate) },
    ],
    text: {
        format: zodTextFormat(JudgingDebate, "judging_debate"),
    },
});

const judging_debate = response.output_parsed;
console.log(judging_debate);
