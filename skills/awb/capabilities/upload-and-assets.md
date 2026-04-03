# Upload And Assets

普通素材上传：

```bash
"$AWB_CMD" upload-files --files ./ref.webp -f json
```

内部主体素材上传：

```bash
"$AWB_CMD" subject-upload --name 小莉 --primaryFile ./three-view.png --projectName demo --dryRun true -f json
"$AWB_CMD" subject-upload --name 小莉 --primaryFile ./three-view.png --projectName demo -f json
```

主体引用：

```bash
"$AWB_CMD" video-create --modelGroupCode <g> --prompt "@小莉 对镜说话" --refSubjects "小莉=asset-xxxxxxxx" --quality 720 --generatedTime 5 --ratio 9:16 --dryRun true -f json
```

规则：

- 普通图片/视频/音频参考直接走 `ref*`
- 已有主体素材 ID 时，优先走 `refSubjects`
- `subject-upload` 仅内部员工可用；普通用户不要把它当通用上传命令
