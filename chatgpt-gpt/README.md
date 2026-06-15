# ChatGPT Custom GPT — 등록 가이드

ChatGPT에는 Claude의 SKILL.md 같은 체계가 없으므로, **Custom GPT + Action**으로 동등한
기능을 제공합니다. Action은 외부 API를 호출하므로 먼저 s2s 서버를 배포해야 합니다.

## 1. 서버 배포

s2s Node 서버는 의존성이 없어 어디든 올라갑니다.

```bash
cd node
npm install -g .            # 또는: npm install
S2S_API_KEY=내가정한키 PORT=8787 node src/server.js
```

공개 URL이 필요합니다(Action은 인터넷에서 접근 가능해야 함). 빠르게는:

```bash
npx localtunnel --port 8787      # 또는 ngrok http 8787, Render/Fly/Cloud Run 등
```

`https://<공개-호스트>/health` 가 `{"ok":true}` 를 반환하는지 확인하세요.

## 2. Custom GPT 생성

1. ChatGPT → 좌측 **Explore GPTs → Create** → **Configure** 탭
2. 이름: `Session Handoff`, 설명/지침: [`INSTRUCTIONS.md`](./INSTRUCTIONS.md) 내용 붙여넣기
3. **Actions → Create new action**
4. **Schema** 칸에 [`../node/openapi.yaml`](../node/openapi.yaml) 내용을 붙여넣기
5. `servers[0].url` 을 1단계의 공개 호스트로 수정
6. **Authentication → API Key → Bearer**, 값은 `S2S_API_KEY` 로 설정한 키
7. 저장 후 우측 미리보기에서 대화를 붙여넣고 "move this to Claude" 로 테스트

## 3. 사용

ChatGPT에서 이 GPT를 열고 옮기고 싶은 대화를 붙여넣은 뒤 "Claude로 넘겨줘" 라고 하면,
GPT가 `transferSession` 액션을 호출해 붙여넣을 primer를 돌려줍니다.

## 메모

- 서버는 기본적으로 **마스킹 ON** 입니다. 민감정보가 외부로 나가지 않습니다.
- 서버 없이 쓰고 싶다면, 이 저장소의 npm CLI(`s2s paste`)나 브라우저 확장을 쓰면 됩니다.
  Custom GPT Action은 "ChatGPT 안에서 바로" 쓰고 싶을 때의 옵션입니다.
- 인증 키(`S2S_API_KEY`)를 비우면 누구나 호출 가능하니 공개 배포 시 반드시 설정하세요.
