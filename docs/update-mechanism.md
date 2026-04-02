# AWB CLI / Skill Update Mechanism

## 目标

本仓库同时维护三类交付物：

- `anime-workbench-cli` 仓库本身
- `@lingjingai/awb-cli`
- `skills/awb`

更新策略不是“CLI 自动拉 skill”，而是：

- CLI 通过 npm 或 GitHub 安装源更新
- skill 通过 git 更新
- 两者通过 `skills/awb/compat.json` 对齐兼容关系

## 版本来源

- 插件版本：根目录 `package.json`
- 独立 CLI 版本：`packages/awb-cli/package.json`
- core 版本：`packages/awb-core/package.json`
- skill 版本：`skills/awb/VERSION`
- 兼容声明：`skills/awb/compat.json`

当前策略：

- 插件、独立 CLI、core 共用同一版本号
- skill 也跟随同一版本号
- `compat.json` 明确记录最小 CLI / 插件版本

## 更新方式

### 1. opencli 插件

```bash
npm install -g github:LingJingAI-Labs/anime-workbench-cli
npm update -g github:LingJingAI-Labs/anime-workbench-cli
```

### 2. 独立 CLI

未来发布后：

```bash
npm install -g @lingjingai/awb-cli
npm update -g @lingjingai/awb-cli
```

### 3. Skill

检查更新：

```bash
bash skills/awb/scripts/check-update.sh
```

执行更新：

```bash
bash skills/awb/scripts/update.sh
```

## 维护规则

发布或变更命令行为时，至少同步下面几项：

1. `npm run version:sync -- <version>`
2. 更新 `skills/awb/VERSION`
3. 更新 `skills/awb/compat.json`
4. 更新 `README.md`
5. 更新 `CHANGELOG.md`

## 推荐原则

- Skill 默认优先调用 `awb`
- 如果机器上没有 `awb`，再退回 `opencli awb`
- Skill 文档示例尽量写成 `"$AWB_CMD" ...`
- Workflow 只保留单元化基础用法，不维护复杂串联生产流
- 批量生图、批量生视频属于单元化高频用法，单独维护 workflow

## 独立 CLI 登录态

独立 `awb` CLI 默认使用自己的状态目录：

- `~/.lingjingai/awb/auth.json`
- `~/.lingjingai/awb/state.json`

为了降低迁移成本，如果独立 CLI 本地还没有自己的状态目录，它会优先沿用现有 `opencli awb` 状态文件，并继续把后续刷新写回这套旧路径。也就是说，在用户显式初始化独立 CLI 自己的状态前，两套入口会共用同一份本地状态。

沿用的旧路径包括：

- `~/.opencli/awb-auth.json`
- `~/.opencli/awb-state.json`
- `~/.animeworkbench_auth.json`

也就是说：

- 新用户可以直接用独立 CLI 自己登录
- 已经登录过 `opencli awb` 的用户，独立 CLI 也能直接复用这份登录态
