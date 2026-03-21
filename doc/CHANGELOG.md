# 修订记录（Changelog）

记录每次迭代的主要修改内容。

## v2.1.0 — 2026-03-21

### 新增

- **加载进度遮罩**：打开或重新打开数据文件时显示全屏加载动画，大文件不再出现界面假死
- **未保存内容警告**：在编辑页有未保存修改时点击返回，会弹出二次确认对话框，防止误操作丢失内容
- **关闭标签页保护**：存在未保存内容时关闭或刷新浏览器标签页，浏览器会弹出系统级离开提示
- **防抖自动保存**：停止输入 2 秒后自动将当前日记保存到文件，导航栏同步显示"自动保存中..."提示
- **条目搜索**：日记本详情页新增搜索框，实时按标题和正文关键词过滤条目列表，无结果时显示专属提示
- **心情选择器**：日记编辑页新增一排 emoji 心情按钮（😊 😢 😡 😴 🤔 ✨ 💪），可为每篇日记标记当日心情
- **标签系统**：日记编辑页新增标签输入框（回车或逗号确认），以 chip 形式展示；条目卡片同步显示已选心情和标签
- **日记本排序**：首页新增排序下拉菜单，支持按自定义顺序、最近更新、创建时间、条目数量、名称排序
- **日记本置顶**：每张日记本卡片右上角新增图钉按钮，置顶的日记本排在最前并以橙色边框高亮
- **跨日记本移动条目**：日记编辑页新增"移动到..."按钮，可将当前日记移动到其他任意日记本
- **导出为 Markdown**：日记本详情页新增"导出为文本"按钮，将整本日记（含心情、标签、日期、正文）导出为 `.md` 文件下载

### 修复

- 修正欢迎页、不兼容提示页、数据管理说明及 README 中错误的 Safari 兼容性声明（Safari 实际上不支持 `showSaveFilePicker`，无法正常使用本应用）

### 数据模型变更（向后兼容）

加载旧版数据文件时自动补全新字段默认值，不影响已有数据：
- 日记本（book）新增字段：`pinned`（默认 `false`）、`sortOrder`（默认按原数组索引）
- 日记条目（entry）新增字段：`mood`（默认 `""`）、`tags`（默认 `[]`）

### 技术改动（`app.js`）

- 新增：`showLoading / hideLoading`（加载遮罩控制）
- 新增：`_isDirty / markDirty / markClean`（脏状态管理）
- 新增：`debounce`（防抖工具函数）
- 新增：`renderMoodSelector / renderTagChips`（心情/标签 UI 渲染）
- 新增：`getSortedBooks / togglePinBook`（排序和置顶逻辑）
- 新增：`openMoveEntryModal / confirmMoveEntry`（跨日记本移动）
- 新增：`exportBookAsMarkdown`（Markdown 导出）
- 修改：`loadFromHandle` — 加入字段迁移逻辑，新建 book/entry 时同步写入新字段
- 修改：`saveEntry` — 同步保存 `mood` 和 `tags` 字段
- 修改：`renderHome` — 支持排序和置顶渲染
- 修改：`renderBookView` — 支持搜索过滤，条目卡片展示心情/标签
- 修改：`showSaveIndicator` — 支持自定义提示文字
- 修改：`bindEvents` — 绑定所有新增交互事件



---

## v2.0.0 — 2026-03-19

### 重大变更：存储架构从浏览器内部迁移至本地文件

**背景**：v1 使用 localStorage 和 IndexedDB 存储数据，导致数据绑定于特定浏览器，同一台电脑上不同浏览器之间数据无法共享。v2 改用 File System Access API，将所有数据存储在用户指定的真实 `.json` 文件中，彻底解决跨浏览器访问问题。

### 新增
- **欢迎页**（`view-welcome`）：首次打开时引导用户新建或打开数据文件
- **浏览器不兼容提示页**（`view-unsupported`）：Firefox 等不支持的浏览器会看到友好提示
- **文件记忆功能**：应用会记住上次使用的数据文件，下次打开时一键重新打开
- **自动保存**：每次数据变更（创建/编辑/删除）后自动将数据写回文件
- **导航栏保存指示器**：每次保存后短暂显示"已保存"提示
- **切换数据文件**：数据管理页新增"切换数据文件"按钮，可在不同数据文件间切换
- **多文件支持**：可创建多个独立的数据文件，分别管理不同主题的日记

### 修改
- **数据管理页**：移除 localStorage/IndexedDB 存储进度条，改为显示当前文件名和文件大小统计
- **导出功能**：从"导出全部数据"改为"下载备份副本"，语义更清晰（原数据文件不受影响）
- **数据格式**：版本号从 v1 升至 v2，`images` 数组从 IndexedDB 迁移至 JSON 文件内嵌

### 修复
- 日记本封面在取消弹窗时，临时上传的图片现在会被正确清理，不再产生孤立数据

### 技术改动（`app.js`）
- 删除：`getBooks/saveBooks/getEntries/saveEntries`（localStorage 操作）
- 删除：`openDB/idbSave/idbGet/idbDelete/idbGetAll/idbClear`（IndexedDB 图片存储）
- 新增：内存数据仓库 `appData`（单一数据源）
- 新增：`openHandleDB/persistHandle/restoreHandle/clearPersistedHandle`（用 IndexedDB 仅存储文件 handle）
- 新增：`loadFromHandle/saveToFile/ensureWritePermission`（File System Access API 读写）
- 新增：`initWelcome/handleReopenFile/handleNewFile/handleOpenFile/handleSwitchFile`（欢迎页流程）
- 修改：`getImageDataUrl` 改为从内存 `appData.images` 同步读取，不再异步查 IndexedDB
- 修改：所有数据变更函数（`confirmBookModal/saveEntry/deleteEntry/deleteBook` 等）末尾统一调用 `saveToFile()`

### 兼容性
- 支持：Chrome 86+、Edge 86+
- 不支持：Safari（不支持 `showSaveFilePicker`）、Firefox（File System Access API 尚未实现）

---

## v1.0.0 — 2026-03-19

### 初始版本

**技术栈**：纯原生 HTML + CSS + JavaScript，无任何外部依赖

**存储方案**：
- 文字数据（日记本、条目）→ `localStorage`
- 图片数据 → `IndexedDB`（以 base64 编码存储）

### 功能
- 多日记本管理：新建、重命名、删除，支持封面图上传
- 日记条目：标题 + 正文 + 多张插图，自动记录创建时间和最后编辑时间
- 条目列表：按创建时间倒序，显示缩略图和内容摘要
- 图片压缩：上传时自动压缩，宽度上限 1200px，JPEG 质量 82%
- 深色 / 浅色主题切换，偏好持久化
- `Cmd+S` / `Ctrl+S` 快速保存快捷键
- 吐司通知（操作反馈）
- 数据管理页：存储占用可视化、统计数字
- 导出：将所有数据（含图片）打包为 `diary_backup_YYYYMMDD.json` 下载
- 导入：从备份文件恢复所有数据，含覆盖确认提示
- 清除全部数据

### 文件结构
```
my_diary_story/
├── index.html    # 页面结构（4个视图 + 2个弹窗）
├── style.css     # 样式
├── app.js        # 业务逻辑（数据层 + UI 层 + 导出导入）
└── README.md     # 使用文档
```
