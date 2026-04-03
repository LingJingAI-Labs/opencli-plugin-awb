---
name: awb
description: Use when Codex needs to operate Anime Workbench through `awb` or `opencli awb`, including auth checks, team or project-group switching, model discovery, image generation, video generation, batch creation, task tracking, uploads, billing, and workflow selection for prompt, reference, frame, or storyboard modes.
---

# AWB Skill

使用入口：

- 独立 CLI：`awb`
- opencli 插件：`opencli awb`

先解析可用命令：

```bash
AWB_CMD=awb
if ! command -v "$AWB_CMD" >/dev/null 2>&1; then
  if command -v opencli >/dev/null 2>&1 && opencli awb --help >/dev/null 2>&1; then
    AWB_CMD="opencli awb"
  else
    echo "No usable AWB CLI found" >&2
    exit 1
  fi
fi
```

在调用任何创作命令前，先执行这三步：

1. `"$AWB_CMD" auth-status -f json`
2. `"$AWB_CMD" image-models` 或 `"$AWB_CMD" video-models`
3. `"$AWB_CMD" model-options --modelGroupCode <g>`

按任务类型选择参考：

- 账号与项目组：见 `capabilities/auth-and-account.md`
- 模型选择：见 `capabilities/model-discovery.md`
- 生图：见 `capabilities/create-image.md`
- 生视频：见 `capabilities/create-video.md`
- 素材上传 / 内部主体素材：见 `capabilities/upload-and-assets.md`
- 任务查询：见 `capabilities/task-management.md`
- 积分与开票：见 `capabilities/billing.md`

按基础 workflow 选择用法：

- 简单文生图：见 `workflows/simple-text-to-image.md`
- 参考图生图 / 多图生图：见 `workflows/reference-image-generation.md`
- 批量生图：见 `workflows/batch-image-generation.md`
- 首帧生视频：见 `workflows/first-frame-video.md`
- 首尾帧生视频：见 `workflows/first-last-frame-video.md`
- 多参考生视频：见 `workflows/multi-reference-video.md`
- 故事板生视频：见 `workflows/storyboard-video.md`
- 批量生视频：见 `workflows/batch-video-generation.md`

需要检查版本或更新时再看：

- Skill 版本：`VERSION`
- 兼容信息：`compat.json`
- 更新检查：`scripts/check-update.sh`
- 更新执行：`scripts/update.sh`
- 命令探测：`scripts/resolve-awb-cmd.sh`

执行规则：

- 默认优先用 `awb`
- 如果机器上没有 `awb`，且 `opencli awb --help` 可用，再退回 `opencli awb`
- JSON 输出统一优先 `-f json`
- 真正提交前，优先先跑 `--dryRun true`
- workflow 只保留单元化基础用法，不写复杂串联生产流
