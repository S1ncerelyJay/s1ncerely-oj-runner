# S1ncerely OJ Runner

一个简洁、现代的算法刷题 VS Code 侧边栏运行器。无需离开编辑器，即可把文本或大数据文件作为标准输入传给指定代码，并查看运行结果。

## 功能

- 管理多个测试用例，数据按工作区自动保存。
- 普通输入：直接粘贴到文本框。
- 大文件输入：选择本地文件，通过流传给子进程，不把整个文件加载进内存。
- 支持 Python、C、C++、JavaScript。
- Windows 上找不到 GCC/G++ 时，会自动探测并使用 Visual Studio MSVC 工具链。
- 使用 MSVC 编译 GCC 专属的 `<bits/stdc++.h>` 时，会显示针对性迁移提示。
- 一键运行单个或全部测试，支持随时停止。
- 可填写期望输出，自动显示 `AC` / `WA`；同时显示 `RE` / `TLE` / `CE`。
- 显示耗时、退出码、stdout 和 stderr。
- 跟随 VS Code 明暗主题和无障碍焦点样式。

## 使用

1. 打开一个已保存的 `.py`、`.c`、`.cpp` 或 `.js` 文件。
2. 点击活动栏中的烧瓶图标。
3. 输入测试数据，或切换到“文件”并选择输入文件。
4. 点击用例卡片上的运行按钮，或点击顶部“全部运行”。
5. 如果填写了期望输出，运行器会忽略行尾空白和末尾空行后进行比较。

插件顶部可以直接选择要运行的源代码文件，也可以恢复为“跟随当前编辑器”。固定选择会按工作区记忆，切换编辑器标签页不会改变运行目标。

运行前会自动保存目标文件。C/C++ 会先编译到系统临时目录，运行结束后自动清理。

## 设置

- `s1ncerelyOjRunner.timeoutMs`：单个用例超时，默认 5000 ms。
- `s1ncerelyOjRunner.outputLimitMB`：stdout/stderr 捕获上限，默认 4 MB。
- `s1ncerelyOjRunner.pythonPath`：Python 路径；留空时读取 Python 扩展配置。
- `s1ncerelyOjRunner.nodePath`：Node.js 命令。
- `s1ncerelyOjRunner.cCompiler` / `s1ncerelyOjRunner.cppCompiler`：C/C++ 编译器。
- `s1ncerelyOjRunner.compilerArgs`：额外编译参数，默认 `-O2 -pipe`。

## 安装

1. 下载最新的 `.vsix` 安装包。
2. 在 VS Code 中执行“扩展: 从 VSIX 安装…”。
3. 选择下载的安装包，然后重新加载窗口。

## 本地开发

需要 Node.js 20 或更高版本，以及 VS Code。

```bash
npm test
npm run package
```

按 `F5` 可以在 VS Code Extension Development Host 中调试扩展。

## 许可证

MIT
