/** A source backup requires a local review of its exact commit, destination and branch. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

try {
  const [remote, destination] = process.argv.slice(2);
  const approvedUrl = git('config', '--local', '--get', 'personal.backupUrl');
  const approvedRef = git('config', '--local', '--get', 'personal.backupRef');
  const approvedCommit = git('config', '--local', '--get', 'personal.reviewedCommit');
  const url = new URL(approvedUrl);
  const upstream = url.hostname.toLowerCase() === 'github.com'
    && /^\/pal-ai-lab\/(?:coopanion|cortico)(?:\.git)?\/?$/i.test(url.pathname);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || upstream
    || remote !== 'backup' || destination !== approvedUrl
    || !approvedRef.startsWith('refs/heads/') || !/^[0-9a-f]{40}$/.test(approvedCommit)) throw new Error();

  const updates = readFileSync(0, 'utf8').trim().split('\n');
  if (updates.length !== 1) throw new Error();
  const fields = updates[0].trim().split(/\s+/);
  const [localRef, commit, remoteRef] = fields;
  if (fields.length !== 4 || commit !== approvedCommit || remoteRef !== approvedRef
    || git('rev-parse', '--verify', `${localRef}^{commit}`) !== approvedCommit) throw new Error();
} catch {
  console.error('Push blocked: review and approve the exact backup commit, URL and branch in local Git config.');
  process.exitCode = 1;
}
