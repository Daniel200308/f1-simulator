# Project Pitwall 진행 현황

> 기준일: 2026-08-13 (Asia/Seoul)
> 기준 저장소: `Daniel200308/f1-simulator`
> 기준 작업 브랜치: `codex/race-weekend`
> 문서 목적: 현재 구현 범위와 완료 상태, 이번 변경분, 검증 결과, 브랜치 상태와 다음 작업을 한 곳에서 추적

## 1. 한눈에 보는 현재 상태

Project Pitwall은 **Silverstone·Monza·Suzuka 3라운드를 저장·복원하며 진행할 수 있는 미니 챔피언십 웹 게임** 단계입니다.

현재 한 세션에서 가능한 흐름은 다음과 같습니다.

```text
팀 선택
  → FP1 / FP2 / FP3 세팅과 디브리프
  → Q1 / Q2 / Q3 퀄리파잉
  → 스타트 타이어 선택
  → 5개 스타트 라이트와 22대 출발
  → 실시간 레이스 운영
  → 피트스톱·날씨·Safety Car·패널티 대응
  → 체커기·리플레이·Race Report
```

상태 요약:

| 영역 | 상태 | 설명 |
| --- | --- | --- |
| 단일 Silverstone 레이스 | 완료 | 52랩, 5.891km, 18코너 기반의 결정론적 레이스 진행 |
| 레이스 위크엔드 | 완료 | 팀 선택부터 FP1~FP3, Q1~Q3, 레이스까지 순차 진행 |
| 실시간 시뮬레이션 엔진 | 완료 | Web Worker, 100ms 고정 틱, 배속·일시정지·시드 재현 지원 |
| 레이스 운영 UI | 완료 | 리더보드, 트랙맵, 차량 상태, 커맨드, 전략, 라디오, 리포트 |
| 타이어·피트·날씨·열 모델 | 완료 | 타이어 재고, 피트 경로, 국지 날씨, 교차점, 4휠 열 상태 |
| FIA 스타일 Race Control·패널티 | 완료 | 플래그·중립화·조사·수행·결과 반영 상태 머신 |
| 브라우저 QA | 완료 | 주요 데스크톱 해상도 및 핵심 세션 흐름 확인 |
| 다중 서킷·미니 시즌 | 완료 | 3개 서킷, 포인트·countback, 다음 라운드와 시즌 완료 |
| 전체 게임 세이브 | 완료 | 스키마 v1, 자동/수동 저장, JSON 내보내기·가져오기 |
| 신뢰성·설명 가능한 AI | 완료 | 부품 마모·고장·그리드 드롭, AI 이유·성격 디버그 오버레이 |
| 오디오·온보딩·접근성 | 완료 | WebAudio 알림, 첫 위크엔드 가이드, 모션 감소·고대비 |
| 온라인·서버 저장·3D | 미구현 | 프로토타입 이후 범위 |

## 2. 이번 작업 브랜치에서 반영한 변경

기준 브랜치 `codex/race-weekend`에는 다음 범주의 변경이 누적되어 있습니다.

### 레이스 위크엔드와 팀 선택

- 11개 컨스트럭터와 22대 그리드를 선택 화면에서 표시합니다.
- 선택한 팀의 두 드라이버에게만 직접 명령 권한을 부여합니다.
- 기본 팀은 Ferrari이며 Charles Leclerc와 Lewis Hamilton을 기본 제어 드라이버로 사용합니다.
- Weekend Hub에서 FP1·FP2·FP3를 순서대로 진행하고 각 세션의 결과·디브리프·차량 상태를 확인합니다.
- Q1·Q2·Q3의 시간, 탈락선, 이전 세션 랩타임 삭제, 최종 그리드 생성을 구현했습니다.
- 기본 세팅만으로 플레이어 팀이 자동으로 프런트 로우를 차지하지 않도록 팀 성능과 세팅 손실을 반영합니다.

### 레이스 HUD와 트랙맵

- 22대의 순위·간격·상태·타이어를 보여주는 리더보드와 중앙 트랙맵을 연결했습니다.
- 트랙 플래그가 바뀔 때만 HUD가 짧게 점멸하고, 이후 해당 상태 색을 유지합니다.
- Race Control 피드는 공지 유무와 상관없이 고정된 위치에 유지됩니다.
- 1280×720을 포함한 데스크톱 화면에서 주요 운영 패널이 스크롤 없이 보이도록 조정했습니다.
- 트랙맵 차량 인디케이터에 공격·방어·충전 상태와 공력 윙 상태를 반영했습니다.
- Active Aero의 Corner·Straight·Partial 상태를 표시하고, 주행 중 전환 애니메이션을 보강했습니다.

