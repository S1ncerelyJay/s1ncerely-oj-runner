'use strict';

const fs = require('node:fs');
const { spawn } = require('node:child_process');

function normalizeOutput(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '');
}

function outputsMatch(actual, expected) {
  return normalizeOutput(actual) === normalizeOutput(expected);
}

function killProcessTree(child) {
  if (!child || !child.pid || child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    killer.unref();
    return;
  }

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // The process may already have exited.
    }
  }
}

function appendLimited(chunks, chunk, state, limitBytes) {
  if (state.size >= limitBytes) {
    state.truncated = true;
    return;
  }
  const remaining = limitBytes - state.size;
  const accepted = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
  chunks.push(accepted);
  state.size += accepted.length;
  if (accepted.length < chunk.length) {
    state.truncated = true;
  }
}

function executeProcess(options) {
  const {
    command,
    args = [],
    cwd,
    inputText = '',
    inputFile,
    timeoutMs = 5000,
    outputLimitBytes = 4 * 1024 * 1024,
    env = process.env,
    windowsVerbatimArguments = false,
    onSpawn
  } = options;

  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();
    const stdoutChunks = [];
    const stderrChunks = [];
    const outputState = { size: 0, truncated: false };
    let timedOut = false;
    let stopped = false;
    let spawnError = null;
    let settled = false;

    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env,
      windowsVerbatimArguments,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    onSpawn?.(child, () => {
      stopped = true;
      killProcessTree(child);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      appendLimited(stdoutChunks, chunk, outputState, outputLimitBytes);
      if (outputState.truncated) {
        killProcessTree(child);
      }
    });

    child.stderr.on('data', (chunk) => {
      appendLimited(stderrChunks, chunk, outputState, outputLimitBytes);
      if (outputState.truncated) {
        killProcessTree(child);
      }
    });

    child.on('error', (error) => {
      spawnError = error;
    });

    const finish = (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        durationMs,
        timedOut,
        stopped,
        outputLimitExceeded: outputState.truncated,
        spawnError
      });
    };

    child.on('close', finish);

    child.stdin.on('error', () => {
      // EPIPE is expected if the program exits before consuming all input.
    });

    if (inputFile) {
      const input = fs.createReadStream(inputFile);
      input.on('error', (error) => {
        spawnError = error;
        killProcessTree(child);
      });
      input.pipe(child.stdin);
    } else {
      child.stdin.end(inputText, 'utf8');
    }
  });
}

module.exports = {
  executeProcess,
  killProcessTree,
  normalizeOutput,
  outputsMatch
};
