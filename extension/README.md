# session_to_session — 브라우저 확장 (MV3)

ChatGPT / Claude / Gemini 웹 화면에서 **현재 대화를 한 클릭으로 캡처**해, 다른 AI 세션에
붙여넣을 handoff primer를 만들어 줍니다. export 파일을 받을 필요가 없습니다 — 이게 입력
마찰을 가장 크게 줄이는 방법입니다.

## 설치 (개발자 모드)

1. Chrome 주소창에 `chrome://extensions` 입력
2. 우측 상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** 클릭 → 이 `extension/` 폴더 선택
4. ChatGPT/Claude/Gemini 대화 페이지를 열고 툴바의 확장 아이콘 클릭

## 사용

1. 넘길 대상(Claude/ChatGPT/Gemini)을 고르고, 필요하면 "Include full transcript" 체크
2. **Capture this chat** — 현재 페이지의 대화를 읽어 압축
3. **Copy primer** — 클립보드에 복사 → 새 세션 첫 메시지로 붙여넣기
   또는 **Download capsule** — 중립 포맷 JSON으로 저장 (CLI/공유용)

## 동작 방식

- `scrape.js` 가 각 사이트 DOM에서 user/assistant 메시지를 추출 (선택자 실패 시 페이지
  전체 텍스트로 폴백)
- `s2s.js` 는 Python 패키지의 compress/rehydrate 단계를 그대로 옮긴 클라이언트 포트 —
  요약·결정·미완작업·선호·산출물을 뽑고 타깃 맞춤 primer를 생성 (한국어 패턴 포함)
- 모든 처리는 **브라우저 안에서** 끝납니다. 외부 서버로 대화를 보내지 않습니다.

## 한계 / 메모

- 각 사이트는 DOM을 자주 바꿉니다. 캡처가 비면 `scrape.js` 의 선택자를 갱신하세요
  (폴백이 있어 최소한 전체 텍스트는 잡힙니다).
- 다운로드한 `*.capsule.json` 은 Python CLI(`s2s.cli primer capsule.json --to …`)로도
  재처리할 수 있어, 브라우저 캡처 ↔ CLI 워크플로가 호환됩니다.
- 브라우저 안에서는 LLM 요약 대신 휴리스틱을 씁니다. 더 높은 품질이 필요하면 capsule을
  다운로드해 CLI(LLM 폴백)로 primer를 다시 만드세요.
