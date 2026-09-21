// Jev에 넘길 state 전처리 (JEV_BENCHMARK_PLAN.md §5.1).
//
// Jev는 간접 참조(indirection)에 약하므로, 이메일을 해당 토론의 역할 라벨
// ("host" | "opponent")로 바꿔서 질문이 발언자를 이름으로 직접 지목할 수 있게 한다.
// 발언 본문은 한국어 원문 그대로 둔다.

export function toJevState(debate) {
    return {
        topic: debate.communityTopic,
        messages: debate.messages.map((m) => ({
            turn: m.turn,
            speaker: speakerOf(debate, m.email),
            body: m.body,
        })),
    };
}

function speakerOf(debate, email) {
    if (email === debate.hostEmail) return "host";
    if (email === debate.opponentEmail) return "opponent";
    throw new Error(
        `토론 "${debate.communityTopic}"에 host/opponent 어느 쪽도 아닌 발언자가 있습니다: ${email}`
    );
}
