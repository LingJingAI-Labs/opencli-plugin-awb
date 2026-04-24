# anime-workbench-cli

[中文](./README.md) | [English](./README.en.md)

灵境 AI Anime Workbench 平台终端工具仓库。

## 使用前准备

开始使用前，请先确保你已经在 Anime Workbench 官网注册账号，并完成微信绑定：

- https://animeworkbench.lingjingai.cn/home

CLI 当前推荐通过微信扫码登录。

如果官网账号还没有绑定微信，请先在官网完成注册和绑定，再继续下面的安装与登录步骤。

当前仓库包含四层：

- `opencli frontend`：给 `opencli` 用的插件入口，继续兼容 `opencli awb ...`
- `@lingjingai/awb-cli`：独立 CLI 入口，命令名为 `awb`
- `@lingjingai/awb-core`：两者共用的核心 SDK、鉴权、上传、模型查询和任务逻辑
- `skills/awb`：给 Agent 用的 skill 文档、流程、兼容元数据和更新脚本

目录结构：

```text
.
├── index.js                  # opencli 插件入口
├── install.mjs              # opencli 插件安装脚本
├── packages/
│   ├── awb-core/            # shared core
│   └── awb-cli/             # standalone CLI
├── skills/awb/              # agent skill bundle
├── docs/                    # release/update docs
├── README.md
└── README.en.md
```

更新机制文档：

- [docs/update-mechanism.md](./docs/update-mechanism.md)
- [docs/repository-architecture.md](./docs/repository-architecture.md)
- [CHANGELOG.md](./CHANGELOG.md)

## 安装

### opencli 插件

前置依赖：

```bash
npm install -g @jackwener/opencli
```

从 GitHub 安装：

```bash
npm install -g github:LingJingAI-Labs/anime-workbench-cli
```

或：

```bash
npm install -g git+https://github.com/LingJingAI-Labs/anime-workbench-cli.git
```

安装完成后，`postinstall` 会自动把插件放到 `~/.opencli/plugins/awb`。

同时会自动补齐 `opencli awb` 的 AWB 专属展示层，包括顶部品牌栏、中文时间格式和 AWB 表格头部居中，不需要用户再手工 patch 宿主。

验证安装：

```bash
opencli awb --help
```

### 独立 CLI

当前仓库已经完成独立 CLI 骨架，入口文件在：

```bash
node packages/awb-cli/bin/awb.js --help
```

独立 CLI 已发布为 `@lingjingai/awb-cli`。

如果独立 CLI 本地还没有自己的登录态，它会优先沿用现有 AWB 认证和项目组状态，避免重复登录。兼容读取的旧路径包括：

- `~/.opencli/awb-auth.json`
- `~/.opencli/awb-state.json`
- `~/.animeworkbench_auth.json`

如果这些路径同时存在，CLI 会优先采用更新更晚、令牌更新鲜的那份认证记录。

## 本地开发

```bash
cd /Users/zheyong/Developer/anime-workbench-cli
npm install -g .
```

或直接刷新本地插件安装：

```bash
node /Users/zheyong/Developer/anime-workbench-cli/install.mjs
```

检查代码：

```bash
npm run check
```

同步版本号：

```bash
npm run version:sync -- 0.1.1
```

Skill 元数据校验：

```bash
npm run check
```

## Skill / Agent Usage

Skill 入口：

- `skills/awb/SKILL.md`
- `skills/awb/compat.json`
- `skills/awb/VERSION`

Skill 更新：

```bash
bash skills/awb/scripts/check-update.sh
bash skills/awb/scripts/update.sh
```

Skill workflow 只保留单元化基础用法，例如：

- 简单文生图
- 参考图生图 / 多图生图
- 批量生图
- 首帧生视频
- 首尾帧生视频
- 多参考生视频
- 故事板生视频
- 批量生视频

## 登录

完成官网注册并绑定微信后，在终端使用微信扫码登录：

```bash
opencli awb login-qr
```

只返回二维码链接，不等待：

```bash
opencli awb login-qr --waitSeconds 0 -f json
```

手机验证码登录：

```bash
opencli awb send-code --phone 13800138000 --captchaVerifyParam '<aliyun-captcha>'
opencli awb phone-login --phone 13800138000 --code 123456
```

## 团队与项目组

查看当前账号、团队和项目组：

```bash
opencli awb me -f json
opencli awb points -f json
```

