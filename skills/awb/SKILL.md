---
name: awb
description: 使用 `awb` / `opencli awb` 操作 Anime Workbench（灵境 AI）。覆盖认证、团队 / 项目组切换、模型发现、生图 / 生视频、批量、任务跟踪、素材上传、积分开票。涉及参考图、首尾帧、多参考、故事板、主体素材、批量输入、通道差价等子场景时，先读对应 module 再执行命令。
---

# AWB Skill

> **前置条件**：先读 [`modules/auth.md`](modules/auth.md)，确认登录与项目组就位。
> **执行前必做**：进到 module 里按表格定位命令，再按 must-read / deep-dive 的链接阅读。参数细节以 `model-options` 和 `<cmd> --help` 为准。
> **真人短剧高频入口**：用户说“真人 / 角色图 + 场景图 + 控音色 / 说话 / 对口型 / 短剧片段”时，先读 [`modules/video.md`](modules/video.md)，再读 [`modules/upload.md`](modules/upload.md) 和 [`references/subject-upload.md`](references/subject-upload.md)。Seedance 2.0 主体资产链路和普通参考图直传是两条不同路径，要按权限、复用需求和模型能力选择。
> **分镜指挥图高频入口**：用户说“4 宫格 / 9 宫格 / 分镜图 / 指挥图 / 镜头切换控制”时，先读 [`references/shotboard-reference-image.md`](references/shotboard-reference-image.md)：先生图得到一张分镜指挥图，再把它作为普通参考图喂给当前已接入且 `model-options` 支持参考图 / 多参考的视频模型。
> 只有 Seedance 2.0 主体资产路线才额外使用 `--refSubjects`。

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

- Agent 调 CLI 默认用 `-f json`，但必须配合 `jq` / `node` 只抽需要字段；不要让整段 JSON 或整张模型表进入上下文
- **创作前先核对归属**：正式创作前先用 `me` / `project-groups` 确认当前团队、当前项目组、可用项目组和余额；向用户说明任务会挂到哪个项目组。当前项目组不明显匹配用户意图，或存在多个候选项目组时，先问是否切换或改用 `--projectGroupNo`。
- 用 `--model "<关键词>"` 缩小模型表，别先扫全量
- **选模型先讲通道和参数**：同一模型可能有多个模型组 / 通道 / 折扣 / 队列 / 成功率 / 参数白名单；先用 `image-models` / `video-models` 找候选，再用 `model-options` 查最终可传参数和可选值。不要凭模型名直接提交。
- 创作命令优先 `image-fee` / `video-fee` 预算；只有结构复杂时再用 `--dryRun true`
- **创作前必须确认**：除非用户已经明确说“直接生成 / 不用确认 / 自动跑 / 批量全部提交”，正式 `image-create` / `video-create` / `*-batch` 前必须先把模型组、通道/折扣、关键参数、最终提示词/参考素材、预估积分、项目组余额、等待策略汇总给用户确认。低费用也不能替代确认。
- **参数不能替用户静默定档**：如果用户没明确给出，提交前要问清或给出默认建议并等待确认：生图 `ratio`、`quality`（如 `1K/2K/4K`）、`generateNum`；生视频 `ratio`、`quality`（如 `720/1080`）、`generatedTime`、是否输出声音 / 是否带音色参考 / 主体引用。
- **提示词要成稿确认**：先把用户意图整理成最终 prompt；有参考图、人物、场景、镜头、风格、字幕、声音要求时写进 prompt 或参数绑定摘要里。正式提交前让用户确认这版 prompt 和关键参数。
- **不要替用户静默选贵通道**：同一模型有标准 / Fast / Discount / Pro / 1080p 等通道时，先说明差异并默认选便宜试片通道；效果优先或高规格交付必须得到用户确认。
- 参数以实时 `image-models` / `video-models` 和 `model-options` 为准；不在白名单的参数不传
- 破坏性 / 写入命令（`auth-clear`、`team-select`、`project-group-*`、`redeem`、`invoice-apply`）支持 `--dryRun true`，没把握时先预览
- 涉及项目组积分的操作（所有创作命令、`points`、`tasks`）默认挂当前项目组；可用 `--projectGroupNo` 覆盖
- 创作失败先看项目组而非团队（`project-group-current` + `points`）
- **等待默认策略**：90–180 秒只是普通单图的前台轮询窗口，不是 AWB 平台 SLA，也不是任务最长耗时。对用户汇报时说“本轮先等 / 查询窗口 N 秒”，不要说“最多等待 N 秒”。视频、Token 计费、高复杂度、多张候选和批量任务默认异步提交；异步/批量提交时加 `--taskRecordFile .awb/tasks.jsonl`，保存 taskId 后再 `task-wait` / `tasks` 查询。`task-wait` 超时只代表本次轮询结束，不代表任务失败。

## 5. 版本与更新

- 本地 skill 版本：[`VERSION`](VERSION)
- 兼容信息：[`compat.json`](compat.json)
- 检查 / 执行更新：`scripts/check-update.sh` / `scripts/update.sh`
- AWB 命令探测：`scripts/resolve-awb-cmd.sh`
