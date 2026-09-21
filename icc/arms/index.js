// arm 레지스트리. arm = 같은 토론을 채점하는 하나의 채점기 설정.
//
// call(debate)는 { output, usage, model, requestId }를 반환한다.
// 지연시간과 재시도는 collect.js가 timing.js로 감싸서 잰다.

import { callOld, callNew, callNewNormalized, callNewLowReasoning } from "./openai.js";
import { callJev } from "./jev.js";
import { JEV_QUESTION_SET_HASH } from "./jev-questions.js";

export const ARMS = {
    "openai-old": { id: "openai-old", provider: "openai", call: callOld },
    "openai-new": { id: "openai-new", provider: "openai", call: callNew },
    "jev-new": {
        id: "jev-new",
        provider: "typesafe",
        call: callJev,
        questionSetHash: JEV_QUESTION_SET_HASH,
    },
    // ---- 선택 비교 실험 (Phase 6) ----
    "openai-new-normalized": { id: "openai-new-normalized", provider: "openai", call: callNewNormalized },
    "openai-new-low": { id: "openai-new-low", provider: "openai", call: callNewLowReasoning },
};

export const DEFAULT_ARMS = ["openai-new", "jev-new"];

export function getArms(ids) {
    return ids.map((id) => {
        const arm = ARMS[id];
        if (!arm) {
            throw new Error(`알 수 없는 arm: ${id} (가능: ${Object.keys(ARMS).join(", ")})`);
        }
        return arm;
    });
}
