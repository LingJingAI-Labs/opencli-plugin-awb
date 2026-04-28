# subject-publish / subject-upload

`subject-publish` / `subject-upload` 把一个真人或角色登记为 Seedance 2.0 可复用主体，后续视频用 `@角色名` + `--refSubjects` 引用。它是 Seedance 2.0 主体资产链路，不是普通上传，也不要泛化到其他参考模型。

## 1. 什么时候用

- 同一真人 / 角色要跨多段视频复用。
- 目标是 Seedance 2.0 / Seedance 2.0 Fast 的主体参考链路，并且账号有权限。
- 用户关心人物一致性、说话、短剧多镜头复用。

无权限、一次性试片、非 Seedance 主体链路时，用普通 `refImageFiles` / `refImageUrls`。

## 2. 输入与命名

- 主参考必填；正面、侧面、背面可选，补齐会更稳。
- 传本地文件或已上传 backendPath / URL 都可以；已有素材不要重复上传。
- 默认按 `projectName + name + stateKey` 复用素材组；换 `stateKey` 适合不同造型 / 版本。
- 敏感人设不要直接放进素材组名或素材名；用 `publishCode` / 安全命名和中性描述。

## 3. 输出怎么用

- 优先使用返回的 `nextRefSubject`，它已经是 `角色=asset-xxx` 的完整引用写法。
- 不要让 agent 手拼主体 ID，容易把角色名、等号或空格拼错。
- 多主体时按 CLI 支持的格式拼接；prompt 里的 `@角色名` 要与引用名一致。

## 4. 排障经验

- `primaryFile` / `primaryUrl` 选最稳定、清晰、干净的一张；它对应的 asset 会成为主体主键。
- 已发布资产状态用 `subject-status` 查；平台没有完整审核状态时，CLI 只能区分已发布可引用与未查到。
- 不过审时先查素材组，再用 `subject-group-update` 改成中性组名 / 描述。
- 批量主体注册用 `subject-publish-batch`，正式跑前先 dry-run，并把返回的引用写法保存到后续视频批量输入里。
