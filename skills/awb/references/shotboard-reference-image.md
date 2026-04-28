# 分镜指挥图（4 宫格 / 9 宫格）

用生图模型先把人物、场景和剧情动作整理成一张 **4 宫格 / 9 宫格分镜指挥图**，再把这张图作为视频参考输入，配合 Seedance 2.0 主体资产或普通人设图 / 场景图，让参考生视频模型更容易按预期做镜头切换。

这条链路适合短剧自动化：先用 Banana Pro / Nano Banana / GPT Image 2 这类强图像模型做“视觉分镜板”，再交给已接入且支持参考图 / 多参考的生视频模型，例如 Seedance 2.0 / Fast、可灵 3.0-Omni、Grok 3、Vidu Q2 Pro。

## 1. 何时使用

- 用户要“短剧分镜”“镜头切换可控”“按 4 个 / 9 个镜头走”
- 已有人物形象图或 Seedance 2.0 主体资产、场景图，希望视频模型按固定构图和节奏切镜
- 直接 `--storyboardPrompts` 不够稳，或目标视频模型不支持故事板
- 要把复杂镜头调度压成一张图片，减少视频 prompt 的不确定性

## 2. 两段式流程

### A. 先生成分镜指挥图

用生图模型输出 **一张** 4 宫格 / 9 宫格图，不是生成 4 张 / 9 张独立图片。比例跟最终视频一致：竖屏短剧用 `9:16`，横屏用 `16:9`。

```bash
"$AWB_CMD" image-create --modelGroupCode <image_g> \
  --prompt "参考图1是人物小莉，参考图2是咖啡馆场景。生成一张9宫格短剧分镜指挥图，整体9:16竖屏；每格是连续镜头：1远景建立咖啡馆，2小莉入画，3坐下，4看向窗外，5听到消息震惊，6低声说话，7手部特写，8站起离开，9门口回头。保持人物服装和场景一致；每格构图清晰、电影感、无字幕、无水印。" \
  --quality 1K --ratio 9:16 --generateNum 1 \
  --irefFiles "./person.webp,./scene.webp" \
  --waitSeconds 120 -f json
```

GPT Image 2 折扣组不带 `quality` / `generateNum`；如果需要 2K / 4K，换默认组 `GPT2_ImageCreate_Group` 并只加 `--quality`：

```bash
"$AWB_CMD" image-create --modelGroupCode GPT2_ImageCreate_Discount_Group \
  --prompt "参考图1是人物小莉，参考图2是咖啡馆场景。生成一张4宫格短剧分镜指挥图，整体16:9横屏；四格依次是建立镜头、人物中景、情绪特写、离开背影；保持人物和场景一致，无字幕无水印。" \
  --ratio 16:9 --irefFiles "./person.webp,./scene.webp" \
  --waitSeconds 120 -f json

"$AWB_CMD" image-create --modelGroupCode GPT2_ImageCreate_Group \
  --prompt "参考图1是人物小莉，参考图2是咖啡馆场景。生成一张4宫格短剧分镜指挥图，整体9:16竖屏；四格依次是建立镜头、人物中景、情绪特写、离开背影；保持人物和场景一致，无字幕无水印。" \
  --quality 2k --ratio 9:16 --irefFiles "./person.webp,./scene.webp" \
  --waitSeconds 120 -f json
```

### B. 再作为视频参考输入

把分镜图作为 `分镜指挥图` 传给视频模型，同时继续传 Seedance 2.0 主体资产或普通人设图和场景图。prompt 里要明确：**学习分镜构图和切换顺序，不要把宫格边框、编号、字幕画进最终视频**。

```bash
"$AWB_CMD" video-create --modelGroupCode JiMeng_Seedance_2_VideoCreate_Group \
  --prompt "参考 @分镜指挥图 的1到9格镜头顺序、构图和节奏生成连续短剧视频；保持 @小莉 的人物形象，场景是 @咖啡馆；不要出现九宫格边框、编号或字幕，画面自然连续，口型自然。" \
  --refSubjects "小莉=asset-xxxxxxxx" \
  --refImageFiles "分镜指挥图=./shotboard.webp,咖啡馆=./scene.webp" \
  --refAudioFiles "小莉=./voice.mp3" \
  --quality 720 --generatedTime 10 --ratio 9:16 --waitSeconds 240 -f json
```

没有主体权限或只是试片时，可以把人物图也作为普通参考图：

```bash
"$AWB_CMD" video-create --modelGroupCode <video_g> \
  --prompt "参考 @分镜指挥图 的4格镜头顺序生成视频；@小莉 是人物形象，@咖啡馆 是场景；不要出现宫格边框和编号。" \
  --refImageFiles "分镜指挥图=./shotboard.webp,小莉=./person.webp,咖啡馆=./scene.webp" \
  --quality 720 --generatedTime 5 --ratio 9:16 --waitSeconds 240 -f json
```

## 3. 模型取舍

- **分镜图生成**：优先 Banana Pro / Nano Banana / GPT Image 2 这类擅长参考图融合、构图和多格布局的生图模型。
- **视频生成**：效果优先 Seedance 2.0；预算优先 Seedance 2.0 Fast / Grok 3；复杂多参考看可灵 3.0-Omni；Vidu Q2 Pro 可参考生但模型较老、最长 8 秒。不要把未接入的 PixVerse 或当前已接入但不支持多参考的 Vidu Q3 Pro 当参考图路线推荐。
- **控音色**：继续用 `--refAudioFiles` / `--refAudioUrls` 绑定到同名 Seedance 2.0 主体资产或人物图；分镜指挥图只负责镜头，不负责音色。

## 4. 经验引导

- **这不是 `--storyboardPrompts`**：分镜指挥图是一张参考图片，走参考生视频 `multi_param`；不要和故事板模式混用。
- **4 宫格适合短镜头**：5–8 秒视频用 4 格更稳；9 宫格适合 10–15 秒或镜头切换更复杂的片段。
- **输出一张图**：生图阶段通常 `generateNum=1`，让模型在一张图里排 4 / 9 个 panel；不是要 4 / 9 张返回图。
- **比例跟最终视频一致**：竖屏短剧用 `9:16`，横屏用 `16:9`；后续视频也使用同样 `--ratio`。
- **prompt 要反向约束**：视频阶段必须写“不要出现宫格边框 / 编号 / 字幕”，否则模型可能把指挥图样式画进视频。
- **人物一致性仍靠主体资产或人设图**：分镜图负责镜头节奏，不替代 Seedance 2.0 的 `--refSubjects` 或普通人物形象图；场景也建议继续单独传。
- **参考数量别超模型限制**：分镜图本身算 1 张参考，人物 / 场景 / 道具继续叠加时先看 `model-options`。
