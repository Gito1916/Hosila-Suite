import { getRenderedScheme } from './theme.js';

/**
 * Dual-Layer Hero Stage (Pure Vanilla JS ES Module):
 * 1) Antigravity-inspired ultra-fast mouse-tracking vector capsule/dash field (2D HiDPI Canvas)
 * 2) Three.js 4-slab extruded Hosila "H" Emblem with dual-theme physical materials
 *
 * Note: Plays by default even when Windows Server/Administrator sets OS ClientAreaAnimation=False;
 * controlled explicitly via the accessible Pause / Play motion toggle (persisted in localStorage).
 */
export function initHeroStage() {
  const stage = document.querySelector('[data-hero-stage]');
  const fieldCanvas = document.querySelector('[data-hero-field]');
  const emblemCanvas = document.querySelector('[data-hero-emblem]');
  const fallbackSvg = document.querySelector('[data-hero-fallback]');
  const pauseBtn = document.querySelector('[data-hero-pause]');
  const textShield = document.querySelector('[data-hero-copy]');

  if (!stage || !fieldCanvas) return;

  let userPaused = false;
  try {
    userPaused = localStorage.getItem('hosila-motion') === 'paused';
  } catch { }
  document.documentElement.dataset.motion = userPaused ? 'paused' : 'playing';

  let offScreenPaused = false;
  let tabHidden = document.hidden;
  let animFrameId = 0;

  const debugState = {
    frameCount: 0,
    emblemBooted: false,
    emblemStatus: 'init',
    emblemError: null,
    rotX: 0.08,
    rotY: -0.18,
    paused: userPaused,
    tiltActive: false,
  };
  window.__hosilaHeroDebug = debugState;

  // Pointer & mobile gyroscope state shared between Antigravity Field and 3D Emblem
  const pointer = {
    x: 0.72,
    y: 0.48,
    targetX: 0.72,
    targetY: 0.48,
    vx: 0,
    vy: 0,
    active: false,
    tiltActive: false,
  };

  const isMobileTiltDevice =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches &&
    'DeviceOrientationEvent' in window;

  if (isMobileTiltDevice) {
    let baseBeta = null;
    let tiltListening = false;

    const onDeviceOrientation = (e) => {
      if (userPaused || e.gamma == null || e.beta == null) return;
      if (baseBeta === null) {
        baseBeta = Math.max(15, Math.min(75, e.beta));
      }
      const nx = Math.max(0.05, Math.min(0.95, 0.5 + e.gamma / 64));
      const ny = Math.max(0.05, Math.min(0.95, 0.5 + (e.beta - baseBeta) / 56));
      pointer.targetX = nx;
      pointer.targetY = ny;
      pointer.active = true;
      pointer.tiltActive = true;
      debugState.tiltActive = true;
    };

    const startTiltListener = () => {
      if (tiltListening) return;
      tiltListening = true;
      window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
    };

    startTiltListener();

    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const requestTiltPermission = () => {
        DeviceOrientationEvent.requestPermission()
          .then((state) => {
            if (state === 'granted') startTiltListener();
          })
          .catch(() => {
            window.addEventListener('touchend', requestTiltPermission, { once: true, passive: true });
          });
      };
      requestTiltPermission();
    }
  }

  stage.addEventListener(
    'pointermove',
    (e) => {
      if (pointer.tiltActive && e.pointerType === 'touch') return;
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointer.targetX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      pointer.targetY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      pointer.active = true;
    },
    { passive: true }
  );

  stage.addEventListener(
    'pointerleave',
    () => {
      if (!pointer.tiltActive) pointer.active = false;
    },
    { passive: true }
  );

  // ── LAYER 1: Antigravity-Style Vector Capsule Field ──────────────────────
  const ctx = fieldCanvas.getContext('2d', { alpha: true });
  let width = 0;
  let height = 0;
  let dpr = 1;
  let particles = [];
  let textZone = { x: 0, y: 0, w: 0, h: 0 };

  function buildParticles() {
    const rect = stage.getBoundingClientRect();
    width = Math.max(320, rect.width);
    height = Math.max(480, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    fieldCanvas.width = Math.floor(width * dpr);
    fieldCanvas.height = Math.floor(height * dpr);
    fieldCanvas.style.width = `${width}px`;
    fieldCanvas.style.height = `${height}px`;

    if (textShield) {
      const tRect = textShield.getBoundingClientRect();
      textZone = {
        x: tRect.left - rect.left,
        y: tRect.top - rect.top,
        w: tRect.width,
        h: tRect.height,
      };
    }

    const spacing = width < 640 ? 44 : 38;
    const cols = Math.ceil(width / spacing) + 1;
    const rows = Math.ceil(height / spacing) + 1;
    particles = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const jx = ((Math.sin(r * 19.3 + c * 7.7) + 1) * 0.5 - 0.5) * spacing * 0.52;
        const jy = ((Math.cos(r * 11.1 + c * 23.9) + 1) * 0.5 - 0.5) * spacing * 0.52;
        const px = c * spacing + jx;
        const py = r * spacing + jy;
        const baseAngle = Math.atan2(py - height * 0.5, px - width * 0.72) + Math.PI * 0.5;
        particles.push({
          x: px,
          y: py,
          baseAngle,
          angle: baseAngle,
          len: 7.5 + ((r + c) % 3) * 2.5,
          alpha: 0.16,
          phase: (r * 0.41 + c * 0.27) % (Math.PI * 2),
          speed: 0.75 + ((r * 7 + c * 13) % 10) * 0.06,
        });
      }
    }
  }

  function renderField(nowSec, isDark) {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const mx = pointer.x * width;
    const my = pointer.y * height;
    const speedMag = Math.min(1.6, Math.hypot(pointer.vx, pointer.vy) * 28);
    const magnetRadius = width < 640 ? 195 : 290;
    const ringRadius = width < 640 ? 78 : 114;

    const baseRgb = isDark ? '242, 242, 247' : '29, 29, 31';
    const mintRgb = isDark ? '106, 212, 176' : '30, 134, 101';

    ctx.lineCap = 'round';

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const driftX = Math.sin(nowSec * p.speed + p.phase) * 3.5;
      const driftY = Math.cos(nowSec * p.speed * 0.85 + p.phase) * 3.5;
      const px = p.x + driftX;
      const py = p.y + driftY;

      const dx = px - mx;
      const dy = py - my;
      const dist = Math.hypot(dx, dy);

      let targetAngle = p.baseAngle + Math.sin(nowSec * 0.65 + p.phase) * 0.16;
      let targetAlpha = 0.15;
      let extraLen = 0;
      let mintMix = 0;
      let pushX = 0;
      let pushY = 0;

      if (dist < magnetRadius) {
        const norm = 1 - dist / magnetRadius;
        const smooth = norm * norm * (3 - 2 * norm);
        const angleToCursor = Math.atan2(dy, dx);
        const ringDelta = dist - ringRadius;
        const swirlOffset = Math.max(-1, Math.min(1, ringDelta / ringRadius)) * 0.55;
        targetAngle = angleToCursor + Math.PI * 0.5 + swirlOffset;

        const radialForce = -ringDelta * 0.12 * smooth;
        const ux = dist > 0.001 ? dx / dist : 0;
        const uy = dist > 0.001 ? dy / dist : 0;
        pushX = ux * radialForce;
        pushY = uy * radialForce;

        mintMix = smooth;
        targetAlpha = 0.18 + smooth * 0.68;
        extraLen = smooth * (4.8 + speedMag * 4);
      }

      let diff = targetAngle - p.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      p.angle += diff * 0.2;
      p.alpha += (targetAlpha - p.alpha) * 0.18;

      let copyAttenuation = 1;
      if (
        textZone.w > 0 &&
        px > textZone.x - 36 &&
        px < textZone.x + textZone.w + 36 &&
        py > textZone.y - 28 &&
        py < textZone.y + textZone.h + 28
      ) {
        copyAttenuation = 0.28;
      }

      const drawX = px + pushX;
      const drawY = py + pushY;
      const half = (p.len + extraLen) * 0.5;
      const cos = Math.cos(p.angle);
      const sin = Math.sin(p.angle);

      ctx.strokeStyle =
        mintMix > 0.16
          ? `rgba(${mintRgb}, ${(p.alpha * copyAttenuation).toFixed(3)})`
          : `rgba(${baseRgb}, ${(p.alpha * copyAttenuation).toFixed(3)})`;
      ctx.lineWidth = 1.65 + mintMix * 0.8;
      ctx.beginPath();
      ctx.moveTo(drawX - cos * half, drawY - sin * half);
      ctx.lineTo(drawX + cos * half, drawY + sin * half);
      ctx.stroke();
    }
  }

  // ── LAYER 2: Native ES Module Three.js 4-Slab Hosila "H" Emblem ──────────
  let threeState = null;

  async function bootThreeEmblem() {
    if (!emblemCanvas || userPaused || threeState) return;
    try {
      debugState.emblemStatus = 'importing';
      const THREE = await import('/vendor/three/three.module.min.js');
      debugState.emblemStatus = 'creating-renderer';
      const container = emblemCanvas.parentElement;
      if (!container) return;

      const renderer = new THREE.WebGLRenderer({
        canvas: emblemCanvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
      camera.position.set(0.35, 0.2, 8.2);

      const ambient = new THREE.AmbientLight(0xffffff, 1.35);
      scene.add(ambient);

      const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
      keyLight.position.set(5, 7, 6);
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0x6ad4b0, 1.6);
      rimLight.position.set(-5, -3, 4);
      scene.add(rimLight);

      const fillLight = new THREE.PointLight(0x21c29c, 2.4, 20);
      fillLight.position.set(2.5, -2.5, 4.5);
      scene.add(fillLight);

      const rawPolygons = [
        {
          pts: [
            [-1.56, -1.26],
            [-0.78, -0.77],
            [-0.77, 0.94],
            [-1.55, 0.45],
          ],
          zOffset: -0.22,
          mintPrimary: false,
        },
        {
          pts: [
            [-0.36, 0.22],
            [0.42, 0.22],
            [0.42, 1.93],
            [-0.36, 1.44],
          ],
          zOffset: 0.12,
          mintPrimary: true,
        },
        {
          pts: [
            [-0.36, -1.91],
            [0.42, -1.42],
            [0.42, -0.09],
            [-0.36, -0.09],
          ],
          zOffset: 0.12,
          mintPrimary: true,
        },
        {
          pts: [
            [0.80, -0.79],
            [1.58, -0.30],
            [1.59, 1.41],
            [0.81, 0.92],
          ],
          zOffset: 0.28,
          mintPrimary: false,
        },
      ];

      const group = new THREE.Group();
      scene.add(group);

      const faceMatDark = new THREE.MeshPhysicalMaterial({
        color: 0x1e2025,
        roughness: 0.34,
        metalness: 0.62,
        clearcoat: 0.42,
        clearcoatRoughness: 0.25,
      });

      const faceMatLight = new THREE.MeshPhysicalMaterial({
        color: 0xf4f5f7,
        roughness: 0.26,
        metalness: 0.12,
        clearcoat: 0.55,
        clearcoatRoughness: 0.18,
      });

      const mintMat = new THREE.MeshPhysicalMaterial({
        color: 0x21c29c,
        emissive: 0x0b3a2e,
        emissiveIntensity: 0.25,
        roughness: 0.28,
        metalness: 0.25,
        clearcoat: 0.5,
      });

      const slabMeshes = [];

      rawPolygons.forEach((poly, idx) => {
        const shape = new THREE.Shape();
        shape.moveTo(poly.pts[0][0], poly.pts[0][1]);
        for (let i = 1; i < poly.pts.length; i++) {
          shape.lineTo(poly.pts[i][0], poly.pts[i][1]);
        }
        shape.closePath();

        const geom = new THREE.ExtrudeGeometry(shape, {
          depth: 0.36,
          bevelEnabled: true,
          bevelThickness: 0.045,
          bevelSize: 0.032,
          bevelSegments: 4,
        });

        const isDark = getRenderedScheme() === 'dark';
        const faceMat = poly.mintPrimary ? mintMat : isDark ? faceMatDark : faceMatLight;
        const mesh = new THREE.Mesh(geom, [faceMat, mintMat]);
        mesh.position.z = poly.zOffset - 0.18;
        group.add(mesh);
        slabMeshes.push({ mesh, baseZ: poly.zOffset - 0.18, idx, mintPrimary: poly.mintPrimary });
      });

      let rotX = 0.08;
      let rotY = -0.18;
      let velX = 0;
      let velY = 0;

      function resize() {
        const w = Math.max(240, container.clientWidth);
        const h = Math.max(240, container.clientHeight);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }

      function updateTheme(isDark) {
        const nextFace = isDark ? faceMatDark : faceMatLight;
        slabMeshes.forEach((s) => {
          if (!s.mintPrimary) {
            s.mesh.material = [nextFace, mintMat];
          }
        });
        mintMat.emissiveIntensity = isDark ? 0.32 : 0.12;
        ambient.intensity = isDark ? 1.25 : 1.55;
      }

      function renderFrame(nowSec, px, py) {
        const yGain = pointer.tiltActive ? 0.72 : 0.48;
        const xGain = pointer.tiltActive ? -0.5 : -0.32;
        const targetRotY = (px - 0.5) * yGain + Math.sin(nowSec * 0.6) * 0.09;
        const targetRotX = (py - 0.5) * xGain + Math.cos(nowSec * 0.45) * 0.06;

        const stiffness = 0.13;
        const damping = 0.72;
        velX = (velX + (targetRotX - rotX) * stiffness) * damping;
        velY = (velY + (targetRotY - rotY) * stiffness) * damping;
        rotX += velX;
        rotY += velY;

        group.rotation.x = rotX;
        group.rotation.y = rotY;
        group.position.y = Math.sin(nowSec * 0.85) * 0.065;

        slabMeshes.forEach((s) => {
          s.mesh.position.z = s.baseZ + Math.sin(nowSec * 1.15 + s.idx * 0.9) * 0.04;
        });

        debugState.rotX = Number(rotX.toFixed(4));
        debugState.rotY = Number(rotY.toFixed(4));
        renderer.render(scene, camera);
      }

      resize();
      updateTheme(getRenderedScheme() === 'dark');
      renderFrame(0, pointer.x, pointer.y);

      emblemCanvas.style.opacity = '1';
      if (fallbackSvg) {
        fallbackSvg.style.opacity = '0';
        fallbackSvg.style.pointerEvents = 'none';
      }

      debugState.emblemStatus = 'ready';
      debugState.emblemBooted = true;
      threeState = {
        renderFrame,
        updateTheme,
        resize,
        dispose: () => renderer.dispose(),
      };
    } catch (err) {
      debugState.emblemBooted = false;
      debugState.emblemError = err instanceof Error ? err.message : String(err);
    }
  }

  function syncPauseButtonUI() {
    if (!pauseBtn) return;
    pauseBtn.setAttribute('aria-label', userPaused ? 'Play hero animation' : 'Pause hero animation');
    pauseBtn.setAttribute('aria-pressed', String(userPaused));
    const labelEl = pauseBtn.querySelector('[data-pause-label]');
    const iconPause = pauseBtn.querySelector('[data-icon-pause]');
    const iconPlay = pauseBtn.querySelector('[data-icon-play]');
    if (labelEl) labelEl.textContent = userPaused ? 'Play motion' : 'Pause motion';
    if (iconPause) iconPause.toggleAttribute('hidden', userPaused);
    if (iconPlay) iconPlay.toggleAttribute('hidden', !userPaused);
  }

  function shouldRun() {
    return !userPaused && !offScreenPaused && !tabHidden;
  }

  let lastTime = performance.now();

  function tick(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    const nowSec = now * 0.001;

    if (!pointer.active) {
      pointer.targetX = 0.7 + Math.sin(nowSec * 0.5) * 0.14;
      pointer.targetY = 0.48 + Math.cos(nowSec * 0.38) * 0.12;
    }

    const prevX = pointer.x;
    const prevY = pointer.y;
    const lerpSpeed = 1 - Math.exp(-14 * dt);
    pointer.x += (pointer.targetX - pointer.x) * lerpSpeed;
    pointer.y += (pointer.targetY - pointer.y) * lerpSpeed;
    pointer.vx = pointer.x - prevX;
    pointer.vy = pointer.y - prevY;

    const isDark = getRenderedScheme() === 'dark';
    renderField(nowSec, isDark);
    threeState?.renderFrame(nowSec, pointer.x, pointer.y);
    debugState.frameCount += 1;

    if (shouldRun()) {
      animFrameId = requestAnimationFrame(tick);
    } else {
      animFrameId = 0;
    }
  }

  function startLoop() {
    if (!animFrameId && shouldRun()) {
      lastTime = performance.now();
      animFrameId = requestAnimationFrame(tick);
    }
  }

  function stopLoop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = 0;
    }
  }

  function drawStaticSnapshot() {
    renderField(0, getRenderedScheme() === 'dark');
    threeState?.renderFrame(0, 0.5, 0.5);
  }

  buildParticles();
  drawStaticSnapshot();
  syncPauseButtonUI();

  pauseBtn?.addEventListener('click', () => {
    userPaused = !userPaused;
    debugState.paused = userPaused;
    document.documentElement.dataset.motion = userPaused ? 'paused' : 'playing';
    try {
      localStorage.setItem('hosila-motion', userPaused ? 'paused' : 'playing');
    } catch { }
    syncPauseButtonUI();

    if (userPaused) {
      stopLoop();
    } else {
      bootThreeEmblem();
      startLoop();
    }
  });

  if ('oncontentvisibilityautostatechange' in window) {
    stage.addEventListener('contentvisibilityautostatechange', (e) => {
      offScreenPaused = Boolean(e?.skipped);
      if (offScreenPaused) stopLoop();
      else startLoop();
    });
  }

  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      offScreenPaused = !visible;
      if (offScreenPaused) stopLoop();
      else startLoop();
    },
    { threshold: 0.01 }
  );
  io.observe(stage);

  document.addEventListener('visibilitychange', () => {
    tabHidden = document.hidden;
    if (tabHidden) stopLoop();
    else startLoop();
  });

  window.addEventListener('hosila:themechange', (ev) => {
    const isDark = (ev?.detail?.scheme ?? getRenderedScheme()) === 'dark';
    threeState?.updateTheme(isDark);
    if (!animFrameId) drawStaticSnapshot();
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      buildParticles();
      threeState?.resize();
      if (!animFrameId) drawStaticSnapshot();
    }, 120);
  });

  if (shouldRun()) {
    startLoop();
  }
  if (!userPaused) {
    bootThreeEmblem();
  }
}
