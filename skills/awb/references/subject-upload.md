# subject-publish / subject-upload — 完整流程

`subject-publish` / `subject-upload` 把一个角色 / 真人登记为**可复用主体**，让后续视频命令用 `@角色名` + `--refSubjects "角色=asset-..."` 稳定引用，而不是每次重新传原图。它既可以吃本地文件，也可以直接吃 `upload-files` 产出的 backendPath。默认推荐 `subject-publish`，因为它会优先用安全代码名做发布名。

> **需有权限账号**。若当前账号可用，真人主体参考生视频优先走这条；无权限时再退回 [`upload-files`](../modules/upload.md) + `refImageUrls`。

## 1. 参数矩阵

四个参考角度，每个角度支持"本地文件"或"已有 URL"二选一：

| 角度 | 本地文件 | 已有 URL | 说明 |
|------|----------|----------|------|
| 主参考 | `--primaryFile` | `--primaryUrl` | **必填**；主参考图的 assetId 会作为 `subjectId` 返回 |
| 正面 | `--faceFile` | `--faceUrl` | 可选；补齐更稳 |
| 侧面 | `--sideFile` | `--sideUrl` | 可选 |
| 背面 | `--backFile` | `--backUrl` | 可选 |

兼容别名：`--threeViewFile` / `--threeViewUrl` 等同 `--primaryFile` / `--primaryUrl`。

身份与分组：

| 参数 | 用途 |
|------|------|
| `--name` | 角色 / 主体名称，**必填**（如 `小莉`） |
| `--projectName` | 素材组项目名，默认 `default` |
| `--stateKey` | 状态名，默认 `default`；非 default 会追加到组名 |
| `--groupName` | 直接指定素材组名；传了就忽略自动拼接 |
| `--description` | 素材组描述；不传自动生成。敏感人设建议改成中性描述 |
| `--publishCode` | 安全代码名；只影响素材组名/素材名，不影响 `--refSubjects` 里的引用名 |
| `--safePublishNaming` | 是否自动用安全代码名代替真实名称；`subject-publish` 默认推荐开启 |
| `--platform` | 可选平台字段，通常不传 |
| `--dryRun true` | 干跑预览 |

## 2. 素材组命名

默认按 `projectName + name + stateKey` 自动拼接：

- `--name 小莉 --projectName demo`（默认 `stateKey=default`） → 组名类似 `demo-小莉`
- `--name 小莉 --projectName demo --stateKey v2` → 组名类似 `demo-小莉-v2`（追加 stateKey）
- `--groupName "小莉-发布版"` → 直接用这个名字，不再拼接

**复用逻辑**：同 `projectName + name + stateKey` 再次上传 → 命中同一素材组，不会重复生成。换 `stateKey` 是做"版本分化"（不同造型 / 服装）。

## 3. 输出字段

6 列：`主体名称 / 素材组ID / 素材组名称 / 主体ID / 引用写法 / 复用素材组`

| 列 | JSON key | 含义 | 下一步怎么用 |
|----|----------|------|--------------|
| 主体ID | `subjectId` | 格式 `asset-xxxxxxxx` | 如果要手拼，就拼 `--refSubjects "角色=asset-xxxxxxxx"` |
| 引用写法 | `nextRefSubject` | 已经是 `角色名=asset-xxxxxxxx` 的现成字符串 | **直接粘到** `--refSubjects`，**别手拼** |
| 素材组ID / 名称 | — | 标识素材组；再次上传同角色会命中 | 无需手抄 |
| 复用素材组 | — | 是否命中已有组（`true` = 复用） | 审计 / 排障用 |

## 4. 最稳写法

四角度 + 干跑预览 + 正式提交：

```bash
"$AWB_CMD" subject-upload --name 小莉 \
  --primaryFile ./primary.webp \
  --faceFile ./front.webp \
  --sideFile ./side.webp \
  --backFile ./back.webp \
  --projectName demo --dryRun true -f json

"$AWB_CMD" subject-upload --name 小莉 \
  --primaryFile ./primary.webp \
  --faceFile ./front.webp \
  --sideFile ./side.webp \
  --backFile ./back.webp \
  --projectName demo -f json
```

只有主参考时：

```bash
"$AWB_CMD" subject-upload --name 小莉 --primaryFile ./front.webp --projectName demo -f json
```

复用已在 COS 的 URL：

