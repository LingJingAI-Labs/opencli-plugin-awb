# Image Module

单张生图、参考图、批量。所有参数以 `model-options` + 模型 `paramKeys` 为准。

## 1. 何时使用

- 生成一张 / 多张图片（纯提示词或带参考图）
- 预估消耗、干跑
- 批量生图（每条条件不一样）
- 先用人物图 / 场景图生成 4 宫格 / 9 宫格分镜指挥图，再给视频模型做参考

## 2. 命令与模式

| 命令 | 用途 | 路由提醒 |
|------|------|----------|
| `image-fee` | 估算单次生图积分与项目组余额 | 复杂 refs 用它替代裸 `dryRun` 更省事 |
| `image-create` | 单次生图 | `--waitSeconds 120` 同步等结果；0 / 不传 = 只提交拿 `taskId` |
| `image-create-batch` | 批量生图 | `--inputFile` 见 [`../references/batch-input-file.md`](../references/batch-input-file.md) |

参数分类：

- **必到位**：`--modelGroupCode`、`--prompt`
- **常见**：`--quality`、`--ratio`、`--generateNum`、`--irefFiles` / `--iref`
- **模型特定**：`--cref` / `--crefFiles`（人物参考）、`--sref` / `--srefFiles`（风格参考）、`--directGenerateNum`、`--customResolution`（FLUX）
- **高级**：`--promptParamsJson`（整体覆盖 JSON）、`--dryRun true`、`--projectGroupNo`、`--pollIntervalMs`

## 3. 标准流程

```bash
# 1) 看参数白名单
"$AWB_CMD" model-options --modelGroupCode <g> -f json

# 2) 预估
"$AWB_CMD" image-fee --modelGroupCode <g> --prompt "一只小狗" \
  --quality 1K --ratio 16:9 --generateNum 1 -f json

# 3) 正式提交（同步等结果）
"$AWB_CMD" image-create --modelGroupCode <g> --prompt "一只小狗" \
  --quality 1K --ratio 16:9 --generateNum 1 --waitSeconds 120 -f json
```

## 4. 典型场景

### 4.1 参考图（iref：画面参考；cref：人物；sref：风格）

```bash
# 本地图：CLI 自动上传
"$AWB_CMD" image-create --modelGroupCode <g> --prompt "参考图里的角色在雨夜奔跑" \
  --quality 1K --ratio 16:9 --generateNum 1 \
  --irefFiles "./a.webp,./b.webp" --waitSeconds 120 -f json

# 已上传过：直接传 backendPath
"$AWB_CMD" image-create --modelGroupCode <g> --prompt "..." \
  --iref "/material/20260423/xxx.webp" --waitSeconds 120 -f json
```

### 4.2 GPT Image 2（参数缩减）

`paramKeys=ratio,iref,prompt`，**不带** `--quality` / `--generateNum`：

```bash
"$AWB_CMD" image-create --modelGroupCode GPT2_ImageCreate_Discount_Group \
  --prompt "赛博朋克少女，霓虹街头，电影感" --ratio 16:9 \
  --irefFiles "./ref.webp" --waitSeconds 120 -f json
```

### 4.3 千问（无 ratio，用 directGenerateNum）

```bash
"$AWB_CMD" image-create --modelGroupCode WX_ImageCreate_Group \
  --prompt "..." --directGenerateNum 4 \
  --irefFiles "./a.webp" --waitSeconds 120 -f json
```

### 4.4 Banana Pro / Nano Banana 2（典型多图返回）

```bash
"$AWB_CMD" image-create --modelGroupCode Nano_Banana2_ImageCreate_Group_Discount \
  --prompt "..." --quality 1K --ratio 16:9 --generateNum 4 \
  --irefFiles "./a.webp" --waitSeconds 120 -f json
```

### 4.5 分镜指挥图（给视频参考模型控镜头切换）

用 Banana Pro / Nano Banana / GPT Image 2 这类生图模型，基于人物图和场景图先生成**一张** 4 宫格 / 9 宫格分镜图。后续把这张图作为 `分镜指挥图`，再和人物主体 / 人设图 / 场景图一起传给 Seedance、可灵、Grok、Veo、Vidu、PixVerse 等参考生视频模型。详细流程见 [`../references/shotboard-reference-image.md`](../references/shotboard-reference-image.md)。

```bash
"$AWB_CMD" image-create --modelGroupCode Nano_Banana2_ImageCreate_Group_Discount \
  --prompt "参考图1是人物小莉，参考图2是咖啡馆场景。生成一张9宫格短剧分镜指挥图，整体9:16竖屏；9格依次是建立镜头、人物入画、坐下、听到消息、情绪特写、低声说话、手部特写、起身、门口回头。保持人物服装和场景一致；每格构图清晰、电影感、无字幕、无水印。" \
  --quality 1K --ratio 9:16 --generateNum 1 \
  --irefFiles "./person.webp,./scene.webp" --waitSeconds 120 -f json
```

GPT Image 2 这类参数缩减模型不要带 `quality` / `generateNum`：

```bash
"$AWB_CMD" image-create --modelGroupCode GPT2_ImageCreate_Discount_Group \
  --prompt "参考图1是人物小莉，参考图2是咖啡馆场景。生成一张4宫格短剧分镜指挥图，整体16:9横屏；四格依次是建立镜头、人物中景、情绪特写、离开背影；保持人物和场景一致，无字幕无水印。" \
  --ratio 16:9 --irefFiles "./person.webp,./scene.webp" --waitSeconds 120 -f json
```

### 4.6 批量

```bash
# 通用默认放命令行，单条差异写进输入文件
"$AWB_CMD" image-create-batch --inputFile ./image-batch.json \
  --modelGroupCode <g> --quality 1K --ratio 16:9 --generateNum 1 \
  --dryRun true -f json
"$AWB_CMD" image-create-batch --inputFile ./image-batch.json --modelGroupCode <g> -f json
```

输入文件格式详见 [`../references/batch-input-file.md`](../references/batch-input-file.md)。

## 5. 经验引导

- **先 `model-options`，后创作**：别把 Nano Banana 的默认 `--quality 1K --ratio 16:9 --generateNum 1` 直接套到 GPT Image 2 / Midjourney / 千问—— `paramKeys` 里没有的参数传了会报错。
- **`image-fee` 优先于裸 `--dryRun`**：前者已经包含预估积分 + 项目组余额 + 提交后剩余；`--dryRun true` 适合结构很复杂（故事板 / 多参考）时再核对整段 payload。
- **`--waitSeconds 120` 的边界**：生图一般几十秒；写大了是安全的。超时也不扣积分重试——`task-wait` 后续兜底。
- **`generateNum` 是"最终返回几张"**：不是所有模型都支持，以 `paramKeys` 为准；千问用 `--directGenerateNum`。
- **分镜指挥图通常 `generateNum=1`**：目标是一张 4 / 9 宫格图，不是 4 / 9 张独立返回图；比例跟最终视频一致（竖屏 `9:16`，横屏 `16:9`）。
- **`--irefFiles "./a.webp,./b.webp"` 是逗号分隔**：不是 JSON 数组。
- **webp 是优选**：参考图上传支持 webp / png / jpg；部分模型 `supportedFileTypes` 只接 webp（见 `model-options`）。转码后上传更稳。
- **重复批量时**：把通用参数（modelGroupCode / quality / ratio）丢命令行，单条独立字段（prompt / irefFiles）放文件；别把所有东西塞文件里，维护成本高。
