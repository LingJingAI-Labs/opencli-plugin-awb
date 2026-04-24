# Video Module

生视频覆盖四种主要模式，**不能混用**：纯提示词 / 首尾帧 / 参考生视频 / 故事板。

## 1. 何时使用

- 生成一段视频（有 / 无首帧、有 / 无参考、单镜头或分镜）
- 预估消耗 / 干跑
- 批量生视频

## 2. 命令与模式

| 命令 | 用途 | 路由提醒 |
|------|------|----------|
| `video-fee` | 估算单次生视频积分与项目组余额 | Token 计费模型（如 Seedance 2.0）特别要先跑这个 |
| `video-create` | 单次生视频 | `--waitSeconds 180` 同步等；视频通常比图慢，建议给大一点 |
| `video-create-batch` | 批量生视频 | `--inputFile` 见 [`../references/batch-input-file.md`](../references/batch-input-file.md) |

### 四种模式

| 模式 | 核心参数 | 适用 |
|------|----------|------|
| 纯提示词 | `--prompt` | 模型 `supportsPromptOnly=true` |
| 首尾帧 | `--frameText` / `--frameFile` / `--frameUrl` (+ `--tailFrame*`) | 看模型 `frameFeature`（可首 / 可首尾 / 仅首） |
| 参考生视频 | `--refImageFiles` / `--refVideoFiles` / `--refAudioFiles` / `--refSubjects` + prompt 里 `@名称` | 看模型 `参考模式` / `refFeature` |
| 故事板 | `--storyboardPrompts "镜头1：xxx||镜头2：yyy"` | 仅 `paramKeys` 含 `multi_prompt`（可灵 3.0 / 3.0-Omni 等）；详见 [`../references/storyboard.md`](../references/storyboard.md) |

**不要混用**：四种模式互斥。故事板模式不要再混用 `frame*` / `ref*`；首尾帧模式的 `frame*` 和参考生视频模式的 `ref*` 也不能同时出现。

## 3. 标准流程

```bash
# 1) 看能力
"$AWB_CMD" model-options --modelGroupCode <g> -f json

# 2) 预估
"$AWB_CMD" video-fee --modelGroupCode <g> --frameFile ./frame.webp \
  --quality 720 --generatedTime 5 --ratio 16:9 -f json

# 3) 正式提交
"$AWB_CMD" video-create --modelGroupCode <g> --frameFile ./frame.webp \
  --quality 720 --generatedTime 5 --ratio 16:9 --waitSeconds 180 -f json
```

## 4. 典型场景

### 4.1 纯提示词（需 `supportsPromptOnly=true`）

```bash
"$AWB_CMD" video-create --modelGroupCode <g> \
  --prompt "雨夜街头，人物缓慢走向镜头，电影感" \
  --quality 720 --generatedTime 5 --ratio 16:9 --waitSeconds 180 -f json
```

### 4.2 首帧

```bash
"$AWB_CMD" video-create --modelGroupCode <g> --frameFile ./frame.webp \
  --prompt "保持首帧角色，镜头缓慢推进，人物抬头微笑" \
  --quality 720 --generatedTime 5 --ratio 16:9 --waitSeconds 180 -f json
```

### 4.3 首尾帧

```bash
"$AWB_CMD" video-create --modelGroupCode <g> \
  --frameFile ./frame.webp --tailFrameFile ./tail.webp \
  --quality 720 --generatedTime 5 --ratio 16:9 --waitSeconds 180 -f json
```

### 4.4 只描述首帧（文字帧）

```bash
"$AWB_CMD" video-create --modelGroupCode <g> --frameText "镜头缓慢推进" \
  --quality 720 --generatedTime 5 --ratio 16:9 --waitSeconds 180 -f json
```

### 4.5 多参考（图 / 视频 / 音频）

