# 番茄钟 (Pomodoro Timer) — Electron 桌面应用

基于 Electron 的番茄工作法桌面计时器，支持任务追踪、统计、系统托盘和桌面通知。

## 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | Electron ^42.3.3 |
| 渲染进程 | Vanilla JavaScript (无框架) |
| 样式 | CSS3 自定义属性 + 暗色主题 |
| 持久化 | IPC 文件存储（`app.getPath('userData')`）为主，localStorage 降级 |
| 音频 | Web Audio API |
| 打包 | electron-builder (portable + NSIS) |

## 目录结构

```
first-cc/
├── CLAUDE.md              # 项目文档（本文件）
├── PROMPTS.md             # 跨会话提示词模板
├── pomodoro-app/          # 🟡 原始版本
│   ├── main.js            #   主进程：窗口管理、托盘、IPC
│   ├── preload.js         #   预加载脚本：contextBridge API
│   ├── package.json       #   项目配置与构建脚本
│   └── renderer/
│       ├── index.html     #   界面结构
│       ├── style.css      #   暗色主题样式
│       └── renderer.js    #   全部业务逻辑（~580行）
├── pomodoro-app-new/      # 🟡 副本（代码与 pomodoro-app 完全相同）
└── tomato/                # 🟡 副本（代码与 pomodoro-app 完全相同）
```

> ⚠️ 三个目录代码相同，建议确认哪个是主要开发版本后清理重复。

## 架构

```
┌──────────────┐     contextBridge     ┌──────────────────┐
│  Main Process │◄────────────────────►│ Renderer Process  │
│  (main.js)    │                      │  (renderer.js)    │
│               │                      │  (index.html)     │
│  - 窗口管理    │     IPC Handlers      │  (style.css)      │
│  - 系统托盘    │  ┌────────────────┐  │                   │
│  - 通知       │  │ show-notify     │  │  - 计时器引擎      │
│  - 置顶       │  │ set-ontop       │  │  - 任务管理        │
│               │  │ set-tray-tip    │  │  - 统计计算        │
│               │  │ minimize-tray   │  │  - 设置管理        │
│               │  │ close-app       │  │  - 音频反馈        │
│               │  └────────────────┘  │                   │
└──────────────┘                      └──────────────────┘
```

**数据模型** (文件 `pomodoro-data.json`，在 `app.getPath('userData')` 下):
```javascript
{
  settings: {
    workDuration: 25,        // 分钟
    shortBreakDuration: 5,
    longBreakDuration: 15,
    longBreakInterval: 4,    // 几个番茄后长休息
    alwaysOnTop: true,
  },
  tasks: [{ id, title, completed, pomodoros }],
  sessions: [{ date, taskId, type, duration }],
  currentTaskId: null | string,
  completedPomodoros: 0,    // 持久化的番茄计数（跨启动保留）
}
```

**状态机**: `work → shortBreak → work → ... → longBreak → work`（循环）

## 常用命令

```bash
cd pomodoro-app        # 或 pomodoro-app-new / tomato

# 开发运行
npm start              # electron .

# 构建
npm run build          # 便携版 .exe → dist/
npm run build:installer # 安装版 .exe → dist/
```

## 编码规范

- **语言**: 中文界面文案，英文代码注释
- **命名**: camelCase 函数/变量，kebab-case CSS 类/ID
- **DOM 访问**: 统一使用 `$('#id')` 查询，集中在 `dom` 对象
- **状态管理**: 全局 `state` 对象，通过 `Storage.save()` 持久化
- **窗口**: 无边框透明窗口 (`frame: false, transparent: true`)，自定义标题栏

## 已实现功能

- [x] 番茄钟核心循环（工作/短休/长休）
- [x] SVG 环形进度条（颜色随模式变化）
- [x] 任务 CRUD + 关联番茄数统计
- [x] 今日/本周/总计统计
- [x] 可配置参数（时长、间隔、置顶）
- [x] 系统托盘 + 提示文字实时更新
- [x] 桌面通知（完成提醒）
- [x] 音频反馈（3 声升调蜂鸣）
- [x] 键盘快捷键（Space 开始/暂停, R 重置, S 跳过）
- [x] 最小化到托盘（关闭按钮隐藏窗口而非退出）
- [x] 文件持久化（IPC `load-data`/`save-data`，双后端保底策略）
- [x] 番茄计数跨启动持久化（关机/重启不丢失）

## 当前状态

- **阶段**: v1.0.1 — 核心功能稳定，已修复两个关键 Bug
- **本次会话完成**:
  1. ✅ **Bug 修复：番茄计数重启清空** — 新增 IPC 文件持久化（`main.js` + `preload.js`），`completedPomodoros` 存入数据模型，`Storage` 改为 async 双后端策略（主：`app.getPath('userData')` 文件，降级：localStorage）。数据在重启/关机后完整保留。
  2. ✅ **Bug 修复：任务列表无法滚动** — 修复 CSS flex 滚动链：`#app` 由 `overflow-y:auto` 改为 `overflow:hidden`，`#task-section`/`#task-body`/`#task-list` 建立正确的 `min-height:0` + `overflow` 约束链，滚动条样式增强暗色主题可视性。
  3. ✅ **窗口尺寸调大** — 默认 440×720，最小 400×640（原 420×640/380×560）。
  4. ✅ **初始化项目文档** — 创建 CLAUDE.md、PROMPTS.md、Memory 记忆系统。
- **进度**: ~85%（核心功能完毕，待整理代码质量与工程化）
- **下一步建议**:
  1. 清理三个重复副本目录（保留 pomodoro-app，删除 pomodoro-app-new 和 tomato）
  2. `git init` 初始化版本控制
  3. 拆分 `renderer.js` 单文件巨石（Storage / Timer / Tasks / Stats / Settings 模块化）
  4. 添加 error boundary 与降级提示（音频失败、存储失败的 UI 提示）
  5. 编写自动化测试
