// GitHub content is rendered as text. Only the main process talks to GitHub CLI.
const inbox = { connected: false, view: 'mine', repo: '', prs: [], generation: 0, detailGeneration: 0, loading: false, login: '' };
const prKey = pr => `${pr.repo}#${pr.number}`;
const pinned = pr => (state?.githubPins || []).includes(prKey(pr));
const needsAttention = pr => ['FAILURE', 'ERROR'].includes(pr.checks) || pr.review === 'CHANGES_REQUESTED' || pr.mergeable === 'CONFLICTING';
const checkLabel = status => ({ SUCCESS: 'Checks passing', FAILURE: 'Checks failing', ERROR: 'Check error', PENDING: 'Checks running', EXPECTED: 'Checks expected', NONE: 'No checks' }[status] || 'Checks unknown');
const reviewLabel = status => ({ APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', REVIEW_REQUIRED: 'Review needed', NONE: 'No decision' }[status] || 'Review pending');
const checkTone = status => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(status) ? 'good' : ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(status) ? 'bad' : ['PENDING', 'IN_PROGRESS', 'QUEUED', 'WAITING', 'REQUESTED', 'EXPECTED'].includes(status) ? 'pending' : '';
function badge(text, tone = '') { return make('span', text, `badge ${tone}`); }
function updatedLabel(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  if (!Number.isFinite(minutes)) return '';
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}
function prBadges(pr) {
  const row = make('div', undefined, 'pr-meta');
  if (pr.draft) row.append(badge('Draft'));
  row.append(badge(checkLabel(pr.checks), checkTone(pr.checks)));
  if (pr.review !== 'NONE') row.append(badge(reviewLabel(pr.review), pr.review === 'APPROVED' ? 'good' : pr.review === 'CHANGES_REQUESTED' ? 'bad' : 'pending'));
  if (pr.mergeable === 'CONFLICTING') row.append(badge('Conflicts', 'bad'));
  return row;
}
function showGitHubError(message) { $('#github-error').textContent = message; $('#github-error').hidden = !message; }
function renderInbox() {
  const list = $('#github-list'); list.replaceChildren();
  const search = $('#github-search').value.trim().toLowerCase(), filter = $('#github-filter').value;
  const filtered = inbox.prs.filter(pr => `${pr.title} ${pr.repo} #${pr.number} ${pr.author}`.toLowerCase().includes(search) &&
    (filter === 'all' || filter === 'attention' && needsAttention(pr) || filter === 'pinned' && pinned(pr) || filter === 'draft' && pr.draft));
  filtered.sort((a, b) => Number(pinned(b)) - Number(pinned(a)));
  $('#github-list-title').textContent = { mine: 'My open pull requests', review: 'Waiting for my review', involved: 'PRs I’m involved in' }[inbox.view];
  for (const pr of filtered) {
    const card = make('article', undefined, `pr-card${pinned(pr) ? ' pinned' : ''}`);
    const open = make('button', undefined, 'pr-open');
    open.title = pr.title;
    open.setAttribute('aria-label', `${pr.repo} #${pr.number}: ${pr.title}`);
    open.onclick = safe(() => showPR(pr));
    const meta = prBadges(pr); meta.append(make('span', updatedLabel(pr.updatedAt), 'pr-time'));
    open.append(make('span', `${pr.repo} · #${pr.number}`, 'pr-repo'), make('span', pr.title, 'pr-title'), meta);
    const pin = make('button', pinned(pr) ? '★' : '☆', 'pin');
    pin.setAttribute('aria-label', `${pinned(pr) ? 'Unpin' : 'Pin'} ${pr.repo} #${pr.number}`); pin.setAttribute('aria-pressed', pinned(pr));
    pin.onclick = safe(async () => { await api.githubPin(pr.repo, pr.number); renderInbox(); });
    card.append(open, pin); list.append(card);
  }
  if (!filtered.length) list.append(make('p', inbox.loading ? 'Loading your pull requests…' : search || filter !== 'all' ? 'No matching PRs in this view. Try another filter or load more.' : inbox.view === 'review' ? 'You’re caught up. No open review requests.' : 'No open pull requests in this view.', 'empty'));
  $('#github-more').hidden = !inbox.page?.hasNextPage; $('#github-more').disabled = inbox.loading;
  if (inbox.page?.hasNextPage) $('#github-more').textContent = `Load more · ${inbox.prs.length} of ${inbox.total}`;
}
function renderAuth(auth) {
  $('#github-auth').hidden = !auth.pending;
  $('#github-connect').disabled = !inbox.installed || !!auth.pending;
  $('#github-code').textContent = auth.code || 'Waiting for code…';
  $('#github-device').disabled = !auth.code;
  if (auth.message) toast(auth.message);
}
async function githubStatus() {
  const status = await api.githubStatus();
  inbox.connected = status.connected; inbox.installed = status.installed; inbox.login = status.login || '';
  $('#github-setup').hidden = status.connected;
  $('#github-connected').hidden = !status.connected;
  $('#github-install').hidden = status.installed;
  $('#github-connect').disabled = !status.installed || status.pending;
  $('#github-account').textContent = status.connected ? `@${status.login} · github.com` : status.message || 'Connect GitHub to bring your PRs into view.';
  renderAuth(status);
  if (status.connected) await loadInbox();
  return status;
}
async function loadInbox(more = false, background = false) {
  const generation = ++inbox.generation;
  inbox.loading = true; $('#github-refresh').disabled = true; showGitHubError('');
  const cursor = more ? inbox.page?.endCursor : null;
  if (!more && !background) { inbox.prs = []; inbox.page = null; }
  renderInbox();
  try {
    const result = await api.githubList({ view: inbox.view, repo: inbox.repo, cursor });
    if (generation !== inbox.generation) return;
    // An account switch must never append rows from the previous account.
    if (inbox.login && result.login !== inbox.login) inbox.prs = [];
    inbox.login = result.login; inbox.connected = true;
    const rows = new Map([...(more ? inbox.prs : []), ...result.prs].map(pr => [prKey(pr), pr])); inbox.prs = [...rows.values()];
    inbox.page = result.page; inbox.total = result.total;
    $('#count-mine').textContent = result.counts.mine; $('#count-review').textContent = result.counts.review;
    $('#github-account').textContent = `@${result.login} · github.com`;
    $('#github-updated').textContent = `Updated ${new Date(result.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } catch (error) { if (generation === inbox.generation) showGitHubError(error.message); }
  finally { if (generation === inbox.generation) { inbox.loading = false; $('#github-refresh').disabled = false; renderInbox(); } }
}
function detailSection(title, child) {
  const section = make('section', undefined, 'detail-section'); section.append(make('h2', title), child); return section;
}
function action(text, fn, className = 'secondary') { const button = make('button', text, className); button.onclick = safe(fn); return button; }
function githubText(text) {
  // Hide bot metadata and HTML presentation tags without rendering remote markup or images.
  const readable = text.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/^\[[^\]]+\]:[^\n]*$/gm, '')
    .replace(/<\/?(?:details|summary|picture|source|img|a|sub|sup|br|p|div|span|strong)\b[^>]*>/gi, '').trim();
  return messageContent(readable);
}
function renderDetail(pr) {
  const box = $('#github-detail-content'); box.replaceChildren();
  box.append(make('div', `${pr.repo} · #${pr.number}`, 'pr-repo'), make('h1', pr.title, 'detail-title'), prBadges(pr));
  box.append(make('p', `${pr.author} · ${pr.head} → ${pr.base}`, 'branch-row'));
  const stats = make('div', undefined, 'pr-meta');
  stats.append(badge(`${pr.changedFiles} files`), badge(`+${pr.additions}`, 'good'), badge(`−${pr.deletions}`, 'bad'), badge(pr.state === 'OPEN' ? `Merge state: ${(pr.mergeState || 'UNKNOWN').toLowerCase()}` : pr.state)); box.append(stats);
  const actions = make('div', undefined, 'detail-actions');
  const review = action('Review with Mochi', () => askAboutPR(pr, 'review'), 'primary');
  const summarize = action('Summarize', () => askAboutPR(pr, 'summary'));
  review.dataset.prAi = ''; summarize.dataset.prAi = ''; review.disabled = summarize.disabled = !!state?.busy;
  actions.append(review, summarize, action('Open on GitHub ↗', () => api.githubOpen(pr.repo, pr.number)), action(pinned(pr) ? '★ Pinned' : '☆ Pin', async () => { await api.githubPin(pr.repo, pr.number); renderDetail(pr); }));
  box.append(actions, make('p', 'Asking Mochi sends the PR details and available diff to your selected model. Reviews stay in chat.', 'hint'));
  const checks = make('div');
  for (const run of pr.runs) { const row = make('div', undefined, 'check-row'); row.append(make('span', run.name), badge((run.state || 'UNKNOWN').replaceAll('_', ' ').toLowerCase(), checkTone(run.state))); checks.append(row); }
  if (!pr.runs.length) checks.append(make('p', 'No CI checks were reported for this revision.', 'hint'));
  if (pr.checksTruncated) checks.append(make('p', 'Showing the first 40 check results.', 'hint'));
  checks.append(action('View checks on GitHub ↗', () => api.githubOpen(pr.repo, pr.number, true), 'text-button'));
  const description = make('div', undefined, 'pr-description'); description.append(githubText(pr.body || 'No description provided.'));
  if (pr.contextTruncated) description.append(make('p', 'Long descriptions and conversations are shortened here. Open GitHub for the full context.', 'hint'));
  box.append(detailSection('CHECKS', checks), detailSection('DESCRIPTION', description));
  const reviews = make('div');
  for (const item of pr.reviews) {
    const note = make('div', undefined, 'review-note'); note.append(make('strong', `${item.author} · ${item.state.replaceAll('_', ' ').toLowerCase()}`));
    if (item.body) note.append(githubText(item.body)); reviews.append(note);
  }
  if (!pr.reviews.length) reviews.append(make('p', 'No submitted reviews yet.', 'hint'));
  box.append(detailSection('LATEST REVIEWS', reviews));
  const comments = make('div');
  for (const comment of pr.comments) {
    const note = make('div', undefined, 'review-note'); note.append(make('strong', `${comment.author} · ${updatedLabel(comment.at)}`), githubText(comment.body)); comments.append(note);
  }
  if (pr.comments.length) box.append(detailSection('RECENT CONVERSATION', comments));
}
async function showPR(pr) {
  const generation = ++inbox.detailGeneration;
  $('#github-overview').hidden = true; $('#github-detail').hidden = false;
  $('#github-detail-content').replaceChildren(make('p', 'Loading the latest PR details…', 'empty'));
  $('#github').scrollTop = 0;
  try {
    const detail = await api.githubDetail(pr.repo, pr.number);
    if (generation === inbox.detailGeneration) renderDetail(detail);
  } catch (error) {
    if (generation === inbox.detailGeneration) $('#github-detail-content').replaceChildren(make('p', error.message, 'error-note'), action('Try again', () => showPR(pr)));
  }
}
async function askAboutPR(pr, intent) {
  if (state?.busy) { toast('Wait for Mochi to finish, or stop the current task.'); return; }
  const task = intent === 'review'
    ? 'Review the latest version of this PR for bugs, regressions, and missing tests. Cite changed files and lines, explain concrete failure scenarios, and flag any incomplete diff.'
    : 'Summarize the latest version of this PR: the problem, what changed, review feedback, CI status, and the next useful action.';
  const prompt = `${task}\n\n${pr.repo} #${pr.number}\n${pr.url}`;
  $('#pr-chat-context').textContent = `Discussing ${pr.repo} #${pr.number}`; $('#pr-chat-context').hidden = false;
  tab('chat'); $('#messages').scrollTop = $('#messages').scrollHeight; await api.chat(prompt);
}
$('#github-back').onclick = () => { ++inbox.detailGeneration; $('#github-overview').hidden = false; $('#github-detail').hidden = true; renderInbox(); };
$('#github-refresh').onclick = safe(() => inbox.connected ? loadInbox() : githubStatus());
$('#github-connect').onclick = safe(async () => renderAuth(await api.githubConnect()));
$('#github-device').onclick = safe(() => api.githubDevice());
$('#github-cancel').onclick = safe(() => api.githubCancel());
$('#github-search').oninput = renderInbox; $('#github-filter').onchange = renderInbox;
$('#github-more').onclick = safe(() => loadInbox(true));
function selectView(view) {
  inbox.view = view;
  document.querySelectorAll('[data-github-view]').forEach(button => button.setAttribute('aria-pressed', button.dataset.githubView === view));
  return loadInbox();
}
document.querySelectorAll('[data-github-view]').forEach(button => button.onclick = safe(() => selectView(button.dataset.githubView)));
$('#github-all').onclick = safe(() => selectView('involved'));
$('#github-repo-form').onsubmit = event => { event.preventDefault(); safe(async () => { inbox.repo = $('#github-repo').value.trim(); await loadInbox(); })(); };
document.addEventListener('mochi-state', () => {
  renderInbox(); document.querySelectorAll('[data-pr-ai]').forEach(button => button.disabled = state.busy);
});
api.onEvent(event => {
  if (event.type === 'github-auth') {
    renderAuth(event.auth);
    if (!event.auth.pending) safe(githubStatus)();
  }
});
setInterval(() => { if (!document.hidden && $('#github').classList.contains('active') && $('#github-detail').hidden && inbox.connected && !inbox.loading) safe(() => loadInbox(false, true))(); }, 120000);
safe(githubStatus)();
