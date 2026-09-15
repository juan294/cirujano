# Nebius runner pilot: R14 live matrix passed

Date: 2026-09-15. Candidate `develop`
`5a86aab1646dd3ae98a537af6752f86e2d47fe6a`, CLI SHA-256
`e99c69dd2969bd0f11ad8020b026119e3f38bd0fee008460fe0720e5e84f5b61`, exact CI
`34979309433` and CodeQL `34979309535` green. Actions runner v2.337.0.
Private identifiers (fixture repository, VM and disk ids, addresses) stay in the
ignored `.cirujano/runner/r14-*` evidence and `docs/agents/`; this report is the
publishable summary. The `runner report` command evaluated the evidence and
returned `complete: true` with no reasons.

## What happened, in order

Between 2026-09-15 05:13Z and 15:23Z there were six authorized live attempts
(r9 to r14) at five successive candidates. Each attempt stopped at the first
failed row, recovered and cleaned up exactly, and produced one local repair
that CI then re-proved. Every failure was found on real infrastructure, not in
simulation:

| attempt | candidate | reached | failed on | repair |
| --- | --- | --- | --- | --- |
| r9 | `291a9c0` | registration | state directory 0700 blocked `cd` | 0711 state directory, hook field names, helper diagnostics |
| r10 | `8d128b5` | registration | runner requires readable ancestors | 0755 state directory |
| r11 | `152a10a` | armed guest | watchdog quarantined on a wall-clock step | monotonic watchdog, no restart of self-stopped guests, drain tolerance |
| r12 | `83dd477` | listener online | pinned runner version deprecated by GitHub | pin v2.337.0, preflight check |
| r13 | `79b5a58` | job assigned | job hook path lacked `.sh` | hook path |
| r14 | `5a86aab` | complete | none | none |

The armed boot oracle (`scripts/test-runner-cloud-init-boot.sh`) replaced a
race against the ten-minute controller-loss window during r11's aftermath; in
CI provisioning finishes about 606 s after SSH readiness, which the old oracle
could not tolerate.

## R14 rows at the final candidate

| row | result | measured evidence |
| --- | --- | --- |
| provider-contract | passed | one create, two starts, two stops, one delete parsed by the production adapters; VM and disk carried the config hash and controller labels |
| first-boot-failure | passed (r9) | interrupted before readiness, separate provider stop reached `STOPPED` within two minutes, exact cleanup |
| watchdog-first | passed (r9, wall-clock watchdog) | guest powered itself off 82 s after its deadline, ten one-minute `STOPPED` reads with the controller disconnected; the replacement monotonic watchdog is proven by the armed boot oracle in CI |
| queue-and-execute | passed | dispatch to job start on a fresh VM in about 4.5 minutes (create 14:28:31Z, start 14:29:40Z, registration 14:31:57Z, job 14:32:22Z), all sixteen fixture steps green in 85 s |
| sequential-isolation | passed | second job from the stopped VM: new registration, previous workspace and sentinel absent, fixed Docker port free, 42 s; the new generation's grant starts its running time at zero |
| normal-idle | passed | drain four seconds after job completion, five-minute grace observed ten times, stop emitted within one poll, `STOPPED` within two minutes, no runner remained |
| restart-and-failure | passed | controller killed by the host during the second job; the job finished on the guest; a tick with failing GitHub reads exited without any intent, start count unchanged, VM untouched; the restarted controller adopted the same VM and completed drain and stop |
| comparison | passed | hosted 38 s and 40 s versus self-hosted 85 s cold and 42 s warm on the same fixture commit; no percentage saving is asserted |
| cleanup | passed | VM, disk and allocations absent; repository runners zero; active runs zero |

## Cost of the passing attempt

Controller accounting for r14: 2766 s of VM running time across two
generations (the second generation was extended by the restart scenario) and
about 54 minutes of retained disk. At the dated rates (USD 0.0992 per hour
for `cpu-d3` `4vcpu-16gb`, USD 0.071 per GiB per 730 hours for 80 GiB
network SSD, public IP and egress free) that is USD 0.0762 compute and USD
0.0069 disk, USD 0.083 in total. The two hosted baseline jobs bill two
rounded-up minutes at USD 0.006 per minute, USD 0.012. The six attempts
together consumed under USD 0.30 against the USD 5 ceiling authorized for
each.

## Limits stated plainly

- The first-boot-failure and watchdog-first rows were proven at the r9
  candidate; later candidates changed the guest scripts, the controller guards
  and the runner pin, and the current watchdog is proven by the armed boot
  oracle rather than by a repeated disconnected-controller run.
- The restart scenario interrupted the controller with SIGKILL from the host
  rather than SIGINT; the SIGINT drain path was exercised by the r12 and r13
  recoveries.
- The comparison is one fixture on one preset; it measures job duration and VM
  intervals, not a monthly saving.
- The controller fails closed while unrelated runs in the target repository
  keep GitHub's pagination totals inconsistent; on a busy repository that delays
  the first start by minutes.

## What this unblocks

Phase 4 of the on-demand runner plan meets its exit condition. Telemetry
Phase 3 (fleet enrollment and the 45-day savings evidence) was gated on this
pilot and can start.
