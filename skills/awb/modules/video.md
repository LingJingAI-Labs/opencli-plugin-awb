# Video Module

生视频覆盖四种主要模式，**不能混用**：纯提示词 / 首尾帧 / 参考生视频 / 故事板。

## 1. 何时使用

- 生成一段视频（有 / 无首帧、有 / 无参考、单镜头或分镜）
- 预估消耗 / 干跑
- 批量生视频
- 用户提到“真人图 / 场景图 / 控音色 / 说话 / 对口型 / 短剧片段”时，按下面 **4.7 真人短剧** 处理：先解释主体发布 / 加白链路，再给一次性 webp 直传备选
- 用户提到“4 宫格 / 9 宫格 / 分镜图 / 指挥图 / 镜头切换控制”时，按下面 **4.8 分镜指挥图** 处理：先生图得到指挥图，再作为参考生视频输入

## 2. 命令与模式

| 命令 | 用途 | 路由提醒 |
|------|------|----------|
| `video-fee` | 估算单次生视频积分与项目组余额 | Token 计费模型（如 Seedance 2.0）特别要先跑这个 |
| `video-create` | 单次生视频 | `--waitSeconds 180` 同步等；视频通常比图慢，建议给大一点 |
| `video-create-batch` | 批量生视频 | `--inputFile` 见 [`../references/batch-input-file.md`](../references/batch-input-file.md) |
| `seedance-subtitle-remove` | Seedance 2.0 生成后去字幕 | 只接火山原始 Seedance 2.0 视频链接；生成后 24 小时内处理 |
| `seedance-subtitle-status` | 查询去字幕任务 | asset-edit 任务 ID；可短窗口等待 |
| `aihubmix-video-status` | 查询 AiHubMix 外部视频任务 | HappyHorse 等外部任务；默认读 `AIHUBMIX_API_KEY` |
| `aihubmix-video-download` | 下载 AiHubMix 视频结果 | 调 `/v1/videos/{video_id}/content` 保存 mp4 |

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

# 3) 用户确认后，正式提交
"$AWB_CMD" video-create --modelGroupCode <g> --frameFile ./frame.webp \
  --quality 720 --generatedTime 5 --ratio 16:9 --waitSeconds 180 -f json
