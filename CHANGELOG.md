# Changelog

## 0.1.6

- 修复 macOS Apple Clang 无法找到 `<bits/stdc++.h>` 的问题。
- 扩展会在 macOS 上自动注入 C++17 标准库兼容头，无需修改刷题代码。
- GitHub Actions 使用 macOS 环境直接验证兼容层。

## 0.1.5

- 在插件面板顶部恢复纯文字 `S1ncerely OJ Runner` 标题。
- 标题不使用铭牌、渐变、边框或发光效果。

## 0.1.3

- 可以在插件页直接选择并固定要运行的源代码文件。
- 可以一键恢复跟随当前编辑器。
- 按工作区记忆源文件和测试用例。
- 支持 MSYS2/MinGW GCC、G++ 与 Visual Studio MSVC 自动回退。
- 改进 `<bits/stdc++.h>` 在 MSVC 下的错误提示。

## 0.1.0

- 首次公开版本。
- 支持文本输入和大数据文件标准输入。
- 支持 Python、C、C++ 和 JavaScript。
- 支持多个测试用例、预期输出以及 AC/WA/RE/TLE/CE 状态。
