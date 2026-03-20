# 修订记录（Changelog）

记录每次迭代的主要修改内容。

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
- 支持：Chrome 86+、Edge 86+、Safari 15.2+
- 不支持：Firefox（File System Access API 尚未实现）

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