```

提交前给用户确认的最小摘要：

- 模型 / 通道：`modelGroupCode`，说明 Fast / Pro / Omni / Discount / 1080p 等取舍
- 模式：纯提示词、首尾帧、参考生视频、故事板四选一；说明没有混用互斥参数
- 参数：`ratio`、`quality`（如 `720/1080`，以 `model-options` 可选值为准）、`generatedTime`、音效 / 音频 / 主体引用
- 输入：最终 prompt / storyboard；帧图、参考图、参考视频、音频、主体 asset 的绑定关系
- 费用：预计积分、项目组余额、提交后预计剩余；Token 计费模型必须先估算
- 等待：视频默认异步或短窗口等待；超过窗口后保存 `taskId`，后续用 `task-wait` / `tasks` 取结果

### 自动化默认路线（短剧 / 多参考 / 主体）

自动化生成短剧片段时，最常见不是纯 prompt 或首尾帧，而是**参考生视频**：人物主体 / 人物形象图 + 场景图 + 可选音色。默认按这个顺序决策：

1. **已有主体 / 多段复用**：用 `--refSubjects "角色=asset-..."` 引用人物主体；场景用 `--refImageFiles` / `--refImageUrls`。
2. **只有人物形象图**：先问是否要做成可复用主体；做剧、多镜头、同角色复用时先 `subject-publish`，试片才直接 `--refImageFiles`。
3. **要控音色**：上传 / 引用音频，用 `--refAudioFiles` / `--refAudioUrls`，左值绑定到同名人物主体或图片；异名用 `名称@绑定目标=文件` 或 `--refAudiosJson bindTo`。
4. **要控镜头切换**：先用 Banana Pro / Nano Banana / GPT Image 2 出 4 / 9 宫格分镜指挥图，再把它作为一张参考图传给视频模型。
5. **模型取舍**：效果优先用 Seedance 2.0 720p；预算优先用 Seedance 2.0 Fast 或 Grok；可灵 3.0 / Omni 可用但音色引用链路更复杂，需按 `model-options` 确认。
6. **成本控制**：Seedance 2.0 系列是 Token 计费，默认先 `video-fee`，默认 `720p`；只有用户明确要高质交付再上 `1080p`。
7. **确认闸口**：短剧 / 说话 / 对口型任务通常成本和等待时间都更高，正式提交前必须让用户确认模型通道、时长、清晰度、主体/音频绑定和预计积分；用户明确说自动跑时才跳过。

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

### 4.7 真人短剧：真人图 + 场景图 + 控音色

用户说“真人”“短剧”“控制音色 / 说话 / 对口型”时，不要只推荐 `--refImageFiles` 一步法。先把路线讲清楚：

1. **模型选择**：效果优先 Seedance 2.0（默认 720p，1080p 太贵时先提醒）；成本 / 速度优先 Seedance 2.0 Fast；便宜试片可考虑 Grok；可灵 3.0 / 3.0-Omni 也可做主体 / 多参考，但音色引用链路更麻烦。“音效开关”只代表自动配乐 / 音效，不等于控音色。
2. **角色一致性优先路径**：真人角色图先走 `subject-publish` / `subject-upload` 发布为主体（也就是平台加白 / 可引用资产链路），拿返回的 `nextRefSubject` 填 `--refSubjects`。
3. **场景图路径**：场景不是主体，通常直接 `--refImageFiles "场景=./scene.webp"`，或先 `upload-files --sceneType material-video-create` 后用 `--refImageUrls` 复用。
4. **一次性备选路径**：如果只是试片、账号无主体权限、或用户明确说“不上传 / 直接传 webp”，可以直接 `--refImageFiles "小莉=./person.webp,咖啡馆=./scene.webp"`；但要提醒这不是可复用主体，跨片一致性弱于 `--refSubjects`。
5. **音色路径**：先用外部 TTS / 录音产出 `mp3` / `wav`，再用 `--refAudioFiles "小莉=./voice.mp3"`；左值和主体 / 图片名保持一致，默认绑定到同名角色。
6. **短剧分镜**：一个任务通常做 5–10 秒单镜头；多镜头短剧拆成多段分别生成，再剪辑拼接。故事板模式和音频 / 主体参考不要默认混用，除非 `model-options` 明确支持且参数白名单允许。

模型建议话术：

- **Seedance 2.0**：目前效果最好、最贵；默认推荐 `720p`，`1080p` 只在预算允许时上。
- **Seedance 2.0 Fast**：自动化批量更常用，便宜 / 快，但质量会降。
- **可灵 3.0 / 3.0-Omni**：可以用主体 / 多参考，Omni 也常用于更复杂参考；如果要控音色，必须确认 `model-options` 与 CLI 生成的 `multi_param + audio` 结构，不要只传 `--audio true`。
- **Grok**：便宜备选，可用于试片或低成本参考生成，不要承诺稳定口型 / 音色效果。

推荐流程（可复用真人主体 + 场景图 + 音频）：

```bash
# 1) 真人图上传到生视频素材池（可选，但便于复用 backendPath）
CHAR_PATH=$("$AWB_CMD" upload-files --files ./person.webp \
  --sceneType material-video-create -f json | jq -r '.[0].backendPath // .[0].素材路径')

# 2) 发布 / 加白为可复用主体，直接取 nextRefSubject
NEXT_REF=$("$AWB_CMD" subject-publish --name 小莉 \
  --primaryUrl "$CHAR_PATH" -f json | jq -r '.nextRefSubject')

# 3) 先估价，再正式生成
"$AWB_CMD" video-fee --modelGroupCode JiMeng_Seedance_2_Fast_VideoCreate_Group \
  --prompt "@小莉 在 @咖啡馆 里低声说话，口型自然，短剧镜头" \
  --refSubjects "$NEXT_REF" \
  --refImageFiles "咖啡馆=./scene.webp" \
  --refAudioFiles "小莉=./voice.mp3" \
  --quality 720 --generatedTime 5 --ratio 9:16 -f json

