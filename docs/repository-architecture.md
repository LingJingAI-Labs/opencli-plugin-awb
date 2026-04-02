# Repository Architecture

仓库名：`anime-workbench-cli`

## 目标

这个仓库不是单一插件仓库，而是 Anime Workbench 的 CLI 主仓：

- 独立 CLI
- opencli frontend
- shared core
- agent skills
- 更新与兼容文档

## 架构图

```text
anime-workbench-cli
├── packages/
│   ├── awb-core
│   │   ├── common.js
│   │   ├── commands.js
│   │   └── standalone.js
│   └── awb-cli
│       ├── package.json
│       └── bin/awb.js
├── skills/
│   └── awb
│       ├── SKILL.md
│       ├── VERSION
│       ├── compat.json
│       ├── capabilities/
│       ├── workflows/
│       └── scripts/
├── index.js
├── install.mjs
├── README.md
├── CHANGELOG.md
└── docs/
    ├── update-mechanism.md
    └── repository-architecture.md
```

## 依赖关系

```text
@lingjingai/awb-cli
        │
        ▼
@lingjingai/awb-core
        ▲
        │
opencli frontend (index.js)

skills/awb
  ├── prefers: awb
  └── fallback: opencli awb
```

## 运行关系

### 1. 独立 CLI

- 入口：`packages/awb-cli/bin/awb.js`
- 默认状态目录：`~/.lingjingai/awb`
- 若本地未登录，会回退读取 `~/.opencli` 的 AWB 登录态

### 2. opencli frontend

- 入口：根目录 `index.js`
- 由 `opencli` 插件发现器扫描并加载
- 调用共享的 `registerAwbCommands(cli)`

### 3. shared core

- 放所有真正业务逻辑
- 包括鉴权、上传、模型查询、任务创建、dry-run、任务等待

### 4. skills/awb

- 只负责教 agent 怎么调用 CLI
- 不承载业务逻辑
- 通过 `compat.json` 约束最低 CLI / plugin 版本

## 发布方式

### opencli frontend

通过仓库安装：

```bash
npm install -g github:LingJingAI-Labs/anime-workbench-cli
```

### 独立 CLI

目标发布名：

```text
@lingjingai/awb-cli
```

### Skill

- 跟仓库一起维护
- 通过 git 更新
- 用 `skills/awb/scripts/check-update.sh` 和 `update.sh` 管理

## 命名原则

- 仓库名是 `anime-workbench-cli`
- `opencli awb` 只是一个 frontend，不再代表整个仓库
- `skills/awb` 是配套 skill，不是单独主仓
