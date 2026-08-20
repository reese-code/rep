/**
 * AR Product Grid — App Block Wiring
 * -----------------------------------
 * Each product card with a 3D model has a matching <template> holding its
 * pre-rendered quick-view content (a <model-viewer> plus the info panel).
 * Clicking the card clones that template into the shared <dialog> and
 * opens it. The dialog is emptied on close so any active <model-viewer>
 * (and its WebGL context) is torn down rather than left running hidden.
 *
 * AR itself is never auto-triggered here — the globe button rendered
 * inside each template is model-viewer's own `slot="ar-button"`, so
 * tapping it calls into model-viewer's built-in device negotiation
 * (AR Quick Look on iOS Safari, Scene Viewer/WebXR on Android Chrome).
 * This file only handles opening/closing the quick view around it.
 */

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('[data-apg-root]').forEach(initApgGrid);
});

function initApgGrid(root) {
  const wrapper = root.closest('.apg');
  if (!wrapper) return;

  const dialog = wrapper.querySelector('[data-apg-modal]');
  const body = wrapper.querySelector('[data-apg-modal-body]');
  const closeBtn = wrapper.querySelector('[data-apg-close]');
  if (!dialog || !body) return;

  function openFor(templateId) {
    const template = wrapper.querySelector('#' + CSS.escape(templateId));
    if (!template) return;
    body.innerHTML = '';
    body.appendChild(template.content.cloneNode(true));
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function close() {
    if (typeof dialog.close === 'function' && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
    body.innerHTML = '';
  }

  root.querySelectorAll('[data-apg-open]').forEach((card) => {
    card.addEventListener('click', function () {
      openFor(card.dataset.apgOpen);
    });
  });

  if (closeBtn) closeBtn.addEventListener('click', close);

  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) close();
  });

  dialog.addEventListener('close', function () {
    body.innerHTML = '';
  });
}
