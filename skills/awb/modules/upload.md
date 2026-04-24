# Upload Module

两种素材：**普通素材**（一次性引用）与 **主体素材**（可复用的角色 / 人物，仅内部员工）。

## 1. 何时使用

- 本地有图 / 视频 / 音频，要作为参考素材喂给创作命令
- 已经上传过、有 `素材路径` / `backendPath`，想复用
- 注册一个可复用主体（多视频共享同一角色 / 人物），仅内部员工

## 2. 核心概念

- **普通素材**（`upload-files`）：把本地文件登记到素材桶，返回 `素材路径`（= backendPath）和 `素材组ID`（groupId）。适合一次性引用或后续复用。
- **主体素材**（`subject-publish` / `subject-upload`，需有权限账号）：多张参考图一起注册为一个"主体"，拿到 `subjectId`（格式 `asset-xxx`），后续靠 `@角色名` + `--refSubjects "角色=asset-..."` 稳定引用。默认推荐 `subject-publish`，因为它会优先用安全代码名生成素材组名/素材名，降低敏感词卡审核的概率。
- **Files 后缀 vs 无 Files**：创作命令里
  - `--irefFiles` / `--crefFiles` / `--srefFiles`：本地文件，CLI **自动上传**后引用
  - `--iref` / `--cref` / `--sref`：已经在素材桶里的 backendPath，直接复用
- **`upload-files.sceneType`**：决定素材归类（`material-image-draw` 生图池 / `material-video-create` 生视频池）。默认 `material-image-draw`。做 Seedance / Grok / Kling / 3o 这类参考生视频时，优先先传到 `material-video-create` 再复用 backendPath。

## 3. 命令

| 命令 | 用途 | 路由提醒 |
|------|------|----------|
| `upload-files --files a.png,b.png` | 通用文件上传（图 / 视频 / 音频） | 返回 `素材路径`（backendPath）和 `素材组ID`；要传给生视频池，加 `--sceneType material-video-create` |
| `subject-publish` / `subject-upload`（**需有权限账号**） | 把角色 / 人物注册成可复用主体 | 必读 [`../references/subject-upload.md`](../references/subject-upload.md)；返回"引用写法"列可直接粘到 `--refSubjects` |
| `subject-publish-batch` | 批量注册真人/角色主体 | 适合 agent/沙箱断线场景；输入文件里逐条给 `name + primaryFile/primaryUrl` |
| `subject-status` | 查主体素材组状态 | 用 `groupId` 或 `name/projectName/stateKey` 定位，排查不过审时的组名/描述 |
| `subject-group-update` | 改主体素材组名 / 描述 | 敏感人设词不过审时，优先改成代码化组名与中性描述 |

## 4. 常用写法

```bash
# 通用上传（生图池）
"$AWB_CMD" upload-files --files ./ref.webp -f json
# 生视频池：场景字段不同，上传后可用作视频参考
"$AWB_CMD" upload-files --files ./motion.mp4 --sceneType material-video-create -f json
"$AWB_CMD" upload-files --files ./char.webp,./scene.webp --sceneType material-video-create -f json

# 创作命令里复用已上传的 backendPath
"$AWB_CMD" image-create --modelGroupCode <g> --prompt "..." \
  --iref "/material/20260423/xxx.webp" -f json

# 参考生视频：先上传到生视频池，再按命名 backendPath 复用
"$AWB_CMD" video-create --modelGroupCode <g> \
  --prompt "@角色A 在 @场景1 前说话" \
  --refImageUrls "角色A=/material/video-create/xxx-char.webp,场景1=/material/video-create/xxx-scene.webp" \
  --quality 720 --generatedTime 5 --ratio 9:16 -f json

# 真人主体参考生视频：先把 backendPath 注册成主体 asset id
NEXT_REF=$("$AWB_CMD" subject-publish --name 小莉 \
  --primaryUrl /material/video-create/xxx-char.webp -f json | jq -r ".nextRefSubject")
"$AWB_CMD" video-create --modelGroupCode JiMeng_Seedance_2_Fast_VideoCreate_Group \
  --prompt "@小莉 对镜说话" \
  --refSubjects "$NEXT_REF" \
  --quality 720 --generatedTime 5 --ratio 9:16 -f json

# 主体素材：四角度一次性注册（需有权限账号，优先用 `subject-publish`）
"$AWB_CMD" subject-upload --name 小莉 \
  --primaryFile ./three-view.png \
  --faceFile ./front.png --sideFile ./side.png --backFile ./back.png \
  --projectName demo -f json
# 下一步：直接从输出的"引用写法"列粘到 --refSubjects
"$AWB_CMD" video-create --modelGroupCode <g> --prompt "@小莉 对镜说话" \
  --refSubjects "小莉=asset-xxxxxxxx" --refAudioFiles "小莉=./voice.mp3" \
  --quality 720 --generatedTime 5 --ratio 9:16 -f json

# 批量主体注册：适合 agent / 沙箱可能断开的环境
"$AWB_CMD" subject-publish-batch --inputFile ./subject-batch.json --dryRun true -f json
"$AWB_CMD" subject-publish-batch --inputFile ./subject-batch.json -f json
```

