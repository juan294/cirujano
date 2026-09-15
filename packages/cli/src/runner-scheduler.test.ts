import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const execFile = promisify(execFileCallback);
const macIt = process.platform === 'darwin' ? it : it.skip;

describe('operating controller launch agent (phase 2 U3)', () => {
  it('keeps credentials out of the KeepAlive launchd template', async () => {
    const template = await readFile(resolve(root, 'scripts/launchd/com.thecreativetoken.cirujano-runner.plist.in'), 'utf8');
    expect(template).toContain('<key>KeepAlive</key>\n  <true/>');
    expect(template).toContain('<key>RunAtLoad</key>');
    expect(template).toContain('<key>ThrottleInterval</key>');
    expect(template).toContain('<integer>63</integer>');
    for (const placeholder of ['__ENROLLMENT_ID__', '__WRAPPER_PATH__', '__CLI_PATH__', '__STATE_DIR__', '__GUEST_DIR__', '__CONTROLLER_KEY_PATH__', '__LOG_DIR__']) {
      expect(template).toContain(placeholder);
    }
    expect(template).not.toMatch(/GITHUB_TOKEN|NEBIUS_API_KEY|ghp_|github_pat_|PRIVATE KEY/u);
  });

  it('leaves the candidate digest to the bundle itself and falls back to dry-run without a permit', async () => {
    const wrapper = await readFile(resolve(root, 'scripts/run-cirujano-controller.sh'), 'utf8');
    expect(wrapper).toContain('unset CIRUJANO_CANDIDATE_DIGEST');
    expect(wrapper).not.toContain('shasum');
    expect(wrapper).toContain('ARGS+=(--dry-run)');
    expect(wrapper).toContain('--permit "$PERMIT_PATH"');
    expect(wrapper).toContain('exec "$NODE_PATH_RESOLVED" "$CLI_PATH" "${ARGS[@]}"');
    expect(wrapper).toContain('--version');
    expect(wrapper).not.toContain('2>&1');
    expect(wrapper).not.toMatch(/GITHUB_TOKEN|ghp_|github_pat_|cat .*key/u);
  });

  macIt('installs one enrollment agent, verifies its first dry-run tick and removes it again', async () => {
    const fixture = await installerFixture();
    const result = await execFile(resolve(root, 'scripts/install-runner-agent.sh'), ['P1'], { env: fixture.env, timeout: 15_000 });
    expect(result.stdout).toMatch(/verified first dry-run tick for P1/u);
    expect(await readFile(resolve(fixture.home, 'bootstraps'), 'utf8')).toBe('1\n');
    const plist = await readFile(resolve(fixture.home, 'Library/LaunchAgents/com.thecreativetoken.cirujano-runner-P1.plist'), 'utf8');
    expect(plist).toContain('<string>com.thecreativetoken.cirujano-runner-P1</string>');
    expect(plist).toContain(`<string>${fixture.stateDir}</string>`);
    expect(plist).not.toMatch(/__[A-Z_]+__/u);
    expect((await stat(resolve(fixture.home, '.local/lib/cirujano/runner'))).mode & 0o777).toBe(0o700);
    expect((await stat(resolve(fixture.stateDir, 'actions-runner.env'))).mode & 0o777).toBe(0o600);
    expect(await readFile(resolve(fixture.stateDir, 'actions-runner.env'), 'utf8')).toBe('CIRUJANO_ACTIONS_RUNNER_VERSION=2.337.0\nCIRUJANO_ACTIONS_RUNNER_SHA256=70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613\n');
    expect((await stat(resolve(fixture.home, '.local/share/cirujano/runner/controller_ed25519'))).mode & 0o777).toBe(0o600);
    const invocation = await readFile(resolve(fixture.home, 'invocation'), 'utf8');
    expect(invocation).toContain(`runner watch --config ${fixture.stateDir}/config.json --dry-run`);
    expect(invocation).toContain('CIRUJANO_CANDIDATE_DIGEST=undefined');
    expect(invocation).toContain(`CIRUJANO_HOST_PRIVATE_KEY_PATH=${fixture.stateDir}/ssh_host_ed25519_key`);
    expect(await readFile(resolve(fixture.stateDir, 'events.jsonl'), 'utf8')).toContain('"type":"dry-run"');
    const removal = await execFile(resolve(root, 'scripts/install-runner-agent.sh'), ['P1', '--remove'], { env: fixture.env, timeout: 15_000 });
    expect(removal.stdout).toMatch(/removed agent com\.thecreativetoken\.cirujano-runner-P1/u);
    await expect(stat(resolve(fixture.home, 'Library/LaunchAgents/com.thecreativetoken.cirujano-runner-P1.plist'))).rejects.toThrow();
    await expect(stat(resolve(fixture.stateDir, 'config.json'))).resolves.toBeDefined();
  });

  macIt.each([
    ['a controller that exits before its first tick', { FAKE_LAUNCH_EXIT: '1', CIRUJANO_INSTALL_WAIT_SECONDS: '2' }, /did not journal a first tick/u],
    ['a launch that never starts the controller', { FAKE_HANG: '1', CIRUJANO_INSTALL_WAIT_SECONDS: '1' }, /did not journal a first tick/u],
  ])('rejects %s during installation', async (_name, changes, message) => {
    const fixture = await installerFixture();
    await expect(execFile(resolve(root, 'scripts/install-runner-agent.sh'), ['P1'], {
      env: { ...fixture.env, ...changes }, timeout: 15_000,
    })).rejects.toThrow(message);
    try {
      const pid = Number((await readFile(resolve(fixture.home, 'pid'), 'utf8')).trim());
      process.kill(pid, 'SIGTERM');
    } catch {}
  });

  macIt('refuses an enrollment without a generated controller config or with a malformed id', async () => {
    const fixture = await installerFixture();
    await expect(execFile(resolve(root, 'scripts/install-runner-agent.sh'), ['P2'], { env: fixture.env, timeout: 15_000 }))
      .rejects.toThrow(/run cirujano fleet controller-config --id P2 first/u);
    await expect(execFile(resolve(root, 'scripts/install-runner-agent.sh'), ['pilot'], { env: fixture.env, timeout: 15_000 }))
      .rejects.toThrow(/usage/u);
  });
});

