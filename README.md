# 长江雨课堂 课件抓取助手

一个脚本猫 / Tampermonkey 用户脚本，用来把**长江雨课堂**（`changjiang.yuketang.cn`）课程里的
PPT 课件和视频保存到本地：整门课一键导出为 **PDF**、**图片版 PPTX** 或**逐页图片 ZIP**（最后打包成一个压缩包下载），
视频同样支持**整门课一次性下载**：脚本会读「学习内容」的章节树，
把学习日志里没显示出来的视频也一并找出来（实测一门课日志只列 3 个、章节树里有 7 个），
也可以只导出带签名的 MP4 直链交给下载器。

仓库地址：<https://github.com/qzhengpyuan/changjiang-course-grabber>
脚本猫脚本站：<https://scriptcat.org/zh-CN/script-show-page/9063>（站内搜索「长江雨课堂 课件抓取助手」）

![课程页工具栏](https://cdn.jsdelivr.net/gh/qzhengpyuan/changjiang-course-grabber@main/docs/images/screenshot-course.png)

> 只在**自己已登录**的浏览器里操作自己的课程数据，不绕过任何权限校验。

---

## 功能

| 位置 | 按钮 | 作用 |
| --- | --- | --- |
| 顶部工具栏 | 扫描课程 | 拉取课程日志 + 学习内容章节树，统计 PPT / 视频数量（并说明多出来的视频来自哪），把按钮挂到对应卡片上 |
| 顶部工具栏 | 全课 PPT→PDF | 整门课导出，**最后打包成一个 ZIP 下载一次**，内含各课件 PDF |
| 顶部工具栏 | 全课 PPT→ZIP | 同上，包内是按课件分的逐页 JPG 目录（`001.jpg`…） |
| 顶部工具栏 | 全课 PPT→PPTX | 同上，包内是各课件的图片版 PPTX（可在 PowerPoint / WPS 打开、放映、批注） |
| 顶部工具栏 | 全课视频↓MP4 | 把章节树里的**全部视频**逐个下载成 MP4（含日志里没列出的那些），一个一个来，带进度 |
| 顶部工具栏 | 视频直链清单 | 导出全部视频的 MP4 直链（含两种清晰度）为 txt，可交给 aria2 / 下载器 |
| 课件卡片 | PDF / 图片ZIP / PPTX | 单个课件导出 |
| 视频卡片 | 视频 / 直链 | 下载该视频 MP4 / 复制直链到剪贴板 |
| 视频页（右下角） | 下载 MP4 | 在学习空间视频页直接下载当前视频 |

![工具栏按钮（含全课视频）](https://cdn.jsdelivr.net/gh/qzhengpyuan/changjiang-course-grabber@main/docs/images/toolbar-v24.png)

![卡片上的按钮](https://cdn.jsdelivr.net/gh/qzhengpyuan/changjiang-course-grabber@main/docs/images/screenshot-card-buttons.png)

批量任务有进度面板，单个任务成功/失败都会弹提示：

![批量进度面板](https://cdn.jsdelivr.net/gh/qzhengpyuan/changjiang-course-grabber@main/docs/images/panel-batch.png)

视频页右下角的下载按钮：

![视频页按钮](https://cdn.jsdelivr.net/gh/qzhengpyuan/changjiang-course-grabber@main/docs/images/screenshot-video.png)

---

## 安装

### 脚本猫（ScriptCat）／ Tampermonkey

1. 浏览器装好 [脚本猫](https://scriptcat.org/) 或 Tampermonkey；
2. 打开下面的地址，脚本管理器会弹出安装页，点「安装」：

   - jsDelivr（默认，国内可直连）：<https://cdn.jsdelivr.net/gh/qzhengpyuan/changjiang-course-grabber@main/changjiang-courseware-grabber.user.js>
   - GitHub 原始地址（raw，被墙时用不了）：<https://raw.githubusercontent.com/qzhengpyuan/changjiang-course-grabber/main/changjiang-courseware-grabber.user.js>

   > 脚本头部的 `@icon`／`@icon64`／`@updateURL`／`@downloadURL` 都指向 jsDelivr，
   > 这样国内不挂代理也能显示图标、检查更新。jsDelivr 是 GitHub 仓库的公共 CDN 镜像，
   > 分支地址有缓存（最长约 12 小时），刚 push 完立刻检查更新可能还拿到旧版；
   > 等不及就把上面的地址加个查询参数（如 `?v=2`）绕过缓存。

3. 登录长江雨课堂，进入任意课程的学习日志页（`/v2/web/studentLog/<classroom_id>`），
   页面顶部会出现工具栏。

脚本头部已带 `@icon`／`@icon64`（长江雨课堂图标，取自站点 `static/images/logo.png`），
`@updateURL`／`@downloadURL` 指向本仓库，脚本管理器可自动检查更新。

### 权限说明

脚本会申请：`GM_xmlhttpRequest`（跨域拉幻灯片图）、`GM_download`（批量下载，见下文「为什么批量下载要用 GM_download」）、
`GM_setValue` / `GM_getValue`（缓存课件元数据）、`GM_addStyle`，以及
`changjiang.yuketang.cn`、`yangtse-oplat.xuetangx.com`、`ali-cdn.xuetangx.com`、`xuetangx.com`、`yuketang.cn` 的连接权限。

---

## 用法

1. 打开课程「学习日志」页，等工具栏出现；
2. 先点 **扫描课程**（面板会显示 `PPT n 个，视频 m 个（日志 a + 学习内容 b）；学习内容里视频 …、课件 …、课堂 …、作业 …`）；
3. 想整门课导出就点 **全课 PPT→PDF / ZIP / PPTX**：整门课全部生成完后**只会下载一个压缩包**，
   命名形如 `示例课程_PDF_20260101-1200.zip`；只想要某一份就点那一行卡片上的按钮；
4. 视频：点 **全课视频↓MP4** 会按「学习内容」章节树逐个下载；
   只要某几个就用 **视频直链清单** 导出 txt，把链接丢给 aria2 / IDM；
5. 文件落在浏览器默认下载目录（Chrome/Edge 一般是 `~/Downloads`）。

> 为什么日志里只有 3 个视频、点「全课视频」却下了 7 个？
> 「学习日志」只列出老师发布到日志流里的活动；「学习内容」是按章节组织的完整课程树，
> 里面还包含从章节进入、没进日志流的视频。脚本以章节树为准，日志作兜底。

批量包内结构：

```
示例课程_PDF_20260101-1200.zip
├── 第01讲-示例课件.pdf
├── 第02讲-示例课件.pdf
└── …

示例课程_ZIP_20260101-1200.zip
├── 第01讲-示例课件/001.jpg … 084.jpg
├── 第02讲-示例课件/001.jpg … 067.jpg
└── …
```

---

## 输出格式：为什么只有 PDF / 图片，没有老师的原始 PPT？

这是雨课堂本身的机制，不是脚本偷懒：

- 学生端看到的课件，是服务端把 PPT **渲染成整页 JPEG** 后按页下发的
  （`GET /v2/api/web/cards/detlist/{courseware_id}` 里的 `Slides[].Cover`，
  图片在 `yangtse-oplat.xuetangx.com/weboffice/images/{ppt_file_id}/…`），页面上只有「打印课件」，**没有下载原文件**的入口。
- 教师端的 `ppt_download_url` 接口（`/v2/api/web/cards/ppt_download_url`）确实存在，
  学生身份调用会返回按学校维度的文件 id（形如 `{"<university_id>": <file_id>}`），但拿不到配套的可下载地址，
  也没有任何前端流程会用到它 —— 属于教师/管理端能力。

所以脚本提供三种「PPT 形式」，都基于同一份整页位图：

| 格式 | 适用 | 特点 |
| --- | --- | --- |
| `.pdf` | 阅读、打印、发给别人 | 每页一张图直嵌（DCTDecode），体积小、翻页快 |
| `.pptx` | 想在幻灯片软件里放映、批注、插页 | 每页一个整页图片框，**文字不是可编辑文本** |
| `.zip`（逐页 JPG） | 要单独用某几页图 | `001.jpg`、`002.jpg`… |

PPTX 实测：37 页课件导出 `示例课件.pptx`（约 2.6 MB），LibreOffice 打开正常，
`soffice --convert-to pdf` 得到 37 页、页面尺寸 1170.6×877.9 pt，与 PDF 一致。

---

## 常见问题

**Q：点「全课 PPT→PDF」只下载到一份？**
v2.0.1 起改走 `GM_download`（`chrome.downloads`，不受「一次点击只能下载一个文件」的限制）；
**v2.3.0 起批量改成「整门课生成完 → 打包成一个 ZIP → 只下载这一次」**，从根上绕开多文件下载限制
（和学习通抓取助手同一套做法）。单课件按钮仍然下载单个文件。
实测 ScriptCat 1.5.1 + Vivaldi：6 份课件 → 一个 31~33 MB 的 ZIP，`unzip -t` 通过、中文名不乱码。

**Q：下载走的是浏览器下载还是别的东西？**
走浏览器下载系统：`GM_download` 会创建一条普通的 `chrome.downloads` 记录，文件落在浏览器默认下载目录。
只有在脚本管理器不支持 `GM_download` 时才退回页面内 `<a download>` + Blob。

**Q：我装了 Rayburst / 迅雷这类下载管理器，为什么它抓不到？**
因为 PDF / PPTX / ZIP 是脚本**在页面内存里现场拼出来的 Blob**，没有可抓取的 http 地址，
下载管理器拿到的只是 `blob:...`，它没法自己下载。这是原理限制。
能交给下载管理器的是**视频**：MP4 是带签名直链的真实 URL，
用「视频直链清单」导出后粘进下载器即可（直链有有效期，过期重新导出）。

**Q：清晰度还能再高吗？**
当前拿的就是雨课堂下发给学生的整页渲染图（实测 960×720 / 1280×720 一类），
再高只能拿原始 pptx，见上面「输出格式」一节。

**Q：课堂回放（直播回看）能抓吗？**
学生端没有权限：`/v2/web/playback/{lesson_id}` 会跳 `/v2/web/forbidden`，
需要教师在课程里开启回放后才有内容。

**Q：课件 ZIP 里怎么是 .jpg？**
ZIP 输出就是逐页原图打包，方便单独取图；要整页排好版的用 PDF / PPTX。

---

## 接口速查（逆向自网页版 1.2.354）

| 用途 | 请求 |
| --- | --- |
| 课程列表 | `GET /v2/api/web/courses/list?identity=2` |
| 课程日志 | `GET /v2/api/web/logs/learn/{classroom_id}?actype=-1&page={p}&offset=20&sort=-1`（`type` 2=课件 17=视频 14=课堂 19=作业 9=学习任务 15=公告） |
| 课程元信息 | `GET /v2/api/web/classrooms/{cid}?role=5` → `uv_id`、`course_sign` |
| 学习内容章节树 | `GET /mooc-api/v1/lms/learn/course/chapter?cid={cid}&sign={sign}&term=latest&uv_id={uv_id}&classroom_id={cid}` → `course_chapter[].section_leaf_list[]`，`leaf_type` **0=视频 6=作业 7=课件 8=课堂** |
| 课件分页 | `GET /v2/api/web/cards/detlist/{courseware_id}?classroom_id={cid}` → `Slides[].Cover`、`Width/Height`、`ppt_file_id` |
| 视频信息 | `GET /mooc-api/v1/lms/learn/leaf_info/{cid}/{leaf_id}/?classroom_id={cid}` → `content_info.media.ccid` |
| 视频直链 | `GET /api/open/audiovideo/playurl?video_id={ccid}&provider=cc&file_type=1&is_single=0&domain=changjiang.yuketang.cn` → `playurl.sources.quality20/quality10` |

三个踩过的坑：

1. **`/mooc-api/*` 必须带请求头 `xtbz: ykt`**，否则 `{"msg":"XTBZ IS REQUIRED","error_code":40000}`。
2. **幻灯片图和视频 CDN 返回 `Access-Control-Allow-Origin: *`**，带 cookie 的 `fetch` 会被浏览器拒绝，
   必须 `credentials: "omit"`，失败再退回 `GM_xmlhttpRequest`。
3. **批量下载不能用连续 `<a download>`**，见上面常见问题。

---

## 目录

```
changjiang-course-grabber.user.js   用户脚本本体（单文件）
assets/                            脚本图标（@icon / @icon64）
docs/images/                       README 配图
reference/                         参考项目「学习通 PDF 抓取助手」原始文件
tools/                             调试与回归测试脚本（CDP 驱动 :99 影子浏览器）
```

`tools/` 里的东西只用于开发验证，普通使用不需要：

- `cdp.py` — 极简 CDP 客户端；`install_script.py` — 把脚本装进影子浏览器的脚本猫
- `ui_test.py` — 在页面上点按钮、观察进度面板与落盘文件（`scan` / `batch_pdf` / `batch_zip` / `card` / `videolist` / `video`）
- `batch_fetch.py` — 无头批量跑「全课 PPT→PDF」
- `verify_mount.py` — 校验卡片按钮与活动类型是否一一对应

---

## 致谢与许可

- 工具栏、进度面板、提示条、STORE ZIP 写入器等模块复用自「学习通 PDF 抓取助手」（见 `reference/`）。
- 图标取自长江雨课堂站点 `static/images/logo.png`，仅用于标识本脚本；与雨课堂官方无隶属关系。

MIT License，见 [LICENSE](LICENSE)。
