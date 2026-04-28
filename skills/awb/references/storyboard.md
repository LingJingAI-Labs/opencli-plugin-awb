# 故事板（storyboard）

故事板是把多个镜头的文字描述一次性传给支持 `multi_prompt` 的视频模型。它和“分镜指挥图作为参考图片”不是同一条路线。

## 1. 使用前确认

- 只有 `paramKeys` 含 `multi_prompt` 的视频模型才支持故事板。
- 用 `video-models --model "<关键词>"` 和 `model-options --modelGroupCode <g>` 实时确认，不在 skill 里维护固定模型名单。
- 故事板通常取代普通 prompt；如保留普通 prompt，只作为全局风格或总指示。

## 2. 关键规则

- 每个分镜写成一句自然小节，镜头差异要清楚。
- `--generatedTime` 是整段视频时长，不是单镜头时长。
- 新版本 CLI 会为简单分镜自动补底层 `index` 和秒级 `duration`；手写 JSON 时，duration 单位是秒，且总和必须等于整段时长。
- 故事板不要默认混用 `frame*`、`ref*`、`refSubjects`；需要人物一致性或多参考时，改走参考生视频路线。
- 过短时长会让切镜很挤；分镜越多，整段时长也要相应变长。

## 3. 何时不用

- 用户重点是人物形象、场景图、音色或多参考控制：优先参考生视频。
- 用户给的是 4 / 9 宫格图：走分镜指挥图参考路线，不走 `--storyboardPrompts`。
- 模型表未显示 `multi_prompt`：不要尝试硬传。
