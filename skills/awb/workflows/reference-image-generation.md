# Reference Image Generation

参考图生图 / 多图生图：

```bash
"$AWB_CMD" auth-status -f json
"$AWB_CMD" image-models --model "Nano Banana"
"$AWB_CMD" model-options --modelGroupCode <g>
"$AWB_CMD" image-create --modelGroupCode <g> --prompt "参考图里的角色在雨夜奔跑" --quality 1K --ratio 16:9 --generateNum 1 --irefFiles "./a.webp,./b.webp" --dryRun true -f json
"$AWB_CMD" image-create --modelGroupCode <g> --prompt "参考图里的角色在雨夜奔跑" --quality 1K --ratio 16:9 --generateNum 1 --irefFiles "./a.webp,./b.webp" --waitSeconds 120 -f json
```

说明：

- 这里的“图像编辑”在当前 AWB CLI 里主要体现为参考图 / 多图生图
- 具体支持 `iref / cref / sref` 哪种，以模型定义为准
