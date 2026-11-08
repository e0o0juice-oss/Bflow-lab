# Render 배포

## 준비된 배포 파일

저장소 루트 `render-color-studio.yaml`은 퍼스널컬러 서비스 전용이다. 기존 `render.yaml`은 이전 BFLOW 강의 서비스용이므로 이 배포에 사용하지 않는다.

- Root Directory: `color-studio`
- Runtime: Node.js 24
- Build: 서버 구문 검사와 실제 API 테스트
- Build: `node --check server.cjs && node --test server.test.cjs`
- Start: `node server.cjs`
- Health: `/color-studio/api/health`
- 단일 인스턴스, Starter 인스턴스 + 1GB 영구 디스크
- 데이터 디렉터리: `/var/data/color-studio`
- 자동 배포 꺼짐: 수업 중 변경사항이 자동 재배포되지 않게 한다.
- Render가 제공하는 `PORT`와 `RENDER_EXTERNAL_URL`을 자동 사용한다. HTTPS 쿠키·출처 검사에 실제 Render 주소를 적용한다.

**Starter 인스턴스와 영구 디스크는 유료다.** 생성 전 Render가 표시하는 현재 금액과 결제 조건을 계정 소유자가 확인해야 한다. 이 파일을 저장하거나 GitHub에 올리는 것만으로 Render 리소스가 생기거나 비용이 발생하지 않는다. 무료 임시 디스크는 재배포 때 학생 기록·이미지가 사라질 수 있어 이 운영 구성에는 사용하지 않는다.

## Render 화면에서 폴더를 지정해 배포 (API 키 불필요)

1. https://dashboard.render.com 에서 **New → Web Service**를 선택하고 GitHub 저장소 `e0o0juice-oss/Bflow-lab`를 연결한다.
2. 아래 값을 입력한다.

| 설정                 | 값                                                       |
| -------------------- | -------------------------------------------------------- |
| Branch               | `main`                                                   |
| Language / Runtime   | `Node`                                                   |
| Root Directory       | `color-studio`                                           |
| Build Command        | `node --check server.cjs && node --test server.test.cjs` |
| Start Command        | `node server.cjs` 또는 `npm start`                       |
| Health Check Path    | `/color-studio/api/health`                               |
| Environment Variable | `NODE_VERSION=24`                                        |
| Environment Variable | `COLOR_DATA_DIR=/var/data/color-studio`                  |
| Instance             | `Starter` · 단일 인스턴스                                |
| Persistent Disk      | Mount Path `/var/data/color-studio`, Size `1 GB`         |
| Auto-Deploy          | 꺼짐 · 수업 중 자동 재배포 방지                          |

3. 해당 계정에서 표시하는 Starter·디스크 요금과 지역을 확인하고 생성한다. 결제 확인은 계정 소유자가 수행한다.
4. 배포가 **Live**가 되면 Render가 발급한 실제 HTTPS 주소를 연다. 이 주소는 확인한 뒤에만 공유한다. 서비스 이름만 보고 URL을 추정하지 않는다.
5. `/color-studio/api/health`의 `{"ok":true}`를 확인한다. 사이트에서 수업을 만들고 실제 학생 기기로 QR·조·저장·이미지·댓글·발표·타이머를 확인한다.

QR 라이브러리와 MIT 라이선스를 `color-studio/vendor/`에 포함했으므로 상위 폴더 파일 없이 실행할 수 있다. 루트 경로 `/`는 자동으로 `/color-studio/`로 이동한다. Render의 `PORT`와 HTTPS 주소는 자동으로 사용하며 Gemini/Firebase/Render API 키는 이 배포에 필요하지 않다.

## Blueprint를 사용하는 경우

**New → Blueprint**에서 같은 저장소와 `main`을 선택하고 Blueprint Path를 **`render-color-studio.yaml`**로 지정한다. 파일에 Root Directory와 디스크 설정이 포함돼 있다. 기본 `render.yaml`은 이전 BFLOW 서비스용이므로 이 앱에는 사용하지 않는다. 사용 중인 계정의 최신 요금·Blueprint 스키마 검증은 생성 화면에서 확인한다.

## 에이전트가 API로 계속 배포하는 경우

Render 계정 소유자가 API 키를 생성한 뒤 이 클라우드의 환경 설정에서 `RENDER_API_KEY` 요구사항에 **안전하게 입력**한다. 값은 채팅이나 GitHub에 넣지 않는다. 환경 설정에서 Render API 네트워크 허용 초안을 저장한 뒤 연결을 다시 검사한다. 계정/워크스페이스와 유료 요금 선택이 확인된 다음에 실제 서비스를 생성한다. API 키는 Render 배포 관리에만 쓰며 웹앱의 런타임 환경변수로 전달하지 않는다.

## 확인 범위

로컬 서버·30개 동시 참여 세션·분리 브라우저·오프라인 복원·권한은 VALIDATION.md에 기록돼 있다. Render 계정 인증·서비스 생성·실제 HTTPS 주소·영구 디스크 재배포·실제 휴대폰 접속은 배포 후 새로 검증해야 한다. Render Blueprint 스키마 검증은 Render의 생성 화면/API에서 확인한다. 클라우드 환경 설정 Publish는 Render 배포와 다른 작업이다.
