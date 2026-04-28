# Auth Module

任何 AWB 流程开始前先确认认证状态。具体登录命令参数以 `auth-status`、`login-key`、`login-qr --help` 为准。

## 1. 登录方式

| 方式 | 适用 | 提醒 |
|------|------|------|
| `AWB_ACCESS_KEY` | e2b / CI / agent 沙箱 | 推荐；无状态，不刷新 token |
| `login-key` | 本机长期保存 access key | 会写入本地 auth 文件，权限应为 0600 |
| `login-qr` | 个人本机扫码 | 需官网账号已注册并绑定微信 |
| 手机验证码 | 账号未绑微信时兜底 | 需要网页端 captcha，不适合自动化 |

`AWB_CODE` 只是旧别名，不是 user id。

## 2. 执行原则

- 第一步跑 `auth-status -f json`，看认证来源、是否过期、是否从 env 读取。
- 自动化优先环境变量，不要把 key 写进命令历史或文档。
- CLI 会安全解析简单 env 文件行，但不会执行 shell 脚本，也不会覆盖当前进程已有环境变量。
- `login-key` 默认会验证 access key；只有离线写配置才考虑跳过验证。
- `login-qr --waitSeconds 0` 适合 agent：先拿扫码会话，再独立轮询状态。
- `auth-clear` 是破坏性本地操作，只清本地凭据，不代表服务端登出；没把握先 dry-run。

## 3. 常见判断

- 报未登录或 token 过期：重新查 `auth-status`，优先确认 env 中是否已有 access key。
- `login-qr` 返回需要绑定：先让用户回官网完成微信绑定，再继续 CLI。
- 多账号共机：登录后立刻查 `me` / 当前项目组，避免任务跑到错误账号或项目组。
