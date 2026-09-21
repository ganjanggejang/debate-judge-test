// 기술통계 헬퍼.

export function mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** p ∈ [0, 1] 분위수. 선형 보간 (R type 7, numpy 기본값과 같음) */
export function percentile(arr, p) {
    if (arr.length === 0) return NaN;
    const sorted = [...arr].sort((a, b) => a - b);
    const h = (sorted.length - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function median(arr) {
    return percentile(arr, 0.5);
}

/** 지연시간 등 분포 요약 */
export function summarize(arr) {
    if (arr.length === 0) return null;
    return {
        n: arr.length,
        mean: mean(arr),
        p50: percentile(arr, 0.5),
        p90: percentile(arr, 0.9),
        p99: percentile(arr, 0.99),
        min: Math.min(...arr),
        max: Math.max(...arr),
    };
}
