# Multi Reference Video

多参考生视频：

```bash
"$AWB_CMD" auth-status -f json
"$AWB_CMD" video-models
"$AWB_CMD" model-options --modelGroupCode <g>
"$AWB_CMD" video-create --modelGroupCode <g> --prompt "@角色A 在雨夜奔跑" --refImageFiles "角色A=./char.webp,背景=./bg.webp" --refVideoFiles "动作=./motion.mp4" --quality 720 --generatedTime 5 --ratio 16:9 --dryRun true -f json
"$AWB_CMD" video-create --modelGroupCode <g> --prompt "@角色A 在雨夜奔跑" --refImageFiles "角色A=./char.webp,背景=./bg.webp" --refVideoFiles "动作=./motion.mp4" --quality 720 --generatedTime 5 --ratio 16:9 --waitSeconds 180 -f json
```

主体素材引用：

```bash
"$AWB_CMD" video-create --modelGroupCode <g> --prompt "@小莉 对镜说话" --refSubjects "小莉=asset-xxxxxxxx" --refAudioFiles "小莉=./voice.mp3" --quality 720 --generatedTime 5 --ratio 9:16 --dryRun true -f json
```
