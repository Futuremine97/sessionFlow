# session-to-session — Claude 플러그인

AI 대화의 컨텍스트를 다른 세션/모델로 옮기는 Claude Code/Cowork 플러그인. 번들된 의존성
없는 Node CLI로 동작하며, 대화를 중립 Session Capsule로 압축하고 타깃(Claude/ChatGPT/
Gemini)에 맞춘 handoff primer를 만든다.

## 구성

```
plugin/
├── .claude-plugin/
│   ├── plugin.json          # 플러그인 매니페스트
│   └── marketplace.json     # 마켓플레이스 정의 (이 저장소를 마켓으로 등록)
├── skills/
│   └── session-transfer/SKILL.md   # 자동 호출되는 스킬 (모델 인보크)
├── commands/
│   └── transfer-session.md  # /transfer-session 슬래시 명령
└── scripts/                 # 번들된 Node 코어 (의존성 0)
```

## 설치

로컬 경로를 마켓플레이스로 추가한 뒤 설치:

```
/plugin marketplace add /Users/sunghoon/Documents/session_to_session/plugin
/plugin install session-to-session@sunghoon-marketplace
```

GitHub에 올렸다면:

```
/plugin marketplace add <github-user>/<repo>
/plugin install session-to-session@sunghoon-marketplace
```

## 사용

- 스킬 자동 호출: "이 대화 Claude로 넘겨줘", "컨텍스트 한계라 새 챗에서 이어가자" 등
- 슬래시 명령: `/transfer-session export.json --to gemini --mask`

Node 18+ 필요. `ANTHROPIC_API_KEY` 등이 설정돼 있으면 LLM 요약, 없으면 휴리스틱.
