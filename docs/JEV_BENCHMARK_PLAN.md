# Jev vs OpenAI Structured Output 벤치마크 구현 계획

> 작성일: 2026-09-21 · 상태: **구현 완료 (Phase 0–5), 본 수집 진행** · 개정 2 (구현 중 확인 사항 반영, §12)
> 참고 자료: `jev_introduce.md`, TypeSafe 공식 문서(docs.typesafe.ai, 2026-09-21 기준), `typesafe:typesafe-ai` 스킬

## 1. 목표와 범위

지금 레포는 **같은 토론 스크립트를 LLM이 여러 번 채점했을 때 점수가 얼마나 일관되는지**를 ICC로 잽니다.
이번 확장에서는 OpenAI Structured Output(`gpt-5.6-luna` + zod 스키마) 채점기와
TypeSafe **Jev**(System One 모델) 채점기를 같은 조건에서 비교합니다.

| # | 질문 | 지표 |
|---|------|------|
| 1 | Jev가 얼마나 빠른가 | 호출당 end-to-end 지연시간(ms) p50/p90, 속도 배수 |
| 2 | Jev가 얼마나 싼가 | 호출당 비용(USD), 비용 배수 |
| 3 | Jev의 ICC가 얼마나 높은가 | ICC(1,1), ICC(1,k) 및 95% 신뢰구간 (총점·세부 항목별) |

### 확정된 범위 결정

| 항목 | 결정 |
|------|------|
| 입력 언어 | 토론 데이터는 **한국어** 그대로 씁니다(다른 언어 데이터는 없음). Jev 질문과 레벨 문구는 **영어로 작성해도 됩니다**. |
| 품질 지표 | 토론 판정에는 절대적인 정답 점수가 있을 수 없으므로, **ICC(일관성)만** 측정합니다. 참조 점수와의 일치도, 정확도 같은 지표는 쓰지 않습니다. |
| 비교 대상 필드 | **숫자 점수만** 비교합니다. `judge_reason` 같은 문자열 필드는 비교 대상이 아닙니다. |
| 데이터 | seed의 토론 **10개 전부**를 씁니다(n = 10). |
| 위반 탐지 | 이번 벤치마크에서 **뺍니다**. `SYSTEM_PROMPT_VIOLATION`과 `DetectDebateViolations`는 쓰지 않습니다. |

---

## 2. 현재 구현 요약

| 파일 | 역할 | 이번 작업에서 |
|------|------|---------------|
| `prompt.js` | `SYSTEM_PROMPT_PREVIOUS / PERFORMANCE / VIOLATION` | **수정 안 함** (기존 원칙 유지) |
| `main.js` | 단발 실행 데모 | **수정 안 함** |
| `icc/collect.js` | 토론 × k회 × (old, new) 호출 → `icc/data/raw-*.json` 저장 | 확장 (arm 구조, 지연시간·토큰 기록) |
| `icc/report.js` | raw 파일로 host/opponent 총점 ICC 계산 | 확장 (속도·비용 표, 항목별 ICC, CI) |
| `icc/icc-math.js` | one-way random ICC(1,1), ICC(1,k) (Shrout & Fleiss) | 확장 (신뢰구간, 경계 조건) |
| `debate-message.seed.json` | 토론 10개 (`communityTopic`, `hostEmail`, `opponentEmail`, `messages[{email, turn, body}]`) | 그대로 사용 |

### seed 데이터 현황

| idx | 주제 | JSON 크기 | 메시지 수 |
|-----|------|-----------|-----------|
| 0 | 기본소득 도입에 찬성하는가 | 9.4 KB | 37 |
| 1 | 선거운동 가능 연령을 16세로 하향하여야 하는가 | 6.7 KB | 18 |
| 2 | 국민연금 의무가입을 폐지하여야 한다 | 20.7 KB | 55 |
| 3–9 | 스마트폰 금지, 컵 보증금, AI 표시, 도심 주차, 등록금 상한, 주 4일제, 반려동물 등록 | 약 1.6–1.7 KB | 12 |

