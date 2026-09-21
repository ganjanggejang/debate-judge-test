// 측정용 HTTP 연결 설정.
//
// Node 내장 fetch(undici)는 유휴 연결을 4초 뒤에 닫는다. latency 모드에서는 Jev 호출 사이에
// OpenAI 호출(약 5초)이 끼므로, 기본값이면 Jev 호출마다 미국 서부까지 TLS 연결을 새로 맺게 되고
// 그 비용(약 300ms)이 Jev 지연시간의 절반 이상을 차지한다. 트래픽이 꾸준한 운영 서버에서는
// 연결이 재사용되므로, 두 SDK가 모두 쓰는 전역 dispatcher의 유휴 시간을 늘려 연결을 유지한다.
// (서버가 먼저 연결을 닫으면 재연결되며, 그 경우는 워밍업이 아닌 한 측정값에 그대로 남는다.)

import { Agent, setGlobalDispatcher } from "undici";

export const KEEP_ALIVE_TIMEOUT_MS = 60_000;

setGlobalDispatcher(
    new Agent({ keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS, keepAliveMaxTimeout: 10 * 60_000 })
);
