const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function spawnAndPipe(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    });

    child.on('error', (err) => reject(err));
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const appPath = path.join(repoRoot, 'ai-engine', 'app.py');

  const isWin = process.platform === 'win32';
  const venvPython = isWin
    ? path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(repoRoot, '.venv', 'bin', 'python');

  const envPython = (process.env.TRACEL_PYTHON || '').trim();

  const candidates = [];

  if (envPython) {
    candidates.push({ cmd: envPython, args: [appPath] });
  }

  if (fileExists(venvPython)) {
    candidates.push({ cmd: venvPython, args: [appPath] });
  }

  if (isWin) {
    candidates.push({ cmd: 'py', args: ['-3', appPath] });
    candidates.push({ cmd: 'python', args: [appPath] });
  } else {
    candidates.push({ cmd: 'python3', args: [appPath] });
    candidates.push({ cmd: 'python', args: [appPath] });
  }

  const cwd = repoRoot;

  for (const c of candidates) {
    try {
      // eslint-disable-next-line no-console
      console.log(`[tracel] starting ai-engine via: ${c.cmd} ${c.args.join(' ')}`);
      const code = await spawnAndPipe(c.cmd, c.args, { cwd, env: process.env });
      process.exit(code);
      return;
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        continue;
      }
      // Any other error: surface it.
      // eslint-disable-next-line no-console
      console.error(`[tracel] failed to start ai-engine via ${c.cmd}:`, err);
      process.exit(1);
      return;
    }
  }

  // eslint-disable-next-line no-console
  console.error(
    '[tracel] Could not find a Python interpreter. Install Python 3 or set TRACEL_PYTHON to your python executable.'
  );
  process.exit(1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[tracel] unexpected error starting ai-engine:', err);
  process.exit(1);
});
