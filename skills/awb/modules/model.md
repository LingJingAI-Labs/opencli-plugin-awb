# Model Module

挑模型、读参数定义、理解通道与白名单。**生图 / 生视频命令的所有参数先在这里拉齐**。

## 1. 何时使用

- 确定该选哪个模型 / 哪个通道
- 要传哪些参数、可选值是什么、默认值是多少
- 模型支持哪几种参考图（iref / cref / sref）、哪种帧模式、是否故事板
- 看音效开关、纯 prompt 支持、Token 计费等特殊能力

## 2. 核心概念

- **modelCode vs modelGroupCode**：`modelCode` 是模型逻辑名；`modelGroupCode` 是具体"通道"（折扣 / 低价 / 官方），它才是唯一主键。创作命令**优先传 `modelGroupCode`**。
- **外部模型例外**：`happyhorse-1.0-t2v/i2v/r2v/video-edit` 是 AiHubMix 外部视频模型，`modelCode` 和 `modelGroupCode` 相同；它们不在 AWB 后端模型表里，也不消耗 AWB 积分。
- **通道（groupHint / 通道列）**：同一个模型可能同时挂在"折扣 / 低价 / 官方"三条通道上，价格和队列不一样。
- **paramKeys 白名单**：`image-models` / `video-models` 会直接告诉你该模型真正支持哪些参数；不在这里的别传。
- **模式识别字段**：
  - `参考图` / `refFeature`：`iref`（画面）+ `cref`（人物）+ `sref`（风格）的组合
  - `帧模式` / `frameFeature`：可首帧 / 可首尾 / 仅首帧 / 多帧
  - `参考模式` / `特色能力`：图 / 视频 / 音频 / 故事板 / 音效开关
  - `supportsPromptOnly`：是否支持纯提示词直出，无需首帧或参考

## 3. 命令

| 命令 | 用途 | 路由提醒 |
|------|------|----------|
| `image-models` | 列出生图模型（含通道 / 参考图能力 / 成功率） | 优先 `--model "<关键词>"` 缩小，再看 `模型组` 列复制 `modelGroupCode` |
| `video-models` | 列出生视频模型（含帧模式 / 参考模式 / 特色能力） | 同上；看 `特色能力` 判断故事板 / 音效 / Token 计费 |
| `model-options --modelGroupCode <g>` | 查该模型的参数定义（底层参数 + CLI 用法 + 约束） | 每次创作前都先跑；详细解读见 [`../references/model-options-read.md`](../references/model-options-read.md) |

## 4. 常用写法

```bash
# 关键词缩小范围
"$AWB_CMD" image-models --model "GPT Image 2" -f json
"$AWB_CMD" video-models --model "可灵 3.0" -f json

# 按提供方过滤
"$AWB_CMD" image-models --provider Google -f json
"$AWB_CMD" video-models --provider 字节跳动 -f json

# 同模型看有几条通道（价格 / 成功率对比）
"$AWB_CMD" image-models --model "Nano Banana" -f json | \
  jq '.[] | {模型, 通道: .groupHint, 模型组: .modelGroupCode, 成功率}'

# 查某模型支持哪些参数
"$AWB_CMD" model-options --modelGroupCode <g> -f json

# 带已选参数再查（条件性约束）
"$AWB_CMD" model-options --modelGroupCode <g> --selectedConfigsJson '{"quality":"720"}' -f json
```

## 5. 经验引导

- **永远先查 `paramKeys`**：它是真相之源。举例：
  - `GPT Image 2` → `ratio,iref,prompt`：**没有** `quality` / `generateNum`
  - `千问` → `direct_generate_num,iref,prompt`：**没有** `ratio`，用 `--directGenerateNum`
  - `FLUX 1.1 Pro` → `ratio,customResolution,prompt_upsampling,seed,prompt`：用 `--customResolution`，不走 `quality`
  - `Nano Banana 2` → `quality,ratio,generate_num,iref,prompt`：支持多图返回
  - `可灵 3.0` → `..., multi_prompt`：支持故事板（见 [`../references/storyboard.md`](../references/storyboard.md)）
- **通道选择逻辑**：
  - 有"折扣 / 低价"就优先，只有对稳定性 / 官方 SLA 敏感时再挑"官方"
  - `modelGroupCode` 是平台唯一键；跨通道比价时对齐这一列
  - `成功率` 也在输出里，低于 80% 的模型慎选
- **`--selectedConfigsJson` 解锁条件性约束**：部分模型的可选值依赖已选参数（比如选了 `quality` 才能看到 `generated_time` 可选值范围）；第一次查只拿到基础列，有条件时带上已选。
- **`model-options` 输出两列名**：
  - `底层参数` 是服务端 paramKey（如 `generated_time`、`generate_num`）
  - `推荐 CLI 用法` 才是命令行 flag（如 `--generatedTime`、`--generateNum`）
  - 别把底层 paramKey 直接当 flag 传
- **别扫全量模型表**：`image-models` / `video-models` 结果长，直接带 `--model` / `--provider` 缩；要给用户展示也只回关键列。
- **生视频的"特色能力"列很信息密度**：一眼能看出是否支持故事板（`故事板`）、音效开关（`音效开关`）、Token 计费（`Token计费`）。
- **自动化短剧视频默认选型**：
  - 追效果 / 控音色：优先 `Seedance 2.0`，默认建议 `720p`；`1080p` 能用但 Token 成本高，先 `video-fee`。
  - 控成本 / 快速批量：`Seedance 2.0 Fast` 更便宜更快，但画质和稳定性弱于标准版。
  - 可灵路线：`可灵 3.0 / 3.0-Omni` 可做主体 / 多参考 / 故事板，音色引用链路更底层、更麻烦；别把“音效开关”误说成“控音色”。
  - 低价试片：可考虑 `Grok`；通常适合便宜参考生成，不要承诺与 Seedance 同等效果或音色控制。
- **分镜指挥图链路**：需要控制镜头切换时，先选 Banana Pro / Nano Banana / GPT Image 2 这类生图模型出 4 / 9 宫格指挥图，再选支持参考图 / `multi_param` 的视频模型（Seedance、可灵 3.0-Omni、Grok、Veo、Vidu、PixVerse 等）吃“指挥图 + 人设图 / 主体 + 场景图”。
