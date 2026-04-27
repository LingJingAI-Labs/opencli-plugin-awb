# Task Module

查任务状态、等任务结果。

## 1. 何时使用

- 异步提交后（`image-create` / `video-create` 没加 `--waitSeconds`），拿 `taskId` 等结果
- 想看最近的任务列表（历史 / 同团队协作）
- 解耦创作与等待（并发多任务、脚本分阶段）

## 2. 核心概念

- **taskType**：任务分类，决定 `tasks` / `task-wait` 查哪张表。常见：
  - `IMAGE_CREATE`：生图
  - `VIDEO_CREATE`：单次生视频
  - `VIDEO_GROUP`：视频任务组（多数生视频命令走这个）
  - `IMAGE_EDIT`：图像编辑
- **taskId**：创作命令返回的任务 ID，用来查 / 等结果
- 任务挂在**项目组**下，默认查当前项目组；跨项目组用 `--projectGroupNo`
- **任务可恢复**：AWB 后端保存任务，`tasks` 可按项目组和类型查回自己的近期任务；只要知道 `taskId + taskType + projectGroupNo`，沙箱关闭后仍可继续 `task-wait`。
- **本地台账**：项目内 JSONL 不是查询后端的必要条件，而是给 agent / 批量自动化保存“这次提交了哪些任务”。CLI 当前不自动持久化提交清单；自动化/批量流程建议把 `taskId + taskType + projectGroupNo + modelGroupCode/modelName + submittedAt + prompt 摘要` 写到台账，避免回来后需要人工从任务列表里按时间和 prompt 反查。

## 3. 命令

| 命令 | 用途 | 路由提醒 |
|------|------|----------|
| `tasks --taskType <t>` | 列出最近任务 | `--pageSize 20`（默认）；`--minTime <ms>` 查某时间点之前 |
| `task-wait --taskId <id> --taskType <t>` | 阻塞等单个任务完成 | `--waitSeconds 300`（默认）；完成后返回 `firstResultUrl` / `resultFileList` |
| `task-records --taskRecordFile <file>` | 查看本地 JSONL 任务台账 | `--pendingOnly true` 只看本地尚未记录完成结果的任务 |
| `task-record-poll --taskRecordFile <file>` | 轮询台账里的未完成任务并回写结果 | 默认只查一轮；`--waitSeconds N` 持续轮询 |
| `task-duration-stats` | 查任务平均耗时 | 读统计看板 API；按 `bizType/platformType/modelUseType/channel` 最佳对齐 |

## 4. 常用写法

```bash
# 1) 异步提交：只拿 taskId
TASK_FILE=.awb/tasks.jsonl
TASK_ID=$("$AWB_CMD" image-create --modelGroupCode <g> --prompt "..." \
  --taskRecordFile "$TASK_FILE" -f json | jq -r '.taskId')

# 2) 单独等结果
"$AWB_CMD" task-wait --taskId "$TASK_ID" --taskType IMAGE_CREATE \
  --waitSeconds 180 --taskRecordFile "$TASK_FILE" -f json

# 看本地台账里还没记录完成结果的任务
"$AWB_CMD" task-records --taskRecordFile "$TASK_FILE" --pendingOnly true -f json

# 查一轮 pending 任务，并把 checked / completed 事件追加回同一个台账
"$AWB_CMD" task-record-poll --taskRecordFile "$TASK_FILE" -f json

# 后台持续轮询 5 分钟
"$AWB_CMD" task-record-poll --taskRecordFile "$TASK_FILE" \
  --waitSeconds 300 --pollIntervalMs 10000 -f json

# 看最近的生图任务
"$AWB_CMD" tasks --taskType IMAGE_CREATE --pageSize 20 -f json

# 看最近的生视频任务组
"$AWB_CMD" tasks --taskType VIDEO_GROUP --pageSize 20 -f json

# 跨项目组查
"$AWB_CMD" tasks --taskType IMAGE_CREATE --projectGroupNo <other> -f json

# 查某个时间点之前
"$AWB_CMD" tasks --taskType IMAGE_CREATE --minTime 1735689600000 -f json

# 查近 7 天 Seedance 2.0 视频平均耗时
"$AWB_CMD" task-duration-stats \
  --bizType 视频生成 --platformType volcengine --modelUseType seedance2.0 \
  --scope channel --granularity day -f json
```

## 5. 经验引导

