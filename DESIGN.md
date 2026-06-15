# session_to_session — 설계 문서

AI 세션의 컨텍스트를 다른 세션으로 안전하게 이어주는 서비스. **같은 AI ↔ 다른 AI**,
**같은 모델 ↔ 다른 모델** 어떤 조합이든 한 세션에서 쌓인 맥락을 잃지 않고 다음 세션으로
넘긴다.

---

## 1. 문제 정의

대화형 AI를 쓰다 보면 세션이 끊긴다 — 컨텍스트 창이 가득 차거나, 더 나은 모델로 갈아타거나,
아예 다른 벤더(Claude → ChatGPT → Gemini)로 옮기는 순간 그동안 합의한 결정, 사용자 선호,
진행 중인 작업, 산출물 상태가 전부 증발한다. 매번 "지금까지 상황은…"을 손으로 다시 쓰는 건
비효율적이고 누락이 생긴다.

핵심 난점은 **벤더마다 세션 저장 포맷이 다르다**는 점이다. 따라서 N×N 변환을 직접 만들면
플랫폼이 늘 때마다 변환기가 제곱으로 늘어난다.

## 2. 설계 원칙

1. **허브-앤-스포크 (N+N, not N×N).** 모든 벤더 포맷을 하나의 중립 포맷
   **Session Capsule** 로 모으고, 거기서 각 타깃용으로 내보낸다. 플랫폼 추가 비용이
   선형이다.
2. **압축이 기본, 원문은 옵트인.** 전체 대화를 그대로 옮기면 토큰만 낭비된다. 기본은
   "이어받기에 꼭 필요한 신호"로 압축하고, 전체 원문(transcript)은 `--full` 토글로만
   덧붙인다. (요구사항 그대로 — 원문은 옵션 버튼)
3. **오프라인·무(無)키 동작.** 프로토타입은 외부 API 키 없이 순수 휴리스틱으로 돈다.
   LLM 요약은 같은 인터페이스에 끼워 넣을 수 있는 선택 사항.
4. **사람이 읽고 git으로 diff 가능.** Capsule은 JSON 한 덩어리. 검수·수정·버전관리가 쉽다.

## 3. 아키텍처

```
 벤더 export                  중립 포맷                   타깃 맞춤 산출물
┌────────────┐   adapter   ┌──────────────┐  rehydrate  ┌──────────────┐
│  ChatGPT   │──┐          │              │──┐          │ Claude primer│
│  Claude    │──┼─normalize▶│ Session      │  ┼─tune────▶│ ChatGPT primer│
│  Gemini    │──┘          │ Capsule(JSON)│──┘          │ Gemini primer│
└────────────┘             └──────┬───────┘             └──────────────┘
                                  │ compress
                            (summary·decisions·
                             open threads·artifacts·
                             user profile)
```

파이프라인 단계:

| 단계 | 입력 | 출력 | 모듈 |
|------|------|------|------|
| **import** | 벤더 export(JSON/JSONL) | 정규화된 Capsule | `adapters/` |
| **compress** | Capsule | 컨텍스트가 채워진 Capsule | `compress.py` |
| **rehydrate** | Capsule + 타깃 | 핸드오프 primer(텍스트) | `rehydrate.py` |

`transfer` 명령은 위 셋을 한 번에 실행한다.

## 4. Session Capsule 포맷

플랫폼 중립 컨테이너. 주요 필드(`s2s/capsule.py`):

- **provenance**: `source_platform`, `source_model`, `title`, `created_at`, `captured_at`
- **transcript**: `Turn[]` (role/content/timestamp) — 무손실 원문. 직렬화 시 기본 제외,
  `include_full_transcript=True`일 때만 포함. 제외돼도 `transcript_turn_count`로 개수는 보존.
- **context** (`CompressedContext`) — 가볍게 이동하는 "메모리":
  - `summary` — 서사형 요약
  - `key_facts` — 프로젝트/사용자에 대한 안정적 사실
  - `decisions` — 명시적 결정("Stripe 쓰기로", "리포지토리 패턴으로")
  - `open_threads` — 미완 작업·TODO·미해결 질문 (다음 세션이 여기서 이어받음)
  - `glossary` — 프로젝트 고유 용어
  - `user_profile` — 선호/역할/제약
  - `token_estimate` — 대략적 토큰 비용
- **artifacts**: `Artifact[]` (path/kind/status/summary/language) — 작업 산출물·파일 상태
- **toggles**: `include_full_transcript`, `schema_version`, `extra`

## 5. 어댑터 (벤더 → Capsule)

각 어댑터는 `sniff()`(0~1 신뢰도)와 `load()`만 구현한다. `detect_and_load()`가 가장 높은
점수의 어댑터를 자동 선택하고, `--from`으로 강제 지정도 가능.

- **ChatGPT** — 공식 export `conversations.json`의 `mapping` 트리를 부모/자식 링크로
  선형화. API 스타일 messages 배열도 지원.
- **Claude** — Claude.ai `chat_messages`, Claude Code 세션 JSONL, Anthropic API
  messages(콘텐츠 블록) 세 가지 모두 지원.
