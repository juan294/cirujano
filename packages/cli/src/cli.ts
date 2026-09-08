import { readFile } from 'node:fs/promises';

import { BillingInputError, parseGithubJobs, summarizeBillableMinutes } from '@cirujano/core';

import { ArgumentError, USAGE, VERSION, parseArguments } from './args.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const processIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

/** Exit code contract: 0 success, 1 runtime failure, 2 usage error. */
export async function runCli(argv: readonly string[], io: CliIo = processIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    if (error instanceof ArgumentError) {
      io.stderr(`${error.message}\n\n${USAGE}\n`);
      return 2;
    }
    throw error;
  }

  switch (parsed.command) {
    case 'help':
      io.stdout(`${USAGE}\n`);
      return 0;
    case 'version':
      io.stdout(`${VERSION}\n`);
      return 0;
    case 'estimate':
      return estimate(parsed.jobsPath, parsed.format, io);
  }
}

async function estimate(jobsPath: string, format: 'json' | 'text', io: CliIo): Promise<number> {
  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(jobsPath, 'utf8'));
  } catch (error) {
    io.stderr(`Cannot read ${jobsPath}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  let summary;
  try {
    summary = summarizeBillableMinutes(parseGithubJobs(payload));
  } catch (error) {
    if (error instanceof BillingInputError) {
      io.stderr(`${jobsPath}: ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  if (format === 'json') {
    io.stdout(`${JSON.stringify(summary)}\n`);
  } else {
    io.stdout(
      `Billable minutes: ${summary.billableMinutes}\n`
      + `Measured jobs:    ${summary.measuredJobs}\n`
      + `Skipped jobs:     ${summary.skippedJobs}\n`,
    );
  }
  return 0;
}
