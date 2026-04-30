# Video Module

生视频先确定 **模式、模型能力、成本、等待策略**。具体 flag 和可选值以 `video-models`、`model-options`、`video-create --help` 为准，skill 只记录 AWB 里容易踩坑的经验。

## 1. 先判断模式

四种主要模式不要混用：

| 模式 | 何时用 | 核心提醒 |
|------|--------|----------|
| 纯提示词 | 模型支持 prompt-only | 先看 `supportsPromptOnly` |
| 首帧 / 首尾帧 | 有确定起始画面或结尾画面 | 看 `frameFeature`，图生视频通常跟随源图比例 |
| 参考生视频 | 需要人物、场景、动作、音频参考 | 用命名参考，prompt 里用自然名称引用 |
| 故事板 | 模型支持 `multi_prompt` | 不要再混首帧、参考图、主体资产 |

正式提交前必须确认当前团队 / 项目组、模型组、通道、模式、时长、清晰度、比例、声音开关、参考素材绑定、最终 prompt、预估费用和等待方式。用户没明确授权“直接跑”时，不要静默提交。

## 2. 模型选择经验

- 模型能力以实时 `video-models` 和 `model-options` 为准，不要凭旧文档硬写死。
- 设计片段时先看 `video-models` 外层的 `时长 / 参考模式 / 特色能力`，最终提交前再用 `model-options` 复核。
- 同一模型的不同通道可能在价格、速度、清晰度、参考能力、声音能力和参数可选值上不同；先列出差异，再让用户按试片成本、速度、质量或能力取舍。
- 用户没给完整参数时，先问或给默认建议并等确认：横竖屏 / 比例、清晰度、时长、是否带声音、是否需要音色参考、参考图如何绑定到 prompt。
- `audio` / `needAudio` 是结果是否带声音的开关；带人物说话或音频参考时默认应打开，但控音色还需要模型支持音频参考并传音频素材。
- Token 计费模型先跑 `video-fee`；同一模型有 Fast / Pro / Omni / 1080p 等通道时，要让用户确认成本取舍。
- 用 `model-duration-estimate --modelGroupCode <g> -f json` 估平均耗时和建议等待窗口；低置信度时再查 `task-duration-stats` 或按经验异步提交。

## 3. 真人短剧 / 多参考

- 现在短剧常见路线是“人物 / 场景 / 可选音频参考”生成单镜头片段，再剪辑拼接；不要默认只走纯 prompt。
- Seedance 2.0 / Seedance 2.0 Fast 做真人多段复用时，优先考虑 `subject-publish` / `subject-upload` 把人物注册成可复用主体，再用 `--refSubjects`。这条“加白 / 主体资产”链路只针对 Seedance 2.0 主体参考，不要泛化到 Grok、HappyHorse 或普通上传。
- 试片、无主体权限、非 Seedance 主体链路时，直接用普通命名参考图 / 场景图即可。
- 场景通常不是主体，不需要发布成主体；多次复用时可以先上传到生视频素材池再用 backendPath。
- Vidu Q2 Turbo 是首帧 / 首尾帧路线；Vidu Q2 Pro 支持首帧 / 首尾帧和参考生但较老、最长 8 秒；Vidu Q3 Pro 当前已接入分组不是多参考路线。后续 Vidu Q3 多参考接入后，以实时模型表为准。

## 4. 分镜与故事板

- `--storyboardPrompts` 是故事板模式，只给支持 `multi_prompt` 的模型用；它和参考图 / 主体资产不是同一条路线。
- “4 宫格 / 9 宫格分镜指挥图”是另一条路线：先生图得到一张分镜参考图，再把它作为普通参考图喂给支持参考图的视频模型。视频 prompt 里必须说明只参考镜头顺序和构图，不要生成宫格边框、编号或字幕。
- 分镜指挥图不替代人物图、主体资产或场景图；它主要负责镜头节奏。

## 5. Seedance 2.0 去字幕

- 只用于 Seedance 2.0 生成结果。
- 输入必须是火山 / Seedance 2.0 原始结果链接，不要用下载后重新上传的 CDN 链接。
- 免费链路需要在视频生成完成后 24 小时内提交，超过后通常只能走付费处理。
- 用 `seedance-subtitle-remove` 提交，返回的 asset-edit 任务 ID 再用 `seedance-subtitle-status` 查。

## 6. HappyHorse / AiHubMix

- `happyhorse-1.0-t2v/i2v/r2v/video-edit` 走 AiHubMix 外部计费，不消耗 AWB 项目组积分；默认读取 `AIHUBMIX_API_KEY`（兼容 `AIHUBMIX_KEY` / `AIHUBMIX_TOKEN`）。
- `video-fee` 和 `video-create --dryRun true` 会估外部成本；默认价格按 AiHubMix HappyHorse 当前标价：720p 每秒 0.1395 美元，1080p 每秒 0.2479 美元，实际以 AiHubMix 账单为准。
- HappyHorse 当前不支持音频 / 音色参考，不要传音频相关参数。
- `happyhorse-1.0-i2v` 图生视频跟随输入图比例，不要让用户再选 `16:9 / 9:16`，也不要额外传比例或尺寸。
- `happyhorse-1.0-r2v` 是参考图生视频：参考图用公网 URL，prompt 中按 `character1`、`character2` 指代顺序。分辨率、比例、时长按 AiHubMix 当前文档和 CLI 干跑结果确认。
- AiHubMix 返回的是 `video_id`，用 `aihubmix-video-status` / `aihubmix-video-download`，也可接入通用 `task-wait --taskType AIHUBMIX_VIDEO`。

## 7. 等待与批量

- 单个短视频可以短窗口等待；几分钟以上、Token 计费、高复杂度和批量任务默认异步。
- 正式提交建议加 `--taskRecordFile .awb/tasks.jsonl`，便于沙箱关闭后恢复查询；台账不是后端查询的必要条件，但能避免回来后靠时间和 prompt 反找。
- 批量先 `--dryRun true`，确认条数、模型通道、公共参数、预估总费用、最低剩余余额、并发数和查询策略后再提交。
