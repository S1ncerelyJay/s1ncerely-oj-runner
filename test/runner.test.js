'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  executeProcess,
  normalizeOutput,
  outputsMatch
} = require('../src/runner');

async function main() {
  assert.equal(normalizeOutput('a  \r\nb\t\r\n\r\n'), 'a\nb');
  assert.equal(outputsMatch('42\n', '42'), true);
  assert.equal(outputsMatch('42\n', '43\n'), false);

  const direct = await executeProcess({
    command: process.execPath,
    args: ['-e', 'process.stdin.pipe(process.stdout)'],
    inputText: 'hello\nworld\n',
    timeoutMs: 3000
  });
  assert.equal(direct.code, 0);
  assert.equal(direct.stdout, 'hello\nworld\n');

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modern-oj-test-'));
  const inputPath = path.join(tempDir, 'large-input.txt');
  const input = `${'1234567890\n'.repeat(100000)}`;
  await fs.writeFile(inputPath, input);
  const fileBacked = await executeProcess({
    command: process.execPath,
    args: [
      '-e',
      'let n=0;process.stdin.on("data",c=>n+=c.length);process.stdin.on("end",()=>console.log(n))'
    ],
    inputFile: inputPath,
    timeoutMs: 5000
  });
  assert.equal(fileBacked.code, 0);
  assert.equal(Number(fileBacked.stdout.trim()), Buffer.byteLength(input));

  const limited = await executeProcess({
    command: process.execPath,
    args: ['-e', 'process.stdout.write("x".repeat(1024 * 1024))'],
    timeoutMs: 3000,
    outputLimitBytes: 1024
  });
  assert.equal(limited.outputLimitExceeded, true);
  assert.equal(Buffer.byteLength(limited.stdout) <= 1024, true);

  const timed = await executeProcess({
    command: process.execPath,
    args: ['-e', 'setInterval(()=>{}, 1000)'],
    timeoutMs: 100
  });
  assert.equal(timed.timedOut, true);

  await fs.rm(tempDir, { recursive: true, force: true });
  process.stdout.write('runner tests passed\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
