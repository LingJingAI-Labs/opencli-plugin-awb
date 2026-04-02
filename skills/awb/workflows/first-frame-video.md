# First Frame Video

只给首帧做视频：

```bash
"$AWB_CMD" auth-status -f json
"$AWB_CMD" video-models
"$AWB_CMD" model-options --modelGroupCode <g>
"$AWB_CMD" video-create --modelGroupCode <g> --frameFile ./frame.webp --quality 720 --generatedTime 5 --ratio 16:9 --dryRun true -f json
"$AWB_CMD" video-create --modelGroupCode <g> --frameFile ./frame.webp --quality 720 --generatedTime 5 --ratio 16:9 --waitSeconds 180 -f json
```