- **什么时候同步 vs 异步**：
  - 单张图、用户正等结果 → 可用 `image-create --waitSeconds 90~180`，简单
  - 单个视频、预计几分钟 → 先异步提交拿 `taskId`；如用户要求等，再 `task-wait --waitSeconds 180~300`
  - 十分钟级视频 / Token 计费 / 高复杂度 → 异步更稳，周期性查询，不要把终端一直卡死
  - 并发多任务 / agent 驱动 → 拆两步，`image-create` / `video-create` 不等结果 → 并发拿多个 `taskId` → 再逐个 / 并发 `task-wait`
  - 批量 → 先 `*-batch --dryRun true` 预估并确认；正式提交后把每条 `taskId` 记录成 JSON/JSONL，再分批查询
- **推荐等待窗口**：
  - 图片：首次等 90–180 秒；超时后回报 taskId，并提示可继续查
  - 视频：首次等 180–300 秒；长视频不要默认等满 10 分钟
  - 批量：不要逐条同步等完再提交下一条；提交和查询解耦，必要时限制查询并发
- **耗时估算来源**：
  - 优先用 CLI 读统计看板：`task-duration-stats --bizType <业务> --platformType <平台> --modelUseType <模型用途> --scope channel -f json`
  - 统计看板地址：`https://monitor-statistics-llm.lingjingai.cn/static/task_exec_stat_dashboard.html`，按 task / channel / biz_type / platform_type / model_use_type / channel 过滤，看 `Avg Duration (s)`
  - 字段不是和 AWB `modelGroupCode` 精确一一对应：`bizType` 通常填 `图片生成` / `视频生成` / `字幕去除`；`platformType` 对齐供应商（如 `volcengine` / `jimeng` / `openai` / `qwen`）；`modelUseType` 对齐模型族或看板里的原始名称（如 `seedance2.0` / `doubao-seedance-2-0-260128` / `gpt-image-2`）；`channel` 用通道处理器名。对不上时先查宽口径，再逐步加过滤。
  - 看板不可用或没有目标组合时，再用下面的经验窗口
- **粗略经验窗口**：
  - 普通单图 / GPT Image 2 / Banana / Nano Banana：常见几十秒到 2 分钟，首次等待 90–180 秒
  - 多参考、高分辨率、多图返回：按 2–5 分钟预期，优先异步
  - 5–10 秒视频：常见几分钟，首次等待 180–300 秒
  - 10 分钟级排队/复杂视频/批量：不要阻塞终端等到底，提交后用台账轮询
  - 这些是兜底经验，不是模型 SLA；更细的个人侧均值可从历史任务的 `gmtCreate/gmtModified` 或本地台账的 `submittedAt/completedAt` 统计。
- **沙箱关闭后的恢复**：
  - 已拿到 `taskId`：直接 `task-wait --taskId <id> --taskType <t> --projectGroupNo <pg>` 或 `tasks --taskType <t> --projectGroupNo <pg>`
  - 没拿到 `taskId` 但任务已提交：用 `tasks --taskType <t> --projectGroupNo <pg> --pageSize 20` 按创建时间、模型、prompt 摘要找回
  - 因此异步/批量正式提交时加 `--taskRecordFile .awb/tasks.jsonl`；批量尤其不能只靠对话上下文
- **本地台账怎么用**：
  - `image-create` / `video-create` / `*-batch --taskRecordFile .awb/tasks.jsonl` 会追加 `submitted` 事件
  - `task-wait --taskRecordFile .awb/tasks.jsonl` 会追加 `checked` 或 `completed` 事件
  - `task-records --pendingOnly true` 只看本地台账里尚未记录完成结果的任务；真正状态仍以 AWB 后端查询为准
  - `task-record-poll` 是批量恢复入口：读取 pending 任务、查后端、把结果追加回台账；默认只查一轮，适合定时执行
- **`taskType` 选对了没？** 大部分生视频命令完成后会回到 `VIDEO_GROUP`，不是 `VIDEO_CREATE`；查错类型会看不到任务。`image-create` / `image-edit` 分开。
- **结果字段**：
  - `firstResultUrl`：首张 / 首段 URL，适合直接消费
  - `resultFileList`：全部结果 URL 数组
  - `resultFileDisplayList`：含展示名
- **超时不等于失败**：`task-wait --waitSeconds 180` 超时只是本次轮询结束；任务仍在排队 / 执行。重新 `task-wait` 或看 `tasks` 里的 `任务状态`。
- **`--minTime` 是毫秒时间戳上界**：表示"这个时间之前"；想看最近 N 条直接默认即可，不需要算时间戳。
- **别让 `task-wait` 把整段 JSON 回显给用户**：结果 URL 列表可能很长；只回首个结果 + 数量。