## 5. 经验引导

- **不要手工拼接主体引用**：`subject-publish` / `subject-upload` 输出有一列"引用写法"（`nextRefSubject`），已经是 `角色=asset-xxx` 的现成字符串——直接粘到 `--refSubjects`，不要用"主体ID"列再手拼一次（容易错）。
- **真人主体优先 `subject-publish`**：如果你的目标是拿 `asset-xxx` 去 `--refSubjects`，就不要停在 `upload-files`；已有 backendPath 时继续走 `subject-publish --primaryUrl <backendPath>`。默认会用安全代码名做素材组名/素材名；想自定义时传 `--publishCode`。
- **`*Files` 是一次性上传快捷方式**：创作命令里 `--irefFiles ./a.webp` 会自动上传再引用；已经有 backendPath 的 → 用 `--iref "<backendPath>"`，省一次上传。视频参考同理，已有素材池路径时优先用 `--refImageUrls "角色A=/material/..."` / `--refVideoUrls` / `--refAudioUrls`。
- **同一组素材别重复上传**：`subject-publish` / `subject-upload` 支持 `--primaryUrl` / `--faceUrl` / `--sideUrl` / `--backUrl` 直接传已在 COS / AWB 素材池里的 URL 或 backendPath。
- **素材组命名**：`subject-publish` / `subject-upload` 默认按 `projectName + name + stateKey` 拼素材组名；同项目同角色再次上传会复用，换 `stateKey` 产生新版本；想完全自定义用 `--groupName`。
- **`primaryFile` 不必是三视图**：名字是历史兼容（`--threeViewFile` 是它的别名）；一张稳定正面照也 OK，有正 / 侧 / 背再一起补齐。
- **`refImagesJson` / `refSubjectsJson` 是"我就是想手写 JSON"的逃生口**：一般不用；常规写 `--refImageFiles "名=./a.webp"` / `--refSubjects "名=asset-..."` 更清晰。

- **你说的“加白”若是平台审核/白名单链路**：当前 CLI 没有独立的“火山审核状态查询 / 提交白名单”命令。`upload-files` 只是把文件放进 AWB 素材池；后续若平台已经给了可用素材路径，就可以继续把 backendPath 传给 `--refImageUrls` / `--refVideoUrls` 复用。

- **批量加白/主体注册优先 `subject-publish-batch`**：对多个人物一次性跑完，结果里直接拿 `引用写法` 回填到后续 Seedance 任务，最适合 agent 和会断线的沙箱。

- **不过审先查组，再改组**：先 `subject-status --groupId <groupId>` 看当前素材组名/描述，再用 `subject-group-update --groupId <groupId> --groupName subj-xxxx --description "主体素材组 subj-xxxx [default]"` 调成中性文案。
