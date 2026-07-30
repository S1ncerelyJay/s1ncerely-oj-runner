'use strict';

const vscode = require('vscode');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { executeProcess, killProcessTree, outputsMatch } = require('./runner');

const VIEW_ID = 's1ncerelyOjRunner.sidebar';
const STORAGE_KEY = 's1ncerelyOjRunner.cases.v1';
const SOURCE_FILE_KEY = 's1ncerelyOjRunner.sourceFile.v1';
const LEGACY_STORAGE_KEY = 'modernOjRunner.cases.v1';
const LEGACY_SOURCE_FILE_KEY = 'modernOjRunner.sourceFile.v1';

function languageIdFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.py') {
    return 'python';
  }
  if (extension === '.c') {
    return 'c';
  }
  if (['.cc', '.cpp', '.cxx'].includes(extension)) {
    return 'cpp';
  }
  if (['.js', '.mjs'].includes(extension)) {
    return 'javascript';
  }
  return '';
}

function createCase(index = 1) {
  return {
    id: crypto.randomUUID(),
    name: `测试 ${index}`,
    inputMode: 'text',
    inputText: '',
    inputFile: '',
    expected: '',
    expanded: true,
    result: null
  };
}

function sanitizeCase(value, index) {
  return {
    id: typeof value?.id === 'string' ? value.id : crypto.randomUUID(),
    name: typeof value?.name === 'string' ? value.name : `测试 ${index + 1}`,
    inputMode: value?.inputMode === 'file' ? 'file' : 'text',
    inputText: typeof value?.inputText === 'string' ? value.inputText : '',
    inputFile: typeof value?.inputFile === 'string' ? value.inputFile : '',
    expected: typeof value?.expected === 'string' ? value.expected : '',
    expanded: value?.expanded !== false,
    result: null
  };
}

