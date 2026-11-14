# 变更记录

## 2.10.0

- 移除仓库内的参考项目运行时备份（`reference/`）：那份 ScriptCat 导出里含真实课程数据与同学姓名、学号，不应随源码分发。
- 版本号改为只认脚本头 `@version`（运行时读 `GM_info`），不再在代码里重复三处。
- 修复：批量任务的进度/序号在列表有重复项时错位（`runPool` 用 `indexOf` 取下标）。
- 修复：灰度 JPEG 幻灯片生成的 PDF 按 RGB 解释导致花屏（按 JPEG 分量选 `DeviceGray`/`DeviceRGB`/`DeviceCMYK`）。
- 修复：文件名清理补上 Windows 保留名（`CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9`）与结尾点号空格，避免 Windows 下批量下载失败。
- 改进：接口遇 429/5xx/超时会退避重试两次，整门课批量不再因单次抖动中断。
- 改进：课件元数据缓存加了 300 条上限，超出按写入时间清理最旧的。
- 改进：`@noframes`，避免在学习内容 iframe 里重复注入。
- 仓库：`tools/` 迁到 `dev/`；新增 `CHANGELOG.md` 与发布前检查（`.github/workflows/check.yml` + `dev/check.mjs`）；`.gitignore` 忽略 `reference/`。

## 2.9.x 及更早

见 git 提交记录与脚本站的历史版本说明。
