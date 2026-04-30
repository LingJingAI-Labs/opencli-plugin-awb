# Task Module

任务查询要和生成提交解耦。AWB 后端保存任务，本地 JSONL 台账只是 agent 恢复和批量管理用的索引。

## 1. 核心概念

- `taskId`：创作命令返回的任务 ID。
- `taskType`：查询哪张任务表；生图、生视频、图像编辑、AiHubMix 外部视频不是同一类。
- `projectGroupNo`：任务挂在项目组下；跨项目组查询要显式传。
- `taskRecordFile`：本地 JSONL 台账，记录这次自动化提交过哪些任务，方便沙箱关闭后继续查。

已知 `taskId + taskType + projectGroupNo` 时，沙箱关闭后仍可查 AWB 后端；没记住 taskId 时，只能从近期任务列表按时间、模型和 prompt 摘要反找。

## 2. 命令入口

| 命令 | 用途 |
|------|------|
| `tasks` | 查项目组近期任务 |
| `task-wait` | 等单个任务完成或查一轮 |
| `task-records` | 看本地台账 |
| `task-record-poll` | 读取台账里的 pending 任务并回写结果 |
| `model-duration-estimate` | 按模型组估算平均耗时和建议等待秒数 |
| `task-duration-stats` | 手动查统计看板口径 |

## 3. 同步还是异步

- 单张普通图片：可以短窗口同步轮询，常用 90-180 秒；这是本轮查询窗口，不是平台 SLA。
- 多参考、高分辨率、多候选图：优先异步并写台账。
- 视频：默认异步或短窗口等待；不要为几分钟到十几分钟的任务长期卡住终端。
- 批量：先提交并记录 taskId，再分批轮询结果；不要逐条等完再提交下一条。

`task-wait` 超时只代表本次轮询结束，不代表任务失败。对用户描述时不要说“最多等待 N 秒”，应说“本轮轮询 N 秒；未完成也会保留 taskId，可继续查”。

## 4. 耗时估算

- 优先用 `model-duration-estimate --modelGroupCode <g> -f json`，看 `avgSeconds`、`suggestedWaitSeconds`、`confidence`。如果没有调用这个命令，就不能把 90-180 秒经验窗口描述成“预计耗时”或“最多等待”。
- 低置信度或需要人工校准时，再用 `task-duration-stats` 对齐统计看板。
- 看板地址：[task exec stat dashboard](https://monitor-statistics-llm.lingjingai.cn/static/task_exec_stat_dashboard.html)。字段不一定和 AWB 模型组一一对应，先宽口径查，再逐步加 `bizType / platformType / modelUseType / channel`。
- 看板没有数据时使用经验窗口：图片几十秒到几分钟，视频通常几分钟起，高复杂度和批量默认异步。

## 5. 台账建议

- 正式异步提交时加 `--taskRecordFile .awb/tasks.jsonl`。
- 台账至少保留 `taskId`、`taskType`、`projectGroupNo`、模型组、提交时间、输入序号和 prompt 摘要。
- `task-record-poll` 是恢复入口：读 pending 任务、查后端、把 checked / completed 事件追加回同一文件。
- 给用户汇报结果时只摘要首个结果链接、结果数量和失败原因，不要回显整段 JSON。
