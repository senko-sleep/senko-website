import { spawnSync } from 'node:child_process';

function parsePort(raw) {
  const value = Number(raw ?? '3000');
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid port: ${raw ?? ''}`);
  }
  return value;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(stderr || stdout || `Command failed: ${command}`);
  }
  return result.stdout.trim();
}

function getPidsOnWindows(port) {
  const script = [
    `$connections = @(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue)`,
    'if ($connections.Count -eq 0) { exit 0 }',
    '$connections | Select-Object -ExpandProperty OwningProcess -Unique',
  ].join('; ');

  try {
    const output = run('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
      '-NoProfile',
      '-Command',
      script,
    ]);
    return output
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

function killOnWindows(pid) {
  run('taskkill', ['/PID', String(pid), '/F']);
}

function getPidsOnUnix(port) {
  try {
    const output = run('lsof', ['-ti', `tcp:${port}`]);
    return output
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

function killOnUnix(pid) {
  run('kill', ['-9', String(pid)]);
}

function main() {
  const port = parsePort(process.argv[2]);
  const ownPid = process.ppid;
  const isWindows = process.platform === 'win32';
  const pids = (isWindows ? getPidsOnWindows(port) : getPidsOnUnix(port)).filter((pid) => pid !== ownPid);

  if (pids.length === 0) {
    return;
  }

  for (const pid of pids) {
    if (isWindows) {
      killOnWindows(pid);
    } else {
      killOnUnix(pid);
    }
  }

  console.log(`[senko] Freed port ${port} by stopping process${pids.length > 1 ? 'es' : ''}: ${pids.join(', ')}`);
}

main();