"$AWB_CMD" video-create --modelGroupCode JiMeng_Seedance_2_Fast_VideoCreate_Group \
  --prompt "@小莉 在 @咖啡馆 里低声说话，口型自然，短剧镜头" \
  --refSubjects "$NEXT_REF" \
  --refImageFiles "咖啡馆=./scene.webp" \
  --refAudioFiles "小莉=./voice.mp3" \
  --quality 720 --generatedTime 5 --ratio 9:16 --waitSeconds 240 -f json
```

一次性直传 webp（试片 / 无主体权限 / 用户明确不走加白）：

```bash
"$AWB_CMD" video-create --modelGroupCode JiMeng_Seedance_2_Fast_VideoCreate_Group \
  --prompt "@小莉 在 @咖啡馆 里低声说话，口型自然，短剧镜头" \
  --refImageFiles "小莉=./person.webp,咖啡馆=./scene.webp" \
  --refAudioFiles "小莉=./voice.mp3" \
  --quality 720 --generatedTime 5 --ratio 9:16 --waitSeconds 240 -f json
```

### 4.8 分镜指挥图 + 人设图 + 场景图

如果用户要更稳定地控制分镜切换，可以先用生图模型生成一张 4 / 9 宫格“分镜指挥图”，再把它作为参考图喂给参考生视频模型。它和 `--storyboardPrompts` 不是同一种模式：这里仍然走参考生视频 `multi_param`，不要混用故事板模式。完整生图流程见 [`../references/shotboard-reference-image.md`](../references/shotboard-reference-image.md)。

典型输入组合：

- `分镜指挥图`：来自 Banana Pro / Nano Banana / GPT Image 2 的 4 / 9 宫格图，用来控制镜头顺序、构图和节奏。
- `人物主体 / 人设图`：用 `--refSubjects` 最稳；试片可用普通 `--refImageFiles`。
- `场景图`：继续单独作为命名图片参考，别只依赖分镜图里的小场景。
- `音色`：需要控音色时继续 `--refAudioFiles` / `--refAudioUrls` 绑定到同名人物。

```bash
"$AWB_CMD" video-create --modelGroupCode JiMeng_Seedance_2_VideoCreate_Group \
  --prompt "参考 @分镜指挥图 的1到9格镜头顺序、构图和节奏生成连续短剧视频；保持 @小莉 的人物形象，场景是 @咖啡馆；不要出现九宫格边框、编号或字幕，画面自然连续，口型自然。" \
  --refSubjects "小莉=asset-xxxxxxxx" \
  --refImageFiles "分镜指挥图=./shotboard.webp,咖啡馆=./scene.webp" \
  --refAudioFiles "小莉=./voice.mp3" \
  --quality 720 --generatedTime 10 --ratio 9:16 --waitSeconds 240 -f json
```

无主体权限 / 快速试片：

```bash
"$AWB_CMD" video-create --modelGroupCode <video_g> \
  --prompt "参考 @分镜指挥图 的4格镜头顺序生成视频；@小莉 是人物形象，@咖啡馆 是场景；不要出现宫格边框和编号。" \
  --refImageFiles "分镜指挥图=./shotboard.webp,小莉=./person.webp,咖啡馆=./scene.webp" \
  --quality 720 --generatedTime 5 --ratio 9:16 --waitSeconds 240 -f json
```

可用于 Seedance 2.0、可灵 3.0-Omni、Grok、Veo、Vidu、PixVerse 等参考图 / 多参考视频模型；实际传参前仍以 `model-options` 的 `multi_param` / `refFeature` / `paramKeys` 为准。

### 4.9 故事板（仅支持的模型）

```bash
"$AWB_CMD" video-create --modelGroupCode KeLing3_VideoCreate_Group \
  --storyboardPrompts "镜头1：城市远景||镜头2：人物走近镜头" \
  --quality 720 --generatedTime 10 --ratio 16:9 --waitSeconds 240 -f json
