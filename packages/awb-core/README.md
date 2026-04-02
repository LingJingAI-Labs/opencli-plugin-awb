# @lingjingai/awb-core

`@lingjingai/awb-core` 是 LingJing AI Anime Workbench 的共享核心层。  
It contains the shared core runtime for LingJing AI Anime Workbench.

包含内容：

- 鉴权与本地状态读写
- AWB API 请求封装
- 文件上传与媒体元数据读取
- 模型查询、参数整理、dry-run 与任务提交
- 给 `opencli-plugin-awb` 和 `@lingjingai/awb-cli` 共用的命令定义

主要导出：

- `./common.js`
- `./commands.js`
- `./standalone.js`
