import * as THREE from '../../node_modules/three/build/three.module.js';

// Everything is procedural and local: no model files, remote textures, or tracking.
export function createPetScene(canvas, { reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.6, 1.6, 2.94, -0.26, 0.1, 30);
  camera.position.set(0, 0.45, 7);
  camera.lookAt(0, 0, 0);
  const root = new THREE.Group();
  scene.add(root);

  // A small studio environment gives the clay a soft sheen without real-time shadows.
  const studio = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicMaterial({ color: 0xb8c1b1, side: THREE.BackSide }));
  studio.add(room);
  for (const [x, y, z, width, height, intensity] of [[-3, 4, 3, 3, 5, 4], [4, 1, 2, 2, 4, 2], [0, 4, -3, 3, 2, 3]]) {
    const light = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity), side: THREE.DoubleSide }));
    light.position.set(x, y, z); light.lookAt(0, 1, 0); studio.add(light);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(studio, 0.06);
  scene.environment = environment.texture;
  studio.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xf6ffe8, 0x718359, 1.6));
  const key = new THREE.DirectionalLight(0xfff2d9, 2.5);
  key.position.set(-3, 5, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xe8f9da, 1.5);
  rim.position.set(3, 2, -3); scene.add(rim);

  const sphere = new THREE.SphereGeometry(1, 40, 28);
  const clay = new THREE.MeshPhysicalMaterial({ color: 0xa9c978, roughness: 0.48, clearcoat: 0.23, clearcoatRoughness: 0.45, envMapIntensity: 0.4 });
  const inner = new THREE.MeshStandardMaterial({ color: 0x96b76c, roughness: 0.7, envMapIntensity: 0.25 });
  const ink = new THREE.MeshPhysicalMaterial({ color: 0x243522, roughness: 0.2, clearcoat: 1, envMapIntensity: 0.7 });
  const mouthMaterial = new THREE.MeshStandardMaterial({ color: 0x42583a, roughness: 0.6 });
  const cheek = new THREE.MeshStandardMaterial({ color: 0xe6aa91, roughness: 0.85, transparent: true, opacity: 0.55 });
  const glint = new THREE.MeshBasicMaterial({ color: 0xfffbea });
  const moteMaterial = new THREE.MeshStandardMaterial({ color: 0xd5e9a9, roughness: 0.4, emissive: 0x536729, emissiveIntensity: 0.18 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xf4ce79, roughness: 0.35, emissive: 0xb28338, emissiveIntensity: 0.2 });
  function ellipsoid(parent, material, position, scale) {
    const mesh = new THREE.Mesh(sphere, material);
    mesh.position.set(...position); mesh.scale.set(...scale); parent.add(mesh); return mesh;
  }
  function curve(parent, points, radius, material) {
    const path = new THREE.QuadraticBezierCurve3(...points.map(p => new THREE.Vector3(...p)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, 16, radius, 8, false), material);
    parent.add(mesh); return mesh;
  }
  ellipsoid(root, clay, [0, 0.87, 0], [0.83, 0.75, 0.6]);
  const ears = [-1, 1].map(side => {
    const pivot = new THREE.Group(); pivot.position.set(side * 0.39, 1.4, -0.04); root.add(pivot);
    ellipsoid(pivot, clay, [0, 0.45, 0], [0.23, 0.61, 0.19]);
    ellipsoid(pivot, inner, [0, 0.48, 0.19], [0.105, 0.38, 0.035]);
    return pivot;
  });
  const feet = [-1, 1].map(side => ellipsoid(root, clay, [side * 0.39, 0.17, 0.22], [0.27, 0.155, 0.34]));
  const arms = [-1, 1].map(side => {
    const arm = ellipsoid(root, clay, [side * 0.75, 0.65, 0.04], [0.17, 0.28, 0.22]);
    arm.rotation.z = side * 0.25; return arm;
  });
  const face = new THREE.Group(); root.add(face);
  const eyes = [-1, 1].map(side => {
    const eye = new THREE.Group(); eye.position.set(side * 0.265, 1.015, 0.559); face.add(eye);
    ellipsoid(eye, ink, [0, 0, 0], [0.071, 0.105, 0.048]);
    ellipsoid(eye, glint, [-0.018, 0.031, 0.045], [0.018, 0.023, 0.008]);
    return eye;
  });
  const happyEyes = [-1, 1].map(side => curve(face, [[side * 0.265 - 0.067, 0.99, 0.595], [side * 0.265, 1.1, 0.6], [side * 0.265 + 0.067, 0.99, 0.595]], 0.019, mouthMaterial));
  for (const side of [-1, 1]) ellipsoid(root, cheek, [side * 0.46, 0.83, 0.502], [0.12, 0.063, 0.022]);
  curve(face, [[-0.095, 0.84, 0.603], [0, 0.715, 0.613], [0.095, 0.84, 0.603]], 0.017, mouthMaterial);

  const thoughts = new THREE.Group(); scene.add(thoughts);
  const dots = [0, 1, 2].map(i => ellipsoid(thoughts, moteMaterial, [(i - 1) * 0.19, 2.65, 0], [0.043, 0.043, 0.043]));
  const sparkles = [-1, 1].map(side => {
    const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), gold);
    spark.position.set(side * 1.08, 1.55, 0); scene.add(spark); return spark;
  });
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 64;
  const context = shadowCanvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(40, 60, 22, .25)'); gradient.addColorStop(0.4, 'rgba(40, 60, 22, .14)'); gradient.addColorStop(1, 'rgba(40, 60, 22, 0)');
  context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.5), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.85 }));
  shadow.position.set(0, 0.07, -0.4); scene.add(shadow);

  let disposed = false, contextLost = false, mood = 'idle', held = false, pointer = null;
  let elapsed = 0, lastFrame = 0, blinkAt = 1.5, blinkStart = -10, glanceAt = 3, glance = 0, perkAt = -10;
  let nextPerk = 9, happyStart = 0, yaw = 0, tilt = 0, lift = 0, stretch = 1;
  const clamp = THREE.MathUtils.clamp;
  const damp = (value, target, dt, speed = 7) => reducedMotion ? target : THREE.MathUtils.damp(value, target, speed, dt);
  function draw(dt = 1 / 30) {
    const t = reducedMotion ? 0 : elapsed;
    if (!reducedMotion && t > blinkAt) {
      blinkStart = t; blinkAt = t + (Math.random() < 0.18 ? 0.32 : 2.5 + Math.random() * 4);
    }
    if (t > glanceAt) { glance = (Math.random() - 0.5) * 0.8; glanceAt = t + 3 + Math.random() * 5; }
    if (mood === 'idle' && !held && t > nextPerk) { perkAt = t; nextPerk = t + 10 + Math.random() * 10; }
    const blinkPhase = (t - blinkStart) / 0.17;
    const blink = reducedMotion || blinkPhase >= 1 ? 1 : Math.max(0.07, 1 - Math.sin(blinkPhase * Math.PI));
    const thinking = mood === 'thinking', waiting = mood === 'waiting', happy = mood === 'happy';
    const breath = reducedMotion ? 0 : Math.sin(t * 1.65) * 0.014;
    const perkPhase = (t - perkAt) / 0.65;
    const perk = !reducedMotion && perkPhase >= 0 && perkPhase <= 1 ? Math.sin(perkPhase * Math.PI) : 0;
    const hop = happy && !reducedMotion ? Math.max(0, Math.sin((t - happyStart) * 9)) * 0.2 * Math.exp(-(t - happyStart) * 0.55) : 0;
    const lookX = reducedMotion ? 0 : pointer?.x ?? glance;
    const lookY = reducedMotion ? 0 : pointer?.y ?? (thinking ? -0.5 : 0);
    yaw = damp(yaw, 0.12 + lookX * 0.22 + (thinking && !reducedMotion ? Math.sin(t * 1.8) * 0.1 : 0), dt);
    tilt = damp(tilt, held ? Math.sin(t * 4) * 0.1 - 0.08 : waiting ? 0.13 : -lookX * 0.04 + (thinking ? 0.06 : 0), dt);
    lift = damp(lift, held ? 0.18 : hop + perk * 0.055, dt, 14);
    stretch = damp(stretch, held ? 1.065 : 1 + breath - perk * 0.025, dt, 12);
    root.position.y = lift;
    root.rotation.set(lookY * 0.06, yaw, tilt);
    root.scale.set(1 / Math.sqrt(stretch), stretch, 1);
    ears.forEach((ear, i) => {
      const side = i === 0 ? -1 : 1;
      const sway = reducedMotion ? 0 : Math.sin(t * 2.1 + i * 1.3) * 0.035 + Math.sin(t * 4 + i) * perk * 0.14;
      ear.rotation.z = damp(ear.rotation.z, -side * (held ? 0.12 : 0.28) + sway + (waiting && i === 1 ? -0.23 : 0) + (thinking && i === 0 ? 0.15 : 0), dt, 9);
      ear.rotation.x = damp(ear.rotation.x, held ? -0.2 : 0.03 + perk * 0.12, dt);
    });
    feet.forEach((foot, i) => { foot.rotation.x = damp(foot.rotation.x, held ? 0.45 : -hop * 1.5, dt); foot.rotation.z = (i ? 1 : -1) * 0.1; });
    arms.forEach((arm, i) => { arm.rotation.z = damp(arm.rotation.z, (i ? 1 : -1) * (held ? 0.05 : happy ? 0.8 : 0.25), dt); });
    face.position.set(lookX * 0.027, -lookY * 0.017, 0);
    eyes.forEach(eye => { eye.visible = !happy; eye.scale.y = blink; });
    happyEyes.forEach(eye => { eye.visible = happy; });
    thoughts.visible = thinking;
    dots.forEach((dot, i) => { dot.position.y = 2.65 + (reducedMotion ? 0 : Math.sin(t * 4 - i * 0.8) * 0.055); });
    sparkles.forEach((spark, i) => {
      spark.visible = happy || (waiting && i === 1);
      spark.position.y = (waiting ? 2.05 : 1.55) + (reducedMotion ? 0 : Math.sin(t * 3 + i) * 0.08);
      spark.rotation.z = reducedMotion ? 0 : t * 0.6;
      spark.scale.setScalar(waiting ? 0.75 : 1);
    });
    shadow.scale.x = 1 - lift * 0.45; shadow.material.opacity = 0.85 - lift;
    renderer.render(scene, camera);
  }
  function animate(now) {
    if (now - lastFrame < 1000 / 30) return;
    const dt = Math.min((now - lastFrame) / 1000, 0.06);
    lastFrame = now; elapsed += dt; draw(dt);
  }
  function resume() {
    renderer.setAnimationLoop(null);
    if (disposed || contextLost || document.hidden) return;
    draw(); lastFrame = performance.now();
    if (!reducedMotion) renderer.setAnimationLoop(animate);
  }
  function resize() {
    if (disposed || contextLost) return;
    const width = canvas.clientWidth || 190, height = canvas.clientHeight || 190;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    const halfWidth = 1.6 * width / height;
    camera.left = -halfWidth; camera.right = halfWidth; camera.updateProjectionMatrix();
    if (!document.hidden) draw();
  }
  function loseContext(event) {
    event.preventDefault(); contextLost = true; renderer.setAnimationLoop(null);
    document.body.dataset.renderer = 'css';
  }
  function restoreContext() {
    contextLost = false; resize(); resume(); document.body.dataset.renderer = 'webgl';
  }
  document.addEventListener('visibilitychange', resume);
  canvas.addEventListener('webglcontextlost', loseContext);
  canvas.addEventListener('webglcontextrestored', restoreContext);
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  resize(); resume();
  const update = () => { if (reducedMotion && !disposed && !contextLost && !document.hidden) draw(); };
  return {
    setMood(next) { if (next === 'happy' && mood !== next) happyStart = elapsed; mood = next; update(); },
    setHeld(value) { if (held && !value) perkAt = elapsed; held = value; update(); },
    lookAt(x, y = 0) { pointer = x === null ? null : { x: clamp(x, -1, 1), y: clamp(y, -1, 1) }; },
    perk() { perkAt = elapsed; },
    setReducedMotion(value) { reducedMotion = value; resume(); },
    dispose() {
      if (disposed) return;
      disposed = true; renderer.setAnimationLoop(null); observer.disconnect();
      document.removeEventListener('visibilitychange', resume);
      canvas.removeEventListener('webglcontextlost', loseContext);
      canvas.removeEventListener('webglcontextrestored', restoreContext);
      const geometries = new Set(), materials = new Set();
      scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material); });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      shadowTexture.dispose(); environment.dispose(); renderer.dispose();
    },
  };
}