- **Gemini** — `contents`/`messages` 배열의 `parts[].text`를 평탄화.

> Google Takeout "My Activity" HTML은 구조화 데이터가 아니라 표현용 HTML이라 프로토타입
> 범위에서 제외. 후속 어댑터로 표기.

## 6. 압축 (휴리스틱 기본 + LLM 훅)

`compress.py`는 정규식 기반으로 결정/미완 작업/선호/사실/코드펜스·파일경로(산출물)를 뽑아
`CompressedContext`를 채운다. 키 없이 즉시 동작.

운영 환경에서는 `llm_summarizer(call_model)`로 LLM 요약을 끼워 넣을 수 있다. `call_model`은
Claude·GPT·Gemini 무엇이든 되는 일반 시그니처라 동일 코드가 어느 백엔드와도 호환된다.

## 7. 재수화 (Capsule → 타깃 맞춤 primer)

같은 Capsule이라도 타깃에 따라 다른 primer를 만든다. 벤더마다 새 세션을 시작하는 관습이
다르기 때문이다:

- **Claude** — `<handoff>…</handoff>` 태그 래핑(구조화 컨텍스트에 강함) + "이전 AI가 하던
  작업을 이어받으라"는 오프너.
- **ChatGPT / Gemini** — 마크다운 섹션 구조 + 각 플랫폼 톤의 오프너/클로저.

`--full` 지정 시 primer 끝에 원문 transcript를 그대로 덧붙인다.

## 8. 사용법

```bash
# ChatGPT 세션을 Claude로 이어받을 primer 생성
python -m s2s.cli transfer examples/chatgpt_export.json --to claude -o primer.txt

# 원문까지 포함해서 Gemini로
python -m s2s.cli transfer chat.json --to gemini --full -o primer.txt

# 단계별로
python -m s2s.cli import   chat.json --from chatgpt -o capsule.json
python -m s2s.cli compress capsule.json            -o capsule.json
python -m s2s.cli primer   capsule.json --to claude -o primer.txt
python -m s2s.cli inspect  capsule.json
```

생성된 `primer.txt`를 새 세션의 첫 메시지로 붙여넣으면 끝.

## 9. 검증

`tests/test_pipeline.py` — 탐지/압축/JSON 라운드트립/원문 토글/타깃별 프레이밍까지 10개
테스트. `examples/demo.sh`는 ChatGPT→Claude, Claude→Gemini, Gemini→ChatGPT(원문 포함)
세 방향을 모두 시연한다.

## 10. v0.2 — "실제 사용자가 원하는가?"에 대한 답

v0.1은 아키텍처(중립 Capsule + 허브앤스포크)는 옳았지만 **형태가 실제 사용 순간과 맞지
않았다.** 가장 큰 약점은 세 가지였다: 입력 마찰(데이터 export는 이메일·zip·대기), 요약
품질(정규식), 전달 방식(수동 붙여넣기). v0.2는 이를 정면으로 다룬다.

**(1) 입력 마찰 — 세 갈래로 해소.**
- **Paste 어댑터** (`adapters/paste_adapter.py`): 대화창에서 그냥 복사한 텍스트를 파싱한다.
  `You:` / `ChatGPT said:` / `사용자:` 등 영어·한국어 화자 마커를 인식하고, 마커가 없으면
  전체를 단일 user 턴으로 처리. export 파일이 전혀 필요 없다.
- **브라우저 확장** (`extension/`, Chrome MV3): 현재 ChatGPT/Claude/Gemini 페이지 DOM에서
  대화를 긁어 한 클릭으로 primer를 클립보드에 복사. compress/rehydrate를 JS로 포팅해
  브라우저 안에서 완결(대화가 외부로 안 나감).
- **폴더 감시** (`watch.py`): 지정 폴더 `inbox/`에 export를 떨구면 자동으로 capsule +
  primer 생성. 원래 주신 경로(session_to_session)를 기본 감시 대상으로 활용.

**(2) 요약 품질 — 키 있으면 LLM, 없으면 휴리스틱** (`summarize.py`):
환경변수로 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` 를 감지해 해당
프로바이더로 요약하고, 키가 없거나 호출 실패 시 조용히 휴리스틱으로 폴백. 표준 라이브러리
urllib만 사용. 휴리스틱도 한국어 패턴을 추가하고 분류를 상호배타(선호>결정>미완>사실)로
바꿔 "todo app"이 미완 작업으로 오분류되던 문제 등을 고쳤다.

## 11. 남은 한계 & 다음 단계

- 브라우저 DOM 선택자는 사이트 변경에 취약 → 폴백(전체 텍스트)으로 완화했지만 주기적 갱신
  필요.
- 분기된 ChatGPT 트리는 첫 자식 체인만 따라간다 → 활성 리프 선택 옵션.
- Gemini Takeout HTML 어댑터, 실제 파일 내용 스냅샷(현재는 경로/상태만), 확장의
  "primer 자동 주입"(복사 대신 새 탭에 바로 입력) 등이 다음 후보.
