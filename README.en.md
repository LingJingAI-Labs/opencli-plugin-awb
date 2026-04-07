# anime-workbench-cli

[中文](./README.md) | [English](./README.en.md)

Terminal tooling repository for the LingJing AI Anime Workbench platform.

## Before You Start

Before using the CLI, make sure you have registered an account on the official Anime Workbench website and linked your WeChat account:

- https://animeworkbench.lingjingai.cn/home

The CLI currently recommends signing in with a WeChat QR code.

If your official site account is not yet linked to WeChat, finish registration and binding on the website first, then continue with the install and login steps below.

This repository currently contains four layers:

- `opencli frontend`: plugin entry for `opencli`, still compatible with `opencli awb ...`
- `@lingjingai/awb-cli`: standalone CLI entry, with command name `awb`
- `@lingjingai/awb-core`: shared core SDK for auth, uploads, model lookup, and task logic
- `skills/awb`: skill docs, workflows, compatibility metadata, and update scripts for agents

Project layout:

```text
.
├── index.js                  # opencli plugin entry
├── install.mjs              # opencli plugin installer
├── packages/
│   ├── awb-core/            # shared core
│   └── awb-cli/             # standalone CLI
├── skills/awb/              # agent skill bundle
├── docs/                    # release/update docs
├── README.md
└── README.en.md
```

Update mechanism docs:

- [docs/update-mechanism.md](./docs/update-mechanism.md)
- [docs/repository-architecture.md](./docs/repository-architecture.md)
- [CHANGELOG.md](./CHANGELOG.md)

## Install

### opencli Plugin

Prerequisite:

```bash
npm install -g @jackwener/opencli
```

Install from GitHub:

```bash
npm install -g github:LingJingAI-Labs/anime-workbench-cli
```

Or:

```bash
npm install -g git+https://github.com/LingJingAI-Labs/anime-workbench-cli.git
```

After installation, `postinstall` automatically places the plugin under `~/.opencli/plugins/awb`.

It also patches the AWB-specific presentation layer inside `opencli`, including the brand banner, Chinese datetime formatting, and centered AWB table headers.

Verify installation:

```bash
opencli awb --help
```

### Standalone CLI

The standalone CLI scaffold is already available in this repository:

```bash
node packages/awb-cli/bin/awb.js --help
```

The standalone npm package will later be published as `@lingjingai/awb-cli`.

If the standalone CLI does not yet have its own local session, it reuses the existing AWB auth and project-group state to avoid duplicate login. Supported legacy paths include:

- `~/.opencli/awb-auth.json`
- `~/.opencli/awb-state.json`
- `~/.animeworkbench_auth.json`

If multiple records exist, the CLI picks the newest one with the freshest token.

## Local Development

```bash
cd /Users/zheyong/Developer/anime-workbench-cli
npm install -g .
```

Or refresh the local plugin install directly:

```bash
node /Users/zheyong/Developer/anime-workbench-cli/install.mjs
```

Validate code:

```bash
npm run check
```

Sync versions:

```bash
npm run version:sync -- 0.1.1
```

Validate skill metadata:

```bash
npm run check
```

## Skill / Agent Usage

Skill entry files:

- `skills/awb/SKILL.md`
- `skills/awb/compat.json`
- `skills/awb/VERSION`

Skill updates:

```bash
bash skills/awb/scripts/check-update.sh
bash skills/awb/scripts/update.sh
```

Skill workflows only keep atomic basic usage, for example:

- simple text-to-image
- reference image generation / multi-reference image generation
- batch image generation
- first-frame video
- first-last-frame video
- multi-reference video
- storyboard video
- batch video generation

## Login

After registering on the official website and linking WeChat, sign in by scanning the QR code in terminal:

```bash
opencli awb login-qr
```

Only print the QR URL without waiting:

```bash
opencli awb login-qr --waitSeconds 0 -f json
```

Phone verification-code login:

```bash
opencli awb send-code --phone 13800138000 --captchaVerifyParam '<aliyun-captcha>'
opencli awb phone-login --phone 13800138000 --code 123456
```

## Teams And Project Groups

Inspect current account, team, and project group:

```bash
opencli awb me -f json
opencli awb points -f json
```

Switch team:

```bash
opencli awb teams -f json
opencli awb team-select --groupId <groupId> -f json
```

Manage project groups:

```bash
opencli awb project-groups -f json
opencli awb project-group-current -f json
opencli awb project-group-users -f json
opencli awb project-group-create --name "CLI Project" -f json
opencli awb project-group-select --projectGroupNo <projectGroupNo> -f json
```

## Model Discovery

List image models:

```bash
opencli awb image-models
```

List video models:

```bash
opencli awb video-models
```

Filter by name:

```bash
opencli awb image-models --model "Nano Banana"
opencli awb video-models --model "可灵 3.0"
```

Inspect model parameters, constraints, and recommended CLI usage:

```bash
opencli awb model-options --modelGroupCode <modelGroupCode>
```

## Uploads

Upload local files to the media bucket:

```bash
opencli awb upload-files --files ./ref.webp -f json
opencli awb upload-files --files ./frame.webp --sceneType material-video-create -f json
```

The result includes both `backendPath` and `signedUrl`.

## Image Creation

Estimate fee:

```bash
opencli awb image-fee \
  --modelGroupCode <modelGroupCode> \
  --prompt "一位赛博风格少女站在霓虹街头" \
  --quality 1K \
  --ratio 16:9 \
  --generateNum 1
```

Create image task:

```bash
opencli awb image-create \
  --modelGroupCode <modelGroupCode> \
  --prompt "一位赛博风格少女站在霓虹街头" \
  --quality 1K \
  --ratio 16:9 \
  --generateNum 1 \
  --dryRun true
```

Multi-reference for Banana-family models:

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

Batch image creation:

```bash
opencli awb image-create-batch \
  --inputFile ./image-batch.json \
  --modelGroupCode <modelGroupCode> \
  --concurrency 2 \
  --dryRun true -f json
```

## Video Creation

Frame-based mode:

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

Prompt-only mode (supported by some models only):

```bash
opencli awb video-create \
  --modelGroupCode <modelGroupCode> \
  --prompt "雨夜街头，人物缓慢走向镜头，电影感" \
  --quality 720 \
  --generatedTime 5 \
  --ratio 16:9 \
  --dryRun true
```

Reference-based video mode:

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

Storyboard mode:

```bash
opencli awb video-create \
  --modelGroupCode <modelGroupCode> \
  --storyboardPrompts "镜头1：城市远景||镜头2：人物走近镜头" \
  --quality 720 \
  --generatedTime 5 \
  --ratio 16:9 \
  --dryRun true
```

Batch video creation:

```bash
opencli awb video-create-batch \
  --inputFile ./video-batch.json \
  --modelGroupCode <modelGroupCode> \
  --concurrency 2 \
  --dryRun true -f json
```

## Task Status

Query task feeds:

```bash
opencli awb tasks --taskType IMAGE_CREATE -f json
opencli awb tasks --taskType VIDEO_GROUP -f json
```

Wait for a specific task:

```bash
opencli awb task-wait --taskId <taskId> --taskType IMAGE_CREATE -f json
opencli awb task-wait --taskId <taskId> --taskType VIDEO_GROUP -f json
```

## Notes

Recommended workflow:

```bash
opencli awb video-models --model "可灵 3.0"
opencli awb model-options --modelGroupCode <modelGroupCode>
opencli awb video-create ... --dryRun true
opencli awb video-create ...
```

`dryRun` builds the real request and calls the fee-estimation endpoint, but does not submit the final creation task.
