---
name: awb
description: 使用 `awb` / `opencli awb` 操作 Anime Workbench（灵境 AI）。覆盖认证、团队 / 项目组切换、模型发现、生图 / 生视频、批量、任务跟踪、素材上传、积分开票。涉及参考图、首尾帧、多参考、故事板、主体素材、批量输入、通道差价等子场景时，先读对应 module 再执行命令。
---

# AWB Skill

> **前置条件**：先读 [`modules/auth.md`](modules/auth.md)，确认登录与项目组就位。
> **执行前必做**：进到 module 里按表格定位命令，再按 must-read / deep-dive 的链接阅读。参数细节以 `model-options` 和 `<cmd> --help` 为准。
> **真人短剧高频入口**：用户说“真人 / 角色图 + 场景图 + 控音色 / 说话 / 对口型 / 短剧片段”时，先读 [`modules/video.md`](modules/video.md) 的“真人短剧”场景，再读 [`modules/upload.md`](modules/upload.md) 和 [`references/subject-upload.md`](references/subject-upload.md)。不要只给 `--refImageFiles` 一步法；必须说明“可复用主体发布 / 加白后用 `--refSubjects`”和“一次性直接传 webp 用 `--refImageFiles`”两条路径。
> **分镜指挥图高频入口**：用户说“4 宫格 / 9 宫格 / 分镜图 / 指挥图 / 镜头切换控制”时，先读 [`references/shotboard-reference-image.md`](references/shotboard-reference-image.md)：用 Banana Pro / Nano Banana / GPT Image 2 等生图模型先出分镜指挥图，再把它和人物主体 / 人设图 / 场景图一起喂给 Seedance、可灵、Grok、Veo、Vidu、PixVerse 等参考生视频模型。

## 1. CLI 入口

```bash
AWB_CMD=awb
if ! command -v "$AWB_CMD" >/dev/null 2>&1; then
  if command -v opencli >/dev/null 2>&1 && opencli awb --help >/dev/null 2>&1; then
    AWB_CMD="opencli awb"
  else
    echo "No usable AWB CLI found" >&2
    exit 1
  fi
fi
```

- 默认优先 `awb`；机器上没有才退回 `opencli awb`
- 官网：`https://animeworkbench.lingjingai.cn/home`（需先完成注册并绑定微信，再来走 `login-qr`）

## 2. 模块地图

| 模块 | 处理的问题 | 入口 |
|------|-----------|------|
| 认证 | 登录状态、微信扫码 / 手机验证码、token 清理 | [`modules/auth.md`](modules/auth.md) |
| 工作区 | 账号、团队切换、项目组切换 / 创建 / 更新 / 成员 | [`modules/workspace.md`](modules/workspace.md) |
| 积分计费 | 团队 vs 项目组积分、积分包、充值、兑换、发票 | [`modules/billing.md`](modules/billing.md) |
| 模型发现 | 挑模型、读参数定义、解读参数白名单与通道差价 | [`modules/model.md`](modules/model.md) |
| 素材上传 | 通用素材、主体素材（三视图 / 正侧背） | [`modules/upload.md`](modules/upload.md) |
| 生图 | 标准生图、参考图、批量 | [`modules/image.md`](modules/image.md) |
| 生视频 | 首帧 / 首尾帧 / 参考 / 故事板 / 批量 | [`modules/video.md`](modules/video.md) |
| 任务跟踪 | 列表、阻塞等结果、拿结果链接 | [`modules/task.md`](modules/task.md) |

## 3. 深入参考

只有对应 module 把你引到这里时才读：

- [`references/subject-upload.md`](references/subject-upload.md) — 主体素材完整流程（四角度 + 组名拼接 + `nextRefSubject` 接力）
- [`references/model-options-read.md`](references/model-options-read.md) — 怎么读 `model-options` 输出与参数白名单
- [`references/batch-input-file.md`](references/batch-input-file.md) — `image-create-batch` / `video-create-batch` 输入文件格式
- [`references/storyboard.md`](references/storyboard.md) — 故事板模式 `--storyboardPrompts` 写法与适用模型
- [`references/shotboard-reference-image.md`](references/shotboard-reference-image.md) — 4/9 宫格分镜指挥图：先生图再作为视频参考

## 4. 全局执行规则

- 默认输出格式 `-f json`；长输出用 `jq` 摘要，不要把整段 JSON 或整张模型表回显给用户
- 用 `--model "<关键词>"` 缩小模型表，别先扫全量
- 创作命令优先 `image-fee` / `video-fee` 预算；只有结构复杂时再用 `--dryRun true`
- 参数以 `paramKeys` 为准；不在白名单的参数不传（GPT Image 2 无 `quality` / `generateNum`；千问无 `ratio`；FLUX 用 `customResolution`）
- 破坏性 / 写入命令（`auth-clear`、`team-select`、`project-group-*`、`redeem`、`invoice-apply`）支持 `--dryRun true`，没把握时先预览
- 涉及项目组积分的操作（所有创作命令、`points`、`tasks`）默认挂当前项目组；可用 `--projectGroupNo` 覆盖
- 创作失败先看项目组而非团队（`project-group-current` + `points`）

## 5. 版本与更新

- 本地 skill 版本：[`VERSION`](VERSION)
- 兼容信息：[`compat.json`](compat.json)
- 检查 / 执行更新：`scripts/check-update.sh` / `scripts/update.sh`
- AWB 命令探测：`scripts/resolve-awb-cmd.sh`
