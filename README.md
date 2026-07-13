# Project Pitwall

Project Pitwall은 실버스톤 그랑프리를 배경으로 한 실시간 Formula 1 레이스 운영 시뮬레이션 게임입니다. 플레이어는 Mercedes의 두 드라이버를 지휘하며 페이스, 에너지, 타이어, 냉각, 브레이크 밸런스와 피트 전략을 관리합니다.

현재 버전은 시작 타이어 선택과 스타트 절차부터 52랩 완주, 경기 중 전략 판단, 피트스톱, 리플레이와 경기 결과 분석까지 한 레이스를 처음부터 끝까지 플레이할 수 있는 단계입니다.

> 이 프로젝트는 비공식 게임 프로토타입이며 Formula 1, FIA 또는 각 팀과 제휴·승인된 제품이 아닙니다.

## 빠른 시작

### 요구 환경

- Node.js 20 이상 권장
- npm
- 최신 Chrome, Edge 또는 Safari

### 실행

```bash
npm install
npm run dev
```

브라우저에서 [http://127.0.0.1:3000](http://127.0.0.1:3000)을 엽니다.

프로덕션 빌드는 다음과 같이 확인할 수 있습니다.

```bash
npm run build
npm run start
```

## 현재 게임 진행 흐름

1. 시작 화면에서 두 Mercedes 드라이버의 스타트 타이어를 선택합니다.
2. 레이스를 시작하면 트랙 상단의 5개 빨간불이 순서대로 켜진 뒤 소등됩니다.
3. 레이스 중 Leader Board 또는 Driver Control에서 관리할 드라이버를 선택합니다.
4. 페이스, 에너지, 타이어 관리, 냉각, 브레이크 밸런스를 실시간으로 조정합니다.
5. Strategy Intelligence의 시나리오와 피트 예상치를 참고해 다음 타이어와 피트 타이밍을 결정합니다.
6. 옐로 플래그, VSC, Safety Car, 날씨 변화, 차량 열 상태와 트래픽에 대응합니다.
7. 레이스가 끝나면 리플레이와 Race Report에서 결과, 추월, 피트스톱, 사고, 열 경고와 타이어 전략을 검토합니다.

## 구현된 기능

### 실제 기반 그리드와 Silverstone

- 11개 팀, 22명의 2026 드라이버 그리드
- 드라이버 실명, 차량 번호, 3글자 약어, 팀 컬러 적용
- Silverstone Circuit: 5.891 km, 52랩, 18개 코너
- OpenStreetMap 기반의 곡선형 단일 센터라인
- 화면 비율이 달라져도 차량이 같은 트랙 경로 위를 주행하도록 거리 기반 좌표 보간
- 각 차량을 팀 컬러 원과 3글자 드라이버 이름으로 표시
- 실버스톤 실제 1랩 텔레메트리 CSV의 거리·속도 프로파일을 기준으로 구간 목표 속도 구성

### 실시간 레이스 시뮬레이션

- Web Worker에서 실행되는 100ms 고정 타임스텝 엔진
- 동일한 시드와 명령 입력에 동일한 결과를 내는 결정론적 시뮬레이션
- 일시정지 및 1x, 2x, 4x, 8x, 16x 배속
- 1초마다 소수점 셋째 자리까지 갱신되는 앞차와의 간격
- 연료량, 타이어 성능, 차량 상태, 트래픽, 날씨, 드라이버 모드와 열 상태를 반영한 랩타임
- 주요 사고와 Race Control 이벤트 발생 시 자동 일시정지
- 상태 해시, 시드, 틱과 스냅샷 수 표시로 시뮬레이션 상태 추적

### 레이스 방송형 UI

- 100% 브라우저 배율과 데스크톱 화면에 맞춘 반응형 레이아웃
- 세션, 현재 랩, 경과 시간, 트랙 상태, 노면·기온, 날씨를 아이콘과 인포그래픽으로 표현한 상단 바
- 22대의 순위, 앞차 간격, 상태와 현재 타이어를 한눈에 보여주는 Leader Board
- 실제 F1 표기 방식에 가까운 타이어 컴파운드 원형 배지
- 트랙 위 로컬 노면 상태, 코너 번호, 스타트 라이트, 차량 위치 표시
- 웻 상황에서도 트랙 배경 디자인은 유지하며 노면 정보만 상태값으로 반영
- 1280×720을 포함한 주요 데스크톱 해상도에서 스크롤 없이 사용하도록 조정

### Driver Control

Driver Control 제목 영역에서 드라이버를 바로 전환할 수 있으며, 플레이어 팀 차량만 직접 지휘할 수 있습니다.

| 영역 | 선택 항목 | 주요 영향 |
| --- | --- | --- |
| Pace | Attack, Push, Standard, Conserve, Cool | 랩타임, 연료, 타이어 마모와 열 발생 |
| Energy | Attack, Balanced, Defend, Recharge | ERS 사용·회수와 공격·방어 성능 |
| Tyre | Grip, Balanced, Save, Temperature | 접지력, 수명과 타이어 온도 |
| Cooling | Normal, Lift & Coast, Max Cooling | 속도 손실과 파워유닛·브레이크 냉각 |
| Brake Bias | 50–64% | 전후 브레이크 온도 분포와 제동 안정성 |
| Next Tyre | Soft, Medium, Hard, Intermediate, Wet | 다음 피트스톱 장착 타이어 예약 |

트랙 차량 인디케이터는 Attack일 때 빨간색, Defend일 때 파란색, Recharge일 때 초록색 상태 링을 표시하며 Balanced에서는 추가 링을 표시하지 않습니다.

### 차량 열 관리

- 차량 인포그래픽 위에 앞·뒤, 좌·우 4개 타이어 온도를 각각 표시
- 4개 브레이크 온도와 파워유닛, 기어박스, 에너지 스토어 온도 추적
- 날씨, 노면 수분, 구간 특성, 하중, 주행 모드, 냉각 설정과 브레이크 밸런스가 온도 변화에 반영
- 타이어별 적정 온도 범위, 열 스트레스, 출력 저하와 신뢰성 위험 계산
- 상태 색상, 게이지와 경고 문구로 숫자만 보지 않고 위험도를 판단할 수 있는 UI
- 열 위험에 대응할 수 있는 Cool, Recharge, Lift & Coast, Max Cooling 명령

### Strategy Intelligence 3.0

- Box Now, Stay Out, Undercut, Overcut 시나리오 비교
- 각 시나리오의 예상 레이스 타임, 피트 손실, 재합류 순위와 트래픽 계산
- 타이어 성능 교차점, 날씨 변화, Safety Car, 더블 스택과 차량 열 위험 반영
- 추천 전략의 근거와 신뢰도 표시
- 1랩째 정상적인 드라이 조건에서 불필요한 피트 추천을 억제하고 긴급 상황만 예외 처리
- 전략 타임라인에서 예상 피트 윈도우와 언더컷 기회를 표시

### Racecraft AI 2.0

- Attack, Defend, Harvest, Hold 전투 상태
- 공격 대상과 방어 위협, 추월·방어 확률, 접근 속도, 더티 에어 계산
- 3초 뒤 예상 간격과 즉시 적용 가능한 전투 프리셋
- AI 판단을 초당 2회 갱신해 성능과 반응성을 균형 있게 유지
- 최소 2.5초 동안 순위와 간격이 안정된 경우에만 추월로 확정
- 스타트 직후 단순 순위 재정렬은 추월 통계에서 제외
- 상대별 쿨다운으로 같은 두 차량의 중복 추월 기록 방지

### Pit Stop Operations 2.0

- 차량별·정차 횟수별로 안정적으로 유지되는 피트 예상치
- 정차 시간, 총 피트 손실, 피트 크루 준비 상태, 타이어 세트와 피트 트래픽 표시
- 팀 동료가 같은 랩에 예약된 경우까지 포함한 더블 스택 위험 계산
- Slow Release, Wheel Gun, Double Stack 이슈와 실제 정차 결과 반영
- 차량별 타이어 세트 재고와 Fresh, Available, Reserved, Fitted, Used 상태 관리
- 새 타이어뿐 아니라 사용한 컴파운드 재사용까지 스틴트 기록에 반영
- 예약 취소와 Stay Out 명령 지원

### 날씨와 Race Control

- 트랙 위치별 강수량, 노면 수분, 건조 라인과 섹터별 로컬 서피스
- 현재 조건과 단기 예보를 활용한 드라이·인터미디어트·웻 타이어 판단
- Yellow, VSC, Safety Car 단계와 피트레인 상태
- 물리적인 Safety Car 위치, 대열 순서와 델타 관리
- 사고, 중립화 발령·해제와 재시작 이벤트 기록
- Safety Car 또는 VSC 상황의 줄어든 피트 손실을 전략 계산에 반영

### Replay와 Race Report

- 메모리 사용을 제한하는 프레임 압축형 리플레이 기록
- 0.5x, 1x, 2x, 4x 재생, 타임라인 탐색과 주요 이벤트 마커
- 경기 중에는 현재 선두 기준의 잠정 리포트, 완주 후에는 최종 우승자 기준 리포트 생성
- 최종 순위, 패스티스트 랩, 추월, 피트스톱과 피트 이슈 집계
- 사고, 열 경고, 타이어 전략과 플레이어 드라이버 디브리프
- 리셋 시 이전 경기의 스냅샷과 이벤트가 새 세션에 섞이지 않도록 수명주기 보호

## 주요 화면과 조작

- **Leader Board**: 드라이버를 선택하고 순위, 앞차 간격, 상태와 타이어를 확인합니다.
- **Race Operations**: 레이스 컨트롤, 차량 열 관리, 피트 운영과 타이어 재고를 확인합니다.
- **Strategy**: 전략 시나리오를 비교하고 추천 피트 계획을 적용합니다.
- **Replay / Report**: 레이스 타임라인을 되돌려 보고 경기 결과를 분석합니다.
- **상단 재생 컨트롤**: 레이스를 일시정지·재개하고 시뮬레이션 배속을 변경합니다.
- **Escape**: 열린 운영 패널을 닫고 이전 포커스로 돌아갑니다.

Race Operations, Strategy, Replay / Report 패널은 키보드 포커스 트랩과 포커스 복귀를 지원합니다.

## 프로젝트 구조

```text
src/
├── app/                    Next.js 진입점과 전역 스타일
├── components/race/        트랙, 상단 바, Leader Board, 제어·전략·리포트 UI
├── domain/                 레이스 상태와 명령 타입
├── fixtures/               22명 드라이버와 11개 팀 그리드 데이터
├── hooks/                  Worker 통신과 UI용 React 훅
├── simulation/             레이스 엔진과 각 시뮬레이션 시스템
├── store/                  UI와 Worker 사이의 상태 관리
└── workers/                레이스 Web Worker
```

주요 시뮬레이션 모듈:

- `engine.ts`: 고정 타임스텝 레이스 엔진과 시스템 통합
- `track.ts`, `silverstone-telemetry.ts`: 트랙 지오메트리와 속도 프로파일
- `thermal-management.ts`: 타이어·브레이크·파워트레인 열 모델
- `weather.ts`, `race-control.ts`: 날씨, 노면과 중립화 상태
- `strategy-intelligence.ts`, `live-strategy.ts`: 전략 시나리오와 실시간 추천
- `racecraft.ts`: 공격·방어와 추월 판정
- `pit-operations.ts`: 피트 예상, 재고와 실제 피트 이벤트
- `race-replay.ts`, `race-report.ts`: 리플레이 데이터와 경기 리포트

## 개발 명령어

```bash
npm run dev          # 개발 서버
npm run typecheck    # TypeScript 타입 검사
npm run lint         # ESLint 검사
npm run test         # Vitest 전체 테스트
npm run test:watch   # 테스트 감시 모드
npm run build        # Next.js 프로덕션 빌드
npm run start        # 프로덕션 서버
```

## 검증 현황

현재 구현은 다음 검증을 통과했습니다.

- TypeScript 타입 검사
- ESLint 검사
- Next.js 프로덕션 빌드
- Vitest 18개 테스트 파일, 136개 테스트
- 결정론적 52랩 완주 시뮬레이션
- 시드 `20260712` 기준 52랩 종료, 55회 추월과 51회 피트스톱 기록
- 1280×720 및 주요 데스크톱 해상도에서 100% 배율 UI 확인

커밋 전 권장 전체 검증:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## 현재 범위와 남은 개발

현재 버전은 Silverstone 단일 레이스의 운영과 전략 경험에 집중합니다. 아래 항목은 아직 완성 범위에 포함되지 않았습니다.

- 연습주행과 퀄리파잉을 포함한 전체 레이스 위크엔드
- 여러 서킷과 시즌 캘린더
- 드라이버·컨스트럭터 챔피언십
- 팀 재정, 연구개발, 시설, 계약과 커리어 모드
- 시즌 전체 타이어 할당과 파워유닛 부품 수명 관리
- 열 위험을 넘어선 상세 기계 고장·수리 시스템
- 온라인 멀티플레이와 서버 저장
- 3D 레이스 화면, 오디오와 중계 연출
- 리플레이·리포트 파일 내보내기와 장기 세이브 데이터

다음 확장 우선순위는 전체 레이스 위크엔드, 챔피언십·팀 운영, 다중 서킷 데이터 파이프라인, 부품 신뢰성 시스템 순서입니다.

## 데이터 출처

- Silverstone 트랙 중심선: [OpenStreetMap](https://www.openstreetmap.org/) 기반 가공 데이터
- 1랩 텔레메트리 기준: [zvanjak/MML의 `f1_silverstone_lap.csv`](https://github.com/zvanjak/MML)
- 트랙 길이, 랩 수와 코너 메타데이터: 공개 Silverstone 및 Formula 1 서킷 정보에 맞춰 구성

원본 라이선스와 제3자 고지는 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)에서 확인할 수 있습니다. 초기 게임 설계 방향은 [`F1_2026_GAME_DESIGN.md`](./F1_2026_GAME_DESIGN.md)에 정리되어 있습니다.

## 기술 스택

- Next.js 16
- React 19
- TypeScript 5
- PixiJS 8
- Zustand 5
- Vitest 4
- ESLint
