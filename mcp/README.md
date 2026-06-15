# session_to_session — MCP 서버

세션 이동 기능을 **MCP(Model Context Protocol) 서버**로 노출합니다. Claude Desktop /
Cowork 등 MCP 클라이언트가 도구로 직접 호출할 수 있습니다. 의존성 0 (Node 18+ 표준
라이브러리만), stdio 전송(JSON-RPC 2.0 newline-delimited).

## 도구

| 도구 | 설명 |
|------|------|
| `transfer_session` | 대화(텍스트/export) → 타깃 AI용 handoff primer |
| `seal_session` | 대화/capsule을 압축+암호화한 토큰으로. 기본 **부팅 세션 키** 사용 |
| `unseal_session` | 토큰 복호 → capsule 또는 primer |
| `encode_session` / `decode_session` | 비암호 압축 토큰 인/디코드 |
| `boot_key_status` | 현재 부팅 세션 키 태그/생성시각 |

## 비밀키 동작 (부팅시 재생성 + 자동 태깅)

`seal_session`은 기본적으로 **부팅 세션 키**로 암호화합니다.

- 키는 맥 부팅시각(`kern.boottime`)에서 유도한 **boot tag**로 식별됩니다.
- 부팅 세션 내 첫 사용 시 32바이트 랜덤 키를 생성해 `~/.s2s/keys/<boottag>.key`
  (권한 0600)에 저장 → 같은 부팅 동안 MCP 재시작·여러 호출에서 공유.
- **재부팅하면** boot tag가 바뀌어 새 키가 자동 생성되고, 이전 부팅의 키 파일은 자동
  삭제됩니다. → 재부팅 전에 만든 토큰은 더 이상 복호 불가(자동 만료/로테이션).
- 각 토큰에는 만들어진 boot tag가 박혀 있어, 다른 부팅 세션의 토큰을 열려 하면 "이전 부팅
  세션에서 봉인됨" 이라고 명확히 거부합니다.

영구 보관이 필요하면 `seal_session`에 `passphrase`를 주면 됩니다(부팅 키 대신 암호문구로
scrypt 키 유도 — 재부팅과 무관하게 복호 가능).

> 트레이드오프: 부팅 세션 키는 프로세스 간 공유를 위해 디스크에 0600으로 저장됩니다(부팅
> 중 같은 사용자면 읽기 가능, 재부팅 시 삭제). 디스크에 절대 두기 싫으면 passphrase 모드를
> 쓰세요.

## 등록

### Claude Desktop / Cowork
`~/Library/Application Support/Claude/claude_desktop_config.json` 에 병합:

```json
{
  "mcpServers": {
    "session-to-session": {
      "command": "node",
      "args": ["/Users/sunghoon/Documents/session_to_session/node/bin/s2s-mcp.js"]
    }
  }
}
```

(이 폴더의 [`claude_desktop_config.json`](./claude_desktop_config.json) 그대로 사용 가능)
앱 재시작 후 도구가 나타납니다.

### Claude 플러그인으로
플러그인에 [`plugin/.mcp.json`](../plugin/.mcp.json)이 포함돼 있어, 플러그인을 설치하면 MCP
서버도 함께 등록됩니다(코어가 번들돼 있어 별도 설치 불필요).

## 빠른 점검

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n' | node node/bin/s2s-mcp.js
```

도구 목록 JSON이 나오면 정상입니다.
