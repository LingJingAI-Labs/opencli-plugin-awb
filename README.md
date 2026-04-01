# opencli-plugin-awb

Anime Workbench (`animeworkbench.lingjingai.cn`) terminal plugin for `opencli`.

This plugin is terminal-only. It does not depend on opening the AWB web UI after installation.

## Install

Prerequisite:

```bash
npm install -g @jackwener/opencli
```

Install from this repo:

```bash
cd /Users/zheyong/Developer/cvm/opencli-plugin-awb
npm install -g .
```

Or refresh the local development install:

```bash
node /Users/zheyong/Developer/cvm/opencli-plugin-awb/install.mjs
```

## Login

WeChat QR login in terminal:

```bash
opencli awb login-qr
```

Only print the QR URL without waiting:

```bash
opencli awb login-qr --waitSeconds 0 -f json
```

Phone login:

```bash
opencli awb send-code --phone 13800138000 --captchaVerifyParam '<aliyun-captcha>'
opencli awb phone-login --phone 13800138000 --code 123456
```

First-time WeChat bind flow:

```bash
opencli awb bind-phone --phone 13800138000 --code 123456
```

## Teams And Projects

Inspect current account, team, and project group:

```bash
opencli awb me -f json
opencli awb points -f json
opencli awb team-points -f json
```

Switch team:

```bash
opencli awb teams -f json
opencli awb team-select --groupId <groupId> -f json
```

Manage creation project groups:

```bash
opencli awb project-groups -f json
opencli awb project-group-current -f json
opencli awb project-group-users -f json
opencli awb project-group-create --name "CLI Project" -f json
opencli awb project-group-select --projectGroupNo <projectGroupNo> -f json
```

## Points

```bash
opencli awb point-packages -f json
opencli awb point-records --pageNo 1 --pageSize 20 -f json
opencli awb redeem --code XXXX-XXXX-XXXX-XXXX -f json
```

## Models And Success Rate

Image and video model lists include current success-rate fields from AWB:

```bash
opencli awb image-models -f json
opencli awb video-models -f json
```

Returned rows include fields such as `successRate`, `successRatePct`, `successCount`, `failCount`, `modelStatus`, and `pointNo`.

## Local Uploads

Upload local files for later use in image or video creation:

```bash
opencli awb upload-files --files ./ref.png -f json
opencli awb upload-files --files ./first-frame.png --sceneType material-video-create -f json
```

The command returns both AWB `backendPath` and signed `signedUrl`.

## Image Creation

Estimate fee:

```bash
opencli awb image-fee \
  --modelCode JiMeng4_ImageCreate \
  --modelGroupCode JiMeng4_ImageCreate_Group \
  --prompt "一位赛博风格少女站在霓虹街头" \
  --irefFiles ./ref.png \
  -f json
```

Create image task:

```bash
opencli awb image-create \
  --modelCode JiMeng4_ImageCreate \
  --modelGroupCode JiMeng4_ImageCreate_Group \
  --projectGroupNo <projectGroupNo> \
  --prompt "一位赛博风格少女站在霓虹街头" \
  --crefFiles ./char.png \
  --srefFiles ./style.png \
  --irefFiles ./ref.png \
  -f json
```

Batch create images from JSON, JSONL, or one prompt per line:

```bash
opencli awb image-create-batch \
  --inputFile ./image-batch.json \
  --modelCode JiMeng4_ImageCreate \
  --modelGroupCode JiMeng4_ImageCreate_Group \
  --projectGroupNo <projectGroupNo> \
  --concurrency 2 \
  -f json
```

## Video Creation

Estimate fee with a local first frame:

```bash
opencli awb video-fee \
  --modelCode JiMeng3_VideoCreate \
  --modelGroupCode JiMeng3_VideoCreate_Group \
  --frameText "镜头缓慢推进，少女在霓虹雨夜回头" \
  --frameFile ./first-frame.png \
  -f json
```

Create video task:

```bash
opencli awb video-create \
  --modelCode JiMeng3_VideoCreate \
  --modelGroupCode JiMeng3_VideoCreate_Group \
  --projectGroupNo <projectGroupNo> \
  --frameText "镜头缓慢推进，少女在霓虹雨夜回头" \
  --frameFile ./first-frame.png \
  --tailFrameFile ./last-frame.png \
  --generatedTime 5 \
  -f json
```

Batch create videos:

```bash
opencli awb video-create-batch \
  --inputFile ./video-batch.json \
  --modelCode JiMeng3_VideoCreate \
  --modelGroupCode JiMeng3_VideoCreate_Group \
  --projectGroupNo <projectGroupNo> \
  --concurrency 2 \
  -f json
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