```bash
"$AWB_CMD" video-create --modelGroupCode <g> --prompt "@角色A 在雨夜奔跑" \
  --refImageFiles "角色A=./char.webp,背景=./bg.webp" \
  --refVideoFiles "动作=./motion.mp4" \
  --quality 720 --generatedTime 5 --ratio 16:9 --waitSeconds 180 -f json
```

`@名称` 在 prompt 里引用，**名称必须与 `--refImageFiles / --refSubjects` 里的左值一致**。

### 4.6 主体引用 + 音频（常用 wr 真人说话）

```bash
"$AWB_CMD" video-create --modelGroupCode <g> --prompt "@小莉 对镜说话" \
  --refSubjects "小莉=asset-xxxxxxxx" \
  --refAudioFiles "小莉=./voice.mp3" \
  --quality 720 --generatedTime 5 --ratio 9:16 --waitSeconds 180 -f json
```

音频参考**默认绑定到同名图片 / 主体**；不同名要用 `--refAudiosJson` 的 `bindTo`。

### 4.7 故事板（仅支持的模型）

```bash
"$AWB_CMD" video-create --modelGroupCode KeLing3_VideoCreate_Group \
  --storyboardPrompts "镜头1：城市远景||镜头2：人物走近镜头" \
  --quality 720 --generatedTime 10 --ratio 16:9 --waitSeconds 240 -f json
```

新版本 CLI 会按 `--generatedTime` 自动给每个分镜补 `index` 和秒级 `duration`；旧版本若报 `each entry in multi_prompt must have index and duration`，先更新 CLI。

详细写法见 [`../references/storyboard.md`](../references/storyboard.md)。

### 4.8 批量

```bash
"$AWB_CMD" video-create-batch --inputFile ./video-batch.json \
  --modelGroupCode <g> --quality 720 --generatedTime 5 --ratio 16:9 \
  --dryRun true -f json
```

## 5. 经验引导

- **先确认模式**：`model-options` 看 `supportsPromptOnly` / `frameFeature` / `refFeature` / `paramKeys`；不支持纯 prompt 的模型传了 `--prompt` 也得补帧或参考。
- **四种模式不共存**：选了故事板就不要传 `frame*` / `ref*`；选了首尾帧就别传 `ref*`；选了参考生视频就别传 `frame*`。想更底层的控制去 `--framesJson` / `--promptParamsJson`。
- **`@名称` 要和命名参考对得上**：
  - `--prompt "@角色A 在雨夜"` + `--refImageFiles "角色A=./a.webp"` → 一致 ✓
  - `--prompt "@charA ..."` + `--refImageFiles "角色A=..."` → 不一致 ✗
- **`--refAudioFiles` 的绑定是隐式的**：默认按同名图片 / 主体配对（`角色A=./voice.mp3` 绑定到 `角色A` 的图 / 主体）。混用异名时用 `--refAudiosJson` 的 `bindTo` 显式指。
- **`--quality` 的数值单位跟模型走**：生视频常见 `720` / `1080`（数字）；生图常见 `1K` / `2K`（字母）。看 `model-options` 的 `约束` 列。
- **`--generatedTime` 单位是秒**：常见 5 / 10 / 15；部分模型只接离散值。可灵 3.0（非 Omni）的参考生视频 `multi_param` 路径截至 2026-04-24 实测 10 秒可创建、15 秒会失败；可灵 3.0-Omni 同路径 15 秒已实测可成功。CLI 当前只拦截已验证会失败的非 Omni 15 秒路径。
- **Token 计费模型（Seedance 2.0 系列）先 `video-fee`**：和按张 / 按次计费的不一样，提示词长度 / 参考数量都会推高成本。
- **故事板、音效开关不是所有模型都有**：查 `video-models` 的 `特色能力` 列；也能在 `paramKeys` 里看 `multi_prompt` / `audio` 是否存在。故事板分镜 `duration` 是秒，总和必须等于 `--generatedTime`。
- **`--waitSeconds 180` 起步**：视频任务比生图慢得多；想完全异步就 `--waitSeconds 0`，拿 `taskId` 走 `task-wait`。
