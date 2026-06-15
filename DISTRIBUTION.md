# session_to_session — 배포 가이드 (npm / Claude 플러그인 / ChatGPT)

하나의 **순수 Node 코어**(`node/src/`)를 세 가지 채널로 배포합니다. 로직은 한 곳에만 있고
나머지는 그걸 감쌉니다.

```
                       ┌───────────────────────────┐
                       │   Node 코어 (node/src)     │
                       │  capsule·adapters·compress │
                       │  rehydrate·summarize·mask  │
                       │  merge·diff·server         │
                       └────────────┬──────────────┘
            ┌───────────────────────┼────────────────────────┐
            ▼                       ▼                         ▼
   npm CLI (`s2s`)        Claude 플러그인            ChatGPT Custom GPT
   bin/s2s.js            plugin/ (SKILL+command,    chatgpt-gpt/ (지침)
                          코어 번들)                 + node/openapi.yaml
                                                     + node/src/server.js
```

## 고도화된 기능 (v0.3)

- **구조화 추출 강화** — 신호별 confidence 점수화 + 랭킹으로 제한된 슬롯에 가장 중요한
  결정·미완작업·사실이 들어감. 상호배타 분류로 오분류 감소(영어+한국어).
- **멀티세션 병합** (`merge`) — 여러 capsule을 하나로 합쳐 프로젝트 단위 메모리 구성
  (결정·사실·스레드 dedupe, transcript 시간순 연결, 출처 추적).
- **프라이버시 마스킹** (`mask`) — API 키·토큰·JWT·이메일·카드번호(Luhn)·사설키 등을
  `«EMAIL_1»` 식 placeholder로 치환. **기본 비가역**(원문 미저장)으로 유출 방지.
- **버전관리/diff** (`diff`) — capsule에 content_hash + revision. 두 capsule 간 추가/삭제된
  결정·스레드·산출물을 비교 출력.
- **고효율 인코딩 + 정보보호 (SHA256급)** (`encode`/`decode`, `seal`/`unseal`) — capsule을
  한 줄 base64url 토큰으로 만들어 세션 간 안전·압축 전송. `encode`는 deflate 압축(무결성
  체크섬 포함, JSON 대비 ~50% 축소). `seal`은 **압축 후 AES-256-GCM 암호화**(scrypt로
  passphrase→256-bit 키 유도, 128-bit GCM 인증태그 + 평문 SHA-256 임베드). 암호문구를
  모르면 복호·변조 불가.

  ```bash
  s2s seal session.capsule.json --pass "비밀문구" -o sealed.txt   # 암호화 토큰
  s2s unseal sealed.txt --pass "비밀문구" --to claude            # 복호 -> primer
  s2s transfer export.json --seal --pass "비밀문구"              # 원샷: export -> 토큰
  ```

  > 참고: SHA-256은 해시(무결성)이고 기밀 보호는 AES-256-GCM이 담당합니다. 둘을 함께 적용해
  > "변조 탐지 + 내용 암호화"를 모두 보장합니다.
- **첨부파일 (사진·논문)** (`attach`, `--attach`) — 핸드오프에 이미지·PDF를 포함. PDF(논문)는
  제목·페이지수·텍스트 발췌(poppler `pdftotext` 있으면 사용, 없으면 내장 순수-JS 추출기;
  스캔본은 OCR 필요로 표시), 이미지는 크기·타입·SHA-256(+선택 캡션) 추출. primer에
  "Attachments" 섹션으로 전달. `--embed` 시 파일 바이트를 base64로 capsule에 넣어 sealed
  토큰에 함께 봉인(SHA-256 무결성 유지).

  ```bash
  s2s transfer chat.json --to claude --attach paper.pdf --attach figure.png
  s2s attach session.capsule.json paper.pdf --embed
  ```

## 1) npm CLI

```bash
cd node
npm install -g .          # 전역 설치 → `s2s` 명령 사용 가능
s2s transfer export.json --to claude --mask -o primer.txt
s2s merge a.json b.json --to claude
s2s diff old.json new.json
npm test                  # 10개 테스트
```

게시(선택): `npm publish` (이름 `session-to-session`). 게시 후 누구나
`npm i -g session-to-session` 로 설치.

## 2) Claude 마켓플레이스 플러그인

```
/plugin marketplace add /Users/sunghoon/Documents/session_to_session/plugin
/plugin install session-to-session@sunghoon-marketplace
```

스킬 자동 호출("이 대화 Claude로 넘겨줘") 또는 `/transfer-session export.json --to gemini`.
코어가 플러그인에 번들돼 있어 npm 설치 없이도 동작(Node 18+만 필요). 자세히는
[`plugin/README.md`](./plugin/README.md).

## 3) ChatGPT Custom GPT

ChatGPT엔 SKILL.md 체계가 없어 **Custom GPT + Action**으로 동등 기능 제공:
서버 배포 → OpenAPI 스키마 등록 → 지침 붙여넣기. 단계별 가이드는
[`chatgpt-gpt/README.md`](./chatgpt-gpt/README.md), 스키마는
[`node/openapi.yaml`](./node/openapi.yaml).

```bash
cd node && S2S_API_KEY=mykey node src/server.js   # 백엔드
```

## 4) MCP 서버 (Claude Desktop / Cowork)

세션 이동 기능을 MCP 도구로 노출(`transfer_session`, `seal_session`, `unseal_session`,
`encode/decode_session`, `boot_key_status`). 의존성 0, stdio(JSON-RPC 2.0).

```json
{ "mcpServers": { "session-to-session": {
  "command": "node",
  "args": ["/Users/sunghoon/Documents/session_to_session/node/bin/s2s-mcp.js"] } } }
```

`claude_desktop_config.json`에 위를 병합하면 앱 재시작 후 도구가 뜹니다. 플러그인에도
`plugin/.mcp.json`이 포함돼 플러그인 설치 시 함께 등록됩니다. 자세히는
[`mcp/README.md`](./mcp/README.md).

**비밀키 = 부팅 세션 키(자동 태깅·재부팅시 재생성).** `seal_session`은 기본적으로 맥
부팅시각에서 유도한 boot tag로 식별되는 키를 씁니다. 부팅 세션 내 첫 사용 시 32바이트 키를
생성(`~/.s2s/keys/<boottag>.key`, 0600)해 공유하고, 재부팅하면 boot tag가 바뀌어 새 키가
자동 생성+이전 키 자동 삭제됩니다(이전 토큰 복호 불가). 영구 보관은 `passphrase` 옵션 사용.

## 전체 구조

```
session_to_session/
├── s2s/               # 원본 Python 패키지 (v0.2, 참조 구현)
├── extension/         # 브라우저 확장 (MV3)
├── node/              # ★ Node 코어 + npm CLI + 서버 + MCP + openapi.yaml
├── plugin/            # ★ Claude 마켓플레이스 플러그인 (코어 번들 + .mcp.json)
├── chatgpt-gpt/       # ★ ChatGPT Custom GPT 지침 + 등록 가이드
├── mcp/               # ★ MCP 등록 설정 + 가이드
├── DESIGN.md          # 설계 문서
└── DISTRIBUTION.md    # (이 문서) 배포 가이드
```

세 채널 모두 동일한 Session Capsule 포맷을 쓰므로 한 채널에서 만든 capsule을 다른 채널에서
이어서 처리할 수 있습니다(브라우저로 캡처 → npm CLI로 재요약 등).
