// 모델별 단가와 호출 비용 계산 (JEV_BENCHMARK_PLAN.md §4.2).
//
// 단가는 raw가 아니라 리포트 단계에서 적용한다. 가격이 바뀌어도 다시 수집할 필요가 없다.
// 단위: USD / 1M tokens

export const PRICING = {
    // short context (입력 272k 토큰 이하)
    "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 },
    // 출력 무료
    "jev-1.13.0": { input: 0.042, output: 0 },
};

export const OPENAI_SHORT_CONTEXT_LIMIT = 272_000;

/** 응답의 model 값(스냅샷 이름일 수 있음)을 단가표의 키로 맞춘다. */
export function pricingKeyOf(model) {
    if (!model) return null;
    return Object.keys(PRICING).find((key) => model === key || model.startsWith(`${key}-`)) ?? null;
}

/**
 * @param {string} provider  "openai" | "typesafe"
 * @param {string} model     응답에 실린 모델 이름
 * @param {object} usage     raw에 저장된 usage 객체
 * @returns {{
 *   usd: number,           // 실제 캐시 상태 그대로 계산한 비용
 *   usdNoCache: number,    // 캐시가 전혀 없다고 가정한 비용 (모든 입력을 기본 입력 단가로)
 *   usdRange: [number, number] | null, // 캐시 쓰기 토큰 수를 모를 때의 [하한, 상한]
 *   parts: { input: number, cached: number, cacheWrite: number, output: number }, // USD
 *   tokens: { input: number, cached: number, cacheWrite: number | null, output: number, reasoning: number },
 *   overShortContext: boolean,
 * } | null}
 */
export function costOf(provider, model, usage) {
    if (!usage) return null;
    const price = PRICING[pricingKeyOf(model)];
    if (!price) throw new Error(`단가표에 없는 모델입니다: ${model}`);
    const perTok = (usd) => usd / 1e6;

    if (provider === "typesafe") {
        const input = usage.input_tokens;
        const usd = input * perTok(price.input) + usage.output_tokens * perTok(price.output);
        return {
            usd,
            usdNoCache: usd,
            usdRange: null,
            parts: { input: usd, cached: 0, cacheWrite: 0, output: 0 },
            tokens: { input, cached: 0, cacheWrite: 0, output: usage.output_tokens, reasoning: 0 },
            overShortContext: false,
        };
    }

    if (provider === "openai") {
        const input = usage.input_tokens;
        const cached = usage.input_tokens_details?.cached_tokens ?? 0;
        const cacheWriteRaw = usage.input_tokens_details?.cache_write_tokens;
        const cacheWrite = Number.isFinite(cacheWriteRaw) ? cacheWriteRaw : null;
        const output = usage.output_tokens; // 추론 토큰 포함
        const reasoning = usage.output_tokens_details?.reasoning_tokens ?? 0;

        const outputUsd = output * perTok(price.output);
        const cachedUsd = cached * perTok(price.cachedInput);
        const uncached = input - cached;

        let parts;
        let usdRange = null;
        if (cacheWrite !== null) {
            parts = {
                input: (uncached - cacheWrite) * perTok(price.input),
                cached: cachedUsd,
                cacheWrite: cacheWrite * perTok(price.cacheWrite),
                output: outputUsd,
            };
        } else {
            // 캐시 쓰기 토큰 수를 알 수 없으면, 캐시 적중이 아닌 입력을 전부 기본 단가(하한)로 두고
            // 전부 캐시 쓰기 단가인 경우(상한)를 범위로 함께 보고한다.
            parts = { input: uncached * perTok(price.input), cached: cachedUsd, cacheWrite: 0, output: outputUsd };
            usdRange = [
                uncached * perTok(price.input) + cachedUsd + outputUsd,
                uncached * perTok(price.cacheWrite) + cachedUsd + outputUsd,
            ];
        }
        return {
            usd: parts.input + parts.cached + parts.cacheWrite + parts.output,
            usdNoCache: input * perTok(price.input) + outputUsd,
            usdRange,
            parts,
            tokens: { input, cached, cacheWrite, output, reasoning },
            overShortContext: input > OPENAI_SHORT_CONTEXT_LIMIT,
        };
    }

    throw new Error(`알 수 없는 provider: ${provider}`);
}
