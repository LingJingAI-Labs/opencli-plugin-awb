# 批量输入文件：`image-create-batch` / `video-create-batch`

`--inputFile` 支持四种格式，**单条的字段优先级高于命令行默认值**。

## 1. 支持的格式

### 1.1 JSON 数组（推荐）

```json
[
  { "prompt": "一只小狗", "ratio": "16:9" },
  { "prompt": "一只猫", "ratio": "1:1", "generateNum": 2 },
  { "prompt": "一条鱼", "irefFiles": "./fish.webp" }
]
```

### 1.2 带 `items` 的 JSON 对象

```json
{
  "items": [
    { "prompt": "一只小狗" },
    { "prompt": "一只猫" }
  ]
}
```

### 1.3 JSONL（一行一条）

```jsonl
{"prompt": "一只小狗"}
{"prompt": "一只猫", "generateNum": 2}
{"prompt": "一只鱼", "irefFiles": "./fish.webp"}
```

### 1.4 纯文本（一行一个 prompt）

```
一只小狗
一只猫
一只鱼
```

纯文本等价于只写 `prompt` 字段，其他参数全部从命令行默认值取。

## 2. 字段速查

### 2.1 生图（`image-create-batch`）

| 字段 | 对应 CLI flag | 说明 |
|------|---------------|------|
| `modelCode` / `modelGroupCode` | `--modelCode` / `--modelGroupCode` | 单条级别覆盖；一般在命令行统一指定即可 |
| `prompt` | `--prompt` | 必填 |
| `ratio` | `--ratio` | 模型支持时 |
| `quality` | `--quality` | 模型支持时 |
| `generateNum` | `--generateNum` | 支持多图的模型 |
| `directGenerateNum` | `--directGenerateNum` | 千问等 |
| `crefFiles` / `srefFiles` / `irefFiles` | 同名 flag | 本地文件，CLI 自动上传 |
| `cref` / `sref` / `iref` | 同名 flag | 已上传的 backendPath |
| `promptParamsJson` | `--promptParamsJson` | 整体覆盖 JSON，极端场景 |
| `projectGroupNo` | `--projectGroupNo` | 单条投到不同项目组 |

### 2.2 生视频（`video-create-batch`）

| 字段 | 对应 CLI flag | 说明 |
|------|---------------|------|
| `modelCode` / `modelGroupCode` | 同名 flag | 一般在命令行统一 |
| `prompt` | `--prompt` | 纯 prompt 模型 |
| `frameText` / `frameUrl` / `frameFile` | 同名 flag | 首帧三选一 |
| `tailFrameText` / `tailFrameUrl` / `tailFrameFile` | 同名 flag | 尾帧三选一 |
| `ratio` / `quality` / `generatedTime` | 同名 flag | 常见三件套 |
| `refImageFiles` / `refImageUrls` / `refImagesJson` | 同名 flag | 参考图（命名绑定） |
| `refVideoFiles` / `refVideoUrls` / `refVideosJson` | 同名 flag | 参考视频 |
| `refAudioFiles` / `refAudioUrls` / `refAudiosJson` | 同名 flag | 参考音频（默认绑定同名图 / 主体） |
| `refSubjects` / `refSubjectsJson` | 同名 flag | 已有主体 ID |
| `storyboardPrompts` | `--storyboardPrompts` | 故事板 |
| `audio` / `needAudio` | 同名 flag | 是否让结果带声音 |
| `promptParamsJson` / `framesJson` | 同名 flag | 极端结构 |

## 3. 命令行默认值 vs 单条字段

**原则：通用放命令行，个性化放文件**。

```bash
# 命令行 = 默认值；文件 = 差异
"$AWB_CMD" image-create-batch \
  --inputFile ./image-batch.json \
  --modelGroupCode Nano_Banana2_ImageCreate_Group_Discount \
  --quality 1K --ratio 16:9 --generateNum 1 \
  --dryRun true -f json
```

配合的 `image-batch.json`：

```json
[
  { "prompt": "一只小狗在雨夜奔跑" },
  { "prompt": "人物特写肖像", "ratio": "3:4" },
  { "prompt": "参考构图", "irefFiles": "./ref.webp", "generateNum": 2 }
]
```

运行时：

- 第 1 条：用命令行默认（Nano Banana 2 / 1K / 16:9 / 1）
- 第 2 条：`ratio` 覆盖为 3:4，其他仍是默认
- 第 3 条：带参考图 + 返回 2 张

## 4. 完整示例

### 生图：四条，不同比例 + 不同参考

```json
[
  { "prompt": "小狗坐在木地板上", "ratio": "1:1" },
  { "prompt": "小狗跳跃的瞬间", "ratio": "16:9" },
  { "prompt": "小狗在雪地里", "ratio": "3:4", "irefFiles": "./snow.webp" },
  { "prompt": "小狗与主人", "ratio": "9:16", "generateNum": 2 }
]
```

```bash
"$AWB_CMD" image-create-batch --inputFile ./dogs.json \
  --modelGroupCode Nano_Banana2_ImageCreate_Group_Discount \
  --quality 1K --generateNum 1 \
  --dryRun true -f json
```

### 生视频：混合 prompt-only / 首帧 / 参考

```json
[
  { "prompt": "雨夜街头，人物走向镜头" },
  { "frameFile": "./a.webp", "prompt": "镜头缓慢推进" },
  { "prompt": "@角色A 在奔跑", "refImageFiles": "角色A=./char.webp" }
]
```

```bash
"$AWB_CMD" video-create-batch --inputFile ./shots.json \
  --modelGroupCode <g> --quality 720 --generatedTime 5 --ratio 16:9 \
  --dryRun true -f json
```

## 5. 并发与限流

- `--concurrency` 默认 `1`（串行）；加大后端并发，但要留意项目组积分和任务并发限制
- 建议先 `--dryRun true` 看每条预估 + 项目组余额，再正式提交
- 批量失败不会回滚已成功的任务
- 批量正式提交前必须给用户看：条数、模型通道、公共参数、总预计积分、最低剩余余额、并发数、等待/查询策略
- 正式提交时加 `--taskRecordFile .awb/tasks.jsonl`，CLI 会记录每条 `taskId`、`taskType`、`projectGroupNo`、输入序号和 prompt 摘要；不要只依赖终端滚动输出

## 6. 经验引导

- **`--dryRun true` 前置**：批量里一条格式错就可能把整批卡住；干跑先让每条都返回"预计积分 / 项目组剩余"的预览行，再正式提交。
- **提交与等待解耦**：批量任务应先批量提交拿任务 ID，再按 taskType 查询；除非用户只跑很少几张图，否则不要在每条任务上同步等待。查询时用 `task-record-poll --taskRecordFile .awb/tasks.jsonl`，让完成事件写回台账。
- **`*Files` 字段值用相对路径 / 绝对路径均可**：CLI 按进程工作目录解析；脚本里别靠 `~` 扩展。
- **JSONL 对 agent 写入更友好**：每行独立，流式生成也能推进；不用一次性构造整个数组。
- **纯文本是最轻的快速入口**：一批 prompt 批量跑时，`echo "..." > prompts.txt` + 命令行传所有默认值就能跑。
- **命令行默认参数只在单条"没传"时才补**：单条已写的字段优先，不会被命令行覆盖。
- **字段名是 CLI flag 去掉 `--`**（驼峰保持），不是 `model-options` 的底层 paramKey。例：用 `generateNum`，不是 `generate_num`。
