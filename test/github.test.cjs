const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GitHub, prURL } = require('../src/core/github.cjs');
const { Store } = require('../src/core/store.cjs');
const { createTools } = require('../src/core/tools.cjs');
const { runAgent } = require('../src/core/agent.cjs');

const fixture = () => ({ repository: { nameWithOwner: 'engineer/project' }, number: 42,
  title: 'Fix timeout handling', url: 'https://untrusted.example/ignored', state: 'OPEN', isDraft: false,
  updatedAt: '2026-11-25T10:00:00Z', additions: 12, deletions: 3, changedFiles: 1, headRefOid: 'abc123',
  headRefName: 'fix/timeouts', baseRefName: 'main', author: { login: 'engineer' }, reviewDecision: 'REVIEW_REQUIRED',
  mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', body: 'Fix the request timeout.',
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: { totalCount: 2, nodes: [
    { name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE' }, { context: 'lint', state: 'SUCCESS' },
  ] } } } }] }, latestReviews: { nodes: [{ author: { login: 'reviewer' }, state: 'CHANGES_REQUESTED', body: 'Add cancellation coverage.' }] }, comments: { nodes: [] } });
const result = pr => ({ data: { repository: { pullRequest: pr } } });

test('inbox uses fixed-host read-only queries, validated filters, and preserves pagination', async () => {
  const github = new GitHub({ run: async (args, options) => {
    assert.deepEqual(args, ['api', 'graphql', '--hostname', 'github.com', '--method', 'POST', '--input', '-']);
    const { query, variables } = JSON.parse(options.input);
    assert.doesNotMatch(query, /mutation/);
    assert.equal(variables.query, 'is:pr is:open review-requested:@me repo:engineer/project sort:updated-desc');
    assert.equal(variables.cursor, 'next-page');
    return { data: { viewer: { login: 'engineer' }, mine: { issueCount: 2 }, review: { issueCount: 35 }, inbox: {
      issueCount: 35, pageInfo: { hasNextPage: true, endCursor: 'page-3' }, nodes: [fixture(), {}],
    } } };
  } });
  const inbox = await github.list({ view: 'review', repo: 'engineer/project', cursor: 'next-page' });
  assert.equal(inbox.prs.length, 1); assert.equal(inbox.total, 35); assert.equal(inbox.page.endCursor, 'page-3');
  assert.equal(inbox.prs[0].url, 'https://github.com/engineer/project/pull/42');
  assert.equal(inbox.prs[0].checks, 'FAILURE'); assert.equal(inbox.prs[0].mergeState, 'BLOCKED');
  for (const options of [{ view: 'anything' }, { repo: 'repo?token=secret' }, { repo: 'owner/../private' }, { cursor: 'x'.repeat(501) }]) await assert.rejects(github.list(options));
});
test('PR references cannot redirect requests or turn into CLI options', () => {
  for (const repo of ['../secret', 'owner/repo/../other', '--hostname/evil', 'owner/repo?query', 'owner/repo\nanything', 'owner/..']) assert.throws(() => prURL(repo, 1));
  for (const number of ['1', 0, -1, 1.5, NaN, Infinity]) assert.throws(() => prURL('owner/repo', number));
  assert.equal(prURL('owner/repo', 23, true), 'https://github.com/owner/repo/pull/23/checks');
});
test('detail handles missing checks, deleted authors and partial review data honestly', async () => {
  const pr = fixture(); pr.commits.nodes = []; pr.author = null; pr.latestReviews.nodes[0].author = null;
  const github = new GitHub({ run: async () => result(pr) });
  const detail = await github.detail('engineer/project', 42);
  assert.equal(detail.checks, 'NONE'); assert.deepEqual(detail.runs, []); assert.equal(detail.author, 'ghost');
  assert.equal(detail.reviews[0].author, 'ghost');
});
test('review context bounds patches and marks missing, oversized, and omitted files', async () => {
  const pr = fixture(); pr.changedFiles = 45;
  const github = new GitHub({ run: async args => args[1] === 'graphql' ? result(pr) : Array.from({ length: 30 }, (_, i) => ({
    filename: `src/file${i}.js`, status: 'modified', additions: 10, deletions: 1, ...(i ? { patch: 'x'.repeat(8000) } : {}),
  })) });
  const detail = await github.read('engineer/project', 42);
  assert.equal(detail.files.length, 30); assert.equal(detail.truncated, true); assert.equal(detail.files[0].incomplete, true);
  assert.ok(detail.files.every(file => file.patch.length <= 6000));
  assert.ok(detail.files.filter(file => !file.patch.startsWith('(Patch')).reduce((sum, file) => sum + file.patch.length, 0) <= 36000);
});
test('a push during a review invalidates the loaded revision', async () => {
  let calls = 0;
  const github = new GitHub({ run: async args => {
    if (args[1] !== 'graphql') return [{ filename: 'src/a.js', patch: '+fix' }];
    const pr = fixture(); if (calls++) pr.headRefOid = 'new-head'; return result(pr);
  } });
  await assert.rejects(github.read('engineer/project', 42), /changed while/);
});
test('API errors do not become apparently empty successful views or leak raw server details', async () => {
  const github = new GitHub({ run: async () => ({ errors: [{ message: 'sensitive upstream diagnostic' }] }) });
  await assert.rejects(github.list(), /could not load/);
  const status = await github.status(); assert.equal(status.connected, false); assert.doesNotMatch(status.message, /sensitive/);
});
test('GitHub tool requests carry cancellation and work through the existing agent loop', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-github-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory), controller = new AbortController();
  const tools = createTools({ store, workspace: path.join(directory, 'workspace'), github: {
    read: async (repo, number, signal) => { assert.equal(repo, 'engineer/project'); assert.equal(number, 42); assert.equal(signal, controller.signal); return { title: 'Fix timeout', truncated: true }; },
  } });
  let calls = 0;
  const provider = { chat: async messages => {
    if (!calls++) return { role: 'assistant', content: '', tool_calls: [{ function: { name: 'github_read_pr', arguments: { repo: 'engineer/project', number: 42 } } }] };
    assert.equal(JSON.parse(messages.at(-1).content).truncated, true);
    return { role: 'assistant', content: 'The patch is partial; I cannot verify the full change.' };
  } };
  assert.match(await runAgent({ text: 'Review PR 42', provider, tools, signal: controller.signal }), /partial/);
  assert.equal(store.state.activity[0].tool, 'github_read_pr');
});
test('old profiles default to dark without changing their model and persist appearance and pins', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-theme-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory); const settings = { ...store.state.settings };
  delete store.state.theme; delete store.state.githubPins; store.save();
  const migrated = new Store(directory); assert.equal(migrated.state.theme, 'dark'); assert.deepEqual(migrated.state.settings, settings);
  migrated.state.theme = 'light'; migrated.state.githubPins = ['engineer/project#42']; migrated.save();
  const restored = new Store(directory); assert.equal(restored.state.theme, 'light'); assert.deepEqual(restored.state.githubPins, ['engineer/project#42']);
});