### 드라이버 명령과 시뮬레이션 연결

- Pace: Attack, Push, Standard, Conserve, Cool
- Energy: Attack, Balanced, Defend, Recharge
- Tyre: Grip, Balanced, Save, Temperature
- Cooling: Normal, Lift & Coast, Max Cooling
- Next Tyre: Soft, Medium, Hard, Intermediate, Wet

각 명령은 랩타임·연료·타이어 마모·에너지·브레이크 및 파워유닛 열 상태에 연결됩니다. UI에서 선택한 드라이버와 팀 권한은 Worker 프로토콜을 통해 엔진에 전달됩니다.

### 타이어·피트레인

- 차량별 타이어 세트 재고를 Fresh, Available, Reserved, Fitted, Used로 관리합니다.
- 새 타이어뿐 아니라 사용한 컴파운드 재사용과 스틴트 기록을 관리합니다.
- 피트 진입·정차·타이어 교체·출구까지 피트 시간을 분리 계측합니다.
- 팀 동료의 같은 랩 예약과 피트 크루 상태를 반영한 더블 스택 위험을 계산합니다.
- 피트레인 경로와 제한 속도, 피트 진입·이탈 이벤트를 별도 테스트로 검증합니다.
- 예약 취소, Stay Out, 다음 장착 타이어 선택을 지원합니다.

### 날씨·열·에너지·전투

- 트랙 위치별 강수량·노면 수분·건조 라인과 섹터별 로컬 서피스를 계산합니다.
- AI가 드라이·인터미디어트·웻 교차점을 판단하고, 플레이어 팀에는 최종 판단을 남기는 엔지니어 콜을 보냅니다.
- 타이어 4개, 브레이크 4개, 파워유닛, 기어박스, 에너지 스토어의 열 상태를 추적합니다.
- ERS 충전·공격·방어와 배터리 지속성을 레이스 전략에 반영합니다.
- Attack·Defend·Harvest·Hold 전투 상태, 더티 에어, 접근 속도, 추월 안정화 시간을 계산합니다.
- 같은 차량 쌍의 중복 추월 기록을 막고, 스타트 직후 단순 재정렬을 추월 통계에서 제외합니다.

### 전략·라디오·결과

- Box Now, Stay Out, Undercut, Overcut을 예상 레이스 타임·피트 손실·재합류 순위로 비교합니다.
- Safety Car, VSC, 날씨, 더블 스택, 트래픽과 열 위험을 전략 추천에 반영합니다.
- 팀의 두 드라이버 라디오를 하나의 팀 채널에 통합하고, 드라이버 감각과 엔지니어 분석을 분리합니다.
- Race Control 공지는 팀 라디오와 분리된 상단 중앙 피드로 표시합니다.
- 경기 중 잠정 리포트와 체커기 이후 최종 Race Report를 생성합니다.
- 최종 순위, 패스티스트 랩, 추월, 피트스톱, 피트 이슈, 사고, 열 경고와 타이어 전략을 집계합니다.

## 3. 구현 완료 시스템 목록

### 코어 구조

- Next.js 16 / React 19 / TypeScript 5 기반 앱 셸
- Zustand 기반 UI 상태 저장소
- Web Worker 기반 레이스 엔진
- 100ms 고정 타임스텝과 결정론적 난수 시드
- 엔진 상태 해시·틱·스냅샷 추적
- UI와 Worker 사이의 명시적 프로토콜

### 시뮬레이션 모듈

