# 批量输入文件

`image-create-batch` / `video-create-batch` 的 `--inputFile` 用来描述每条任务的差异。具体字段名以对应命令 `--help` 和 `model-options` 为准；这里只记录批量设计原则。

## 1. 支持格式

- JSON 数组：适合结构清晰的批量任务。
- `{"items":[...]}`：适合外层还要带元信息的文件。
- JSONL：一行一条，最适合 agent 流式写入和断点续写。
- 纯文本：一行一个 prompt，其他参数全部走命令行默认值。

单条里的字段优先级高于命令行默认值。通用配置放命令行，差异放输入文件。

## 2. 字段口径

- 字段名通常是 CLI flag 去掉 `--` 后的驼峰写法，例如 `generatedTime`、`refImageFiles`；不是底层 paramKey。
- 单条可以覆盖 `modelGroupCode`、prompt、比例、清晰度、候选数量、帧图、参考素材、项目组等。
- 图片参考对用户语义写“参考图片 / 角色参考图片 / 风格参考图片”；文件里才使用 CLI 字段。
- 视频参考用命名绑定时，prompt 里的名称要和文件字段里的左值一致。
- `promptParamsJson` / `framesJson` / `refImagesJson` 这类 JSON 字段是逃生口，只有普通字段表达不了时才用。

## 3. 提交策略

- 批量正式提交前先 `--dryRun true`，确认条数、模型通道、公共参数、总预计费用、最低剩余余额和并发数。
- 正式提交时加 `--taskRecordFile .awb/tasks.jsonl`，让每条任务的 `taskId / taskType / projectGroupNo / 输入序号 / prompt 摘要` 留在项目内。
- 批量不要逐条同步等完再提交下一条；提交和查询解耦，后续用 `task-record-poll` 或 `task-wait` 分批拿结果。
- `--concurrency` 谨慎提高；要同时考虑项目组余额、平台并发限制和任务失败后的排查成本。
- 批量失败不会回滚已成功提交的任务，所以台账比终端滚动输出更可靠。