```

新版本 CLI 会按 `--generatedTime` 自动给每个分镜补 `index` 和秒级 `duration`；旧版本若报 `each entry in multi_prompt must have index and duration`，先更新 CLI。

详细写法见 [`../references/storyboard.md`](../references/storyboard.md)。

### 4.10 批量

```bash
"$AWB_CMD" video-create-batch --inputFile ./video-batch.json \
  --modelGroupCode <g> --quality 720 --generatedTime 5 --ratio 16:9 \
  --dryRun true -f json
```

### 4.11 Seedance 2.0 生成后去字幕

只在 **Seedance 2.0** 生视频结果上用。输入必须是火山 / Seedance 2.0 的原始视频链接，不要用下载后重新上传的 CDN 链接或任意公网视频链接。免费链路要求在视频生成完成后 **24 小时内** 提交；超过 24 小时通常只能走付费处理。

```bash
# 1) 先等 Seedance 2.0 视频完成，拿原始火山结果链接
"$AWB_CMD" task-wait --taskId <videoTaskId> --taskType VIDEO_GROUP \
  --waitSeconds 300 -f json

# 2) 24 小时内提交去字幕任务
"$AWB_CMD" seedance-subtitle-remove \
  --videoUrl "<volc-seedance-original-video-url>" \
  --name "<clip-name>" -f json

# 3) 后续查询；也可以创建时加 --waitSeconds 300 短窗口等
"$AWB_CMD" seedance-subtitle-status --taskId <assetEditTaskId> -f json
```

`seedance-subtitle-remove` 返回的 `去字幕任务ID` 是 asset-edit 的 `public_id`，后续传给 `seedance-subtitle-status --taskId`。如果 asset-edit 需要私有登录态，传 `--authorization "<Authorization header>"`，或设置 `ASSET_EDIT_AUTHORIZATION` / `ASSET_EDIT_TOKEN`。CLI 会对 URL 和 24 小时做本地保护；确认是有效原始链接或付费链路时才用 `--force true`。

### 4.12 AiHubMix / HappyHorse 外部视频模型

HappyHorse 暂未接入灵境 AWB 积分模型表时，可直接用 AiHubMix key 走外部计费。CLI 默认读取 `AIHUBMIX_API_KEY`（也兼容 `AIHUBMIX_KEY` / `AIHUBMIX_TOKEN`），不消耗 AWB 项目组积分；成本归属由 AiHubMix key 所在项目承担。

支持的 `modelGroupCode`：

- `happyhorse-1.0-t2v`：文生视频，只需要 `--prompt`
- `happyhorse-1.0-i2v`：图生视频，用 `--frameUrl` / `--frameFile` / `--refImageUrls` / `--refImageFiles` 传首帧或图片参考
- `happyhorse-1.0-r2v`：参考生视频，用 `--refImageUrls` / `--refVideoUrls` / `--refAudioUrls`，本地文件也可用对应 `*Files`
- `happyhorse-1.0-video-edit`：视频编辑，必须传 `--refVideoUrls` 或 `--refVideoFiles`

```bash
# 文生视频
"$AWB_CMD" video-create --modelGroupCode happyhorse-1.0-t2v \
  --prompt "雨夜街头，镜头缓慢推进，电影感" \
  --generatedTime 5 --size 1280x720 -f json

# 图生视频
"$AWB_CMD" video-create --modelGroupCode happyhorse-1.0-i2v \
  --prompt "保持首帧人物，微风吹动头发，镜头轻微推进" \
  --frameFile ./frame.webp --generatedTime 5 --size 1280x720 -f json

