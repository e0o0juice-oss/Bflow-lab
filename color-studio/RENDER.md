# Render 배포

## 준비된 배포 파일

저장소 루트 `render-color-studio.yaml`은 퍼스널컬러 서비스 전용이다. 기존 `render.yaml`은 이전 BFLOW 강의 서비스용이므로 이 배포에 사용하지 않는다.

- Runtime: Node.js 24
- Build: 서버 구문 검사와 실제 API 테스트
- Start: `node color-studio/server.cjs`
- Health: `/color-studio/api/health`
- 단일 인스턴스, Starter 인스턴스 + 1GB 영구 디스크
- 데이터 디렉터리: `/var/data/color-studio`
- 자동 배포 꺼짐: 수업 중 변경사항이 자동 재배포되지 않게 한다.
- Render가 제공하는 `PORT`와 `RENDER_EXTERNAL_URL`을 자동 사용한다. HTTPS 쿠키·출처 검사에 실제 Render 주소를 적용한다.

**Starter 인스턴스와 영구 디스크는 유료다.** 생성 전 Render가 표시하는 현재 금액과 결제 조건을 계정 소유자가 확인해야 한다. 이 파일을 저장하거나 GitHub에 올리는 것만으로 Render 리소스가 생기거나 비용이 발생하지 않는다. 무료 임시 디스크는 재배포 때 학생 기록·이미지가 사라질 수 있어 이 운영 구성에는 사용하지 않는다.

## 계정에서 배포하는 순서

1. https://dashboard.render.com 에서 가입·로그인하고 GitHub 저장소 접근을 연결한다.
2. **New → Blueprint**에서 `e0o0juice-oss/Bflow-lab`, 브랜치 `main`을 선택한다.
3. Blueprint Path를 **`render-color-studio.yaml`**로 지정한다. 기본 `render.yaml`을 그대로 사용하면 이전 BFLOW 서비스가 배포된다.
4. `bflow-color-studio` 한 서비스와 1GB 디스크, 요금·지역을 확인하고 생성한다. GitHub 연결·결제 확인은 계정 소유자가 수행한다.
5. 배포가 Live가 되면 Render가 발급한 실제 HTTPS 주소를 연다. 주소는 생성 결과를 확인한 뒤에만 공유한다. 서비스 이름만 보고 URL을 추정하지 않는다.
6. 실제 주소의 `/color-studio/api/health`에서 `{"ok":true}`를 확인한다. ‘강사 · 새 수업 만들기’를 누르고 별도 휴대폰으로 QR 참여·다른 조 차단·입력 복원·이미지·피드백·발표 동의·타이머를 리허설한다.

## 에이전트가 API로 계속 배포하는 경우

Render 계정 소유자가 API 키를 생성한 뒤 이 클라우드의 환경 설정에서 `RENDER_API_KEY` 요구사항에 **안전하게 입력**한다. 값은 채팅이나 GitHub에 넣지 않는다. 환경 설정에서 Render API 네트워크 허용 초안을 저장한 뒤 연결을 다시 검사한다. 계정/워크스페이스와 유료 요금 선택이 확인된 다음에 실제 서비스를 생성한다. API 키는 Render 배포 관리에만 쓰며 웹앱의 런타임 환경변수로 전달하지 않는다.

## 확인 범위

로컬 서버·30개 동시 참여 세션·분리 브라우저·오프라인 복원·권한은 VALIDATION.md에 기록돼 있다. Render 계정 인증·서비스 생성·실제 HTTPS 주소·영구 디스크 재배포·실제 휴대폰 접속은 배포 후 새로 검증해야 한다. Render Blueprint 스키마 검증은 Render의 생성 화면/API에서 확인한다. 클라우드 환경 설정 Publish는 Render 배포와 다른 작업이다.
