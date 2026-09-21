# debate-judge-test

## 본 실행 (기본값: subjects=3, k=10, 총 60회 호출)
node icc/collect.js

## 특정 값으로 조정하고 싶으면
SUBJECTS=3 K=10 node icc/collect.js

## 결과 리포트 (가장 최근 raw-*.json 자동 사용)
node icc/report.js
