# 轻记（Qingji Notes）

一个类似 **苹果备忘录** 的桌面笔记应用，为 Windows 打造（同时也能在 macOS 上运行）。
干净、即时保存、丝滑 —— 补上 Windows 上一直缺的那款好用备忘录。

## ✨ 功能

- **三栏布局**：文件夹 / 笔记列表 / 编辑器，和苹果备忘录一致
- **富文本**：标题 / 大标题 / 小标题 / 正文，加粗、斜体、下划线、删除线
- **可勾选清单**：点圆圈即可打勾，todo 一目了然
- **项目符号 / 编号列表**
- **图片**：粘贴、拖拽或点按钮插入
- **文件夹分类** + **全文搜索** + **笔记置顶**
- **最近删除**：删除的笔记先进回收站，30 天内可恢复
- **深色模式**：手动切换，也可跟随系统
- **自动保存**：打字即存，没有「保存」按钮
- **纯本地存储**：数据存在你自己电脑上，不需要账号、不联网

## 🖱 一键脚本（最省事）

先装好 [Node.js](https://nodejs.org/)（选 LTS 版），然后双击对应脚本即可，第一次会自动装依赖：

| 我想做什么 | Windows 双击 | Mac 双击 |
|---|---|---|
| **运行应用** | `启动.bat` | `启动-Mac.command` |
| **打包成 Windows 安装包** | `打包Windows安装包.bat` | —— |

`打包Windows安装包.bat` 跑完后会自动弹出 `dist` 文件夹，里面的 `轻记 Setup 1.0.0.exe` 就是安装程序，双击即可在 Windows 上安装。**打包 Windows 版请在 Windows 上运行这个脚本。**

> Mac 上第一次双击 `.command` 若提示「无法打开」，右键 → 打开 → 确认一次即可。

> ⚠️ **换电脑传输时，不要拷贝 `node_modules` 文件夹**（它跟操作系统绑定，含 Mac/Windows 专属的二进制和符号链接，跨系统会解压报错、无法启动）。只传源码即可，脚本会在新电脑上自动重装依赖。若已误拷，启动脚本会自动识别并清理重装。

## 🚀 或者用命令行

需要先装 [Node.js](https://nodejs.org/)（18 及以上）。

```bash
npm install
npm start          # 运行
npm run build:win  # 在 Windows 上打包出安装包
```

## 📦 打包成 Windows 安装包（.exe）

产物是一个标准的 Windows 安装程序 `dist/轻记 Setup 1.0.0.exe`，双击即可安装。有三种方式：

### 方式一：在任意一台 Windows 电脑上打包（最简单）

把整个文件夹拷到 Windows 上，然后：

```bash
npm install
npm run build:win
```

打包好的安装包在 `dist/` 目录里。

### 方式二：用 GitHub Actions 云端打包（推荐给只有 Mac 的人）

本项目自带 `.github/workflows/build-windows.yml`。把代码推到 GitHub 后：

1. 打开仓库的 **Actions** 标签页
2. 选 **Build Windows Installer** → **Run workflow**
3. 跑完后在该次运行的 **Artifacts** 里下载 `windows-installer`

不需要自己有 Windows 电脑，也不用装任何东西。

### 方式三：在这台 Mac 上交叉打包

electron-builder 可以在 macOS 上打 Windows 包，但需要先装 Wine：

```bash
brew install --cask wine-stable
npm run build:win
```

## 🗂 数据存在哪

- **Windows**：`%APPDATA%\qingji-notes\qingji-notes.json`
- **macOS**：`~/Library/Application Support/qingji-notes/qingji-notes.json`

每次保存前会自动留一份 `*.backup.json`，主文件损坏时可回退。

## 🛠 技术栈

- Electron（主进程 + 渲染进程隔离，`contextIsolation` 开启，`nodeIntegration` 关闭）
- 零前端框架、零运行时依赖，纯 HTML / CSS / 原生 JS —— 启动快、好维护
- 数据以单个 JSON 文件本地存储（原子写入 + 自动备份）

## 目录结构

```
qingji-notes/
├─ src/
│  ├─ main/          # 主进程
│  │  ├─ main.js     # 窗口、菜单、生命周期
│  │  ├─ preload.js  # 安全桥（contextBridge）
│  │  └─ store.js    # 本地 JSON 读写（原子写 + 备份）
│  └─ renderer/      # 界面
│     ├─ index.html
│     ├─ styles.css  # 浅色 / 深色主题
│     ├─ storage.js  # 数据层（Electron 文件 / 浏览器 localStorage 双通道）
│     ├─ editor.js   # 富文本 + 可勾选清单
│     └─ app.js      # 文件夹 / 列表 / 搜索 / 置顶 / 主题 编排
├─ assets/icon.png   # 应用图标
└─ package.json
```

## 快捷键

| 操作 | Windows | macOS |
|---|---|---|
| 新建备忘录 | Ctrl+N | ⌘N |
| 新建文件夹 | Ctrl+Shift+N | ⌘⇧N |
| 搜索 | Ctrl+F | ⌘F |
| 切换深色模式 | Ctrl+Shift+L | ⌘⇧L |

## License

MIT