# 查询并下载
"$AWB_CMD" aihubmix-video-status --taskId <video_id> --waitSeconds 300 -f json
"$AWB_CMD" aihubmix-video-download --taskId <video_id> --outputFile ./output.mp4
```

AiHubMix 任务返回的是 `video_id`，不是 AWB 后端 taskId；推荐直接用 `aihubmix-video-status` 查询，也可用 `task-wait --taskType AIHUBMIX_VIDEO --taskId <video_id>` 接入通用等待链路。`video-create --dryRun true` 只预览 AiHubMix 请求体，不会查 AWB 余额。

## 5. 经验引导

- **先确认模式**：`model-options` 看 `supportsPromptOnly` / `frameFeature` / `refFeature` / `paramKeys`；不支持纯 prompt 的模型传了 `--prompt` 也得补帧或参考。
- **四种模式不共存**：选了故事板就不要传 `frame*` / `ref*`；选了首尾帧就别传 `ref*`；选了参考生视频就别传 `frame*`。想更底层的控制去 `--framesJson` / `--promptParamsJson`。
- **`@名称` 要和命名参考对得上**：
  - `--prompt "@角色A 在雨夜"` + `--refImageFiles "角色A=./a.webp"` → 一致 ✓
  - `--prompt "@charA ..."` + `--refImageFiles "角色A=..."` → 不一致 ✗
- **`--refAudioFiles` 的绑定是隐式的**：默认按同名图片 / 主体配对（`角色A=./voice.mp3` 绑定到 `角色A` 的图 / 主体）。混用异名时用 `--refAudiosJson` 的 `bindTo` 显式指。
- **真人短剧别跳过主体链路**：用户说真人 / 做剧 / 多段复用时，优先建议 `subject-publish` / `subject-upload` 发布成主体（平台加白 / 可引用资产）再 `--refSubjects`；只有试片、无权限或用户明确要直传时，才用 `--refImageFiles "角色=./person.webp"`。
- **场景图不需要发布成主体**：场景通常直接作为命名图片参考传入；如果要多次复用，先 `upload-files --sceneType material-video-create` 再用 `--refImageUrls`。
- **分镜指挥图是参考图，不是故事板模式**：4 / 9 宫格图作为 `--refImageFiles "分镜指挥图=..."` 进入参考生视频；prompt 必须写清“按格子顺序参考构图，但不要出现宫格边框 / 编号 / 字幕”。
- **`--quality` 的数值单位跟模型走**：生视频常见 `720` / `1080`（数字）；生图常见 `1K` / `2K`（字母）。看 `model-options` 的 `约束` 列。
- **`--generatedTime` 单位是秒**：常见 5 / 10 / 15；部分模型只接离散值。可灵 3.0（非 Omni）的参考生视频 `multi_param` 路径截至 2026-04-24 实测 10 秒可创建、15 秒会失败；可灵 3.0-Omni 同路径 15 秒已实测可成功。CLI 当前只拦截已验证会失败的非 Omni 15 秒路径。
- **Token 计费模型（Seedance 2.0 系列）先 `video-fee`**：和按张 / 按次计费的不一样，提示词长度 / 参考数量都会推高成本。
- **默认清晰度是 720p**：Seedance 2.0 可用 1080p，但成本很高；除非用户明确要高质量，否则自动化默认 720p。
- **Seedance 2.0 去字幕要趁早**：如果用户要求“生成完去字幕 / 去水印”，只对 Seedance 2.0 结果调用 `seedance-subtitle-remove`，并在完成后 24 小时内用原始火山链接提交。
- **AiHubMix HappyHorse 是外部计费**：`happyhorse-1.0-*` 不走 AWB 积分；先确认用户接受用 AiHubMix key 计费，再用 `video-create` 提交，用 `aihubmix-video-status/download` 查取结果。
- **没给清晰度 / 比例 / 时长就不要静默提交**：先问用户，或明确建议默认值（如试片 `720p`、`5s`、竖屏 `9:16` / 横屏 `16:9`）并等待确认；`1080p` / Pro / 高质通道必须确认成本。
- **故事板、音效开关不是所有模型都有**：查 `video-models` 的 `特色能力` 列；也能在 `paramKeys` 里看 `multi_prompt` / `audio` 是否存在。故事板分镜 `duration` 是秒，总和必须等于 `--generatedTime`。
- **`--waitSeconds 180` 起步**：视频任务比生图慢得多；想完全异步就 `--waitSeconds 0`，拿 `taskId` 走 `task-wait`。
- **异步台账**：视频默认建议加 `--taskRecordFile .awb/tasks.jsonl`；后续用同一个文件跑 `task-record-poll` 批量查回结果，或 `task-records --pendingOnly true` 只查看还没记录完成结果的任务。
