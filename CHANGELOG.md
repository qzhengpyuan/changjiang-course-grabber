# 变更记录

## 2.10.1

- 修复：大文件下载丢尾段时无法察觉（实测 284MB 视频只落 274MB，浏览器仍报完成）。新增 `fetchTotalSize`（`Range: bytes=0-0` 读 `Content-Range` 的总长）与 `verifyDownloadSize`（容差 `max(4KB, 0.1%)`）；单视频、单录音、视频页、批量视频/录音全部改用同一口径，直链清单里的真实大小也来自它。
- 已知限制：在浏览器下载模式下，脚本猫回报的 `loaded` 是声明总大小而非实际落盘字节，因此这条校验对「浏览器接管下载」的路径无效，只对脚本内流式下载（blob 兜底）有效。真丢尾段时请用「直链」+ `aria2c -c -x8 -s8` 续传，这也是报错文案给出的做法。
- 修复：`fetchTotalSize` 在跨域下拿不到 `Content-Range`（不在 CORS 安全响应头里）时，206 响应的 `Content-Length` 只是那 1 个字节，早先会误判成「总大小 1 B」导致正常下载被判不完整。现在 206 只认 `Content-Range`，拿不到就返回 0（跳过校验）。
- 修复：课堂录音面板写的「约 N 分钟」是课堂时长，不是音频轨长度（实测 89 分钟课堂的音频只有 18.9 分钟）。文案改成「课堂 N 分钟」，避免误读。
- 改进：课堂没有回放时，点「录音」报错后按钮自动置灰并注明原因，不必反复点。
- 移除：`/pro/lms/*/studycontent` 的 `@match` 与对应分支。该页正常只在 iframe 里出现（已被 `@noframes` 排除），单独打开又不挂工具栏，属于走不到的死代码。
- 开发：`dev/ui_test.py` 适配 2.9 之后的界面（工具栏三按钮 + 批量弹窗选择），新增 `dev/unit_check.mjs`（色彩空间、文件名、并发队列的纯函数测试）。

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