```bash
"$AWB_CMD" subject-upload --name 小莉 \
  --primaryUrl https://cos.example.com/path/primary.webp \
  --faceUrl   https://cos.example.com/path/front.webp \
  --projectName demo -f json
```

## 5. 接力到 `video-create`

从返回的 JSON 里取 `nextRefSubject`（就是"引用写法"列），整串粘到 `--refSubjects`：

```bash
# 拿现成字符串
NEXT_REF=$("$AWB_CMD" subject-upload --name 小莉 --primaryFile ./front.webp \
  --projectName demo -f json | jq -r '.nextRefSubject')
# 输出示例：小莉=asset-xxxxxxxx

# 直接塞给 video-create
"$AWB_CMD" video-create --modelGroupCode <g> --prompt "@小莉 对镜说话" \
  --refSubjects "$NEXT_REF" \
  --refAudioFiles "小莉=./voice.mp3" \
  --quality 720 --generatedTime 5 --ratio 9:16 --waitSeconds 180 -f json
```

多主体时逗号连接即可：

```bash
--refSubjects "小莉=asset-xxxxxxxx,小梅=asset-yyyyyyyy"
```

## 6. 经验引导

- **引用写法 > 主体ID**：永远用 `nextRefSubject` 粘贴，不手拼 `subjectId`；少一次出错机会（角色名拼错、等号写错、空格）。
- **`primaryFile` 其实是"哪张图的 assetId 当 subjectId"**：选稳定、干净的正面或三视图；后续所有引用都以它的 assetId 为主键。
- **版本分化走 `--stateKey`**：同一个角色有「发布版 / 试妆版」，用 `--stateKey release` / `--stateKey makeup` 分开素材组，不要同一组里反复覆盖。
- **`--groupName` 是逃生口**：想完全手控组名（比如跨项目共享一组）用它；一般别用，自动拼接够清晰。
- **`--faceFile` / `--sideFile` / `--backFile` 能明显提升一致性**：视频里转镜、换角度时尤其有用；只传 `primaryFile` 时镜头一转人脸容易崩。
- **已在 COS 的素材用 URL 版本**：避免重复上传；`primaryUrl` 可接平台内部 `/material/...` 或 `https://...` 完整 URL。
- **`subject-publish` / `subject-upload` 是真人主体最佳路径（前提是账号有权限）**：它最终返回 `subjectId` / `nextRefSubject`，最适合 Seedance 2.0 / Grok 这类 `--refSubjects` 工作流。若账号无权限，再退回普通 `upload-files` + `refImageUrls`。

## 7. 批量主体注册（agent 推荐）

输入文件支持 JSON 数组 / `{"items": [...]}` / JSONL。每条至少给：

```json
[
  {"name":"小莉","primaryUrl":"/material/video-create/xxx-char.webp"},
  {"name":"小梅","primaryFile":"./mei-front.webp"}
]
```

```bash
"$AWB_CMD" subject-publish-batch --inputFile ./subject-batch.json --dryRun true -f json
"$AWB_CMD" subject-publish-batch --inputFile ./subject-batch.json -f json
```

返回列会包含 `主体名称 / 主体ID / 引用写法 / 素材组ID / 复用素材组 / 错误`。

## 8. 审核不过时怎么调

如果像“老鸨”这类人设词容易卡审核，优先不要直接把人设词放进素材组名/素材名。推荐：

```bash
# 先查当前主体素材组和已发布资产
"$AWB_CMD" subject-status --groupId group-xxxxxxxx

# 再改成代码化组名 + 中性描述
"$AWB_CMD" subject-group-update --groupId group-xxxxxxxx \
  --groupName subj-a1b2c3d4 \
  --description "主体素材组 subj-a1b2c3d4 [default]"
```

如果一开始就知道设定敏感，创建时直接走：

```bash
"$AWB_CMD" subject-publish --name 老鸨 \
  --publishCode actor_001 \
  --primaryUrl /material/video-create/xxx.webp -f json
```

这样 `--refSubjects` 仍然可以继续用真实引用名（如 `老鸨=asset-xxx`），但平台里的组名/素材名会更中性。


> `subject-status` 现在会额外查询 `/api/material/creation/thirdAsset/list`：如果能查到已发布资产，会返回 `发布状态=已发布可引用`、`已发布资产数` 和推导出的 `主体ID`。当前平台没有显式的“审核中/审核拒绝”字段，所以 CLI 只能区分“已发布可引用” vs “未查到已发布资产”。