- 모든 메시지의 `email`이 해당 토론의 `hostEmail` 또는 `opponentEmail`과 일치합니다(확인함). §5.1의 역할 라벨 변환이 누락 없이 됩니다.
- **토론 길이가 크게 두 그룹으로 나뉩니다**(긴 토론 3개, 짧은 토론 7개). 지연시간과 비용은 입력 길이에 비례하므로, §4.1과 §4.2에서 길이 그룹별로도 보고합니다.

### 지금 구현에서 벤치마크에 부족한 부분

1. **지연시간과 토큰 사용량을 기록하지 않습니다.** `callOld/callNew`는 `output_parsed`만 반환합니다.
2. `package.json`에 `openai`, `zod` 의존성이 선언되어 있지 않고 `node_modules`도 없습니다.
3. 동시성 4로 호출하므로 측정된 지연시간에 대기열 효과가 섞입니다.
4. `collect.js`의 기본값이 `subjects=3`이라서 10으로 바꿔야 합니다. README의 "총 60회 호출" 설명도 갱신해야 합니다.
5. `computeICC1`은 `BMS = 0`일 때 NaN이 됩니다. Jev처럼 반복 간 변동이 거의 없는 채점기에서는 `WMS = 0`도 나올 수 있어서 경계 처리가 필요합니다.

---

## 3. 문서에서 확인한, 설계에 영향을 주는 Jev의 특성

