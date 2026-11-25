/* global anime */
'use strict';

(function () {
  const LOAD_STEPS = [
    'STARTING ENGINE',
    'SEARCHING FOR PRIMES',
    'MILLER-RABIN PASSED',
    'COMPUTING MODULUS',
    'DERIVING D',
    'READY'
  ];

  const PIPE_POSITIONS = {
    candidate: 0,
    prime: 20,
    modulus: 40,
    exponent: 60,
    encrypt: 80,
    decrypt: 100
  };

  const state = {
    jobId: createJobId(),
    keys: {
      n: null,
      e: null,
      d: null
    },
    currentOp: 'idle',
    busy: false,
    needleAngle: 0,
    pipePercent: 0,
    eventCount: 0,
    eventSource: null,
    sseReadyPromise: null
  };

  // DOM Elements
  const curtainEl = document.querySelector('.load-curtain');
  const loadNumEl = document.querySelector('.load-num');
  const loadStepTextEl = document.getElementById('loadStepText');
  const loadCursorEl = document.getElementById('loadCursor');

  const apiPillEl = document.getElementById('apiPill');
  const apiStatusEl = document.getElementById('apiStatus');
  const apiLatencyEl = document.getElementById('apiLatency');

  const keyBitsEl = document.getElementById('keyBits');
  const generateBtnEl = document.getElementById('generateBtn');
  const msgInputEl = document.getElementById('msgInput');
  const encryptBtnEl = document.getElementById('encryptBtn');
  const cipherInputEl = document.getElementById('cipherInput');
  const decryptBtnEl = document.getElementById('decryptBtn');
  const errorBannerEl = document.getElementById('errorBanner');

  const pValEl = document.getElementById('pVal');
  const qValEl = document.getElementById('qVal');
  const nValEl = document.getElementById('nVal');
  const phiValEl = document.getElementById('phiVal');
  const eValEl = document.getElementById('eVal');
  const dValEl = document.getElementById('dVal');
  const nDigitsEl = document.getElementById('nDigits');
  const keyMetaBadgeEl = document.getElementById('keyMetaBadge');

  const mValEl = document.getElementById('mVal');
  const cValEl = document.getElementById('cVal');
  const plainValEl = document.getElementById('plainVal');
  const verifyNoteEl = document.getElementById('verifyNote');

  const traceListEl = document.getElementById('traceList');
  const traceModeLabelEl = document.getElementById('traceModeLabel');
  const eventLogEl = document.getElementById('eventLog');
  const logCountEl = document.getElementById('logCount');

  const clockNeedleEl = document.getElementById('clockNeedle');
  const clockAngleValEl = document.getElementById('clockAngleVal');
  const pipeDotEl = document.getElementById('pipeDot');
  const pipeNodes = Array.from(document.querySelectorAll('.pipe-node'));
  const activeStageLabelEl = document.getElementById('activeStageLabel');

  const presentBtnEl = document.getElementById('presentBtn');
  const presentCaptionEl = document.getElementById('presentCaption');
  const encryptInstrumentEl = document.getElementById('encryptInstrument');
  const decryptInstrumentEl = document.getElementById('decryptInstrument');

  function createJobId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'td-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function reducedMotionPreferred() {
    return Boolean(
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function formatTimestamp() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  // Section 2: Loading Curtain driven by anime.js
  function runLoadingSequence() {
    if (reducedMotionPreferred() || typeof anime !== 'function') {
      if (curtainEl) {
        curtainEl.style.display = 'none';
      }
      document.querySelectorAll('[data-enter]').forEach((el) => {
        el.style.opacity = '1';
        el.style.transform = 'none';
      });
      return;
    }

    if (loadCursorEl) {
      anime({
        targets: loadCursorEl,
        opacity: [1, 0],
        duration: 460,
        direction: 'alternate',
        loop: true,
        easing: 'steps(1)'
      });
    }

    const syncReadout = () => {
      if (!loadNumEl) return;
      const numeric = Math.max(0, Math.min(100, parseInt(loadNumEl.textContent, 10) || 0));
      loadNumEl.textContent = String(numeric).padStart(3, '0');
      if (loadStepTextEl) {
        if (numeric >= 98) {
          loadStepTextEl.textContent = 'READY';
        } else {
          const stepIndex = Math.min(
            LOAD_STEPS.length - 1,
            Math.floor((numeric / 100) * LOAD_STEPS.length)
          );
          loadStepTextEl.textContent = LOAD_STEPS[stepIndex];
        }
      }
    };

    const tl = anime.timeline({
      easing: 'easeOutExpo',
      update: syncReadout
    });

    tl.add({
      targets: '.load-rule',
      scaleX: [0, 1],
      duration: 1200
    })
      .add(
        {
          targets: '.load-num',
          innerHTML: [0, 100],
          round: 1,
          duration: 1200,
          easing: 'linear',
          update: syncReadout
        },
        0
      )
      .add(
        {
          targets: '.load-curtain',
          translateY: ['0%', '-100%'],
          duration: 750,
          easing: 'easeInOutQuart'
        },
        '+=180'
      )
      .add(
        {
          targets: '[data-enter]',
          translateY: [18, 0],
          opacity: [0, 1],
          delay: anime.stagger(70),
          duration: 650
        },
        '-=420'
      )
      .add({
        targets: '.load-curtain',
        display: 'none',
        duration: 1,
        complete: () => {
          if (loadCursorEl) {
            anime.remove(loadCursorEl);
          }
          if (curtainEl) {
            curtainEl.style.display = 'none';
          }
        }
      });
  }

  // Health check
  async function checkHealth() {
    const t0 = performance.now();
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      const data = await res.json();
      const pingMs = Math.max(1, Math.round(performance.now() - t0));
      if (res.ok && data.ok) {
        apiPillEl.classList.remove('bad');
        apiStatusEl.textContent = `ONLINE · ${data.engine}`;
        if (apiLatencyEl.textContent.startsWith('--')) {
          apiLatencyEl.textContent = `${pingMs} MS`;
        }
      } else {
        throw new Error('Unhealthy response');
      }
    } catch (_err) {
      apiPillEl.classList.add('bad');
      apiStatusEl.textContent = 'ENGINE OFFLINE';
    }
  }

  // SSE stream connection
  function connectSse() {
    if (state.eventSource && state.eventSource.readyState !== EventSource.CLOSED) {
      return state.sseReadyPromise;
    }

    state.sseReadyPromise = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      const fallbackTimer = setTimeout(finish, 450);
      const es = new EventSource(`/api/events?id=${encodeURIComponent(state.jobId)}`);
      state.eventSource = es;

      es.onopen = () => {
        clearTimeout(fallbackTimer);
        finish();
      };

      es.onerror = () => {
        clearTimeout(fallbackTimer);
        finish();
      };

      es.addEventListener('stage', (ev) => {
        try {
          const payload = JSON.parse(ev.data);
          handleStageEvent(payload.stage, payload.message);
        } catch (_err) {
          // Ignore malformed SSE frames
        }
      });
    });

    return state.sseReadyPromise;
  }

  function mapStageToPipeNode(stage) {
    switch (stage) {
      case 'candidate':
        return 'candidate';
      case 'prime-p':
      case 'prime-q':
        return 'prime';
      case 'modulus':
      case 'totient':
        return 'modulus';
      case 'public-e':
      case 'private-d':
        return 'exponent';
      case 'encode':
        return 'encrypt';
      case 'decode':
        return 'decrypt';
      case 'pow':
        return state.currentOp === 'decrypt' ? 'decrypt' : 'encrypt';
      case 'done':
        if (state.currentOp === 'keys') return 'exponent';
        if (state.currentOp === 'decrypt') return 'decrypt';
        return 'encrypt';
      default:
        return null;
    }
  }

  function advancePipeline(stepKey) {
    if (!stepKey || !(stepKey in PIPE_POSITIONS)) return;

    pipeNodes.forEach((node) => {
      node.classList.toggle('active', node.getAttribute('data-step') === stepKey);
    });

    const nextPct = PIPE_POSITIONS[stepKey];
    const prevPct = state.pipePercent;
    state.pipePercent = nextPct;

    if (pipeDotEl && typeof anime === 'function' && !reducedMotionPreferred()) {
      anime.remove(pipeDotEl);
      anime({
        targets: pipeDotEl,
        left: [`${prevPct}%`, `${nextPct}%`],
        duration: 540,
        easing: 'easeInOutSine'
      });
    } else if (pipeDotEl) {
      pipeDotEl.style.left = `${nextPct}%`;
    }
  }

  function appendLogRow(stage, message, isError) {
    if (!eventLogEl) return;

    const placeholder = eventLogEl.querySelector('.muted-row');
    if (placeholder) {
      placeholder.remove();
    }

    state.eventCount += 1;
    if (logCountEl) {
      logCountEl.textContent = `${String(state.eventCount).padStart(2, '0')} EVENTS`;
    }

    const row = document.createElement('div');
    row.className = isError ? 'log-row bad' : 'log-row';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = formatTimestamp();

    const msgWrap = document.createElement('span');
    msgWrap.className = 'log-msg';

    if (stage) {
      const tag = document.createElement('span');
      tag.className = 'log-stage-tag';
      tag.textContent = `[${stage}]`;
      msgWrap.appendChild(tag);
    }

    msgWrap.appendChild(document.createTextNode(message));
    row.appendChild(timeSpan);
    row.appendChild(msgWrap);

    eventLogEl.appendChild(row);
    eventLogEl.scrollTop = eventLogEl.scrollHeight;

    if (typeof anime === 'function' && !reducedMotionPreferred()) {
      anime.remove(row);
      anime({
        targets: row,
        translateX: [-14, 0],
        opacity: [0, 1],
        duration: 320,
        easing: 'easeOutQuad'
      });
    }
  }

  function handleStageEvent(stage, message) {
    if (activeStageLabelEl) {
      activeStageLabelEl.textContent = `${String(stage).toUpperCase()} — ${message}`;
    }
    const nodeKey = mapStageToPipeNode(stage);
    if (nodeKey) {
      advancePipeline(nodeKey);
    }
    appendLogRow(stage, message, false);
  }

  // Modular clock rotation using base-10 string residue:
  // For any decimal integer string s, (s mod 1000) equals its final 3 decimal digits.
  function rotateClockNeedle(decimalString) {
    if (!clockNeedleEl || typeof decimalString !== 'string') return;
    const cleaned = decimalString.trim();
    if (!/^\d+$/.test(cleaned)) return;

    const mod1000 = parseInt(cleaned.slice(-3), 10) || 0;
    const nextAngle = 360 * (mod1000 / 1000);
    const prevAngle = state.needleAngle;
    state.needleAngle = nextAngle;

    if (clockAngleValEl) {
      clockAngleValEl.textContent = `${nextAngle.toFixed(1).padStart(5, '0')}\u00B0`;
    }

    if (typeof anime === 'function' && !reducedMotionPreferred()) {
      anime.remove(clockNeedleEl);
      anime({
        targets: clockNeedleEl,
        rotate: [prevAngle, nextAngle],
        duration: 700,
        easing: 'easeOutExpo'
      });
    } else {
      clockNeedleEl.style.transform = `rotate(${nextAngle}deg)`;
    }
  }

  function pulseFlash(elements) {
    const list = Array.isArray(elements) ? elements : [elements];
    list.forEach((el) => {
      if (!el) return;
      el.classList.add('flash');
      setTimeout(() => {
        el.classList.remove('flash');
      }, 620);
    });
  }

  function setError(message, badInputEl) {
    msgInputEl.classList.remove('bad');
    cipherInputEl.classList.remove('bad');

    if (!message) {
      errorBannerEl.textContent = '';
      errorBannerEl.classList.add('hidden');
      errorBannerEl.classList.remove('bad');
      return;
    }

    errorBannerEl.textContent = message;
    errorBannerEl.classList.remove('hidden');
    errorBannerEl.classList.add('bad');
    if (badInputEl) {
      badInputEl.classList.add('bad');
    }
    appendLogRow('error', message, true);
  }

  function setBusy(busy) {
    state.busy = busy;
    generateBtnEl.disabled = busy;
    encryptBtnEl.disabled = busy;
    decryptBtnEl.disabled = busy;
  }

  function renderTrace(trace, modeLabel) {
    if (!traceListEl) return;
    traceListEl.innerHTML = '';

    if (traceModeLabelEl) {
      traceModeLabelEl.textContent = modeLabel;
    }

    if (!Array.isArray(trace) || trace.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'trace-empty';
      empty.textContent = 'No iterations returned.';
      traceListEl.appendChild(empty);
      return;
    }

    const rows = [];
    trace.forEach((item) => {
      const row = document.createElement('div');
      const isOne = Number(item.bit) === 1;
      row.className = isOne ? 'trace-row bit-one' : 'trace-row';

      const iterCell = document.createElement('span');
      iterCell.textContent = `#${String(item.i).padStart(2, '0')}`;

      const bitCell = document.createElement('span');
      bitCell.className = isOne ? 'trace-bit-on' : 'trace-bit-off';
      bitCell.textContent = String(item.bit);

      const opCell = document.createElement('span');
      opCell.className = 'trace-op';
      opCell.textContent = isOne ? 'SQ + MUL' : 'SQ ONLY';

      const baseCell = document.createElement('span');
      baseCell.className = 'trace-num';
      baseCell.textContent = String(item.base);

      const accCell = document.createElement('span');
      accCell.className = 'trace-num';
      accCell.textContent = String(item.acc);

      row.appendChild(iterCell);
      row.appendChild(bitCell);
      row.appendChild(opCell);
      row.appendChild(baseCell);
      row.appendChild(accCell);

      traceListEl.appendChild(row);
      rows.push(row);
    });

    if (typeof anime === 'function' && !reducedMotionPreferred()) {
      anime.remove(rows);
      anime({
        targets: rows,
        translateX: [-14, 0],
        opacity: [0, 1],
        delay: anime.stagger(32),
        duration: 320,
        easing: 'easeOutQuad'
      });
    }
  }

  // Action: Generate Keys
  async function onGenerateKeys() {
    if (state.busy) return;
    setError(null);
    setBusy(true);
    state.currentOp = 'keys';

    try {
      await connectSse();
      const bits = Number(keyBitsEl.value) || 64;
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: state.jobId, bits })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Key generation failed.');
      }

      state.keys = {
        n: data.n,
        e: data.e,
        d: data.d
      };

      pValEl.textContent = data.p;
      qValEl.textContent = data.q;
      nValEl.textContent = data.n;
      phiValEl.textContent = data.phi;
      eValEl.textContent = data.e;
      dValEl.textContent = data.d;

      if (nDigitsEl) {
        nDigitsEl.textContent = `${data.n.length} DIGITS`;
      }
      if (keyMetaBadgeEl && data.meta) {
        keyMetaBadgeEl.textContent = `${data.meta.bits}-BIT PRIMES · n HAS ${data.n.length} DIGITS`;
      }
      if (data.meta && typeof data.meta.durationMs === 'number') {
        apiLatencyEl.textContent = `${data.meta.durationMs} MS`;
      }

      // Reset stale message readouts when switching to a fresh key pair
      mValEl.textContent = '—';
      cValEl.textContent = '—';
      plainValEl.textContent = '—';
      cipherInputEl.value = '';
      verifyNoteEl.textContent = 'Key pair loaded — click ENCRYPT to compute c = m^e mod n';

      const regEls = Array.from(document.querySelectorAll('.reg'));
      if (typeof anime === 'function' && !reducedMotionPreferred()) {
        anime.remove('.reg');
        anime({
          targets: '.reg',
          translateY: [12, 0],
          opacity: [0, 1],
          delay: anime.stagger(55),
          duration: 520,
          easing: 'easeOutExpo'
        });
      }
      pulseFlash(regEls);
      rotateClockNeedle(data.n);
    } catch (err) {
      setError(err.message || 'Failed to generate keys.');
    } finally {
      setBusy(false);
    }
  }

  // Action: Encrypt
  async function onEncrypt() {
    if (state.busy) return;
    setError(null);

    if (!state.keys.n || !state.keys.e) {
      setError('Generate a key pair first in section 01 / KEY PAIR.');
      return;
    }

    const message = msgInputEl.value;
    if (!message || message.length === 0) {
      setError('Enter a plaintext message to encrypt.', msgInputEl);
      return;
    }

    setBusy(true);
    state.currentOp = 'encrypt';

    try {
      await connectSse();
      const res = await fetch('/api/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: state.jobId,
          n: state.keys.n,
          e: state.keys.e,
          message
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Encryption failed.', msgInputEl);
        return;
      }

      mValEl.textContent = data.m;
      cValEl.textContent = data.c;
      cipherInputEl.value = data.c;
      verifyNoteEl.textContent = 'Ciphertext c ready — click DECRYPT to apply private trapdoor d';

      rotateClockNeedle(data.m);
      renderTrace(data.trace, `ENCRYPT · m^e mod n · ${data.trace.length} ITERATIONS`);
      pulseFlash(encryptInstrumentEl);
    } catch (err) {
      setError(err.message || 'Network error while encrypting.', msgInputEl);
    } finally {
      setBusy(false);
    }
  }

  // Action: Decrypt
  async function onDecrypt() {
    if (state.busy) return;
    setError(null);

    if (!state.keys.n || !state.keys.d) {
      setError('Generate a key pair first in section 01 / KEY PAIR.');
      return;
    }

    const cStr = cipherInputEl.value.trim();
    if (!cStr) {
      setError('Ciphertext integer c is required — run ENCRYPT first or paste decimal c.', cipherInputEl);
      return;
    }

    setBusy(true);
    state.currentOp = 'decrypt';

    try {
      await connectSse();
      const res = await fetch('/api/decrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: state.jobId,
          n: state.keys.n,
          d: state.keys.d,
          c: cStr
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Decryption failed.', cipherInputEl);
        return;
      }

      cValEl.textContent = data.c;
      mValEl.textContent = data.m;
      plainValEl.textContent = data.message;
      verifyNoteEl.textContent = `RECOVERED m (${data.m.length} DIGITS) → UTF-8 MATCH`;

      rotateClockNeedle(data.m);
      renderTrace(data.trace, `DECRYPT · c^d mod n · ${data.trace.length} ITERATIONS`);
      pulseFlash(decryptInstrumentEl);
    } catch (err) {
      setError(err.message || 'Network error while decrypting.', cipherInputEl);
    } finally {
      setBusy(false);
    }
  }

  // Action: Toggle Present Mode
  function togglePresentMode() {
    const entering = !document.body.classList.contains('present');
    document.body.classList.toggle('present', entering);
    presentBtnEl.classList.toggle('active', entering);

    if (entering) {
      presentCaptionEl.classList.remove('hidden');
      if (typeof anime === 'function' && !reducedMotionPreferred()) {
        anime.remove(presentCaptionEl);
        anime({
          targets: presentCaptionEl,
          opacity: [0, 1],
          translateY: [-8, 0],
          duration: 360,
          easing: 'easeOutQuad'
        });
      }
    } else {
      presentCaptionEl.classList.add('hidden');
    }
  }

  // Event bindings
  generateBtnEl.addEventListener('click', onGenerateKeys);
  encryptBtnEl.addEventListener('click', onEncrypt);
  decryptBtnEl.addEventListener('click', onDecrypt);
  presentBtnEl.addEventListener('click', togglePresentMode);

  msgInputEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      onEncrypt();
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        active.isContentEditable)
    ) {
      return;
    }
    if (ev.key === 'p' || ev.key === 'P') {
      ev.preventDefault();
      togglePresentMode();
    }
  });

  // Boot
  runLoadingSequence();
  checkHealth();
  connectSse();
})();