async function installerFixture() {
  const home = await mkdtemp(resolve(tmpdir(), 'cirujano-runner-installer-'));
  const stateRoot = resolve(home, '.local/share/cirujano/runner');
  const stateDir = resolve(stateRoot, 'P1');
  const guestSource = resolve(home, 'guest-source');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await mkdir(guestSource, { recursive: true });
  await writeFile(resolve(guestSource, 'status'), '#!/bin/sh\n');
  await writeFile(resolve(stateDir, 'config.json'), '{"fixture":true}', { mode: 0o600 });
  await writeFile(resolve(stateDir, 'ssh_host_ed25519_key'), 'fixture-host-key\n', { mode: 0o600 });
  const mockCli = resolve(home, 'mock-cli.mjs');
  const fakeLaunchctl = resolve(home, 'launchctl');
  await writeFile(mockCli, `
    import { appendFile, writeFile } from 'node:fs/promises';
    const value = (name) => process.argv[process.argv.indexOf(name) + 1];
    const keys = ['CIRUJANO_CANDIDATE_DIGEST', 'CIRUJANO_HOST_PRIVATE_KEY_PATH', 'CIRUJANO_SSH_KEY_PATH', 'CIRUJANO_ACTIONS_RUNNER_VERSION'];
    await writeFile(process.env.HOME + '/invocation', process.argv.slice(2).join(' ') + '\\n' + keys.map((key) => key + '=' + process.env[key]).join('\\n') + '\\n');
    if (process.argv.includes('watch')) {
      const stateDir = value('--config').replace(/\\/config\\.json$/, '');
      await appendFile(stateDir + '/events.jsonl', JSON.stringify({ schemaVersion: 1, type: 'dry-run', effect: 'none' }) + '\\n');
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
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
      else
        CIRUJANO_CLI_PATH="$HOME/.local/lib/cirujano/runner/cirujano.mjs" \\
        CIRUJANO_RUNNER_STATE_DIR="$HOME/.local/share/cirujano/runner/P1" \\
        CIRUJANO_GUEST_DIR="$HOME/.local/lib/cirujano/runner/guest" \\
        CIRUJANO_CONTROLLER_KEY_PATH="$HOME/.local/share/cirujano/runner/controller_ed25519" \\
        "$HOME/.local/lib/cirujano/runner/run-cirujano-controller.sh" > "$HOME/stdout" 2> "$HOME/stderr"; status=$?
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
    stateDir,
    env: {
      ...process.env,
      HOME: home,
      CIRUJANO_SOURCE_CLI_PATH: mockCli,
      CIRUJANO_SOURCE_GUEST_DIR: guestSource,
      CIRUJANO_LAUNCHCTL_PATH: fakeLaunchctl,
      CIRUJANO_INSTALL_POLL_SECONDS: '0.05',
      CIRUJANO_INSTALL_WAIT_SECONDS: '10',
    },
  };
}
