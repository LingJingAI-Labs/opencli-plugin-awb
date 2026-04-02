# Storyboard Video

故事板生视频：

```bash
"$AWB_CMD" auth-status -f json
"$AWB_CMD" video-models --model "可灵 3.0"
"$AWB_CMD" model-options --modelGroupCode <g>
"$AWB_CMD" video-create --modelGroupCode <g> --storyboardPrompts "镜头1：城市远景||镜头2：人物走近镜头" --quality 720 --generatedTime 5 --ratio 16:9 --dryRun true -f json
"$AWB_CMD" video-create --modelGroupCode <g> --storyboardPrompts "镜头1：城市远景||镜头2：人物走近镜头" --quality 720 --generatedTime 5 --ratio 16:9 --waitSeconds 180 -f json
```
