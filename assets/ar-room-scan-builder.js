/**
 * Room-Aware Builder — Shopify Section Wiring
 * ---------------------------------------------
 * Connects the room-scan-builder.liquid markup to the shared RepRoomScan
 * engine (room-scan-engine.js, loaded just before this file). Scoped per
 * section instance via [data-rsb-root] so multiple instances of this
 * section can exist on one page without colliding (standard Dawn pattern).
 *
 * Covers two real, distinct mobile AR paths with no native app required:
 *   - Android / Chrome: WebXR `navigator.xr.isSessionSupported('immersive-ar')`
 *   - iOS / Safari: AR Quick Look via a plain `<a rel="ar">` link
 * Both fall back to manual dimension entry, which feeds identical
 * downstream logic (clearance checks, persistent canvas, recommendations).
 */

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('[data-rsb-root]').forEach(initRoomScanBuilder);
});

function initRoomScanBuilder(root) {
  if (!window.RepRoomScan) {
    console.error('Room-Aware Builder: shared engine (room-scan-engine.js) not loaded.');
    return;
  }

  const { RACKS, ACCESSORIES, createRoomState, checkXRSupport, checkClearance, placeItem, getRecommendations, remainingFloorWidth, remainingWallWidth } = window.RepRoomScan;

  let room = createRoomState();

  const steps = {};
  root.querySelectorAll('[data-rsb-step]').forEach((el) => {
    steps[el.dataset.rsbStep] = el;
  });
  function showStep(name) {
    Object.values(steps).forEach((el) => el.classList.remove('is-active'));
    steps[name].classList.add('is-active');
  }

  // --- Step 1: scan / AR Quick Look / manual entry ---
  const xrStatusEl = root.querySelector('[data-rsb-xr-status]');
  const manualPanel = root.querySelector('[data-rsb-manual-panel]');
  const quicklookPanel = root.querySelector('[data-rsb-quicklook-panel]');
  const quicklookLink = root.querySelector('[data-rsb-quicklook-link]');

  // Quick Look requires Safari/WebKit on iOS or iPadOS specifically — not
  // Chrome or Firefox running on iOS (those use WebKit under the hood but
  // Apple does not expose Quick Look's <a rel="ar"> behavior to them), and
  // not Android or desktop at all.
  function isQuickLookCapable() {
    const ua = navigator.userAgent;
    const isiOSDevice = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
    const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
    return isiOSDevice && isSafari;
  }

  // Real sample USDZ hosted on Apple's developer domain — used only to
  // demonstrate that the <a rel="ar"> mechanism genuinely launches native
  // ARKit Quick Look. Not a REP rack model. Linked directly to Apple's
  // hosted file rather than rehosted, per their redistribution terms.
  const PLACEHOLDER_USDZ = 'https://developer.apple.com/augmented-reality/quick-look/models/boxing-glove/boxing_glove_realistic.usdz';

  checkXRSupport().then((result) => {
    if (result.supported) {
      xrStatusEl.textContent = 'WebXR immersive-ar is supported on this device (Android/Chrome path). Live guided scan requires a render-loop wired to a physical device camera. Falling back to manual entry for this demo.';
      xrStatusEl.dataset.status = 'supported';
      manualPanel.hidden = false;
    } else if (quicklookPanel && isQuickLookCapable()) {
      xrStatusEl.textContent = 'WebXR is not available in Safari (Apple does not support it) — but Safari has its own native AR path below.';
      xrStatusEl.dataset.status = 'unsupported';
      if (quicklookLink) quicklookLink.setAttribute('href', PLACEHOLDER_USDZ);
      quicklookPanel.hidden = false;
      manualPanel.hidden = false;
    } else {
      xrStatusEl.textContent = 'AR not available here: ' + result.reason;
      xrStatusEl.dataset.status = 'unsupported';
      manualPanel.hidden = false;
    }
  });

  const confirmBtn = root.querySelector('[data-rsb-action="confirm-room"]');
  confirmBtn.addEventListener('click', function () {
    const widthInput = root.querySelector('[data-rsb-input="width"]');
    const depthInput = root.querySelector('[data-rsb-input="depth"]');
    const ceilingInput = root.querySelector('[data-rsb-input="ceiling"]');

    room.source = 'manual';
    room.widthIn = Number(widthInput.value);
    room.depthIn = Number(depthInput.value);
    room.ceilingIn = Number(ceilingInput.value);

    root.querySelector('[data-rsb-room-summary]').textContent =
      room.widthIn + '" × ' + room.depthIn + '", ' + room.ceilingIn + '" ceiling';

    populateRackOptions();
    showStep('rack');
  });

  // --- Step 2: rack + height selection, clearance ---
  const selRack = root.querySelector('[data-rsb-select="rack"]');
  const selHeight = root.querySelector('[data-rsb-select="height"]');
  const clearanceOutput = root.querySelector('[data-rsb-clearance-output]');

  function populateRackOptions() {
    selRack.innerHTML = RACKS.map((r) => '<option value="' + r.id + '">' + r.name + '</option>').join('');
    populateHeightOptions();
    renderClearance();
  }
  function populateHeightOptions() {
    const rack = RACKS.find((r) => r.id === selRack.value);
    selHeight.innerHTML = rack.heights.map((h) => '<option value="' + h + '">' + h + '"</option>').join('');
  }
  function renderClearance() {
    const rack = RACKS.find((r) => r.id === selRack.value);
    const height = Number(selHeight.value);
    const verdict = checkClearance(room, rack, height);

    let html = ''
      + '<div class="ar-room-scan-builder__panel">'
      + '<div class="ar-room-scan-builder__panel-label"><span>Clearance Check</span><span>' + rack.name + ', ' + height + '"</span></div>'
      + '<div class="ar-room-scan-builder__spec-sheet">'
      + '<div class="ar-room-scan-builder__spec-row"><span>Rack height</span><span>' + height + '"</span></div>'
      + '<div class="ar-room-scan-builder__spec-row"><span>Your ceiling</span><span>' + room.ceilingIn + '"</span></div>'
      + '<div class="ar-room-scan-builder__spec-row"><span>Headroom</span><span>' + Math.max(0, room.ceilingIn - height) + '"</span></div>'
      + '<div class="ar-room-scan-builder__spec-row"><span>Footprint</span><span>' + rack.footprint.width + '"×' + rack.footprint.depth + '"</span></div>'
      + '</div></div>';

    if (verdict.warnings.length) {
      html += '<div class="ar-room-scan-builder__verdict" data-state="' + (verdict.ok ? 'warn' : 'fail') + '">'
        + '<span class="ar-room-scan-builder__verdict-title">' + (verdict.ok ? 'Tight Fit' : "Won't Fit") + '</span>'
        + verdict.warnings.map((w) => '<div>' + w + '</div>').join('')
        + verdict.suggestions.map((s) => '<div class="ar-room-scan-builder__suggestion">→ ' + s + '</div>').join('')
        + '</div>';
    } else {
      html += '<div class="ar-room-scan-builder__verdict" data-state="ok">'
        + '<span class="ar-room-scan-builder__verdict-title">Fits Clean</span>'
        + 'Full headroom and footprint clearance confirmed against your scanned room.'
        + '</div>';
    }

    clearanceOutput.innerHTML = html;
  }

  selRack.addEventListener('change', function () { populateHeightOptions(); renderClearance(); });
  selHeight.addEventListener('change', renderClearance);

  // --- Step 2 -> 3: place rack ---
  root.querySelector('[data-rsb-action="place-rack"]').addEventListener('click', function () {
    const rack = RACKS.find((r) => r.id === selRack.value);
    placeItem(room, { id: rack.id, name: rack.name, footprint: rack.footprint, type: 'floor' });
    renderCanvas();
    showStep('canvas');
  });

  // --- Step 3: canvas + recommendations ---
  const canvasEl = root.querySelector('[data-rsb-canvas]');
  const recoListEl = root.querySelector('[data-rsb-reco-list]');

  function renderCanvas() {
    root.querySelector('[data-rsb-canvas-room-size]').textContent = room.widthIn + '"×' + room.depthIn + '"';

    canvasEl.innerHTML = '';
    const scaleX = 100 / room.widthIn;
    const scaleY = 100 / room.depthIn;
    let cursorX = 0;

    room.placedItems.forEach((item) => {
      const w = item.footprint.width * scaleX;
      const d = item.footprint.depth * scaleY;
      const div = document.createElement('div');
      div.className = 'ar-room-scan-builder__canvas-item';
      if (RACKS.some((r) => r.id === item.id)) div.classList.add('is-rack');
      div.style.left = cursorX + '%';
      div.style.top = '0%';
      div.style.width = w + '%';
      div.style.height = d + '%';
      div.textContent = item.name;
      canvasEl.appendChild(div);
      cursorX += w;
    });

    root.querySelector('[data-rsb-open-space]').textContent =
      remainingFloorWidth(room) + '" floor, ' + remainingWallWidth(room) + '" wall open';

    renderRecommendations();
  }

  function renderRecommendations() {
    const recs = getRecommendations(room);
    if (!recs.length) {
      recoListEl.innerHTML = '<p class="ar-room-scan-builder__note">No additional items fit your remaining open space.</p>';
      return;
    }
    recoListEl.innerHTML = recs.map((acc) => ''
      + '<div class="ar-room-scan-builder__reco-item">'
      + '<div><div class="ar-room-scan-builder__reco-name">' + acc.name + '</div>'
      + '<div class="ar-room-scan-builder__reco-meta">' + acc.footprint.width + '"×' + acc.footprint.depth + '" · ' + acc.type + ' space · $' + acc.basePrice + '</div></div>'
      + '<button type="button" class="ar-room-scan-builder__btn ar-room-scan-builder__btn--secondary" data-rsb-add="' + acc.id + '">Add</button>'
      + '</div>'
    ).join('');

    recoListEl.querySelectorAll('[data-rsb-add]').forEach((btn) => {
      btn.addEventListener('click', function () {
        const acc = ACCESSORIES.find((a) => a.id === btn.dataset.rsbAdd);
        placeItem(room, { id: acc.id, name: acc.name, footprint: acc.footprint, type: acc.type });
        if (acc.type === 'floor') renderCanvas();
        else renderRecommendations();
      });
    });
  }

  // --- Restart ---
  root.querySelector('[data-rsb-action="restart"]').addEventListener('click', function () {
    room = createRoomState();
    manualPanel.hidden = false;
    showStep('scan');
  });
}
