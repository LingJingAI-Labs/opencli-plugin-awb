# Simple Text To Image

最基础的文生图：

```bash
"$AWB_CMD" auth-status -f json
"$AWB_CMD" image-models
"$AWB_CMD" model-options --modelGroupCode <g>
"$AWB_CMD" image-create --modelGroupCode <g> --prompt "一只小狗" --quality 1K --ratio 16:9 --generateNum 1 --dryRun true -f json
"$AWB_CMD" image-create --modelGroupCode <g> --prompt "一只小狗" --quality 1K --ratio 16:9 --generateNum 1 --waitSeconds 120 -f json
```
