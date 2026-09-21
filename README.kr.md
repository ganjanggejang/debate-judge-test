# debate-judge-test

**한국어** | [English](README.md)

같은 토론 스크립트를 LLM이 여러 번 채점했을 때 점수가 얼마나 일관되는지를 재고,
OpenAI Structured Output 채점기와 TypeSafe Jev 채점기의 **속도·비용·일관성**을 비교합니다.

- 설계와 해석 주의사항은 `docs/JEV_BENCHMARK_PLAN.md`를 보세요.

- 9/21에 예시 데이터로 테스트한 결과 레포트는 `docs/JEV_BENCHMARK_RESULTS.kr.md`를 보세요.

## 준비

Node 20 이상이 필요합니다.

```
npm install
```

`.env`에 API 키를 넣습니다 (`.env`는 gitignore 대상).

```
OPENAI_API_KEY=...
TYPESAFE_API_KEY=...
```

키와 모델 접근 권한 확인 (각 SDK로 최소 호출 1회):

```
npm run check-env
```

토론 데이터 10개를 프로젝트 루트 디렉토리에 json 파일로 저장합니다 (이 레포에서는 데이터를 제공하지 않음).

## 채점기 (arm)

| arm                            | 채점기                                                            | 출력                 |
| ------------------------------ | ----------------------------------------------------------------- | -------------------- |
| `openai-new`                   | `gpt-5.6-luna` + `SYSTEM_PROMPT_PERFORMANCE` (개선 버전)          | 세부 항목 5개        |
| `jev-new`                      | `jev-1.13.0`, Score 질문 10개(참가자 2명 × 항목 5개)를 요청 1회로 | 항목별 레벨 확률분포 |
| `openai-new-normalized` (선택) | `openai-new`에 Jev와 같은 전처리 state 입력                       | 세부 항목 5개        |
| `openai-new-low` (선택)        | `openai-new`의 추론 강도 low                                      | 세부 항목 5개        |

Jev 질문 세트는 `icc/arms/jev-questions.js`에 있습니다. 질문을 고치면 해시가 바뀌어 raw에 기록됩니다.
질문을 고친 뒤에는 벤치마크를 수집하기 전에 점검 스크립트로 레벨 분포와 confidence를 확인하세요.

```
node --env-file=.env icc/jev-probe.js        # 토론 10개에 1회씩, 저장하지 않음
```

## 수집

기본값: arms=`openai-new,jev-new`, subjects=10(seed 전체), k=10, latency 모드
→ 총 **200회** 호출.

```
npm run collect
```

- `latency` 모드(기본): 동시성 1로 순차 호출합니다. 같은 (토론, 반복) 안에서 arm 순서를 돌려가며 호출하고,
  arm마다 워밍업 1회를 버립니다. 시작할 때 Jev 초소형 요청으로 네트워크 기준선을 잽니다.
- `throughput` 모드: 동시성 N으로 호출해서 전체 소요 시간과 초당 호출 수를 잽니다.

```
npm run collect -- --arms openai-new,jev-new --subjects 1 --k 2      # 드라이런
npm run collect -- --mode throughput --concurrency 4
SUBJECTS=3 K=5 ARMS=jev-new npm run collect                          # 환경변수로도 지정 가능
```

결과는 `icc/data/raw-<ts>.jsonl`에 한 줄씩 기록되고, 끝나면 `raw-<ts>.json`으로 합쳐집니다.
도중에 끊기거나 실패한 호출이 남으면 이어서 수집합니다 (성공한 호출은 건너뜀):

```
npm run collect -- --resume                              # 가장 최근 jsonl
npm run collect -- --resume icc/data/raw-171234.jsonl
```

## 리포트

가장 최근 raw 파일을 자동으로 씁니다 (수집 중이면 jsonl도 읽음). 기존 v1 raw 파일도 읽을 수 있고,
이 경우 속도·비용은 N/A로 표시됩니다.

```
npm run report
npm run report -- icc/data/raw-171234.json
```

출력 표:

1. **속도**: arm별 지연시간 mean/p50/p90/p99 (전체, 긴 토론, 짧은 토론), 속도 배수(OpenAI p50 / Jev p50),
   토론별 짝지은 배수, 네트워크 기준선
2. **비용**: 호출당 USD (실제 캐시 상태 / 캐시 없음 가정), 1,000건 환산, 토큰·비용 항목별 분해, 비용 배수.
   단가는 `icc/pricing.js`에 있고 리포트 단계에서 적용합니다.
3. **일관성 (ICC)**: arm × 지표(총점, 항목별)별 ICC(1,1)·ICC(1,k)와 95% 신뢰구간. Jev는 연속(기대값)·이산(argmax) 두 가지
4. **Jev 응답 진단**: 질문별 confidence와 argmax 레벨 분포

요약은 `icc/data/summary-<ts>.json`으로도 저장됩니다.

## 결과 요약 (2026-09-21, `raw-1789970405493.json`)

조건: 토론 10개(한국어) × k=10, 채점기별 100회, latency 모드, 한국에서 측정. Jev 질문·레벨은 영어.

| 지표                          | `openai-new`     | `jev-new`                                      |
| ----------------------------- | ---------------- | ---------------------------------------------- |
| 지연시간 p50 / p90            | 5,034 / 7,461 ms | **284 / 618 ms**                               |
| 호출당 비용 (캐시 없음 가정)  | $0.00107         | **$0.00025**                                   |
| 호출당 비용 (실제 캐시 상태)  | $0.00069         | $0.00025                                       |
| 총점 ICC(1,1) host / opponent | 0.719 / 0.786    | **0.999 / 0.999** (연속), 0.997 / 0.982 (이산) |

- **속도**: Jev가 `openai-new`보다 p50 기준 약 18배(토론별 15~20배) 빠릅니다. Jev 지연시간의 대부분(기준선 p50 259ms)은
  한국 ↔ 미국 서부 네트워크 왕복입니다.
- **비용**: 캐시가 없다고 가정하면 약 4.2배 쌉니다. 같은 입력을 반복 호출해 OpenAI 프롬프트 캐시가 적중한 실제 상태에서는
  약 2.7배이고, 긴 토론만 보면 1.6배입니다. Jev 입력 토큰이 OpenAI보다 많은데(평균 6,052 vs 2,728), 한국어 토큰화 차이와
  Score 질문 10개의 문구가 입력에 포함되기 때문으로 보입니다. OpenAI 비용의 약 75%는 출력(추론 포함) 토큰입니다.
- **일관성**: Jev 연속 점수는 모든 항목에서 ICC(1,1) ≥ 0.995입니다. 이산(argmax) 점수는 대부분 1이지만, 거의 모든 토론이
  한 레벨에 몰린 항목(`opponent_rebuttal` 0.691, `host_understanding` 0.846)에서는 경계에 있는 토론 하나가 레벨을 오가기만 해도
  값이 떨어집니다. ICC는 **일관성**만 나타내며 채점이 타당한지는 이 벤치마크의 범위 밖입니다.

토론별 점수 분포, 반복 간 승자 변화, 채점기 간 승자 비교는 `docs/JEV_BENCHMARK_RESULTS.md`에 있습니다.
같은 표는 `npm run analyze`로 raw 파일에서 다시 만들 수 있습니다 (API 호출 없음).

## 테스트

```
npm test
```
