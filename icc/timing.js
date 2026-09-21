// 호출 지연시간 계측과 재시도.
//
// SDK 자체 재시도는 모두 끄고(maxRetries: 0) 재시도는 여기서만 처리한다.
// 그래야 시도 횟수와 시도별 시간을 기록할 수 있고, latencyMs에는
// "성공한 시도 1회"의 시간만 담을 수 있다 (JEV_BENCHMARK_PLAN.md §4.1).

import { setTimeout as sleep } from "node:timers/promises";

/**
 * fn을 실행하고 걸린 시간(ms)을 잰다.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<{ value: T, ms: number }>}
 */
export async function timed(fn) {
    const t0 = performance.now();
    const value = await fn();
    return { value, ms: performance.now() - t0 };
}

/**
 * 실패하면 최대 maxAttempts회까지 다시 시도한다.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ maxAttempts?: number, label?: string, backoffMs?: number }} [opts]
 * @returns {Promise<{
 *   value: T,
 *   latencyMs: number,   // 성공한 시도 1회의 시간
 *   totalMs: number,     // 실패한 시도와 대기 시간을 포함한 전체 시간
 *   attempts: number,
 *   attemptLog: { ms: number, error: string | null }[],
 * }>}
 * 모든 시도가 실패하면 마지막 에러를 던진다. 에러에는 attempts, attemptLog, totalMs가 붙는다.
 */
export async function withRetry(fn, { maxAttempts = 3, label = "", backoffMs = 1000 } = {}) {
    const attemptLog = [];
    const start = performance.now();
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const t0 = performance.now();
        try {
            const value = await fn();
            const ms = performance.now() - t0;
            attemptLog.push({ ms, error: null });
            return {
                value,
                latencyMs: ms,
                totalMs: performance.now() - start,
                attempts: attempt,
                attemptLog,
            };
        } catch (err) {
            lastErr = err;
            attemptLog.push({ ms: performance.now() - t0, error: describeError(err) });
            console.warn(`[재시도 ${attempt}/${maxAttempts}] ${label}: ${describeError(err)}`);
            if (attempt < maxAttempts) await sleep(backoffMs * 2 ** (attempt - 1));
        }
    }
    lastErr.attempts = maxAttempts;
    lastErr.attemptLog = attemptLog;
    lastErr.totalMs = performance.now() - start;
    throw lastErr;
}

export function describeError(err) {
    const status = err?.status ? ` (HTTP ${err.status})` : "";
    return `${err?.name ?? "Error"}${status}: ${err?.message ?? String(err)}`;
}
