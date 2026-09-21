// Phase 0 환경 점검: 두 SDK로 최소 호출을 1회씩 해서 키와 모델 접근 권한을 확인한다.
//
// 사용법:
//   npm run check-env

import OpenAI from "openai";
import { TypeSafeClient, noul } from "@typesafe-ai/sdk";
import { JEV_MODEL } from "./arms/jev.js";
import { OPENAI_MODEL } from "./arms/openai.js";

const typesafe = new TypeSafeClient({ defaultModel: JEV_MODEL, retry: { maxRetries: 0 } });
const models = await typesafe.models.list();
console.log("TypeSafe 모델 목록:", models.map((m) => m.name).join(", "));

const { data, requestId } = await typesafe
    .systemOne({
        state: { text: "The meeting is moved to Friday." },
        questions: { is_schedule: noul("Is this text about a schedule change?") },
    })
    .withResponse();
console.log("Jev 응답:", JSON.stringify({ model: data.model, usage: data.usage, requestId, answers: data.answers }));

const openai = new OpenAI({ maxRetries: 0 });
const res = await openai.responses.create({ model: OPENAI_MODEL, input: "Reply with the single word: ok" });
console.log("OpenAI 응답:", JSON.stringify({ model: res.model, text: res.output_text, usage: res.usage }));
