const labels = { idle: 'here for you', thinking: 'on it…', waiting: 'a little permission?', happy: 'a little nudge ♡' };
const pet = document.querySelector('#pet');
let gesture, settling = false;
const reportError = () => { document.querySelector('#mood').textContent = 'Try moving me again'; };
pet.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary || gesture || settling) return;
  event.preventDefault();
  pet.focus({ preventScroll: true });
  pet.setPointerCapture(event.pointerId);
  const current = { pointerId: event.pointerId, ready: window.mochi.beginPetDrag() };
  gesture = current; pet.classList.add('dragging');
  current.ready.catch(() => { if (gesture === current) finishGesture(true); });
});
async function finishGesture(cancelled = false) {
  const current = gesture;
  if (!current) return;
  gesture = null; settling = true; pet.classList.remove('dragging');
  if (pet.hasPointerCapture(current.pointerId)) pet.releasePointerCapture(current.pointerId);
  try {
    await current.ready;
    const moved = await window.mochi.endPetDrag();
    if (!cancelled && !moved) await window.mochi.toggle();
  } catch { reportError(); }
  finally { settling = false; }
}
pet.addEventListener('pointerup', event => { if (event.pointerId === gesture?.pointerId) finishGesture(); });
pet.addEventListener('pointercancel', () => finishGesture(true));
pet.addEventListener('lostpointercapture', () => finishGesture(true));
window.addEventListener('blur', () => finishGesture(true));
window.addEventListener('pagehide', () => { window.mochi.endPetDrag().catch(() => {}); });
// Pointer gestures are handled above; keep keyboard and accessibility activation working.
pet.addEventListener('click', event => { if (event.detail === 0) window.mochi.toggle().catch(reportError); });
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
