export function roundedJobMinutes(elapsedMs) {
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('invalid-elapsed-ms');
  return Math.ceil(elapsedMs / 60000);
}

export function aggregateMinutes(jobs) {
  return jobs.reduce((minutes, job) => minutes + roundedJobMinutes(job.elapsedMs), 0);
}