| 모듈 | 역할 |
| --- | --- |
| `src/simulation/engine.ts` | 전체 레이스 틱과 시스템 통합 |
| `src/simulation/weekend.ts` | 연습·예선·레이스 주말 상태 |
| `src/simulation/track.ts` | Silverstone 지오메트리와 코너 |
| `src/simulation/silverstone-telemetry.ts` | 거리·속도 프로파일 |
| `src/simulation/weather.ts` | 강수·노면 수분·건조 라인 |
| `src/simulation/thermal-management.ts` | 타이어·브레이크·파워트레인 열 |
| `src/simulation/energy/` | 에너지 저장·예측·배치·메시지 |
| `src/simulation/racecraft.ts` | 공격·방어·추월·더티 에어 |
| `src/simulation/ai-strategy.ts` | AI 타이어·피트 전략 |
| `src/simulation/strategy-intelligence.ts` | 시나리오 비교와 추천 |
| `src/simulation/live-strategy.ts` | 실시간 전략 업데이트 |
| `src/simulation/pit-operations.ts` | 피트 예상·재고·이슈 |
| `src/simulation/pit-lane.ts` | 피트레인 경로·속도·구간 |
| `src/simulation/race-control.ts` | Yellow·VSC·Safety Car 상태 |
| `src/simulation/stewarding.ts` | 위반 조사와 패널티 수행 |
| `src/simulation/race-replay.ts` | 리플레이용 이벤트·스냅샷 |
| `src/simulation/race-report.ts` | 경기 결과·분석 리포트 |

### UI 주요 구성

- `src/components/race/team-selection.tsx`: 팀 선택
- `src/components/race/weekend-hub.tsx`: 주말 세션 진행과 디브리프
- `src/components/race/race-shell.tsx`: 전체 레이스 화면 조립
- `src/components/race/race-map.tsx`: 트랙·차량·플래그·윙 표시
- `src/components/race/command-dock.tsx`: 드라이버 명령
- `src/components/race/timing-tower.tsx`: 리더보드
- `src/components/race/strategy-intelligence-panel.tsx`: 전략 비교
- `src/components/race/energy-telemetry.tsx`: 에너지 상태
- `src/components/race/tyre-temperature-car.tsx`: 4휠 타이어·열 상태
- `src/components/race/replay-report-panel.tsx`: 리플레이·Race Report
- `src/components/race/team-radio-overlay.tsx`: 팀 라디오

## 4. 검증 결과

2026-08-01 현재 작업 트리에서 다음 명령을 실행했습니다.

| 검증 | 결과 | 비고 |
| --- | --- | --- |
| `git diff --check` | 통과 | 공백·패치 오류 없음 |
| `npm run typecheck` | 통과 | TypeScript 오류 없음 |
| `npm run lint` | 통과 | 오류 0개, 기존 경고 2개 |
| `npm test -- --reporter=dot` | 통과 | 52개 파일, 428개 테스트 통과; 1개 파일·1개 테스트 스킵 |
| 브라우저/화면 QA | 통과 기록 보유 | `qa/` 아래 세션별 결과·스크린샷 보관 |

현재 린트 경고:

- `qa/qualifying-responsive-audit.mjs:36`: `label` 미사용
- `src/simulation/engine.ts:2904`: `reserved` 값 미사용

두 항목은 테스트 실패나 빌드 실패를 일으키지 않지만, 다음 정리 작업에서 제거하거나 실제 검증 로직에 연결하는 것이 좋습니다.

## 5. 브랜치별 Git 감사

점검 기준은 로컬 브랜치와 `origin`의 upstream 비교입니다.

| 브랜치 | 최신 커밋 | 원격 상태 | 역할 |
| --- | --- | --- | --- |
| `main` | `444c4dc` | 동기화 | 기본 기준선 |
| `develop` | `444c4dc` | 동기화 | 개발 기준선 |
| `codex/next-development` | `444c4dc` | 동기화 | 초기 개발 기준선 |
| `codex/race-weekend` | 최신 커밋 | 동기화 | 이번 변경의 주 브랜치 |
| `codex/thermal-management-gameplay` | `98638b3` | 동기화 | 현재 시스템 문서화 |
| `codex/product-design-telemetry-ui` | `693bf9a` | 동기화 | 라이브 텔레메트리 UI |
| `codex/live-strategy-driver-controls` | `e533b54` | 동기화 | 전략·4휠 텔레메트리 |
| `codex/race-control-procedures` | `9869cc3` | 동기화 | Race Control·패널티 |
| `codex/spatial-weather-surface` | `2ac7fb2` | 동기화 | 공간 날씨·타이어 교차점 |
| `codex/command-infographics` | `4694d0f` | 동기화 | 드라이버 커맨드 인포그래픽 |
| `codex/ai-strategy-model` | `ba0125c` | 동기화 | AI 전략 모델 시작점 |
| `codex/broadcast-responsive-ui` | `9f3da91` | 동기화 | 브로드캐스트 HUD·반응형 |
| `codex/tyre-pit-inventory` | `61a773b` | 동기화 | 타이어 재고·가변 피트 |
| `codex/ui-leaderboard-controls` | `9c43475` | 동기화 | 리더보드·드라이버 제어 |
| `codex/battle-energy` | `8543f8b` | 동기화 | 전투·에너지 시스템 |
| `codex/f1-2026/tyre` | `444c4dc` | upstream 없음 | 로컬 전용 기준선, 미푸시 커밋 없음 |

