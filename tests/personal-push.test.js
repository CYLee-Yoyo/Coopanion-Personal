import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = join(root, 'scripts', 'check-personal-push.mjs');
const scratch = join(root, 'scratch');
const url = 'https://example.test/operator/companion.git';
const ref = 'refs/heads/reviewed';
const zero = '0'.repeat(40);
const folders = [];

function repository() {
  mkdirSync(scratch, { recursive: true });
  const cwd = mkdtempSync(join(scratch, 'push-contract-'));
  folders.push(cwd);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Operator');
  git('config', 'user.email', 'operator@example.test');
  writeFileSync(join(cwd, 'source.txt'), 'reviewed source\n');
  git('add', 'source.txt');
  git('commit', '-qm', 'feat: add source');
  const commit = git('rev-parse', 'HEAD');
  git('config', 'personal.backupUrl', url);
  git('config', 'personal.backupRef', ref);
  git('config', 'personal.reviewedCommit', commit);
  const row = (sha = commit, target = ref) => `HEAD ${sha} ${target} ${zero}\n`;
  const push = (destination = url, input = row(), remote = 'backup') =>
    spawnSync(process.execPath, [script, remote, destination], { cwd, input, encoding: 'utf8' });
  return { cwd, git, commit, row, push };
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('reviewed source backup hook', () => {
  it('accepts the reviewed commit on its approved destination and branch', () => {
    expect(repository().push().status).toBe(0);
  });

  it('rejects a missing review, other remote names and other destinations', () => {
    const repo = repository();
    expect(repo.push(url, repo.row(), 'origin').status).toBe(1);
    expect(repo.push('https://example.test/other/companion.git').status).toBe(1);
    repo.git('config', '--unset', 'personal.reviewedCommit');
    expect(repo.push().status).toBe(1);
  });

  it('requires a fresh review after another source commit', () => {
    const repo = repository();
    writeFileSync(join(repo.cwd, 'source.txt'), 'changed source\n');
    repo.git('add', 'source.txt');
    repo.git('commit', '-qm', 'fix: update source');
    expect(repo.push(url, repo.row(repo.git('rev-parse', 'HEAD'))).status).toBe(1);
    expect(repo.push().status).toBe(1);
  });

  it('rejects the upstream destination even when locally approved', () => {
    const repo = repository();
    const upstream = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).homepage + '.git';
    repo.git('config', 'personal.backupUrl', upstream);
    expect(repo.push(upstream).status).toBe(1);
  });

  it('rejects extra branches, tags and deletion', () => {
    const repo = repository();
    expect(repo.push(url, repo.row(repo.commit, 'refs/heads/other')).status).toBe(1);
    expect(repo.push(url, repo.row(repo.commit, 'refs/tags/version')).status).toBe(1);
    expect(repo.push(url, repo.row(zero)).status).toBe(1);
    expect(repo.push(url, repo.row() + repo.row()).status).toBe(1);
    expect(repo.push(url, '').status).toBe(1);
  });

  it('rejects a credential-bearing destination without echoing it', () => {
    const repo = repository();
    const destination = 'https://fixture-user:fixture-password@example.test/operator/companion.git';
    repo.git('config', 'personal.backupUrl', destination);
    const result = repo.push(destination);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('fixture-password');
  });
});
