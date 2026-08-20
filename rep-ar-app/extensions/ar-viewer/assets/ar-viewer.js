/**
 * AR Viewer — App Block Wiring
 * ----------------------------
 * Connects the ar-viewer.liquid app block markup to the <model-viewer>
 * element it renders. Scoped per block instance via [data-av-root] so
 * multiple instances of this block can exist on one page without
 * colliding.
 *
 * <model-viewer> (loaded as a module script by the block) does the real
 * device negotiation: its `ar` + `ar-modes="webxr scene-viewer quick-look"`
 * attributes make it feature-detect the device and launch the right native
 * AR path when its AR button is tapped — AR Quick Look via `ios-src` on iOS
 * Safari, Scene Viewer/WebXR via `src` everywhere else that supports it. If
 * neither is available it hides the AR button on its own; this file only
 * reports what was detected and swaps which model is loaded when the
 * pyramid toggle is used.
 */

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('[data-av-root]').forEach(initArViewer);
});

function initArViewer(root) {
  const statusEl = root.querySelector('[data-av-status]');
  const viewer = root.querySelector('[data-av-viewer]');
  const pyramidToggle = root.querySelector('[data-av-action="toggle-pyramid"]');

  if (!viewer) return;

  function isiOSSafari() {
    const ua = navigator.userAgent;
    const isiOSDevice = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
    const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
    return isiOSDevice && isSafari;
  }

  function updateStatus() {
    if (viewer.canActivateAR) {
      statusEl.textContent = isiOSSafari()
        ? 'AR ready — tap "View in Your Space" to launch AR Quick Look.'
        : 'AR ready — tap "View in Your Space" to launch Scene Viewer/WebXR.';
      statusEl.dataset.status = 'supported';
    } else {
      statusEl.textContent = 'AR isn’t available on this device or browser — you can still explore the 3D model below.';
      statusEl.dataset.status = 'unsupported';
    }
  }

  // canActivateAR is set asynchronously once <model-viewer> finishes its
  // own capability check, so poll briefly rather than assuming it's ready
  // on first paint.
  updateStatus();
  let attempts = 0;
  const poll = setInterval(function () {
    attempts += 1;
    updateStatus();
    if (viewer.canActivateAR || attempts > 20) clearInterval(poll);
  }, 250);

  const MODELS = {
    cube: {
      src: viewer.getAttribute('src'),
      iosSrc: viewer.getAttribute('ios-src'),
      toggleLabel: 'Add Pyramid',
    },
    cubePyramid: {
      src: viewer.dataset.pyramidSrc,
      iosSrc: viewer.dataset.pyramidIosSrc,
      toggleLabel: 'Remove Pyramid',
    },
  };

  let showingPyramid = false;
  if (pyramidToggle) {
    pyramidToggle.addEventListener('click', function () {
      showingPyramid = !showingPyramid;
      const state = showingPyramid ? MODELS.cubePyramid : MODELS.cube;
      viewer.setAttribute('src', state.src);
      viewer.setAttribute('ios-src', state.iosSrc);
      pyramidToggle.textContent = state.toggleLabel;
    });
  }
}