감사 결과:

- 현재 작업 브랜치 외에는 미커밋 변경을 확인할 수 있는 별도 worktree가 없으므로, 브랜치별 미커밋 상태는 현재 checkout 기준으로 점검했습니다.
- upstream이 연결된 모든 브랜치는 로컬 커밋과 `origin`이 일치했습니다.
- `codex/f1-2026/tyre`는 upstream이 없지만 `main`과 같은 커밋이며, 추가 로컬 커밋은 없습니다.
- 기능 브랜치들은 원격에 존재하지만 모두 `main`에 자동 병합된 것은 아닙니다. 이번 작업은 현재 checkout인 `codex/race-weekend`에 커밋·푸시했습니다.

## 6. 이번 로드맵에서 새로 완료한 범위

- 서킷 데이터를 Silverstone·Monza·Suzuka 공통 레지스트리로 분리하고 엔진·위크엔드·맵·피트·에너지 시스템이 현재 라운드 정의를 사용하도록 통합
- 드라이버·컨스트럭터 포인트, 패스티스트 랩, countback과 3라운드 진행을 포함한 챔피언십 허브
- 레이스 스냅샷, 위크엔드, 챔피언십, 타이어 재고와 신뢰성을 한 번에 저장하는 전체 게임 세이브
- 부품 마모·정비·성능 저하·결정론적 기계 고장·부품 교체 그리드 페널티
- AI 성격·목표·타깃·판단 근거·신뢰도와 플레이어 자동 ERS를 확인하는 개발 오버레이
- WebAudio 이벤트 알림, 첫 위크엔드 가이드, 모션 감소·고대비와 UI 설정 저장

## 7. 아직 구현되지 않은 범위

### 제품 기능

- 팀 재정, 연구개발, 시설, 계약, 직원과 장기 커리어
- 온라인 멀티플레이와 서버 저장
- 실제 음성 팩과 공간 음향, 3D 레이스 화면
- 3라운드를 넘어선 전체 시즌 캘린더와 장기 계약·이적

### 품질·기술 부채

- 브라우저 E2E 흐름을 CI에서 자동 실행하는 파이프라인
- 긴 세션에서 Worker 메모리와 렌더링 성능 프로파일링
- 시스템별 밸런스 데이터와 공식 규정 데이터의 버전 관리 UI
- UI 문자열 및 콘텐츠 팩 분리
- 이전 스키마가 추가될 때의 실제 장기 세이브 마이그레이션 표본

## 8. 권장 다음 개발 순서

1. **CI 브라우저 회귀**: 이번 QA 인벤토리의 핵심 경로와 뷰포트를 자동 실행합니다.
2. **밸런스 텔레메트리**: 3개 서킷 완주 결과를 수집해 추월·피트·고장·날씨 확률을 교정합니다.
3. **팀 운영 메타게임**: 예산·시설·직원·개발을 성능과 신뢰성에 연결합니다.
4. **전체 시즌 콘텐츠**: 추가 서킷, 시즌 캘린더, 계약·이적과 장기 부품 풀을 추가합니다.
5. **음성·중계 확장**: 상황별 실제 음성 팩과 공간 음향, 하이라이트 연출을 연결합니다.

## 9. 실행과 검증 명령

```bash
npm install
npm run dev

npm run typecheck
npm run lint
npm test
npm run build
```

브라우저에서 `http://127.0.0.1:3000`을 열면 플레이할 수 있습니다. 상세 설계 원칙과 규정 데이터 계층은 [`F1_2026_GAME_DESIGN.md`](./F1_2026_GAME_DESIGN.md), 제3자 자료 고지는 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)에서 확인할 수 있습니다.
