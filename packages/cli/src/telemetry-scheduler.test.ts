import { execFile as execFileCallback, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const execFile = promisify(execFileCallback);
const macIt = process.platform === 'darwin' ? it : it.skip;

describe('telemetry scheduler', () => {
  macIt('retries the owner lookup once GitHub answers, and never accepts an empty owner', { timeout: 30_000 }, async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'cirujano-owner-retry-')), bin = resolve(directory, 'bin');
    await mkdir(bin);
    await writeFile(resolve(bin, 'gh'), `#!/bin/bash\ncount=$(cat "${directory}/calls" 2>/dev/null || echo 0); echo $((count + 1)) > "${directory}/calls"\nif [ "$count" -eq 0 ]; then echo 'Get "https://api.github.com/user": net/http: TLS handshake timeout' >&2; exit 1; fi\necho "$GH_OWNER"\n`);
    await chmod(resolve(bin, 'gh'), 0o700);
    const mockCli = resolve(directory, 'cli.mjs');
    await writeFile(mockCli, `const fs = await import('node:fs'); if (process.argv.includes('collect')) fs.writeFileSync(process.env.OWNER_SEEN, process.argv[process.argv.indexOf('--owner') + 1] ?? ''); if (process.argv.includes('report')) process.stdout.write('# report\\n');`);
    const script = resolve(root, 'scripts/collect-actions-telemetry.sh');
    const env = { PATH: `${bin}:${process.env['PATH'] ?? ''}`, HOME: directory, CIRUJANO_CLI_PATH: mockCli, CIRUJANO_TELEMETRY_STORE: resolve(directory, 'store'), OWNER_SEEN: resolve(directory, 'owner'), GH_OWNER: 'example-owner' };
    await execFile(script, { env, timeout: 25_000 });
    expect(await readFile(resolve(directory, 'calls'), 'utf8')).toBe('2\n');
    expect(await readFile(resolve(directory, 'owner'), 'utf8')).toBe('example-owner');
    await writeFile(resolve(directory, 'calls'), '1');
    await expect(execFile(script, { env: { ...env, GH_OWNER: '' }, timeout: 25_000 })).rejects.toMatchObject({ stderr: expect.stringContaining('could not read the GitHub owner') });
  });
  it('keeps credentials out of the launchd template and runs at login and daily', async () => {
    const template = await readFile(resolve(root, 'scripts/launchd/com.thecreativetoken.cirujano-telemetry.plist.in'), 'utf8');
    expect(template).toContain('<key>RunAtLoad</key>');
    expect(template).toContain('<key>StartCalendarInterval</key>');
    expect(template).toContain('<key>Umask</key>');
    expect(template).toContain('<integer>63</integer>');
    expect(template).toContain('__COLLECTOR_PATH__');
    expect(template).toContain('__CLI_PATH__');
    expect(template).not.toMatch(/GITHUB_TOKEN|ghp_|github_pat_/u);
  });

  it('serializes collection and writes the report atomically', async () => {
    const script = await readFile(resolve(root, 'scripts/collect-actions-telemetry.sh'), 'utf8');
    expect(script).toContain('/usr/bin/lockf');
    expect(script).toContain('CIRUJANO_TELEMETRY_LOCKED');
    expect(script).toContain('mv "$REPORT_TEMP" "$REPORT_PATH"');
    expect(script).not.toContain('2>&1');
    expect(script).not.toMatch(/GITHUB_TOKEN|ghp_|github_pat_/u);
  });

  macIt('allows only one executable collection at a time', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'cirujano-telemetry-lock-'));
    const mockCli = resolve(directory, 'mock-cli.mjs');
    await writeFile(mockCli, `
      import { existsSync, writeFileSync } from 'node:fs';
      if (process.argv.includes('collect') && process.env.MOCK_HOLD === '1') {
        writeFileSync(process.env.MOCK_COLLECT_STARTED, 'ready');
        while (!existsSync(process.env.MOCK_COLLECT_RELEASE)) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      if (process.env.MOCK_STDERR === '1') process.stderr.write('provider failure\\n');
      if (process.argv.includes('report')) process.stdout.write('# report\\n');
    `);
    await chmod(mockCli, 0o700);
    const script = resolve(root, 'scripts/collect-actions-telemetry.sh');
    const env = {
      ...process.env,
      CIRUJANO_CLI_PATH: mockCli,
      CIRUJANO_TELEMETRY_OWNER: 'juan294',
      CIRUJANO_TELEMETRY_STORE: directory,
      MOCK_COLLECT_STARTED: resolve(directory, 'collect.started'),
      MOCK_COLLECT_RELEASE: resolve(directory, 'collect.release'),
    };
    const first = spawn(script, { env: { ...env, MOCK_HOLD: '1' }, stdio: 'ignore' });
    const firstExit = new Promise<void>((resolveExit, reject) => {
      first.once('error', reject);
      first.once('exit', (code) => code === 0 ? resolveExit() : reject(new Error(`first collector exited ${String(code)}`)));
    });
    try {
      let started = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        try {
          await stat(env.MOCK_COLLECT_STARTED);
          started = true;
          break;
        } catch {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
        }
      }
      expect(started).toBe(true);
      const second = await execFile(script, { env, timeout: 10_000 });
      expect(second.stdout).toMatch(/already active/u);
    } finally {
      await writeFile(env.MOCK_COLLECT_RELEASE, 'release');
      await firstExit;
    }
    await expect(readFile(resolve(directory, 'latest.md'), 'utf8')).resolves.toBe('# report\n');
    const separated = await execFile(script, { env: { ...env, MOCK_STDERR: '1' } });
    expect(separated.stderr).toBe('provider failure\nprovider failure\n');
  });

  it.each([
    ['the default store registry', false],
    ['CIRUJANO_FLEET_REGISTRY', true],
  ])('writes the fleet report with %s (report-with-registry-from-wrapper)', async (_name, explicit) => {
    const fixture = await wrapperFixture();
    const registry = explicit ? resolve(fixture.store, 'elsewhere', 'registry.json') : resolve(fixture.store, 'fleet-registry.json');
    await mkdir(dirname(registry), { recursive: true });
    await writeFile(registry, '{}');

    await execFile(fixture.script, { env: { ...fixture.env, ...(explicit ? { CIRUJANO_FLEET_REGISTRY: registry } : {}) } });

    expect(await fixture.reports()).toEqual([
      '--store STORE --since 2026-09-13 --format markdown',
      `--store STORE --since 2026-09-13 --format markdown --registry ${registry.replace(fixture.store, 'STORE')}`,
    ]);
    await expect(readFile(resolve(fixture.store, 'latest.md'), 'utf8')).resolves.toBe('# plain\n');
    await expect(readFile(resolve(fixture.store, 'fleet-latest.md'), 'utf8')).resolves.toBe('# fleet\n');
  });

  it('writes only the cumulative report when no fleet registry exists', async () => {
    const fixture = await wrapperFixture();

    await execFile(fixture.script, { env: fixture.env });

    expect(await fixture.reports()).toEqual(['--store STORE --since 2026-09-13 --format markdown']);
    await expect(readFile(resolve(fixture.store, 'latest.md'), 'utf8')).resolves.toBe('# plain\n');
    await expect(stat(resolve(fixture.store, 'fleet-latest.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('exits non-zero and names the failing key when the fleet report fails', async () => {
    const fixture = await wrapperFixture();
    await writeFile(resolve(fixture.store, 'fleet-registry.json'), '{}');
    await writeFile(resolve(fixture.store, 'fleet-latest.md'), 'old fleet\n');

    const failure = await execFile(fixture.script, { env: { ...fixture.env, MOCK_FAIL_FLEET: '1' } })
      .then(() => undefined, (error: unknown) => error as { code: number; stderr: string });

    expect(failure).toMatchObject({ code: 1, stderr: expect.stringContaining('conflicting duplicate telemetry job juan294/app:1:1:1 (conclusion)') });
    await expect(readFile(resolve(fixture.store, 'latest.md'), 'utf8')).resolves.toBe('# plain\n');
    await expect(readFile(resolve(fixture.store, 'fleet-latest.md'), 'utf8')).resolves.toBe('old fleet\n');
    expect((await readdir(fixture.store)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  macIt('installs one stable private bundle and verifies fresh evidence', async () => {
    const fixture = await installerFixture();
    const result = await execFile(resolve(root, 'scripts/install-telemetry-agent.sh'), { env: fixture.env, timeout: 10_000 });

    expect(result.stdout).toMatch(/verified fresh snapshot/u);
    expect(await readFile(resolve(fixture.home, 'bootstraps'), 'utf8')).toBe('1\n');
    expect((await stat(resolve(fixture.home, '.local/lib/cirujano/telemetry'))).mode & 0o777).toBe(0o700);
    expect((await stat(resolve(fixture.home, '.local/share/cirujano/telemetry'))).mode & 0o777).toBe(0o700);
    expect((await stat(resolve(fixture.home, 'Library/Logs/cirujano/telemetry.log'))).mode & 0o777).toBe(0o600);
  });

  macIt.each([
    ['failed launch', { FAKE_LAUNCH_EXIT: '1' }, /did not exit successfully/u],
    ['stale evidence', { FAKE_SKIP_COLLECT: '1' }, /fresh daily snapshot/u],
    ['launch timeout', { FAKE_HANG: '1', CIRUJANO_INSTALL_WAIT_SECONDS: '0' }, /did not exit successfully/u],
  ])('rejects %s during installation', async (_name, changes, message) => {
    const fixture = await installerFixture();
    if ('FAKE_SKIP_COLLECT' in changes && changes.FAKE_SKIP_COLLECT === '1') {
      const store = resolve(fixture.home, '.local/share/cirujano/telemetry');
      await mkdir(store, { recursive: true });
      const snapshot = resolve(store, `${new Date().toISOString().slice(0, 10)}.json`);
      await writeFile(snapshot, '{}');
      await writeFile(resolve(store, 'latest.md'), 'old');
      await utimes(snapshot, 1, 1);
      await utimes(resolve(store, 'latest.md'), 1, 1);
    }
    await expect(execFile(resolve(root, 'scripts/install-telemetry-agent.sh'), {
      env: { ...fixture.env, ...changes }, timeout: 10_000,
    })).rejects.toThrow(message);
    try {
      const pid = Number((await readFile(resolve(fixture.home, 'pid'), 'utf8')).trim());
      process.kill(pid, 'SIGTERM');
    } catch {}
  });
});

/** Runs the wrapper inside its lock against a fixture store with a mock CLI that records each report call. */
async function wrapperFixture() {
  const store = await mkdtemp(resolve(tmpdir(), 'cirujano-telemetry-wrapper-'));
  const mockCli = resolve(store, 'mock-cli.mjs');
  const calls = resolve(store, 'calls.log');
  await writeFile(mockCli, `
    import { appendFileSync } from 'node:fs';
    const args = process.argv.slice(2);
    if (args[1] === 'report') {
      appendFileSync(process.env.MOCK_CALLS, args.slice(2).join(' ') + '\\n');
      if (args.includes('--registry')) {
        if (process.env.MOCK_FAIL_FLEET === '1') {
          process.stderr.write('telemetry report failed: conflicting duplicate telemetry job juan294/app:1:1:1 (conclusion)\\n');
          process.exit(1);
        }
        process.stdout.write('# fleet\\n');
      } else process.stdout.write('# plain\\n');
    }
  `);
  return {
    store,
    script: resolve(root, 'scripts/collect-actions-telemetry.sh'),
    env: {
      ...process.env,
      CIRUJANO_CLI_PATH: mockCli,
      CIRUJANO_TELEMETRY_LOCKED: '1',
      CIRUJANO_TELEMETRY_OWNER: 'juan294',
      CIRUJANO_TELEMETRY_STORE: store,
      CIRUJANO_FLEET_REGISTRY: '',
      CIRUJANO_TELEMETRY_SINCE: '',
      CIRUJANO_TELEMETRY_LOOKBACK_HOURS: '',
      MOCK_CALLS: calls,
    },
    reports: async () => (await readFile(calls, 'utf8')).trimEnd().split('\n').map((line) => line.replaceAll(store, 'STORE')),
  };
}

async function installerFixture() {
  const home = await mkdtemp(resolve(tmpdir(), 'cirujano-installer-'));
  const mockCli = resolve(home, 'mock-cli.mjs');
  const fakeLaunchctl = resolve(home, 'launchctl');
  await writeFile(mockCli, `
    import { mkdir, writeFile } from 'node:fs/promises';
    const value = (name) => process.argv[process.argv.indexOf(name) + 1];
    if (process.argv.includes('collect')) {
      const store = value('--store');
      await mkdir(store, { recursive: true });
      await writeFile(store + '/' + new Date().toISOString().slice(0, 10) + '.json', '{}');
      process.stdout.write('{"status":"collected"}\\n');
    }
    if (process.argv.includes('report')) process.stdout.write('{"schemaVersion":1}\\n');
  `);
  await writeFile(fakeLaunchctl, `#!/bin/bash
set -u
case "$1" in
  bootout) exit 0 ;;
  bootstrap)
    count="$(cat "$HOME/bootstraps" 2>/dev/null || echo 0)"
    echo "$((count + 1))" > "$HOME/bootstraps"
    (
      if [ "\${FAKE_HANG:-0}" = 1 ]; then sleep 5; status=0
      elif [ "\${FAKE_LAUNCH_EXIT:-0}" = 1 ]; then status=1
      elif [ "\${FAKE_SKIP_COLLECT:-0}" = 1 ]; then status=0
      else CIRUJANO_CLI_PATH="$HOME/.local/lib/cirujano/telemetry/cirujano.mjs" "$HOME/.local/lib/cirujano/telemetry/collect-actions-telemetry.sh" > "$HOME/stdout" 2> "$HOME/stderr"; status=$?
      fi
      echo "$status" > "$HOME/exit-code"
    ) >/dev/null 2>&1 &
    echo "$!" > "$HOME/pid"
    ;;
  print)
    pid="$(cat "$HOME/pid")"
    if [ -f "$HOME/exit-code" ]; then state="not running"; code="$(cat "$HOME/exit-code")"
    elif kill -0 "$pid" 2>/dev/null; then state="running"; code="(never exited)"
    else state="not running"; code="1"
    fi
    printf 'state = %s\\nruns = 1\\nlast exit code = %s\\n' "$state" "$code"
    ;;
esac
`);
  await chmod(mockCli, 0o700);
  await chmod(fakeLaunchctl, 0o700);
  return {
    home,
    env: {
      ...process.env,
      HOME: home,
      CIRUJANO_SOURCE_CLI_PATH: mockCli,
      CIRUJANO_LAUNCHCTL_PATH: fakeLaunchctl,
      CIRUJANO_TELEMETRY_OWNER: 'juan294',
      CIRUJANO_INSTALL_POLL_SECONDS: '0.05',
      CIRUJANO_INSTALL_WAIT_SECONDS: '5',
    },
  };
}
