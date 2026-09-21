// TypeSafe Jev arm. 호출만 담당하고, 점수 환산은 report.js가 한다.

import { TypeSafeClient, noul } from "@typesafe-ai/sdk";
import { toJevState } from "./jev-state.js";
import { JEV_QUESTIONS } from "./jev-questions.js";

/** alias(jev-latest)는 바뀔 수 있으므로 버전을 고정한다. */
export const JEV_MODEL = "jev-1.13.0";

let client;
function getClient() {
    // 재시도는 timing.js의 withRetry가 담당하므로 SDK 재시도는 끈다.
    client ??= new TypeSafeClient({
        defaultModel: JEV_MODEL,
        retry: { maxRetries: 0 },
        timeout: 30_000,
    });
    return client;
}

export async function callJev(debate) {
    const { data, requestId } = await getClient()
        .systemOne({ state: toJevState(debate), questions: JEV_QUESTIONS })
        .withResponse();
    return {
        output: { answers: data.answers }, // score, probabilities, confidence, legend 원본 전체
        usage: data.usage,
        model: data.model,
        requestId: requestId ?? null,
    };
}

/**
 * 네트워크 기준선 측정용 초소형 요청 (§4.1).
 * 짧은 state와 Noul 1개라서 모델 시간이 거의 없고, 왕복 시간 대부분이 네트워크다.
 */
export async function callJevBaseline() {
    const { data, requestId } = await getClient()
        .systemOne({
            state: "ok",
            questions: { q: noul("Is this text a single word?") },
        })
        .withResponse();
    return { output: data.answers, usage: data.usage, model: data.model, requestId };
}
