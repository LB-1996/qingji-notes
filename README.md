<div align="center">

<img src="logo.png" width="120" alt="轻记" />

# 轻记 · Qingji Notes

**一个类似苹果备忘录的桌面笔记应用，为 Windows 打造（同时支持 macOS）**

干净 · 即时保存 · 丝滑 —— 补上 Windows 上一直缺的那款好用备忘录

</div>

---

## ✨ 功能

- 🗂 **三栏布局** —— 文件夹 / 笔记列表 / 编辑器，和苹果备忘录一致
- ✍️ **富文本** —— 标题、大标题、小标题、正文，加粗 / 斜体 / 下划线 / 删除线
- ✅ **可勾选清单** —— 点圆圈即可打勾，todo 一目了然
- 🔢 **项目符号 / 编号列表**
- 🖼 **图片** —— 粘贴、拖拽或点按钮插入（自动压缩大图）
- 🔍 **文件夹分类 · 全文搜索 · 笔记置顶**
- 🗑 **最近删除** —— 删除的笔记先进回收站，30 天内可恢复
- 🌗 **深色模式** —— 手动切换，也可跟随系统
- 💾 **自动保存** —— 打字即存，没有「保存」按钮
- 🔒 **纯本地存储** —— 数据存在你自己电脑上，不需要账号、不联网

## 🚀 快速开始

先装好 [Node.js](https://nodejs.org/)（选 LTS 版）。

### 一键脚本（最省事）

双击对应脚本即可，第一次会自动安装依赖：

| 我想做什么 | Windows 双击 | Mac 双击 |
|---|---|---|
| **运行应用** | `启动.bat` | `启动-Mac.command` |
| **打包成 Windows 安装包** | `打包Windows安装包.bat` | —— |

> ⚠️ **换电脑传输时，不要拷贝 `node_modules` 文件夹**：它跟操作系统绑定（含各系统专属的二进制和符号链接），跨系统会解压报错、无法启动。只传源码即可，脚本会在新电脑上自动重装依赖；若已误拷，启动脚本也会自动识别并清理重装。

### 命令行

```bash
npm install
npm start          # 运行
npm run build:win  # 在 Windows 上打包出安装包
```

## 📦 打包成 Windows 安装包（.exe）

产物是标准 Windows 安装程序 `dist/轻记 Setup 1.0.0.exe`，双击即可安装。三种方式：

1. **在任意 Windows 电脑上**：双击 `打包Windows安装包.bat`（或 `npm run build:win`）。
2. **用 GitHub Actions 云端打包**（只有 Mac 的人推荐）：推到 GitHub 后，在 **Actions** 里手动运行 **Build Windows Installer**，跑完在 Artifacts 下载。
3. **在 Mac 上交叉打包**：需先 `brew install --cask wine-stable`，再 `npm run build:win`。

## 🎨 换应用图标

把 `logo.ico` 或 `logo.png` 放到项目根目录即可，打包时会自动采用（优先 `.ico`）。建议正方形、至少 256×256。

## 🗂 数据存在哪

- **Windows**：`%APPDATA%\qingji-notes\qingji-notes.json`
- **macOS**：`~/Library/Application Support/qingji-notes/qingji-notes.json`

每次保存前会自动留一份备份，主文件损坏时可回退。

## ⌨️ 快捷键

| 操作 | Windows | macOS |
|---|---|---|
| 新建备忘录 | Ctrl+N | ⌘N |
| 新建文件夹 | Ctrl+Shift+N | ⌘⇧N |
| 搜索 | Ctrl+F | ⌘F |
| 切换深色模式 | Ctrl+Shift+L | ⌘⇧L |

## 🛠 技术栈

- **Electron** —— 主/渲染进程隔离，`contextIsolation` 开、`nodeIntegration` 关
- **零前端框架、零运行时依赖** —— 纯 HTML / CSS / 原生 JS，启动快、好维护
- **单 JSON 文件本地存储** —— 原子写入 + 自动备份

## ☕ 请我喝杯咖啡

「轻记」是我用业余时间做的，**永久免费、开源**。如果它帮到了你，或者你觉得好用，欢迎请我喝杯咖啡 —— 这会是我继续维护和改进的最大动力 😄

> 纯自愿，不打赏也完全没关系～ 觉得好用的话，点个 Star ⭐ 或提点建议，我一样开心！

<div align="center">

| 支付宝 | 微信支付 |
|:---:|:---:|
| <img src="docs/sponsor-alipay.png" width="240" alt="支付宝赞赏码" /> | <img src="docs/sponsor-wechat.png" width="240" alt="微信赞赏码" /> |

</div>

## 📄 License

[MIT](LICENSE) © 2026 陆宝 —— 可自由使用、修改、分发。
