'use strict';

const vscode = acquireVsCodeApi();
const app = document.getElementById('app');
let state = {
  cases: [],
  running: false,
  activeFile: null
};

const STATUS_LABELS = {
  RUN: '运行中',
  AC: 'AC',
  WA: 'WA',
  DONE: '完成',
  RE: 'RE',
  CE: 'CE',
  TLE: 'TLE',
  OLE: '输出超限',
  STOP: '已停止',
  ERR: '错误'
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function button(label, className, title, onClick) {
  const node = element('button', className, label);
  node.type = 'button';
  node.title = title;
  node.addEventListener('click', onClick);
  return node;
}

function post(type, payload = {}) {
  vscode.postMessage({ type, ...payload });
}

function formatDuration(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  if (value < 1) {
    return '<1 ms';
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  return `${(value / 1000).toFixed(2)} s`;
}

function fileName(filePath) {
  if (!filePath) {
    return '';
  }
  return filePath.split(/[\\/]/).pop() || filePath;
}

function makeTopbar() {
  const top = element('section', 'topbar');
  const runnerTitle = element('div', 'runner-title', 'S1ncerely OJ Runner');
  const fileRow = element('div', 'file-row');
  const fileInfo = element('button', 'active-file source-picker');
  fileInfo.type = 'button';
  fileInfo.addEventListener('click', () => post('chooseSourceFile'));
  const dot = element('span', state.activeFile ? 'file-dot ready' : 'file-dot');
  const details = element('div', 'file-details');
  details.append(
    element('strong', '', state.activeFile?.name || '未选择源文件'),
    element(
      'span',
      '',
      state.activeFile
        ? `${state.activeFile.languageId} · ${
            state.activeFile.selectionMode === 'selected' ? '已固定选择' : '跟随当前编辑器'
          }`
        : '点击选择 Python / C / C++ / JS 文件'
    )
  );
  fileInfo.title = state.activeFile?.path
    ? `${state.activeFile.path}\n点击更换运行文件`
    : '选择要运行的源代码文件';
  fileInfo.append(dot, details);

  const fileActions = element('div', 'file-actions');
  const chooseSource = button(
    state.activeFile?.selectionMode === 'selected' ? '更换' : '选择',
    'button secondary compact source-action',
    '选择要运行的源代码文件',
    () => post('chooseSourceFile')
  );
  fileActions.append(chooseSource);
  if (state.activeFile?.selectionMode === 'selected') {
    fileActions.append(
      button('跟随', 'text-button', '恢复跟随当前编辑器', () => post('followActiveEditor'))
    );
  }
  const settings = button('⚙', 'icon-button subtle', '运行器设置', () => {
    post('openSettings');
  });
  settings.setAttribute('aria-label', '打开设置');
  fileActions.append(settings);
  fileRow.append(fileInfo, fileActions);

  const actions = element('div', 'primary-actions');
  const runAll = button(
    state.running ? '运行中…' : '▶  全部运行',
    'button primary',
    '运行全部测试用例',
    () => post('runAll')
  );
  runAll.disabled = state.running || !state.activeFile;
  const add = button('＋  新建', 'button secondary', '新建测试用例', () => post('addCase'));
  const stop = button('■', 'button danger compact', '停止所有运行', () => post('stop'));
  stop.disabled = !state.running;
  actions.append(runAll, add, stop);
  top.append(runnerTitle, fileRow, actions);
  return top;
}

function makeLabel(title, value, copyable = false) {
  const row = element('div', 'field-label');
  row.append(element('label', '', title));
  if (copyable) {
    row.append(
      button('复制', 'text-button', `复制${title}`, () => post('copy', { text: value }))
    );
  }
  return row;
}

function makeInputArea(item) {
  const wrapper = element('div', 'input-block');
  const tabs = element('div', 'tabs');
  tabs.setAttribute('role', 'tablist');

  for (const mode of ['text', 'file']) {
    const selected = item.inputMode === mode;
    const tab = button(
      mode === 'text' ? '文本输入' : '数据文件',
      `tab${selected ? ' active' : ''}`,
      mode === 'text' ? '直接输入标准输入' : '使用文件作为标准输入',
      () => {
        item.inputMode = mode;
        item.result = null;
        render();
        post('updateCase', { id: item.id, patch: { inputMode: mode } });
      }
    );
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(selected));
    tabs.append(tab);
  }
  wrapper.append(tabs);

  if (item.inputMode === 'text') {
    const textarea = element('textarea', 'code-input');
    textarea.value = item.inputText;
    textarea.placeholder = '在这里粘贴 stdin…';
    textarea.spellcheck = false;
    textarea.rows = 6;
    textarea.addEventListener('change', () => {
      post('updateCase', { id: item.id, patch: { inputText: textarea.value } });
    });
    wrapper.append(textarea);
  } else {
    const fileBox = element('div', item.inputFile ? 'file-box selected' : 'file-box');
    const fileIcon = element('div', 'file-icon', item.inputFile ? '↗' : '↑');
    const fileText = element('div', 'file-copy');
    fileText.append(
      element('strong', '', item.inputFile ? fileName(item.inputFile) : '选择输入数据文件'),
      element(
        'span',
        '',
        item.inputFile
          ? '运行时直接流式传入 stdin'
          : '适合无法粘贴的大规模测试数据'
      )
    );
    const choose = button(
      item.inputFile ? '更换' : '浏览',
      'button secondary compact',
      '选择输入文件',
      () => post('chooseInputFile', { id: item.id })
    );
    fileBox.append(fileIcon, fileText, choose);
    wrapper.append(fileBox);

    if (item.inputFile) {
      const pathRow = element('div', 'path-row');
      const pathText = element('code', '', item.inputFile);
      pathText.title = item.inputFile;
      pathRow.append(
        pathText,
        button('移除', 'text-button danger-text', '移除文件关联', () => {
          post('detachInputFile', { id: item.id });
        })
      );
      wrapper.append(pathRow);
    }
  }
  return wrapper;
}

function makeOutputBox(title, value, tone = '') {
  const block = element('div', `output-block ${tone}`);
  block.append(makeLabel(title, value, true));
  const pre = element('pre', '', value || '（无输出）');
  block.append(pre);
  return block;
}

function makeResult(item) {
  const result = item.result;
  if (!result) {
    return null;
  }
  const area = element('section', 'result-area');
  const meta = element('div', 'result-meta');
  meta.append(
    element('span', `status status-${result.status.toLowerCase()}`, STATUS_LABELS[result.status] || result.status),
    element('span', 'metric', `耗时 ${formatDuration(result.durationMs)}`),
    element(
      'span',
      'metric',
      result.exitCode === null || result.exitCode === undefined
        ? '退出码 —'
        : `退出码 ${result.exitCode}`
    )
  );
  area.append(meta);
  if (result.status !== 'RUN') {
    area.append(makeOutputBox('实际输出', result.stdout));
    if (result.stderr) {
      area.append(makeOutputBox('错误输出', result.stderr, 'stderr'));
    }
  }
  return area;
}

function makeCaseCard(item, index) {
  const card = element('article', `case-card${item.expanded ? ' expanded' : ''}`);
  const header = element('header', 'case-header');

  const collapse = button(
    item.expanded ? '⌄' : '›',
    'icon-button collapse',
    item.expanded ? '折叠用例' : '展开用例',
    () => {
      item.expanded = !item.expanded;
      render();
      post('updateCase', { id: item.id, patch: { expanded: item.expanded } });
    }
  );
  collapse.setAttribute('aria-expanded', String(item.expanded));

  const name = element('input', 'case-name');
  name.value = item.name || `测试 ${index + 1}`;
  name.setAttribute('aria-label', `测试用例 ${index + 1} 名称`);
  name.addEventListener('change', () => {
    post('updateCase', { id: item.id, patch: { name: name.value } });
  });

  const headerActions = element('div', 'case-actions');
  if (item.result) {
    headerActions.append(
      element(
        'span',
        `status mini status-${item.result.status.toLowerCase()}`,
        STATUS_LABELS[item.result.status] || item.result.status
      )
    );
  }
  const run = button('▶', 'icon-button run', '运行此测试', () => {
    post('runCase', { id: item.id });
  });
  run.disabled = state.running || !state.activeFile;
  const remove = button('×', 'icon-button remove', '删除此测试', () => {
    post('deleteCase', { id: item.id });
  });
  headerActions.append(run, remove);
  header.append(collapse, element('span', 'case-index', String(index + 1).padStart(2, '0')), name, headerActions);
  card.append(header);

  if (!item.expanded) {
    return card;
  }

  const body = element('div', 'case-body');
  body.append(makeInputArea(item));

  const expectedLabel = makeLabel('期望输出', item.expected, Boolean(item.expected));
  const hint = element('span', 'optional', '可选');
  expectedLabel.querySelector('label').append(hint);
  body.append(expectedLabel);
  const expected = element('textarea', 'code-input expected');
  expected.value = item.expected;
  expected.placeholder = '填写后自动判断 AC / WA';
  expected.spellcheck = false;
  expected.rows = 3;
  expected.addEventListener('change', () => {
    post('updateCase', { id: item.id, patch: { expected: expected.value } });
  });
  body.append(expected);

  const result = makeResult(item);
  if (result) {
    body.append(result);
  }
  card.append(body);
  return card;
}

function render() {
  app.replaceChildren();
  app.append(makeTopbar());

  const list = element('section', 'case-list');
  if (!state.cases.length) {
    const empty = element('div', 'empty-state');
    empty.append(
      element('div', 'empty-icon', '◇'),
      element('strong', '', '还没有测试用例'),
      element('p', '', '创建一个用例，然后输入或选择测试数据。'),
      button('新建测试', 'button primary', '新建测试用例', () => post('addCase'))
    );
    list.append(empty);
  } else {
    state.cases.forEach((item, index) => list.append(makeCaseCard(item, index)));
  }
  app.append(list);

  const footer = element('footer', 'footer');
  footer.append(
    element('span', '', `${state.cases.length} 个测试`),
    element('span', '', state.running ? '正在执行，请稍候…' : '文本与文件 stdin')
  );
  app.append(footer);
}

window.addEventListener('message', (event) => {
  if (event.data?.type !== 'state') {
    return;
  }
  state = {
    cases: Array.isArray(event.data.cases) ? event.data.cases : [],
    running: Boolean(event.data.running),
    activeFile: event.data.activeFile || null
  };
  render();
});

post('ready');