切换团队：

```bash
opencli awb teams -f json
opencli awb team-select --groupId <groupId> -f json
```

管理项目组：

```bash
opencli awb project-groups -f json
opencli awb project-group-current -f json
opencli awb project-group-users -f json
opencli awb project-group-create --name "CLI Project" -f json
opencli awb project-group-select --projectGroupNo <projectGroupNo> -f json
```

## 模型发现

列出图片模型：

```bash
opencli awb image-models
```

列出视频模型：

```bash
opencli awb video-models
```

按名称过滤：

```bash
opencli awb image-models --model "Nano Banana"
opencli awb video-models --model "可灵 3.0"
```

查看某个模型的参数、约束和推荐命令：

```bash
opencli awb model-options --modelGroupCode <modelGroupCode>
```

## 素材上传

上传本地文件到素材桶：

```bash
opencli awb upload-files --files ./ref.webp -f json
opencli awb upload-files --files ./frame.webp --sceneType material-video-create -f json
```

返回值里会包含 `backendPath` 和 `signedUrl`。

## 图片生成

积分预估：

```bash
opencli awb image-fee \
  --modelGroupCode <modelGroupCode> \
  --prompt "一位赛博风格少女站在霓虹街头" \
  --quality 1K \
  --ratio 16:9 \
  --generateNum 1
```

正式创建：

```bash
opencli awb image-create \
  --modelGroupCode <modelGroupCode> \
  --prompt "一位赛博风格少女站在霓虹街头" \
  --quality 1K \
  --ratio 16:9 \
  --generateNum 1 \
  --dryRun true
```

Banana 系列多图参考：

```bash
opencli awb image-create \
  --modelGroupCode <modelGroupCode> \
  --prompt "参考图里的角色在雨夜奔跑" \
  --quality 1K \
  --ratio 16:9 \
  --generateNum 1 \
  --irefFiles "./a.webp,./b.webp" \
  --dryRun true
```

批量生图：

```bash
opencli awb image-create-batch \
  --inputFile ./image-batch.json \
  --modelGroupCode <modelGroupCode> \
  --concurrency 2 \
  --dryRun true -f json
```

## 视频生成

首尾帧模式：

```bash
opencli awb video-create \
  --modelGroupCode <modelGroupCode> \
  --frameFile ./first-frame.webp \
  --tailFrameFile ./last-frame.webp \
  --quality 720 \
  --generatedTime 5 \
  --ratio 16:9 \
  --dryRun true
```

纯提示词模式（仅部分模型）：

```bash
opencli awb video-create \
  --modelGroupCode <modelGroupCode> \
  --prompt "雨夜街头，人物缓慢走向镜头，电影感" \
  --quality 720 \
  --generatedTime 5 \
  --ratio 16:9 \
  --dryRun true
```

参考生视频模式：

```bash
opencli awb video-create \
  --modelGroupCode <modelGroupCode> \
  --prompt "@角色A 对镜说话" \
  --refImageFiles "角色A=./char.webp" \
  --refAudioFiles "角色A=./voice.mp3" \
  --quality 720 \
  --generatedTime 5 \
  --ratio 9:16 \
  --dryRun true
```

故事板模式：

```bash
opencli awb video-create \
  --modelGroupCode <modelGroupCode> \
  --storyboardPrompts "镜头1：城市远景||镜头2：人物走近镜头" \
  --quality 720 \
  --generatedTime 5 \
  --ratio 16:9 \
  --dryRun true
```

批量生视频：

```bash
opencli awb video-create-batch \
  --inputFile ./video-batch.json \
  --modelGroupCode <modelGroupCode> \
  --concurrency 2 \
  --dryRun true -f json
```

## 任务查询

查询任务流：

```bash
opencli awb tasks --taskType IMAGE_CREATE -f json
opencli awb tasks --taskType VIDEO_GROUP -f json
```

等待任务完成：

```bash
opencli awb task-wait --taskId <taskId> --taskType IMAGE_CREATE -f json
opencli awb task-wait --taskId <taskId> --taskType VIDEO_GROUP -f json
```

## 说明

推荐流程：

```bash
opencli awb video-models --model "可灵 3.0"
opencli awb model-options --modelGroupCode <modelGroupCode>
opencli awb video-create ... --dryRun true
opencli awb video-create ...
```

`dryRun` 会构造真实请求并调用积分估算接口，但不会真正提交创作任务。