class RunnerViewProvider {
  constructor(context) {
    this.context = context;
    const stored = context.workspaceState.get(
      STORAGE_KEY,
      context.workspaceState.get(LEGACY_STORAGE_KEY, [])
    );
    this.cases = Array.isArray(stored) && stored.length
      ? stored.map(sanitizeCase)
      : [createCase()];
    this.view = null;
    this.selectedSourcePath = context.workspaceState.get(
      SOURCE_FILE_KEY,
      context.workspaceState.get(LEGACY_SOURCE_FILE_KEY, '')
    );
    this.running = false;
    this.children = new Set();
    this.stopRequested = false;
    this.disposables = [];

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.postState()),
      vscode.workspace.onDidSaveTextDocument(() => this.postState())
    );
  }

  dispose() {
    this.stop();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };
    webview.html = this.getHtml(webview);

    webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      undefined,
      this.context.subscriptions
    );
    webviewView.onDidDispose(() => {
      this.view = null;
    });
  }

  async handleMessage(message) {
    switch (message?.type) {
      case 'ready':
        this.postState();
        break;
      case 'addCase':
        await this.addCase();
        break;
      case 'updateCase':
        await this.updateCase(message.id, message.patch, false);
        break;
      case 'deleteCase':
        await this.deleteCase(message.id);
        break;
      case 'chooseInputFile':
        await this.chooseInputFile(message.id);
        break;
      case 'chooseSourceFile':
        await this.chooseSourceFile();
        break;
      case 'followActiveEditor':
        await this.followActiveEditor();
        break;
      case 'detachInputFile':
        await this.updateCase(
          message.id,
          { inputFile: '', inputMode: 'text' },
          true
        );
        break;
      case 'runCase':
        await this.runCases([message.id]);
        break;
      case 'runAll':
        await this.runCases(this.cases.map((item) => item.id));
        break;
      case 'stop':
        this.stop();
        break;
      case 'copy':
        await vscode.env.clipboard.writeText(String(message.text ?? ''));
        break;
      case 'openSettings':
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:local.modern-oj-runner'
        );
        break;
      default:
        break;
    }
  }

  async addCase() {
    this.cases.push(createCase(this.cases.length + 1));
    await this.persist();
    this.postState();
  }

  async updateCase(id, patch, refresh = false) {
    const item = this.cases.find((entry) => entry.id === id);
    if (!item || !patch || typeof patch !== 'object') {
      return;
    }
    const allowed = ['name', 'inputMode', 'inputText', 'inputFile', 'expected', 'expanded'];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        item[key] = patch[key];
      }
    }
    item.result = null;
    await this.persist();
    if (refresh) {
      this.postState();
    }
  }

  async deleteCase(id) {
    this.cases = this.cases.filter((entry) => entry.id !== id);
    if (!this.cases.length) {
      this.cases.push(createCase());
    }
    await this.persist();
    this.postState();
  }

  async chooseInputFile(id) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title: '选择作为标准输入的数据文件',
      openLabel: '使用此文件'
    });
    if (!picked?.length) {
      return;
    }
    await this.updateCase(
      id,
      {
        inputMode: 'file',
        inputFile: picked[0].fsPath
      },
      true
    );
  }

  async chooseSourceFile() {
    const active = this.getActiveEditorFile();
    const initialPath = this.selectedSourcePath || active?.path;
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: initialPath ? vscode.Uri.file(path.dirname(initialPath)) : undefined,
      title: '选择要运行的源代码文件',
      openLabel: '运行此文件',
      filters: {
        '支持的源代码': ['py', 'c', 'cc', 'cpp', 'cxx', 'js', 'mjs'],
        '所有文件': ['*']
      }
    });
    if (!picked?.length) {
      return;
    }
    const languageId = languageIdFromPath(picked[0].fsPath);
    if (!languageId) {
      vscode.window.showErrorMessage(
        '不支持此文件类型。请选择 Python、C、C++ 或 JavaScript 源文件。'
      );
      return;
    }
    this.selectedSourcePath = picked[0].fsPath;
    await this.context.workspaceState.update(SOURCE_FILE_KEY, this.selectedSourcePath);
    this.postState();
  }

  async followActiveEditor() {
    this.selectedSourcePath = '';
    await this.context.workspaceState.update(SOURCE_FILE_KEY, undefined);
    this.postState();
  }

  async persist() {
    const serializable = this.cases.map(({ result, ...item }) => item);
    await this.context.workspaceState.update(STORAGE_KEY, serializable);
  }

  getActiveEditorFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      return null;
    }
    return {
      editor,
      document: editor.document,
      path: editor.document.uri.fsPath,
      name: path.basename(editor.document.uri.fsPath),
      languageId: editor.document.languageId
    };
  }

  getSourceFileSummary() {
    if (this.selectedSourcePath) {
      return {
        name: path.basename(this.selectedSourcePath),
        path: this.selectedSourcePath,
        languageId: languageIdFromPath(this.selectedSourcePath),
        selectionMode: 'selected'
      };
    }
    const active = this.getActiveEditorFile();
    return active
      ? {
          name: active.name,
          path: active.path,
          languageId: active.languageId,
          selectionMode: 'editor'
        }
      : null;
  }

  async getRunFile() {
    if (!this.selectedSourcePath) {
      return this.getActiveEditorFile();
    }
    try {
      await fs.access(this.selectedSourcePath);
    } catch {
      throw new Error(`找不到所选源文件：${this.selectedSourcePath}`);
    }
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(this.selectedSourcePath)
    );
    return {
      editor: vscode.window.visibleTextEditors.find(
        (candidate) => candidate.document.uri.fsPath === this.selectedSourcePath
      ),
      document,
      path: this.selectedSourcePath,
      name: path.basename(this.selectedSourcePath),
      languageId: languageIdFromPath(this.selectedSourcePath) || document.languageId
    };
  }

  postState() {
    if (!this.view) {
      return;
    }
    const active = this.getSourceFileSummary();
    this.view.webview.postMessage({
      type: 'state',
      cases: this.cases,
      running: this.running,
      activeFile: active
    });
  }

  setResult(id, result) {
    const item = this.cases.find((entry) => entry.id === id);
    if (item) {
      item.result = result;
    }
    this.postState();
  }

  trackChild(child) {
    this.children.add(child);
    child.once('close', () => this.children.delete(child));
  }

  stop() {
    this.stopRequested = true;
    for (const child of this.children) {
      killProcessTree(child);
    }
  }

  async runCases(ids) {
    if (this.running) {
      vscode.window.showInformationMessage('S1ncerely OJ Runner 正在运行。');
      return;
    }

    let active;
    try {
      active = await this.getRunFile();
    } catch (error) {
      vscode.window.showErrorMessage(
        `S1ncerely OJ Runner：${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }
    if (!active) {
      vscode.window.showErrorMessage('请打开源代码文件，或在插件面板中选择要运行的文件。');
      return;
    }

    if (active.document.isDirty && !(await active.document.save())) {
      vscode.window.showErrorMessage('源文件未能保存，已取消运行。');
      return;
    }

    this.running = true;
    this.stopRequested = false;
    for (const id of ids) {
      const item = this.cases.find((entry) => entry.id === id);
      if (item) {
        item.result = null;
      }
    }
    this.postState();
    let prepared = null;

    try {
      prepared = await this.prepareProgram(active);
      if (prepared.compileResult && prepared.compileResult.code !== 0) {
        const compilerOutput = [
          prepared.compileHint,
          prepared.compileResult.stdout,
          prepared.compileResult.stderr
        ]
          .filter(Boolean)
          .join('\n')
          .trim();
        for (const id of ids) {
          this.setResult(id, {
            status: 'CE',
            stdout: '',
            stderr: compilerOutput || '编译失败。',
            durationMs: prepared.compileResult.durationMs,
            exitCode: prepared.compileResult.code
          });
        }
        return;
      }

      for (const id of ids) {
        if (this.stopRequested) {
          break;
        }
        const item = this.cases.find((entry) => entry.id === id);
        if (!item) {
          continue;
        }
        await this.runOne(item, prepared);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`S1ncerely OJ Runner：${message}`);
      for (const id of ids) {
        const item = this.cases.find((entry) => entry.id === id);
        if (item && !item.result) {
          this.setResult(id, {
            status: 'ERR',
            stdout: '',
            stderr: message,
            durationMs: 0,
            exitCode: null
          });
        }
      }
    } finally {
      if (prepared?.tempDir) {
        await fs.rm(prepared.tempDir, { recursive: true, force: true }).catch(() => {});
      }
      this.children.clear();
      this.running = false;
      this.postState();
    }
  }

  async prepareProgram(active) {
    const config = vscode.workspace.getConfiguration('s1ncerelyOjRunner');
    const language = active.languageId;
    const cwd = path.dirname(active.path);

    if (language === 'python') {
      const pythonExtensionPath = vscode.workspace
        .getConfiguration('python')
        .get('defaultInterpreterPath', '');
      return {
        command: config.get('pythonPath', '') || pythonExtensionPath || 'python',
        args: [active.path],
        cwd
      };
    }

    if (language === 'javascript') {
      return {
        command: config.get('nodePath', 'node'),
        args: [active.path],
        cwd
      };
    }

    if (!['c', 'cpp'].includes(language)) {
      throw new Error(`暂不支持语言 “${language}”。当前支持 Python、C、C++、JavaScript。`);
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 's1ncerely-oj-runner-'));
    const executable = path.join(
      tempDir,
      process.platform === 'win32' ? 'solution.exe' : 'solution'
    );
    const compiler = language === 'c'
      ? config.get('cCompiler', 'gcc')
      : config.get('cppCompiler', 'g++');
    const canUseMsvcFallback =
      process.platform === 'win32' &&
      ((language === 'c' && compiler === 'gcc') ||
        (language === 'cpp' && compiler === 'g++'));
    const compilerOnPath = await this.commandExists(compiler, cwd);

    if (!compilerOnPath && canUseMsvcFallback) {
      return this.prepareMsvcProgram(active, tempDir, executable, config);
    }

    const standard = language === 'c' ? '-std=c17' : '-std=c++17';
    const extraArgs = config.get('compilerArgs', ['-O2', '-pipe']);
    const compatibilityArgs =
      process.platform === 'darwin' &&
      language === 'cpp' &&
      active.document.getText().includes('bits/stdc++.h')
        ? [
            '-isystem',
            path.join(this.context.extensionPath, 'resources', 'include')
          ]
        : [];
    const compileResult = await executeProcess({
      command: compiler,
      args: [
        standard,
        ...extraArgs,
        ...compatibilityArgs,
        active.path,
        '-o',
        executable
      ],
      cwd,
      timeoutMs: Math.max(config.get('timeoutMs', 5000), 30000),
      outputLimitBytes: config.get('outputLimitMB', 4) * 1024 * 1024,
      onSpawn: (child) => this.trackChild(child)
    });

    if (compileResult.spawnError) {
      throw new Error(
        `无法启动编译器 “${compiler}”：${compileResult.spawnError.message}`
      );
    }

    return {
      command: executable,
      args: [],
      cwd,
      tempDir,
      compileResult
    };
  }

  async commandExists(command, cwd) {
    if (path.isAbsolute(command)) {
      try {
        await fs.access(command);
        return true;
      } catch {
        return false;
      }
    }

    const locator = process.platform === 'win32' ? 'where.exe' : 'which';
    const result = await executeProcess({
      command: locator,
      args: [command],
      cwd,
      timeoutMs: 3000,
      outputLimitBytes: 64 * 1024,
      onSpawn: (child) => this.trackChild(child)
    });
    return !result.spawnError && result.code === 0;
  }

  async prepareMsvcProgram(active, tempDir, executable, config) {
    const vswhere = path.join(
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Microsoft Visual Studio',
      'Installer',
      'vswhere.exe'
    );
    try {
      await fs.access(vswhere);
    } catch {
      throw new Error(
        '找不到 g++，也未找到 Visual Studio C++ 工具链。请安装编译器，或在 S1ncerely OJ Runner 设置中指定编译器路径。'
      );
    }

    const discovery = await executeProcess({
      command: vswhere,
      args: [
        '-latest',
        '-products',
        '*',
        '-requires',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property',
        'installationPath'
      ],
      cwd: path.dirname(active.path),
      timeoutMs: 10000,
      outputLimitBytes: 256 * 1024,
      onSpawn: (child) => this.trackChild(child)
    });
    const installationPath = discovery.stdout.trim();
    if (discovery.code !== 0 || !installationPath) {
      throw new Error(
        '找不到 g++，且 Visual Studio 没有安装“使用 C++ 的桌面开发”工具。'
      );
    }

    const vsDevCmd = path.join(
      installationPath,
      'Common7',
      'Tools',
      'VsDevCmd.bat'
    );
    const environmentResult = await executeProcess({
      command: 'cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        `call "${vsDevCmd}" -no_logo -arch=x64 -host_arch=x64 >nul && set`
      ],
      cwd: path.dirname(active.path),
      timeoutMs: 20000,
      outputLimitBytes: 2 * 1024 * 1024,
      windowsVerbatimArguments: true,
      onSpawn: (child) => this.trackChild(child)
    });
    if (environmentResult.code !== 0) {
      throw new Error(
        `Visual Studio C++ 环境初始化失败：${environmentResult.stderr || 'VsDevCmd.bat 返回错误。'}`
      );
    }

    const msvcEnvironment = { ...process.env };
    for (const line of environmentResult.stdout.split(/\r?\n/)) {
      const separator = line.indexOf('=');
      if (separator > 0) {
        msvcEnvironment[line.slice(0, separator)] = line.slice(separator + 1);
      }
    }
    // Keep diagnostics readable regardless of the Windows system code page.
    msvcEnvironment.VSLANG = '1033';

    const toolsDir =
      msvcEnvironment.VCToolsInstallDir ||
      msvcEnvironment.VCToolsInstallDir?.trim();
    const cl = toolsDir
      ? path.join(toolsDir, 'bin', 'Hostx64', 'x64', 'cl.exe')
      : 'cl.exe';
    const languageArgs =
      active.languageId === 'cpp'
        ? ['/EHsc', '/std:c++17']
        : ['/std:c17', '/TC'];
    const compileResult = await executeProcess({
      command: cl,
      args: [
        '/nologo',
        ...languageArgs,
        '/O2',
        active.path,
        `/Fe:${executable}`
      ],
      cwd: path.dirname(active.path),
      timeoutMs: Math.max(config.get('timeoutMs', 5000), 30000),
      outputLimitBytes: config.get('outputLimitMB', 4) * 1024 * 1024,
      env: msvcEnvironment,
      onSpawn: (child) => this.trackChild(child)
    });
    if (compileResult.spawnError) {
      throw new Error(
        `无法启动 Visual Studio C++ 编译器：${compileResult.spawnError.message}`
      );
    }

    return {
      command: executable,
      args: [],
      cwd: path.dirname(active.path),
      tempDir,
      compileResult,
      compilerLabel: 'MSVC',
      compileHint: active.document
        .getText()
        .includes('bits/stdc++.h')
        ? [
            '提示：当前使用 MSVC 编译，但 <bits/stdc++.h> 是 GCC/G++ 专属头文件。',
            '请改为包含实际需要的标准头文件（如 <iostream>、<vector>、<algorithm>），或安装并配置 G++。'
          ].join('\n')
        : ''
    };
  }

  async runOne(item, prepared) {
    if (item.inputMode === 'file') {
      if (!item.inputFile) {
        this.setResult(item.id, {
          status: 'ERR',
          stdout: '',
          stderr: '尚未选择输入文件。',
          durationMs: 0,
          exitCode: null
        });
        return;
      }
      try {
        await fs.access(item.inputFile);
      } catch {
        this.setResult(item.id, {
          status: 'ERR',
          stdout: '',
          stderr: `找不到输入文件：${item.inputFile}`,
          durationMs: 0,
          exitCode: null
        });
        return;
      }
    }

    this.setResult(item.id, {
      status: 'RUN',
      stdout: '',
      stderr: '',
      durationMs: 0,
      exitCode: null
    });

    const config = vscode.workspace.getConfiguration('s1ncerelyOjRunner');
    const result = await executeProcess({
      command: prepared.command,
      args: prepared.args,
      cwd: prepared.cwd,
      inputText: item.inputText,
      inputFile: item.inputMode === 'file' ? item.inputFile : '',
      timeoutMs: config.get('timeoutMs', 5000),
      outputLimitBytes: config.get('outputLimitMB', 4) * 1024 * 1024,
      onSpawn: (child) => this.trackChild(child)
    });

    let status = 'DONE';
    if (result.stopped || this.stopRequested) {
      status = 'STOP';
    } else if (result.timedOut) {
      status = 'TLE';
    } else if (result.outputLimitExceeded) {
      status = 'OLE';
    } else if (result.spawnError || result.code !== 0) {
      status = 'RE';
    } else if (item.expected.length > 0) {
      status = outputsMatch(result.stdout, item.expected) ? 'AC' : 'WA';
    }

    this.setResult(item.id, {
      status,
      stdout: result.stdout,
      stderr: result.spawnError
        ? `${result.spawnError.message}\n${result.stderr}`
        : result.stderr,
      durationMs: result.durationMs,
      exitCode: result.code
    });
  }

  getHtml(webview) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'styles.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js')
    );

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>S1ncerely OJ Runner</title>
</head>
<body>
  <main id="app" aria-live="polite"></main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function activate(context) {
  const provider = new RunnerViewProvider(context);
  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('s1ncerelyOjRunner.focus', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.s1ncerelyOjRunner');
    }),
    vscode.commands.registerCommand('s1ncerelyOjRunner.addCase', async () => {
      await provider.addCase();
      await vscode.commands.executeCommand('workbench.view.extension.s1ncerelyOjRunner');
    }),
    vscode.commands.registerCommand('s1ncerelyOjRunner.runAll', async () => {
      await provider.runCases(provider.cases.map((item) => item.id));
    }),
    vscode.commands.registerCommand('s1ncerelyOjRunner.stop', () => provider.stop())
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
