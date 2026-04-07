# Auth And Account

前置条件：

- 先确认用户已在官网完成注册并绑定微信：`https://animeworkbench.lingjingai.cn/home`
- CLI 默认推荐通过微信扫码登录
- 如果官网账号还没绑定微信，先去官网完成绑定，再继续 `login-qr`

推荐顺序：

1. `"$AWB_CMD" auth-status -f json`
2. 如果未登录，执行 `"$AWB_CMD" login-qr`
3. 登录成功后执行 `"$AWB_CMD" me -f json`
4. 需要切团队时执行 `"$AWB_CMD" teams -f json` 和 `"$AWB_CMD" team-select --groupId <id> -f json`
5. 需要切项目组时执行 `"$AWB_CMD" project-groups -f json` 和 `"$AWB_CMD" project-group-select --projectGroupNo <no> -f json`

常用命令：

```bash
"$AWB_CMD" auth-status -f json
"$AWB_CMD" login-qr
"$AWB_CMD" me -f json
"$AWB_CMD" teams -f json
"$AWB_CMD" team-select --groupId <groupId> -f json
"$AWB_CMD" project-groups -f json
"$AWB_CMD" project-group-current -f json
"$AWB_CMD" project-group-select --projectGroupNo <projectGroupNo> -f json
```

注意：

- `auth-status` 是所有自动化流程的第一步
- 创作失败先看当前项目组，不要只看团队
