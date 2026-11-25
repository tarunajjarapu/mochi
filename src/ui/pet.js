const pet = document.querySelector('#pet');
const bubble = document.querySelector('#mood');
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
let gesture, settling = false, scene, mood = 'idle', bubbleTimer, bubbleKind, happyTimer, receivedMood = false;

function say(text, duration = 5500, kind = 'status') {
  clearTimeout(bubbleTimer);
  bubbleKind = kind;
  bubble.textContent = text;
  bubble.title = text;
  bubble.classList.toggle('visible', !!text);
  if (text) bubbleTimer = setTimeout(() => { bubble.classList.remove('visible'); bubble.textContent = ''; }, duration);
}
function setMood(next) {
  if (!['idle', 'thinking', 'waiting', 'happy'].includes(next)) next = 'idle';
  clearTimeout(happyTimer);
  if (mood === 'waiting' && next !== 'waiting' && bubbleKind === 'permission') say('');
  // A small celebration when a task finishes, then back to resting.
  if (next === 'idle' && (mood === 'thinking' || mood === 'waiting')) next = 'happy';
  mood = next;
  document.body.dataset.mood = next;
  scene?.setMood(next);
  pet.setAttribute('aria-label', next === 'waiting' ? 'Mochi needs permission. Open chat' : next === 'thinking' ? 'Mochi is thinking. Open chat' : 'Talk to Mochi');
  if (next === 'waiting') say('A little permission?', 5500, 'permission');
  if (next === 'happy') happyTimer = setTimeout(() => setMood('idle'), 2800);
}
const reportError = () => say('Try moving me again');
pet.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary || gesture || settling) return;
  event.preventDefault();
  pet.focus({ preventScroll: true });
  pet.setPointerCapture(event.pointerId);
  const current = { pointerId: event.pointerId, ready: window.mochi.beginPetDrag() };
  gesture = current; pet.classList.add('dragging'); scene?.setHeld(true);
  current.ready.catch(() => { if (gesture === current) finishGesture(true); });
});
async function finishGesture(cancelled = false) {
  const current = gesture;
  if (!current) return;
  gesture = null; settling = true; pet.classList.remove('dragging'); scene?.setHeld(false);
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
pet.addEventListener('pointermove', event => {
  const bounds = pet.getBoundingClientRect();
  scene?.lookAt((event.clientX - bounds.left) / bounds.width * 2 - 1, (event.clientY - bounds.top) / bounds.height * 2 - 1);
});
pet.addEventListener('pointerleave', () => scene?.lookAt(null));
window.addEventListener('blur', () => { finishGesture(true); scene?.lookAt(null); });
window.addEventListener('pagehide', () => {
  clearTimeout(bubbleTimer); clearTimeout(happyTimer); scene?.dispose();
  window.mochi.endPetDrag().catch(() => {});
});
// Pointer gestures are handled above; keep keyboard and accessibility activation working.
pet.addEventListener('click', event => {
  if (event.detail === 0) { scene?.perk(); window.mochi.toggle().catch(reportError); }
});
window.mochi.onEvent(event => {
  if (event.type === 'mood') { receivedMood = true; setMood(event.mood); }
  if (event.type === 'reminder') {
    say(event.text, 9000, 'reminder');
    // A reminder must not replace an ongoing task or approval pose.
    if (mood === 'idle' || mood === 'happy') setMood('happy');
    else scene?.perk();
  }
  if (event.type === 'error') say('Something needs a look. Open chat.', 7000);
});
window.mochi.state().then(state => { if (!receivedMood && state.busy) setMood('thinking'); }).catch(() => {});
motion.addEventListener('change', () => scene?.setReducedMotion(motion.matches));

// Dragging and chat remain usable if WebGL is unavailable or a module fails to load.
import('./pet-scene.mjs').then(({ createPetScene }) => {
  scene = createPetScene(document.querySelector('#scene'), { reducedMotion: motion.matches });
  scene.setMood(mood); scene.setHeld(!!gesture);
  document.body.dataset.renderer = 'webgl';
}).catch(error => {
  document.body.dataset.renderer = 'css';
  console.warn('Mochi is using its CSS appearance:', error.message);
});