| Jev 특성 (출처) | 설계 결정 |
|----------------------|-----------|
| **텍스트를 생성하지 않음**. 답은 Choice / Score / Noul 세 가지 타입뿐 (primitives, jaggedness #9) | 숫자 점수만 비교하기로 한 범위와 맞습니다. Jev arm은 점수 질문만 보냅니다. |
| **Score** = 서술형 레벨(최대 10개)의 확률분포. `score`는 기대값이라 레벨 사이 실수가 나올 수 있음 (primitives/score) | 세부 항목 5개를 각각 Score 질문으로 만들고, 점수 환산은 코드에서 합니다 (§5.3). |
| 레벨에는 **정도가 아니라 상황을 서술**해야 하고, 숫자는 도움이 안 됨. 레벨은 각각 독립적으로 평가됨 | "0~30점" 같은 숫자 범위를 쓰지 않고 레벨마다 구체적인 상황을 서술합니다. |
| 수학·산술은 코드에서 해야 함. Score 기대값으로 정확한 크기를 보간하지 말 것 (jaggedness #2) | 합산과 가중치는 코드에서 합니다. 이산(argmax) 환산도 함께 보고합니다. |
| **같은 state에 대한 질문은 한 요청에 묶기**: 병렬 평가되고, 질문을 추가해도 지연시간은 거의 늘지 않음 (primitives, parallel_questions cookbook) | Score 질문 10개(참가자 2명 × 5개 항목)를 **요청 1회**로 보냅니다. OpenAI new arm도 호출 1회라서 호출 단위로 공정하게 비교됩니다. |
| **간접 참조(indirection)에 약함**. 관련 state를 이름으로 지목할 것 (jaggedness #4) | 이메일 대신 `speaker: "host" \| "opponent"` 라벨을 붙이도록 state를 전처리합니다 (§5.1). |
| **영어가 주력 언어**. 한국어는 "지원하지만 정확도가 낮음" (models, state) | 토론(state)은 한국어 그대로, 질문과 레벨은 영어로 씁니다. 결과 해석 시 입력 언어 조건을 명시합니다. |
| 가격: 입력 **$0.042 / Mtok**, 출력 무료. 컨텍스트 64k (state + 가장 긴 질문 ≤ 32k). 1,200 RPM (models) | 가장 긴 토론(20.7KB)도 한도 안에 들어갈 것으로 보이지만, Phase 3 드라이런에서 실제 `input_tokens`로 확인합니다. |
| 완전히 결정적이지는 않지만 반복 간 변동이 매우 작음 (consistency_choice cookbook: 확률 std 평균 0.0098) | Jev의 ICC는 1에 가깝게 나올 가능성이 큽니다. 이 경우를 대비해 `icc-math.js`의 경계 조건을 처리합니다. |
| JS SDK `@typesafe-ai/sdk` (Node 20+ 필요, 현재 v24.11.1). 기본 timeout 10초, 기본 재시도 2회 (TypeSafeClientConfig, RetryPolicy) | SDK의 자동 재시도를 끄고(`retry: { maxRetries: 0 }`) 재시도는 우리 `withRetry`로 처리해서 시도 횟수를 기록합니다. OpenAI SDK도 `maxRetries: 0`으로 같게 설정합니다. |
| 응답의 `model` 필드에 실제 버전(`jev-1.13.0`)이 실림. alias는 바뀔 수 있음 (models) | 요청에는 **`jev-1.13.0`으로 버전을 고정**하고, 응답의 `model` 값을 raw에 기록합니다. |

---

## 4. 측정 지표 정의

### 4.1 속도 (지연시간)

- **정의**: SDK 호출 직전부터 파싱된 결과를 받을 때까지의 wall-clock 시간(`performance.now()`). 실패한 시도는 빼고 성공한 시도 1회의 시간만 셉니다. 전체 소요 시간(재시도 포함)은 따로 기록합니다.
- **측정 모드**
  - `latency` 모드 (주 지표): **동시성 1, 순차 호출**. 같은 `(subject, rep)` 안에서 arm을 번갈아 호출해 시간대별 네트워크 변동이 한쪽에만 쏠리지 않게 합니다. arm마다 첫 호출 1회는 워밍업으로 보고 버립니다.
  - `throughput` 모드 (선택): 기존처럼 동시성 N으로 호출해서 전체 소요 시간과 초당 호출 수를 잽니다.
- **네트워크 기준선**: TypeSafe 서버는 미국 서부에 있고 측정은 한국에서 합니다. 아주 작은 Jev 요청(짧은 state, Noul 1개)의 왕복 시간을 따로 재서, Jev 지연시간 중 네트워크가 차지하는 몫을 가늠합니다.
- **리포트**
  - arm별 mean / p50 / p90 / p99 / min / max
  - **속도 배수 = OpenAI p50 / Jev p50**. 전체와 길이 그룹별(긴 토론 3개 / 짧은 토론 7개)로 각각 보고합니다.
  - 토론별 짝지은 배수(같은 토론에서 OpenAI 중앙값 / Jev 중앙값)의 분포

### 4.2 비용

- **단가** (`icc/pricing.js` 상수, 단위: USD / 1M tokens)

  | 모델 | 입력 | 캐시 적중 입력 | 캐시 쓰기 | 출력 |
  |------|------|----------------|-----------|------|
  | `gpt-5.6-luna` (short context, 입력 272k 토큰 이하) | $0.20 | $0.02 | $0.25 | $1.20 |
  | `jev-1.13.0` | $0.042 | — | — | 무료 |

  단가는 raw가 아니라 리포트 단계에서 적용해서, 가격이 바뀌어도 다시 수집할 필요가 없게 합니다.
- **OpenAI**: Responses API의 `usage` 객체를 **통째로** raw에 저장합니다. 계산에 쓰는 값은 `input_tokens`, `input_tokens_details.cached_tokens`, `output_tokens`(추론 토큰 포함), `output_tokens_details.reasoning_tokens`, 그리고 캐시 쓰기 토큰입니다.
  `cost = (input − cached − cacheWrite) × 0.20 + cached × 0.02 + cacheWrite × 0.25 + output × 1.20` (÷ 1e6)
  - **캐시 쓰기 토큰이 `usage`의 어느 필드로 오는지는 Phase 2 드라이런에서 확인합니다.** 필드가 없으면 캐시 쓰기 토큰 수를 알 수 없으므로, 캐시 적중이 아닌 입력을 전부 $0.20(하한)과 전부 $0.25(상한)로 계산한 범위로 보고합니다.
  - 모든 토론은 입력 272k 토큰보다 훨씬 짧아서 short context 단가가 적용됩니다. 그래도 `input_tokens`가 272k를 넘는 호출이 나오면 리포트에서 경고합니다.
- **Jev**: 응답의 `usage.input_tokens`, `usage.output_tokens`를 기록합니다.
  `cost = input_tokens × 0.042 / 1e6` (출력은 무료)
- **주의**
  - 두 모델은 토크나이저가 다르므로 **토큰 수 대신 USD로 비교**합니다.
  - 같은 입력을 반복 호출하므로 OpenAI 프롬프트 캐시가 적중해 비용이 실제 운영보다 낮게 나올 수 있습니다. 실제 캐시 상태 그대로 계산한 비용과, **캐시가 전혀 없다고 가정한 비용**(모든 입력 $0.20)을 둘 다 보고합니다.
  - `gpt-5.6-luna`는 출력 단가가 입력의 6배이고 추론 토큰도 출력으로 과금됩니다. 그래서 OpenAI 비용은 추론 토큰 수에 크게 좌우될 수 있습니다. 비용을 입력·캐시·출력(추론 포함) 항목별로 나눠 보여줍니다.
- **리포트**: arm별 호출당 평균 비용(전체와 길이 그룹별), 토론 1,000건 채점 환산 비용, **비용 배수 = OpenAI / Jev**.

### 4.3 일관성 (ICC): 유일한 품질 지표

- 기존 `computeICC1`(one-way random, ICC(1,1), ICC(1,k))을 그대로 씁니다. subject = 토론(n = 10), 반복 = k회 호출.
- **계산 대상**
  - 참가자별 총점(host_total, opponent_total): 기존 리포트와 같습니다.
  - **세부 항목별**(logic / evidence / rebuttal / understanding / clarity × host / opponent): 새로 추가합니다.
  - `openai-old` arm은 기존과 같이 `host.score`, `opponent.score`로 계산합니다(세부 항목 없음).
  - Jev는 두 가지로 읽습니다. ① 기대값 `score`를 환산한 연속 점수, ② argmax 레벨을 환산한 이산 점수. ②가 정수를 출력하는 LLM과 더 직접적으로 비교됩니다.
- **신뢰구간**: Shrout & Fleiss(1979)의 F분포 기반 ICC(1,1)·ICC(1,k) 95% CI를 `icc-math.js`에 구현하고, 참조값 테스트를 추가합니다.
- **경계 조건**
  - `WMS = 0`이고 `BMS > 0`이면 ICC = 1로 정의하고 "반복 간 변동 없음"으로 표시합니다.
  - `BMS = 0`이면 ICC를 정의할 수 없으므로 "정의 불가(subject 간 분산 0)"로 표시합니다. NaN을 출력하지 않습니다.

---

## 5. Jev 채점기 설계

`typesafe:typesafe-ai` 스킬의 지침(판단을 좁고 독립적인 질문으로 나누기, 같은 state의 질문은 한 요청에, 산술은 코드로)과 **Composite scoring 패턴**을 따릅니다.

### 5.1 State 전처리 (`icc/arms/jev-state.js`)

```js
// 이메일 → 역할 라벨. 간접 참조 제거 (jaggedness #4)
{
  topic: debate.communityTopic,
  messages: debate.messages.map(m => ({
    turn: m.turn,
    speaker: m.email === debate.hostEmail ? "host" : "opponent",
    body: m.body,          // 한국어 원문 그대로
  })),
}
```

- OpenAI arm은 **기존 입력(`JSON.stringify(debate)`)을 그대로** 씁니다. 원래 파이프라인과 비교하는 것이 목적이기 때문입니다.
- 입력 전처리의 효과를 분리해 보고 싶으면, 같은 전처리 state를 OpenAI에 넣는 `openai-new-normalized` arm을 선택으로 둡니다 (Phase 6).

### 5.2 질문 구성 (요청 1회당 Score 10개)

| 질문 ID | 타입 | 내용 |
|---------|------|------|
| `host_logic`, `host_evidence`, `host_rebuttal`, `host_understanding`, `host_clarity` | Score | host 발언(`speaker`가 `"host"`인 `messages`)의 해당 항목 수준 |
| `opponent_logic` … `opponent_clarity` (5개) | Score | 위와 같은 질문을 opponent에 대해 |

- 질문 ID는 모델에 전달되지 않습니다. 그래서 `instructions` 안에 참가자와 항목을 완전하게 적습니다.
- 질문과 레벨은 **영어로** 쓰고, 각 Score는 **레벨 5개**를 기본으로 상황 서술형으로 작성합니다. 예시(logic):

```js
host_logic: score(
  {
    question: "How logically sound and well-structured are the arguments made by the host (the `messages` whose `speaker` is \"host\")?",
    note: "The debate is written in Korean. Judge only reasoning quality, not evidence quantity or manners.",
  },
  [
    "Claims are asserted without reasons, or the reasoning contradicts itself",
    "Some reasons are given, but key steps are missing or rely on obvious fallacies",
    "Main claims are supported by reasons, with a few gaps or leaps",
    "Arguments are consistently supported and connected, with only minor gaps",
    "Every main claim follows from clearly stated premises; the case is coherent from start to finish",
  ],
)
```

- 레벨 문구는 `SYSTEM_PROMPT_PERFORMANCE`의 항목 정의(logic / evidence / rebuttal / understanding / clarity)에 맞춰 작성합니다. 토론 판정에 정답이 없으므로, 문구를 다듬는 기준은 "정답에 가까운가"가 아니라 **레벨 정의가 명확한가**입니다. 확인할 것은 두 가지입니다: 확률이 인접 레벨 여러 개에 퍼져 confidence가 낮은 항목이 있는지, 그리고 토론 10개가 모두 한 레벨로 몰려 변별력이 없는지.

### 5.3 점수 환산 (코드)

항목별 만점 `M = {logic: 30, evidence: 25, rebuttal: 20, understanding: 15, clarity: 10}`, 레벨 수 `L = 5`일 때:

- 연속 점수: `points = answer.score / (L − 1) × M[dim]`
- 이산 점수: `points = argmax(answer.probabilities) / (L − 1) × M[dim]`
- 총점 = 5개 항목의 합 (0~100). OpenAI new arm의 총점 범위와 같습니다.

ICC는 항목별 선형 변환에 대해 불변이므로 **항목별 ICC는 환산 방식의 영향을 받지 않습니다**. 총점 ICC는 가중치(= 만점)에 따라 달라지지만, OpenAI 쪽과 가중치가 같으므로 비교할 수 있습니다.

---

## 6. 구현 단계

각 Phase가 끝날 때 체크포인트를 두고 결과를 확인한 뒤 다음으로 넘어갑니다.

### Phase 0: 환경 준비
- `package.json`에 의존성 선언: `openai`, `zod`, `@typesafe-ai/sdk`. 스크립트 추가: `collect`, `report`, `test`(`node --test icc/`).
- `.env`에 `OPENAI_API_KEY`, `TYPESAFE_API_KEY` 설정 (`.env`는 이미 gitignore 대상). Node 내장 `--env-file=.env` 사용.
- `client.models.list()`로 Jev 접근 권한과 사용 가능한 모델을 확인합니다.
- ✅ 체크: 두 SDK로 최소 호출 1회씩 성공.

### Phase 1: Jev 질문 프로토타이핑
- `typesafe:typesafe-ai` 스킬을 불러온 상태에서 최신 문서(primitives/score, confidence, jaggedness)를 다시 확인한 뒤 Score 질문 10개를 작성합니다.
- 긴 토론 1개와 짧은 토론 1개로 TypeSafe Console Playground나 스크립트에서 실행해 §5.2의 두 가지를 점검합니다.
- **주의**: 질문을 확정한 뒤에 벤치마크용 데이터를 수집합니다. 질문 세트는 해시로 raw에 기록합니다.
- ✅ 체크: 모든 항목에서 응답이 나오고, 레벨 분포가 지나치게 퍼지거나 몰리지 않음.

### Phase 2: 공통 계측 레이어 + OpenAI arm 리팩터링
- `icc/arms/openai.js`: 기존 `callOld/callNew`를 옮기고 `{ output, usage, latencyMs, attempts, model, requestId }`를 반환하도록 합니다. 스키마와 프롬프트는 기존과 동일하게 유지합니다.
- `icc/arms/index.js`: arm 레지스트리 `{ id, provider, call(debate) }`.
- `icc/timing.js`: `performance.now()` 래퍼와, 시도 횟수·시도별 시간을 기록하는 `withRetry`.
- ✅ 체크: `--arms openai-old,openai-new --subjects 1 --k 2` 드라이런이 기존과 같은 출력 구조로 저장되고, usage와 latency가 채워짐.

### Phase 3: Jev arm
- `icc/arms/jev-state.js` (§5.1), `icc/arms/jev-questions.js` (§5.2), `icc/arms/jev.js` (호출만 담당, 환산은 report에서).
- `new TypeSafeClient({ defaultModel: "jev-1.13.0", retry: { maxRetries: 0 } })`, `client.systemOne({ state, questions })`.
- raw에는 **응답 원본 전체**(`answers`의 score, probabilities, confidence, legend)를 저장합니다.
- ✅ 체크: `--arms jev-new --subjects 10 --k 1` 성공. 가장 긴 토론(idx 2)의 `input_tokens`가 컨텍스트 한도 안인지 확인.

### Phase 4: 수집기 확장 (`icc/collect.js`)
- CLI/환경변수: `--arms` (기본 `openai-old,openai-new,jev-new`), `--mode latency|throughput` (기본 `latency`). 기존 `--subjects`(기본값을 10으로 변경), `--k`, `--concurrency`는 유지합니다.
- latency 모드에서는 작업 순서를 `(subject, rep)` 단위로 arm을 번갈아 배치하고, arm별 워밍업 1회를 둡니다.
- 수집을 시작할 때 네트워크 기준선(§4.1)을 10회 측정합니다.
- 중간 실패 대비: 결과를 JSONL로 한 줄씩 쓰고(`raw-<ts>.jsonl`), 끝나면 헤더를 붙인 JSON으로 합칩니다. 중단 후 `--resume`으로 이어서 수집합니다(순차 300회 호출이라 도중에 끊길 가능성을 고려).
- ✅ 체크: 전체 설정 드라이런(`--subjects 10 --k 2`).

### Phase 5: 리포트 확장 (`icc/report.js`, `icc/stats.js`, `icc/icc-math.js`, `icc/pricing.js`)
- `icc-math.js`: F분포 기반 95% CI와 §4.3의 경계 조건을 추가합니다. `icc-math.test.js`에 CI 참조값 테스트와 경계 조건 테스트를 추가합니다.
- `stats.js`: percentile, mean.
- `pricing.js`: 단가 상수와 `costOf(arm, usage)`.
- 출력 표 3개:
  1. **속도**: arm별 p50/p90/mean, 배수(전체와 길이 그룹별), 네트워크 기준선
  2. **비용**: arm별 호출당 USD(캐시 할인 적용/미적용, 전체와 길이 그룹별), 1,000건 환산, 배수
  3. **ICC**: arm × 지표(총점, 항목별)별 ICC(1,1) [95% CI], ICC(1,k) [95% CI]. Jev는 연속·이산 두 줄
- 기존 raw 파일(`version: "old"|"new"`, usage 없음)도 읽을 수 있게 하위 호환합니다. 속도·비용 표는 "N/A"로 표시합니다.
- 결과를 콘솔 표와 함께 `icc/data/summary-<ts>.json`으로 저장합니다.

### Phase 6: 본 수집
- 본 수집: subjects=10, k=10, arms=`openai-old,openai-new,jev-new`, latency 모드.
- 선택 비교 실험 (필요할 때만):
  1. `openai-new-normalized`: 입력 전처리의 영향 분리 (§5.1)
  2. `openai-new`의 추론 강도를 low로 설정: 속도·비용 격차가 추론 설정에 얼마나 좌우되는지
- README 업데이트: 호출 수, 기본값, phase 2 실행 방법과 결과 요약.

---

## 7. raw 레코드 스키마 (v2)

```jsonc
{
  "schemaVersion": 2,
  "collectedAt": "...",
  "mode": "latency",
  "numSubjects": 10, "k": 10,
  "arms": ["openai-old", "openai-new", "jev-new"],
  "questionSetHash": { "jev-new": "sha256:..." },
  "networkBaselineMs": [/* 10개 */],
  "subjects": [{ "topic": "...", "jsonBytes": 9385, "messageCount": 37 }],
  "results": [
    {
      "subjectIdx": 0, "rep": 3, "arm": "jev-new",
      "provider": "typesafe", "model": "jev-1.13.0",   // 응답에 실린 실제 버전
      "requestId": "...",
      "startedAt": "ISO", "latencyMs": 182.4,          // 성공한 시도 1회
      "totalMs": 182.4, "attempts": 1,
      "usage": { "input_tokens": 0, "output_tokens": 0 /* OpenAI는 cached/reasoning 포함 */ },
      "output": { /* 파싱된 원본 응답 (Jev는 answers 전체) */ },
      "error": null
    }
  ]
}
```

---

## 8. 리스크와 해석상 주의

| 리스크 | 영향 | 대응 |
|--------|------|------|
| **한국어 입력** (Jev의 비주력 언어) | Jev의 ICC가 영어 데이터일 때보다 낮게 나올 수 있음 | 데이터 제약이므로 그대로 진행하고, 리포트에 "한국어 입력, 영어 질문" 조건을 명시 |
| Jev의 반복 변동이 거의 0 | ICC가 1이거나 1에 가깝게 나옴 | 경계 조건을 처리함(§4.3). ICC는 **일관성**만 나타내며 채점의 타당성은 이 벤치마크의 범위 밖이라는 점을 리포트에 명시 |
| 토론 길이 편차 (1.6KB ~ 20.7KB) | 평균 지연·비용이 긴 토론 3개에 끌려감 | 길이 그룹별 보고와 토론별 짝지은 배수(§4.1, §4.2) |
| subject 간 분산 부족 | 짧은 토론 7개가 비슷한 형식이라 점수가 비슷하면 ICC가 낮아짐(두 arm 공통) | CI를 반드시 표기함. 두 arm 모두 같은 토론을 쓰므로 상대 비교는 유효함 |
| 문자열 필드 부재 | OpenAI 출력과 기능이 완전히 같지는 않음 | 비교 범위를 점수로 한정했음을 리포트에 명시 |
| Score 기대값 보간의 한계 (jaggedness #2) | 연속 환산 점수의 절대값 해석이 부정확함 | 이산 환산을 병기함. 항목별 ICC는 선형 변환에 불변임 |
| 지연시간에 네트워크 영향 (한국 ↔ 미국 서부) | Jev는 모델 시간이 짧아서 네트워크 비중이 큼 | 네트워크 기준선을 따로 측정하고 측정 위치를 명시함 |
| OpenAI 프롬프트 캐시 | 반복 호출 비용이 과소 추정됨 | 캐시 할인 적용/미적용 비용을 둘 다 보고 |
| 모델 alias 변경 | 수집 도중 모델이 바뀔 수 있음 | 버전 고정 + 응답의 `model` 기록. 한 run에 버전이 섞이면 경고 |
| Rate limit (Jev 1,200 RPM, 변동 가능) | 수집 실패 | 순차 모드에서는 문제없음. throughput 모드는 동시성 상한을 둠 |
| 벤더 자체 수치의 편향 | 기대치 과장 | 본 벤치마크는 우리 데이터와 워크로드로 독립 측정함을 명시 |

---

## 9. 남은 결정 사항

- 없음. 캐시 쓰기 토큰은 `usage.input_tokens_details.cache_write_tokens`로 온다는 것을 Phase 0 호출에서 확인했습니다(§4.2).

---

## 10. 예상 호출량과 비용 규모

- 본 수집: 10 subjects × 10 reps × 3 arms = **300회**, 워밍업·기준선을 더하면 약 315회. 선택 비교 실험은 arm 1개당 100회씩 추가됩니다.
- 순차 실행이므로 총 소요 시간은 대부분 OpenAI 호출 시간이 차지합니다. Phase 2 드라이런의 지연시간으로 전체 소요 시간을 추정합니다.
- 호출당 비용 감 잡기 (가정: 입력 5,000 토큰, 캐시 없음, OpenAI 출력 2,000 토큰(추론 포함). 실제 값은 드라이런에서 확인):

  | arm | 계산 | 호출당 | 100회 |
  |-----|------|--------|-------|
  | `openai-new` | 5,000 × $0.20 + 2,000 × $1.20 (per 1M) | 약 $0.0034 | 약 $0.34 |
  | `jev-new` | 5,000 × $0.042 (per 1M) | 약 $0.00021 | 약 $0.021 |

  이 가정에서는 비용 배수가 약 16배입니다. 출력(추론) 토큰이 많을수록 배수가 커지고, 캐시 적중이 많을수록 작아집니다. 두 모델의 토크나이저가 달라 같은 토론이라도 입력 토큰 수가 다를 수 있습니다.
- 본 수집 전체(OpenAI 200회 + Jev 100회)는 위 가정으로 약 $0.7 수준입니다. Phase 2·3 드라이런의 실제 usage로 다시 추정합니다.

---

## 11. 산출물 체크리스트

- [x] `package.json` 의존성·스크립트
- [x] `icc/arms/{index,openai,jev,jev-state,jev-questions}.js`
- [x] `icc/{timing,stats,pricing}.js` (+ `scoring.js`, `http-agent.js`, `jev-probe.js`, `check-env.js`)
- [x] `icc/collect.js` 확장 (arms, mode, 기본 subjects=10, JSONL, resume, 네트워크 기준선)
- [x] `icc/icc-math.js` CI·경계 조건 추가 + 테스트
- [x] `icc/report.js` 확장 (속도·비용·ICC 표, 길이 그룹별 분석, 하위 호환, summary JSON)
- [x] README 업데이트 (결과 요약은 본 수집 후)

---

## 12. 구현 중 확인한 사항 (개정 2)

| 항목 | 내용 | 조치 |
|------|------|------|
| 캐시 쓰기 토큰 필드 | `usage.input_tokens_details.cache_write_tokens` | `pricing.js`가 이 필드를 씀. 필드가 없는 호출에만 [하한, 상한] 범위 표시 |
| `models.list()` | alias(`jev-latest`, `jev-preview`)만 나열되지만 `jev-1.13.0` 고정 요청은 정상 동작, 응답 `model`도 `jev-1.13.0` | 그대로 버전 고정 |
| 가장 긴 토론의 Jev 입력 | idx 2: `input_tokens` 17,197 (state 한도 32k 이내) | — |
| HTTP keep-alive | Node fetch(undici)는 유휴 연결을 4초 뒤 닫음. latency 모드에서 Jev 호출 사이에 OpenAI 호출(약 5초)이 끼면 Jev 호출마다 TLS 재연결이 생겨 p50이 약 260ms → 약 700ms로 부풀었음 | `icc/http-agent.js`로 전역 dispatcher의 keep-alive를 60초로 늘림 (두 SDK 공통). raw 헤더에 `keepAliveTimeoutMs` 기록 |
| `jsonBytes` 단위 | UTF-8 바이트라 §2 표(문자 수 기준)와 수치가 다름. 긴 토론 ≥15KB, 짧은 토론 ≈3KB | 리포트의 길이 그룹 경계를 8KB로 둠 |
| Jev 이산 점수 ICC | 거의 모든 토론이 같은 레벨에 몰린 항목은 subject 간 분산이 매우 작아, 한 토론이 경계에서 레벨을 오가기만 해도 이산 ICC가 크게 떨어짐 (드라이런 k=2: `opponent_rebuttal` 이산 0.05, 연속 0.995) | 연속·이산을 함께 보고하고 CI로 해석. §8 "subject 간 분산 부족" 리스크의 사례 |
| 질문 세트 | Phase 1 점검 결과 모든 항목 응답, 평균 confidence 0.72–0.91, 모든 항목이 토론 간 2개 이상의 레벨로 갈림. 짧은 토론 7개의 clarity/understanding 최상위·evidence 최하위 쏠림은 데이터 특성(수치·사례 없는 짧고 정중한 토론)으로 판단 | 질문 세트 확정 (`sha256:373af13d…`) |
