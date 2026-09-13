import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const guestDir = resolve(import.meta.dirname, '../../guest');
const scripts = ['bootstrap.sh', 'arm-grant.sh', 'watchdog.sh', 'register-runner.sh', 'job-start-hook.sh', 'drain.sh', 'status.sh', 'resume-admission.sh'];

describe('guest helpers (R08-R09)', () => {
  it.each(scripts)('%s passes bash syntax validation', (script) => {
    expect(() => execFileSync('/bin/bash', ['-n', resolve(guestDir, script)])).not.toThrow();
  });

  it('keeps registration tokens off config argv and uses an ephemeral runner', () => {
    const script = readFileSync(resolve(guestDir, 'register-runner.sh'), 'utf8');
    expect(script).toContain('read -r RUNNER_TOKEN');
    expect(script).toContain('ACTIONS_RUNNER_INPUT_TOKEN');
    expect(script).toContain('--ephemeral');
    expect(script).toContain('--disableupdate');
    expect(script).not.toContain('--replace');
    expect(script).not.toContain('RUNNER_REPOSITORY:?');
  });

  it('installs the watchdog before readiness and verifies the runner checksum', () => {
    const script = readFileSync(resolve(guestDir, 'bootstrap.sh'), 'utf8');
    expect(script.indexOf('systemctl enable --now cirujano-watchdog')).toBeLessThan(script.indexOf('touch /var/lib/cirujano/ready'));
    expect(script).toContain('sha256sum --check');
  });

  it('fails delayed jobs before user code and bounds the hook itself', () => {
    const script = readFileSync(resolve(guestDir, 'job-start-hook.sh'), 'utf8');
    expect(script).toContain('timeout 10s');
    expect(script).toContain('safe_cutoff_ms');
    expect(script).toContain('exit 1');
  });

  it('drains named processes and task-owned Docker resources without global cleanup', () => {
    const script = readFileSync(resolve(guestDir, 'drain.sh'), 'utf8');
    expect(script).toContain('Runner.Worker');
    expect(script).toContain('label=cirujano.generation=');
    expect(script).not.toMatch(/pkill|docker system prune|rm -rf \/home/);
  });

  it('retires the listener before generation cleanup and preserves diagnostics', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'cirujano-drain-'));
    const runnerDir = resolve(state, 'runner-4');
    mkdirSync(resolve(runnerDir, '_diag'), { recursive: true });
    writeFileSync(resolve(runnerDir, '_diag', 'runner.log'), 'preserved');
    execFileSync('/bin/bash', [resolve(guestDir, 'drain.sh')], {
      env: { ...process.env, CIRUJANO_TEST_MODE: '1', CIRUJANO_STATE_DIR: state, CIRUJANO_RUNNER_ROOT: state, CIRUJANO_DOCKER_BIN: '/usr/bin/true', CIRUJANO_FLOCK_BIN: '/usr/bin/true' }, input: '4\n',
    });
    expect(readFileSync(resolve(state, 'diag-4', 'runner.log'), 'utf8')).toBe('preserved');
    expect(readFileSync(resolve(state, 'admission-disabled'), 'utf8')).toBe('');
  });

  it('serializes drain against a registration holding the generation lock', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'cirujano-race-'));
    mkdirSync(resolve(state, 'runner-8'));
    const flock = resolve(state, 'flock.py');
    writeFileSync(flock, '#!/usr/bin/python3\nimport fcntl, sys\nfd=int(sys.argv[-1])\nop=fcntl.LOCK_UN if "-u" in sys.argv else fcntl.LOCK_EX | fcntl.LOCK_NB\ntry: fcntl.flock(fd, op)\nexcept BlockingIOError: sys.exit(1)\n');
    chmodSync(flock, 0o700);
    const ready = resolve(state, 'lock-ready');
    const holder = spawn('/bin/bash', ['-c', `exec 9>"${resolve(state, 'generation-8.lock')}"; "${flock}" -n 9; touch "${ready}"; sleep 30`]);
    const started = Date.now();
    while (Date.now() - started < 1_000 && !existsSync(ready)) execFileSync('/bin/sleep', ['0.02']);
    expect(existsSync(ready)).toBe(true);
    expect(holder.exitCode).toBeNull();
    expect(() => execFileSync('/bin/bash', [resolve(guestDir, 'drain.sh')], {
      env: { ...process.env, CIRUJANO_TEST_MODE: '1', RUNNER_GENERATION: '8', CIRUJANO_STATE_DIR: state, CIRUJANO_RUNNER_ROOT: state, CIRUJANO_DOCKER_BIN: '/usr/bin/true', CIRUJANO_FLOCK_BIN: flock },
    })).toThrow();
    expect(existsSync(resolve(state, 'runner-8'))).toBe(true);
    holder.kill('SIGTERM');
  });

  it('holds the generation lock across the sudo listener boundary until drain stops it', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'cirujano-supervisor-'));
    const template = resolve(state, 'template');
    mkdirSync(template);
    writeFileSync(resolve(template, 'config.sh'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(resolve(template, 'run.sh'), `#!/usr/bin/env bash\ntouch "${resolve(state, 'listener-ready')}"\nwhile true; do sleep 1; done\n`);
    chmodSync(resolve(template, 'config.sh'), 0o700);
    chmodSync(resolve(template, 'run.sh'), 0o700);
    const sudo = resolve(state, 'sudo.sh');
    writeFileSync(sudo, '#!/usr/bin/env bash\nwhile [[ $# -gt 0 ]]; do case "$1" in -u) shift 2;; --preserve-env=*) shift;; *) exec "$@";; esac; done\n');
    chmodSync(sudo, 0o700);
    const flock = resolve(state, 'flock.py');
    writeFileSync(flock, '#!/usr/bin/python3\nimport fcntl, sys\nfd=int(sys.argv[-1])\nop=fcntl.LOCK_UN if "-u" in sys.argv else fcntl.LOCK_EX | fcntl.LOCK_NB\ntry: fcntl.flock(fd, op)\nexcept BlockingIOError: sys.exit(1)\n');
    chmodSync(flock, 0o700);
    const registration = spawn('/bin/bash', [resolve(guestDir, 'register-runner.sh')], {
      env: { ...process.env, RUNNER_REPOSITORY: 'trusted/private', RUNNER_NAME: 'runner-9', RUNNER_LABEL: 'pilot', RUNNER_GENERATION: '9', CIRUJANO_STATE_DIR: state, CIRUJANO_RUNNER_ROOT: state, CIRUJANO_RUNNER_TEMPLATE: template, CIRUJANO_SUDO_BIN: sudo, CIRUJANO_FLOCK_BIN: flock, CIRUJANO_TEST_MODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    registration.stdin.end('trusted/private\nrunner-9\npilot\n9\nregistration-token\n');
    const started = Date.now();
    while (Date.now() - started < 2_000 && !existsSync(resolve(state, 'listener-ready'))) execFileSync('/bin/sleep', ['0.05']);
    expect(existsSync(resolve(state, 'listener-ready'))).toBe(true);
    execFileSync('/bin/bash', [resolve(guestDir, 'drain.sh')], {
      env: { ...process.env, CIRUJANO_TEST_MODE: '1', CIRUJANO_STATE_DIR: state, CIRUJANO_RUNNER_ROOT: state, CIRUJANO_DOCKER_BIN: '/usr/bin/true', CIRUJANO_FLOCK_BIN: flock }, input: '9\n',
    });
    expect(existsSync(resolve(state, 'runner-9', 'run.sh'))).toBe(false);
    registration.kill('SIGKILL');
  });

  it('reports a machine-readable fail-closed guest snapshot', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'cirujano-status-'));
    writeFileSync(resolve(state, 'ready'), '');
    writeFileSync(resolve(state, 'grant.env'), 'grant_generation=3\ngrant_started_at_ms=1000\ngrant_deadline_ms=9000\n');
    const output = execFileSync('/bin/bash', [resolve(guestDir, 'status.sh')], {
      env: { ...process.env, CIRUJANO_TEST_MODE: '1', CIRUJANO_STATE_DIR: state, CIRUJANO_SYSTEMCTL_BIN: '/usr/bin/true' }, encoding: 'utf8',
    });
    expect(JSON.parse(output)).toMatchObject({ complete: true, status: 'ready', grant: { generation: 3, startedAtMs: 1000, deadlineMs: 9000 } });
  });

  it('persists an immutable grant, rejects extension, and permits exactly the confirmed next generation', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'cirujano-grant-'));
    const arm = resolve(guestDir, 'arm-grant.sh');
    const env = { ...process.env, CIRUJANO_TEST_MODE: '1', CIRUJANO_STATE_DIR: state, CIRUJANO_BOOT_ID: 'boot-a', CIRUJANO_MONOTONIC_MS: '100', CIRUJANO_SKIP_SYNC: '1' };
    execFileSync('/bin/bash', [arm], { env, input: '1\n1000\n91000\n60000\n5000\n0\n' });
    expect(() => execFileSync('/bin/bash', [arm], { env, input: '1\n1000\n92000\n60000\n5000\n0\n' })).toThrow();
    expect(() => execFileSync('/bin/bash', [arm], { env, input: '2\n92000\n182000\n60000\n5000\n0\n' })).toThrow();
    execFileSync('/bin/bash', [arm], { env: { ...env, CIRUJANO_NOW_MS: '90000' }, input: '2\n92000\n182000\n60000\n5000\n1\n' });
    expect(readFileSync(resolve(state, 'grant.env'), 'utf8')).toContain('grant_generation=2');
  });

  it('powers off an expired prior generation even after guest drain', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'cirujano-rearm-'));
    writeFileSync(resolve(state, 'grant.env'), [
      'grant_generation=1', 'grant_started_at_ms=1000', 'grant_deadline_ms=2000',
      'max_job_ms=60000', 'shutdown_margin_ms=5000', 'grant_boot_id=boot-a',
      'last_monotonic_ms=10', 'monotonic_elapsed_ms=1000', 'maximum_wall_ms=2000', '',
    ].join('\n'));
    const poweroff = resolve(state, 'powered-off');
    execFileSync('/bin/bash', [resolve(guestDir, 'watchdog.sh')], {
      env: { ...process.env, CIRUJANO_STATE_DIR: state, CIRUJANO_NOW_MS: '3000', CIRUJANO_MONOTONIC_MS: '5', CIRUJANO_BOOT_ID: 'boot-b', CIRUJANO_WATCHDOG_ONCE: '1', CIRUJANO_POWEROFF_FILE: poweroff, CIRUJANO_SKIP_SYNC: '1' },
    });
    expect(existsSync(poweroff)).toBe(true);
  });

  it('preserves a deadline across reboot and quarantines wall-clock rollback', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'cirujano-watchdog-'));
    const poweroff = resolve(state, 'powered-off');
    const arm = resolve(guestDir, 'arm-grant.sh');
    execFileSync('/bin/bash', [arm], { env: { ...process.env, CIRUJANO_TEST_MODE: '1', CIRUJANO_STATE_DIR: state, CIRUJANO_BOOT_ID: 'boot-a', CIRUJANO_MONOTONIC_MS: '100', CIRUJANO_SKIP_SYNC: '1' }, input: '1\n1000\n91000\n60000\n5000\n0\n' });
    const watchdog = resolve(guestDir, 'watchdog.sh');
    execFileSync('/bin/bash', [watchdog], { env: { ...process.env, CIRUJANO_STATE_DIR: state, CIRUJANO_BOOT_ID: 'boot-b', CIRUJANO_MONOTONIC_MS: '10', CIRUJANO_NOW_MS: '2000', CIRUJANO_WATCHDOG_ONCE: '1', CIRUJANO_POWEROFF_FILE: poweroff, CIRUJANO_SKIP_SYNC: '1' } });
    expect(readFileSync(resolve(state, 'grant.env'), 'utf8')).toContain('grant_deadline_ms=91000');
    expect(() => execFileSync('/bin/bash', [watchdog], { env: { ...process.env, CIRUJANO_STATE_DIR: state, CIRUJANO_BOOT_ID: 'boot-b', CIRUJANO_MONOTONIC_MS: '20', CIRUJANO_NOW_MS: '1500', CIRUJANO_WATCHDOG_ONCE: '1', CIRUJANO_POWEROFF_FILE: poweroff, CIRUJANO_SKIP_SYNC: '1' } })).toThrow();
    expect(readFileSync(resolve(state, 'quarantined'), 'utf8')).toBe('');
  });
});
