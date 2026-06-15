# session_to_session (s2s)

AI 세션의 맥락을 다른 세션으로 옮긴다 — **같은 AI든 다른 AI든, 같은 모델이든 다른 모델이든.**
한 대화에서 쌓인 결정·선호·진행 중인 작업·산출물 상태를 잃지 않고 다음 세션이 이어받게 한다.

> **포지셔닝.** 같은 벤더 안의 "기억"은 ChatGPT Memory/Projects, Claude Projects 등이 이미
> 해결한다. 이 도구의 진짜 가치는 **벤더 간 핸드오프** — 더 나은 모델/다른 AI로 갈아탈 때
> 맥락을 그대로 넘기는 것이다.

```
입력(3가지)            중립 포맷                  타깃 맞춤 산출물
┌ 붙여넣기 텍스트 ┐               ┌ Claude primer
├ 벤더 export    ┼─▶ Session Capsule ─압축/요약─▶ ┼ ChatGPT primer
└ 브라우저 캡처   ┘   (중립 JSON)                  └ Gemini primer
```

의존성 없음 — Python 3.10+ 표준 라이브러리만. **요약은 API 키가 있으면 LLM, 없으면 휴리스틱**
으로 자동 폴백.

## 입력 마찰을 줄이는 3가지 방법

1. **붙여넣기** (가장 빠름) — 대화창에서 텍스트를 복사해 바로 넣는다. export 파일 불필요.
   ```bash
   pbpaste | python3 -m s2s.cli paste --to claude -o primer.txt   # macOS
   ```
2. **브라우저 확장** (가장 매끄러움) — ChatGPT/Claude/Gemini 페이지에서 한 클릭 캡처 →
   primer 복사. `extension/` 폴더 참고.
3. **폴더 자동 감시** — 지정 폴더의 `inbox/`에 export를 떨구면 자동 변환.
   ```bash
   python3 -m s2s.cli watch          # ~/Documents/session_to_session 감시
   ```

## 빠른 시작

```bash
# 붙여넣기 한 줄 (export 파일 없이)
echo "You: ... \nChatGPT: ..." | python3 -m s2s.cli paste --to claude

# 벤더 export 한 방에: 압축 → 타깃용 primer
python3 -m s2s.cli transfer examples/chatgpt_export.json --to claude -o primer.txt

# LLM 요약을 쓰려면 키만 설정하면 자동 사용됨
export ANTHROPIC_API_KEY=sk-...   # 또는 OPENAI_API_KEY / GEMINI_API_KEY
python3 -m s2s.cli transfer chat.json --to gemini

# 세 방향 데모 / 테스트
bash examples/demo.sh
python3 -m unittest discover -s tests
```

생성된 `primer.txt`를 새 AI 세션의 첫 메시지로 붙여넣으면 그 세션이 맥락을 그대로 이어받는다.

## 명령어

| 명령 | 하는 일 |
|------|---------|
| `paste [file]` | 붙여넣은 대화 텍스트(stdin/파일) → primer. export 불필요 |
| `transfer <export> --to <plat>` | export → 압축 → primer (원스톱) |
| `watch [folder]` | 폴더 `inbox/` 감시 → 자동으로 capsule + primer 생성 |
| `import <export>` | 벤더 export를 중립 Capsule(JSON)로 정규화 |
| `compress <capsule>` | Capsule에 압축 컨텍스트(요약·결정·미완작업…) 채우기 |
| `primer <capsule> --to <plat>` | Capsule을 타깃 맞춤 primer로 재수화 |
| `inspect <capsule>` | Capsule 요약 + 사용 중인 요약 엔진 출력 |

옵션: `--from claude|chatgpt|gemini|paste` (자동탐지 강제),
`--to claude|chatgpt|gemini|generic`, `--full` (원문 transcript까지 포함 — 기본은 압축본만),
`--offline` (LLM 키가 있어도 휴리스틱 강제).

## 지원 입력 포맷

- **Claude** — Claude.ai `conversations.json`, Claude Code 세션 JSONL, Anthropic API messages
- **ChatGPT** — OpenAI 데이터 export `conversations.json`(mapping 트리), API messages 배열
- **Gemini** — `contents`/`messages` 배열(`parts[].text`)

## 구조

```
s2s/
  capsule.py        중립 포맷(Session Capsule) 스키마
  compress.py       휴리스틱 컨텍스트 압축 (한국어 포함)
  summarize.py      LLM 요약 + 키 없으면 휴리스틱 자동 폴백
  rehydrate.py      타깃별 handoff primer 생성
  watch.py          폴더 감시 자동 변환
  cli.py            커맨드라인 인터페이스
  adapters/         Claude/ChatGPT/Gemini + paste 임포트 + 자동탐지
extension/          Chrome MV3 브라우저 확장 (한 클릭 캡처)
examples/           샘플 export 3종 + demo.sh
tests/              엔드투엔드 + 단위 테스트 18개
DESIGN.md           설계 문서 (아키텍처·근거·로드맵)
```

자세한 설계 근거는 [DESIGN.md](./DESIGN.md) 참고.
