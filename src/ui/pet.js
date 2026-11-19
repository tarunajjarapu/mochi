const labels = { idle: 'here for you', thinking: 'on it…', waiting: 'a little permission?', happy: 'a little nudge ♡' };
document.querySelector('#pet').addEventListener('click', () => window.mochi.toggle());
window.mochi.onEvent(event => {
  if (event.type === 'mood') {
    document.body.className = event.mood;
    document.querySelector('#mood').textContent = labels[event.mood] || labels.idle;
  }
  if (event.type === 'reminder') {
    document.querySelector('#mood').textContent = event.text;
    document.querySelector('#mood').title = event.text;
  }
});
