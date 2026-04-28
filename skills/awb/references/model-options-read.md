# 读懂 `model-options`

`model-options` 返回该模型的参数定义。看懂它就能写对命令。

## 1. 输出列

| 列 | JSON key | 含义 |
|----|----------|------|
| 底层参数 | `paramKey` | 服务端字段名（如 `generated_time`、`generate_num`）—— 不是 CLI flag |
| 名称 | `paramName` | 中文名 |
| 类型 | `paramType` | `EnumType` / `FileListType` / `Prompt` / `Number` / `Bool` / `Int` |
| 约束 | — | 根据 `rules` 汇总（默认值、可选枚举、文件数上限、prompt 长度） |
| 推荐CLI用法 | `cliFlag` | **这才是命令行 flag**（如 `--generatedTime`、`--generateNum`） |

**一定记住**：`底层参数` 列不能直接当 flag 传；用 `推荐CLI用法` 列。

## 2. 典型 paramType

| paramType | 对应 CLI 形态 | 约束里看什么 |
|-----------|---------------|--------------|
| `EnumType` | `--ratio 16:9` / `--quality 720` 之类 | `可选` 列给的枚举值、`默认` 值 |
| `FileListType` | `--irefFiles ./a.webp,./b.webp` | `最多 N 个`、`格式: webp/png/jpg` |
| `Prompt` | `--prompt "文本"` | `最长 N 字`（比如 800） |
| `Number` / `Int` | `--generateNum 4` | 取值范围、默认值 |
| `Bool` | `--audio true` / `--needAudio true` | true / false |

## 3. paramKeys 白名单

`image-models` / `video-models` 的输出列 `paramKeys` 是该模型真正支持的参数集合。**不在白名单的参数别传**——会报错。

举例：

| 模型 | `paramKeys` | 关键推论 |
|------|-------------|----------|
| GPT Image 2 折扣组（`GPT2_ImageCreate_Discount_Group`） | `ratio,iref,prompt` | 无 `quality` / `generateNum`；比例枚举更全；只 `iref` 参考 |
| GPT Image 2 默认组（`GPT2_ImageCreate_Group`） | `ratio,quality,iref,prompt` | 支持 `1K/2K/4K`；无 `generateNum`；只 `iref` 参考 |
| 千问 | `direct_generate_num,iref,prompt` | 无 `ratio`；用 `--directGenerateNum` |
| Nano Banana 2 | `quality,ratio,generate_num,iref,prompt` | 支持多图返回（`--generateNum`） |
| FLUX 1.1 Pro | `ratio,customResolution,prompt_upsampling,seed,prompt` | 用 `--customResolution`、`--seed`；无 `quality` |
| 即梦 4.0 | `ratio,quality,cref,sref,iref,prompt` | 三路参考（人物 / 风格 / 画面） |
| 可灵 3.0 | `..., multi_prompt` | 支持故事板（见 [`storyboard.md`](storyboard.md)） |

## 4. 参考图能力：`refFeature`

- `iref`（画面）：整张参考图，控制构图 / 场景
- `cref`（人物）：角色参考
- `sref`（风格）：风格参考
- 组合式，比如 `iref+cref+sref` = 三路都支持

对应 CLI：`--irefFiles` / `--crefFiles` / `--srefFiles`（本地）或 `--iref` / `--cref` / `--sref`（已上传的 backendPath）。

## 5. 帧模式：`frameFeature`

- `可首帧`：只能传首帧
- `可首尾`：支持首尾帧过渡
- `仅首帧`：只有首帧，没有尾帧槽
- `多帧`：用 `--framesJson` 做多帧精细控制

对应 CLI：`--frameFile` / `--frameText` / `--frameUrl`、`--tailFrameFile` / 等。

## 6. 特色能力：`extraFeatures`

生视频模型的额外信号，如：

- `故事板`：支持 `--storyboardPrompts`
- `声音开关`：支持 `--audio true/false` / `--needAudio`，控制结果是否带声音；不是独立控音色
- `Token计费`：按 token 计费，先 `video-fee`
- `图/视频/音频`：参考类型支持组合（全都能传）

## 7. `--selectedConfigsJson`：条件性参数

部分模型的参数可选值依赖已选参数。先选了 `quality`，再查才能看到 `generated_time` 的可选范围：

```bash
# 第一次查：拿基础参数
"$AWB_CMD" model-options --modelGroupCode <g> -f json

# 选了 quality=720 / generated_mode=multi_param 再查剩下的
"$AWB_CMD" model-options --modelGroupCode <g> \
  --selectedConfigsJson '{"quality":"720","generated_mode":"multi_param"}' -f json
```

## 8. 常用查询写法

```bash
# 只看参数名和约束
"$AWB_CMD" model-options --modelGroupCode <g> -f json | \
  jq '.[] | {底层参数, 类型, 推荐CLI用法, 约束}'

# 只看支持哪些参考图
"$AWB_CMD" model-options --modelGroupCode <g> -f json | \
  jq '.[] | select(.paramType == "FileListType") | {底层参数, 约束}'

# 看默认值
"$AWB_CMD" model-options --modelGroupCode <g> -f json | \
  jq '.[] | select(.约束 | contains("默认")) | {底层参数, 约束}'
```

## 9. 经验引导

- **每次换模型都要重查 `paramKeys`**：别靠记忆。即便同一家族（即梦 3.0 → 4.0）paramKey 也可能变。
- **看到 `paramType=Prompt` 的约束"最长 N 字"**：别写到超限；部分模型 prompt 上限 400 / 800 字不一。
- **看到 `paramType=FileListType` 的"最多 N 个"**：参考图数量上限；超了只会用前 N 个。
- **`rules.defaultValue` 不是"别传也行"**：部分参数即使有默认值也最好显式传，避免模型行为因默认变化而波动。
- **"推荐CLI用法"列的示例可直接抄**：它给的就是当前版本 CLI 认识的写法（含 `--flag` 和样例值）。
