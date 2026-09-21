// Jev 채점 질문 세트 (JEV_BENCHMARK_PLAN.md §5.2).
//
// 참가자 2명 × 세부 항목 5개 = Score 질문 10개를 요청 1회로 보낸다.
// 항목 정의는 SYSTEM_PROMPT_PERFORMANCE의 logic / evidence / rebuttal /
// understanding / clarity에 맞췄다. 토론은 한국어, 질문과 레벨은 영어다.
//
// 작성 원칙 (TypeSafe score 문서):
//   - 레벨에는 정도가 아니라 상황을 서술한다. 숫자 범위는 쓰지 않는다.
//   - 각 레벨은 따로 평가되므로 단독으로 읽혀도 의미가 통해야 한다.
//   - 질문 ID는 모델에 전달되지 않으므로 instructions에 참가자와 항목을 모두 적는다.
//   - 점수 환산(가중치, 합산)은 코드(report.js)에서 한다.

import { createHash } from "node:crypto";
import { score } from "@typesafe-ai/sdk";

export const PARTICIPANTS = ["host", "opponent"];

/** 항목별 만점. OpenAI new arm의 zod 스키마 범위와 같다. */
export const DIMENSION_MAX = {
    logic: 30,
    evidence: 25,
    rebuttal: 20,
    understanding: 15,
    clarity: 10,
};
export const DIMENSIONS = Object.keys(DIMENSION_MAX);

const DIMENSION_SPECS = {
    logic: {
        question: "How logically sound and well-structured are the arguments made by {P}?",
        scope: "Judge only the quality of reasoning: whether claims follow from stated reasons and fit together. Do not judge how much evidence is cited, how well the other side is answered, or manners.",
        levels: [
            "Claims are asserted without any reasons, or the reasoning contradicts itself",
            "Some reasons are given, but key steps are missing or the argument relies on obvious fallacies",
            "Main claims are supported by reasons, but with noticeable gaps or leaps",
            "Arguments are consistently supported and connected, with only minor gaps",
            "Every main claim follows from clearly stated premises, and the whole case is coherent from start to finish",
        ],
    },
    evidence: {
        question: "How well does {P} support their claims with concrete evidence such as data, examples, cases, or sources?",
        scope: "Judge only the use of supporting evidence: whether it exists, is specific, and is relevant to the claim it supports. Do not judge the reasoning structure or manners.",
        levels: [
            "No evidence at all; only opinions or assertions",
            "Only vague or generic appeals such as 'everyone knows' or 'it is obvious', with no specific examples or data",
            "A few specific examples or facts are given, but they are thin or only loosely tied to the claims",
            "Several specific, relevant examples, figures, or cases support most of the main claims",
            "Main claims are backed by specific, relevant, and credible evidence such as statistics, named studies, real cases, or precedents",
        ],
    },
    rebuttal: {
        question: "How effectively does {P} respond to and counter the arguments made by {O}?",
        scope: "Judge only how the participant engages with the other side's points: whether they address them directly and weaken them. Do not judge the participant's own opening case.",
        levels: [
            "Ignores the other side's arguments entirely and never responds to them",
            "Responds only by repeating their own position or by dismissing the other side without addressing its points",
            "Addresses some of the other side's points, but the responses are shallow or leave the main objections standing",
            "Directly answers most of the other side's main points with relevant counterarguments",
            "Directly answers the other side's strongest points and clearly exposes their weaknesses, turning them into support for their own position",
        ],
    },
    understanding: {
        question: "How well does {P} understand the debate topic and the position of {O}?",
        scope: "Judge only understanding: whether the participant grasps what the topic is really about and represents the other side's position accurately. Do not judge persuasiveness or evidence.",
        levels: [
            "Misunderstands the topic or talks past it, and misrepresents what the other side is saying",
            "Grasps the topic only superficially, and often distorts or strawmans the other side's position",
            "Understands the basic issue, but misses important aspects of the topic or parts of the other side's position",
            "Understands the topic and represents the other side's position accurately in most places",
            "Shows a thorough grasp of the topic's key issues and trade-offs, and represents the other side's position accurately and fairly",
        ],
    },
    clarity: {
        question: "How clearly and understandably does {P} express their points?",
        scope: "Judge only clarity of expression: whether a reader can easily tell what the participant is claiming. Do not judge whether the arguments are correct or well supported.",
        levels: [
            "Messages are confusing or incoherent, and it is hard to tell what is being claimed",
            "The main point can be guessed, but messages are disorganized, vague, or rambling",
            "Points are mostly understandable, with some unclear or muddled passages",
            "Points are stated clearly and in a sensible order, with only occasional vagueness",
            "Every message states its point clearly and concisely, and it is always easy to follow what is being argued",
        ],
    },
};

/** 레벨 수 L. 모든 항목이 같다. */
export const NUM_LEVELS = 5;

function participantRef(p) {
    return `the ${p} (the \`messages\` whose \`speaker\` is "${p}")`;
}

function buildQuestion(participant, dim) {
    const other = participant === "host" ? "opponent" : "host";
    const spec = DIMENSION_SPECS[dim];
    const question = spec.question
        .replace("{P}", participantRef(participant))
        .replace("{O}", `the ${other}`);
    return score(
        {
            question,
            whose_messages: `Evaluate only the messages whose \`speaker\` is "${participant}". Messages from the ${other} are context only.`,
            scope: spec.scope,
            note: `The debate topic is \`topic\`. The messages are written in Korean.`,
        },
        spec.levels
    );
}

/** 질문 ID `${participant}_${dimension}` → Score 질문 */
export const JEV_QUESTIONS = Object.fromEntries(
    PARTICIPANTS.flatMap((p) => DIMENSIONS.map((d) => [`${p}_${d}`, buildQuestion(p, d)]))
);

for (const d of DIMENSIONS) {
    if (DIMENSION_SPECS[d].levels.length !== NUM_LEVELS) {
        throw new Error(`${d} 항목의 레벨 수가 ${NUM_LEVELS}개가 아닙니다.`);
    }
}

/** 질문 세트가 바뀌면 달라지는 해시. raw에 기록해서 수집 간 질문 세트를 구분한다. */
export const JEV_QUESTION_SET_HASH =
    "sha256:" + createHash("sha256").update(JSON.stringify(JEV_QUESTIONS)).digest("hex");
