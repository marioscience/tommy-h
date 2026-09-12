import fs from 'fs';

const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').slice(1).map(line => {
  const [profile, engine, round, elapsed, user, system, rss, bytes, digestOk] = line.split(',');
  return { profile, engine, round: Number(round), elapsed: Number(elapsed), cpuSeconds: Number(user) + Number(system), maxRssKiB: Number(rss), archiveBytes: Number(bytes), digestOk: digestOk === 'true' };
});
const groups = Object.groupBy(rows, row => `${row.profile}:${row.engine}`);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const summary = Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, {
  rounds: values.length,
  elapsedMeanSeconds: mean(values.map(value => value.elapsed)),
  cpuMeanSeconds: mean(values.map(value => value.cpuSeconds)),
  maxRssPeakKiB: Math.max(...values.map(value => value.maxRssKiB)),
  archiveMeanBytes: mean(values.map(value => value.archiveBytes)),
  equivalent: values.every(value => value.digestOk)
}]));
process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), summary }, null, 2)}\n`);
