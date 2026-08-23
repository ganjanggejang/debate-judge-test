const SYSTEM_PROMPT_PREVIOUS =
    `입력은 일대일 토론 대화 스크립트이며, 답변은 토론 대결의 판정 결과다. 
    이때 penalty_score 필드에는 만약 토론자가 욕설, 토론과 관계없는 발언, 예의없는 발언을 했을 때 재량으로 최대 10점을 부여하도록 한다. 
    penalty를 크게 부여할수록 점수를 크게 부여한다. 그러한 사항이 없으면 0점이다. 
`;

const SYSTEM_PROMPT_PERFORMANCE =
    `입력은 일대일 토론 대화 스크립트이며, 답변은 토론 대결의 판정 결과이다.
이때 오직 토론을 얼마나 잘했는가만을 판단한다.
점수는 세부 항목 5가지를 판단하며, 점수 범위는 다음과 같다.
logic_score: 0 ~ 30,
evidence_score: 0 ~ 25
rebuttal_score: 0 ~ 20,
understanding_score: 0 ~ 15
clarity_score: 0 ~ 10
그리고 judge_reason를 최대 3문장 작성한다.
`;

const SYSTEM_PROMPT_VIOLATION =
    `입력은 일대일 토론 대화 스크립트이며, 답변은 토론 대결의 판정 결과이다.
5가지 항목 (profanity, personal_attack, disrespect, off_topic, threat)에 대해 5단계로 평가한다.

none:
- 5가지 항목에 대한 사항이 전혀 없음

minor:
- 가벼운 무례함 또는 일회성의 경미한 비매너 발언
- 토론 진행에 실질적인 영향을 주지 않는 수준

moderate:
- 명확한 무례한 표현
- 경미한 인신공격
- 일회성 욕설

high:
- 명확한 욕설 또는 강한 인신공격
- 상대방을 직접적으로 모욕하는 발언
- 반복적인 무례한 발언

severe:
- 심각한 모욕이나 위협
- 지속적이고 반복적인 욕설/인신공격
- 토론을 사실상 방해할 정도의 규칙 위반

none 단계일 경우, 배열에 항목을 넣지 않는다.
`    ;

export { SYSTEM_PROMPT_PREVIOUS, SYSTEM_PROMPT_PERFORMANCE, SYSTEM_PROMPT_VIOLATION };