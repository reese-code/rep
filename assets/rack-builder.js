// Rack Builder — 3D configurator demo
// ------------------------------------
// Loads a single .glb (uploaded to the product as Shopify "3D model" media)
// and lets the shopper spin/zoom it, toggle add-on parts on and off, and
// recolor the frame. Which object in the .glb is "the frame", "the bar",
// etc. is configured per-section (data-frame-object and friends, set from
// the theme editor's "3D model object names" settings) rather than
// hardcoded — different models can use different naming conventions, and
// getting a name wrong should just make that one toggle inert rather than
// break the whole viewer.

// Vendored as theme assets (same approach as cart-ar-setup.js) rather than
// pulled from a CDN at runtime, so this doesn't depend on an external host
// being reachable or on the storefront's CSP allowing it. Relative imports
// resolve against this file's own asset URL.
const THREE_URL = './three.module.js';
const GLTF_LOADER_URL = './three-gltf-loader.js';
const ORBIT_CONTROLS_URL = './three-orbit-controls.js';

/** @type {Promise<{ THREE: any, GLTFLoader: any, OrbitControls: any }> | undefined} */
let threeModulesPromise;

function loadThree() {
  if (!threeModulesPromise) {
    threeModulesPromise = Promise.all([
      import(THREE_URL),
      import(GLTF_LOADER_URL),
      import(ORBIT_CONTROLS_URL),
    ]).then(([THREE, gltfModule, orbitModule]) => ({
      THREE,
      GLTFLoader: gltfModule.GLTFLoader,
      OrbitControls: orbitModule.OrbitControls,
    }));
  }
  return threeModulesPromise;
}

class RackBuilderComponent extends HTMLElement {
  /** @type {any} */
  #THREE;
  /** @type {any} */
  #renderer;
  /** @type {any} */
  #scene;
  /** @type {any} */
  #camera;
  /** @type {any} */
  #controls;
  /** @type {any} */
  #frameId = 0;
  /** @type {ResizeObserver | undefined} */
  #resizeObserver;
  /** @type {Map<string, any>} named objects found in the loaded model, keyed by name */
  #namedObjects = new Map();
  /** @type {any[]} materials found on rack_frame, so a color swap can update all of them */
  #frameMaterials = [];
  /** @type {{ id: string, price: number, available: boolean, options: string[] }[]} main product's variants */
  #variants = [];
  /** @type {string[]} currently selected value per product option index (Color, Size, ...) */
  #selectedOptions = [];

  connectedCallback() {
    this.#loadVariants();
    this.#initSelectedOptions();

    this.#init().catch((error) => {
      console.error('[rack-builder] failed to load viewer', error);
      const loadingEl = this.querySelector('[data-rack-loading]');
      // Surface the real error text (not just a generic message) so it's
      // visible without opening devtools — e.g. a WebGL failure, a 404 on
      // the .glb, or a CORS error all say something different here.
      if (loadingEl) {
        loadingEl.hidden = false;
        loadingEl.textContent = `Couldn't load the 3D model: ${error.message}`;
      }
    });

    this.querySelectorAll('[data-rack-toggle]').forEach((el) => {
      el.addEventListener('change', this.#onToggleChange);
    });
    this.querySelectorAll('[data-rack-swatch]').forEach((el) => {
      el.addEventListener('change', this.#onSwatchChange);
    });
    this.querySelectorAll('[data-rack-option]').forEach((el) => {
      el.addEventListener('change', this.#onOptionChange);
    });

    const form = this.querySelector('form');
    form?.addEventListener('submit', this.#onSubmit);

    this.querySelector('[data-rack-expand]')?.addEventListener('click', this.#openFullscreen);
    this.querySelector('[data-rack-collapse]')?.addEventListener('click', this.#closeFullscreen);
    this.querySelector('[data-rack-panel-toggle]')?.addEventListener('click', this.#toggleFullscreenPanel);
    // The native <dialog> "close" event fires both when we call
    // dialog.close() ourselves and when the shopper presses Escape, so
    // this is the one place that needs to move the viewer/panel back.
    this.querySelector('[data-rack-fullscreen-dialog]')?.addEventListener('close', this.#onFullscreenClose);
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.#frameId);
    this.#resizeObserver?.disconnect();
    this.#controls?.dispose();
    this.#renderer?.dispose();
  }

  /** Maps a checkbox's semantic data-object ("bar", "weight_plates", "bench") to the actual object name in this model, as configured in the section's settings. */
  get #addonObjectNames() {
    return {
      bar: this.dataset.barObject,
      weight_plates: this.dataset.weightPlatesObject,
      bench: this.dataset.benchObject,
    };
  }

  #loadVariants() {
    const script = this.querySelector('[data-rack-variants]');
    try {
      this.#variants = JSON.parse(script?.textContent || '[]');
    } catch {
      this.#variants = [];
    }
  }

  // Seeds #selectedOptions from whichever variant Liquid picked as the
  // default, so swatch/dropdown changes only need to update one index at a
  // time rather than re-deriving the whole option set.
  #initSelectedOptions() {
    const variant = this.#variants.find((v) => v.id === this.dataset.initialVariantId);
    this.#selectedOptions = variant ? [...variant.options] : [];
  }

  async #init() {
    const glbUrl = this.dataset.glbUrl;
    const canvasWrap = this.querySelector('[data-rack-canvas]');
    const loadingEl = this.querySelector('[data-rack-loading]');
    if (!glbUrl || !canvasWrap) return;

    const { THREE, GLTFLoader, OrbitControls } = await loadThree();
    this.#THREE = THREE;

    const width = canvasWrap.clientWidth || 800;
    const height = canvasWrap.clientHeight || 600;

    this.#renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.setSize(width, height);
    // Matches how a phone/monitor actually displays color and keeps
    // bright highlights from blowing out to flat white — without these
    // two, PBR metal materials (like a steel rack frame) render dull and
    // too dark under any normal set of lights.
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1.1;
    canvasWrap.appendChild(this.#renderer.domElement);

    this.#scene = new THREE.Scene();

    this.#camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.#camera.position.set(3, 2.5, 4);

    // Orbit controls: left-drag rotates, scroll-wheel/pinch zooms
    // in and out, right-drag pans. Distance limits get set once the
    // model's real size is known, below.
    this.#controls = new OrbitControls(this.#camera, this.#renderer.domElement);
    this.#controls.target.set(0, 1, 0);
    this.#controls.enableDamping = true;
    this.#controls.enableZoom = true;

    // Simple studio-style lighting rig: soft ambient fill + a strong key
    // light, a softer fill light from the opposite side to open up
    // shadows, and a rim light from behind to separate the model from
    // the background — the same idea as a 3-point photo/product shot,
    // rather than one flat directional light.
    this.#scene.add(new THREE.AmbientLight(0xffffff, 0.7));

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(5, 8, 6);
    this.#scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 1.1);
    fill.position.set(-6, 4, 2);
    this.#scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 1.6);
    rim.position.set(-2, 6, -8);
    this.#scene.add(rim);

    const loader = new GLTFLoader();
    // If no progress event has arrived after a few seconds, the browser
    // likely hasn't gotten a single byte back yet (slow/stalled
    // connection, or the request never really started) — say so instead
    // of leaving the shopper staring at an unchanging "Loading…" label.
    let receivedProgress = false;
    const stallTimeout = setTimeout(() => {
      if (!receivedProgress && loadingEl) {
        loadingEl.textContent = 'Still downloading the 3D model — this file is large, hang tight…';
      }
    }, 6000);

    const gltf = await new Promise((resolve, reject) =>
      loader.load(
        glbUrl,
        resolve,
        (progress) => {
          receivedProgress = true;
          if (!loadingEl || !progress.lengthComputable) return;
          const percent = Math.round((progress.loaded / progress.total) * 100);
          const totalMb = (progress.total / 1024 / 1024).toFixed(1);
          loadingEl.textContent = `Loading 3D model… ${percent}% of ${totalMb}MB`;
        },
        reject
      )
    ).finally(() => clearTimeout(stallTimeout));
    const model = gltf.scene;
    this.#scene.add(model);

    const frameObjectName = this.dataset.frameObject;
    const addonObjectNames = Object.values(this.#addonObjectNames);
    const wantedNames = new Set([frameObjectName, ...addonObjectNames].filter(Boolean));

    // Walk the model and stash a reference to each named object we care
    // about, so the toggle/color controls don't have to re-search the
    // scene graph every time they're used.
    model.traverse((node) => {
      if (wantedNames.has(node.name)) {
        this.#namedObjects.set(node.name, node);
      }
    });

    if (this.#namedObjects.size === 0) {
      console.warn(
        `[rack-builder] none of the configured object names (${[...wantedNames].join(', ')}) were found in this .glb.`,
        'Toggles and color swatches will have no effect until the "3D model object names" section settings match the real names inside the file.'
      );
    }

    // Hide add-on parts by default; only the frame shows until a
    // checkbox is switched on.
    addonObjectNames.forEach((name) => {
      const object = this.#namedObjects.get(name);
      if (object) object.visible = false;
    });

    // Collect every material used on the frame object (recolored by the
    // color swatches) so a color swap can update all of them at once,
    // even if the frame turns out to have more than one material slot.
    const frame = this.#namedObjects.get(frameObjectName);
    if (frame) {
      frame.traverse((node) => {
        if (!node.isMesh) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => {
          if (material && !this.#frameMaterials.includes(material)) this.#frameMaterials.push(material);
        });
      });
    }

    // Frame the camera around whatever loaded, regardless of the model's
    // native scale/origin.
    const box = new THREE.Box3().setFromObject(frame || model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    this.#camera.position.set(center.x + maxDim, center.y + maxDim * 0.6, center.z + maxDim);
    this.#controls.target.copy(center);
    // Keep zooming within a sane range relative to the model's actual
    // size — close enough to inspect detail, far enough to not clip
    // through it or fly off into empty space.
    this.#controls.minDistance = maxDim * 0.5;
    this.#controls.maxDistance = maxDim * 5;
    this.#controls.update();

    // Liquid already marked the right swatch radio "checked" for the
    // default variant — just read it and apply the color.
    const checkedSwatch = this.querySelector('[data-rack-swatch]:checked');
    if (checkedSwatch) this.#setFrameColor(checkedSwatch.dataset.color);

    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(canvasWrap);

    if (loadingEl) loadingEl.hidden = true;
    this.#startRenderLoop();
  }

  #startRenderLoop() {
    const tick = () => {
      this.#controls.update();
      this.#renderer.render(this.#scene, this.#camera);
      this.#frameId = requestAnimationFrame(tick);
    };
    this.#frameId = requestAnimationFrame(tick);
  }

  #resize() {
    const canvasWrap = this.querySelector('[data-rack-canvas]');
    if (!canvasWrap || !this.#camera || !this.#renderer) return;
    const width = canvasWrap.clientWidth || 800;
    const height = canvasWrap.clientHeight || 600;
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
    this.#renderer.setSize(width, height);
  }

  // Fullscreen mode reuses the exact same viewer and panel elements —
  // just relocates them into the <dialog> — rather than building a
  // second copy of the canvas/controls. That keeps the one Three.js
  // renderer, its event listeners, and every form control (radios,
  // checkboxes, the variant id input) working identically in both
  // places with no duplication to keep in sync.
  #openFullscreen = () => {
    const dialog = this.querySelector('[data-rack-fullscreen-dialog]');
    const stage = this.querySelector('[data-rack-fullscreen-stage]');
    const panelSlot = this.querySelector('[data-rack-fullscreen-panel]');
    const viewer = this.querySelector('[data-rack-viewer]');
    const panel = this.querySelector('.rack-builder__panel');
    if (!(dialog instanceof HTMLDialogElement) || !stage || !panelSlot || !viewer || !panel) return;

    stage.appendChild(viewer);
    panelSlot.appendChild(panel);
    dialog.showModal();
    // The canvas has real pixel dimensions now that it's on-screen full
    // size, but only after layout settles on the next frame.
    requestAnimationFrame(() => this.#resize());
  };

  #closeFullscreen = () => {
    const dialog = this.querySelector('[data-rack-fullscreen-dialog]');
    if (dialog instanceof HTMLDialogElement) dialog.close();
  };

  #onFullscreenClose = () => {
    const dialog = this.querySelector('[data-rack-fullscreen-dialog]');
    const viewer = this.querySelector('[data-rack-viewer]');
    const panel = this.querySelector('.rack-builder__panel');
    if (dialog && viewer) this.insertBefore(viewer, dialog);
    if (dialog && panel) this.insertBefore(panel, dialog);
    this.querySelector('[data-rack-fullscreen-panel]')?.removeAttribute('data-open');
    requestAnimationFrame(() => this.#resize());
  };

  #toggleFullscreenPanel = () => {
    const panel = this.querySelector('[data-rack-fullscreen-panel]');
    panel?.toggleAttribute('data-open', !panel.hasAttribute('data-open'));
  };

  #onToggleChange = (event) => {
    const checkbox = event.currentTarget;
    const objectName = this.#addonObjectNames[checkbox.dataset.object];
    const object = this.#namedObjects.get(objectName);
    if (object) object.visible = checkbox.checked;
    this.#updateTotal();
  };

  #onSwatchChange = (event) => {
    const radio = event.currentTarget;
    this.#setFrameColor(radio.dataset.color);
    this.#selectedOptions[Number(radio.dataset.optionIndex)] = radio.value;
    this.#applySelectedOptions();
  };

  #onOptionChange = (event) => {
    const select = event.currentTarget;
    this.#selectedOptions[Number(select.dataset.optionIndex)] = select.value;
    this.#applySelectedOptions();
  };

  // Finds the real variant matching every currently selected option value
  // and, if one exists, points the hidden "id" input at it (so Add to
  // Cart reflects it) and enables/disables the submit button to match its
  // availability. If no exact-match variant exists (e.g. no "Color"
  // option configured yet, or that combination isn't sold), the hidden
  // input is left alone — swatches/dropdowns still drive the 3D preview
  // either way.
  #applySelectedOptions() {
    const matchedVariant = this.#variants.find((variant) =>
      variant.options.every((value, index) => value === this.#selectedOptions[index])
    );

    if (matchedVariant) {
      const variantIdInput = this.querySelector('[data-rack-variant-id]');
      if (variantIdInput) {
        variantIdInput.value = matchedVariant.id;
        variantIdInput.dataset.price = String(matchedVariant.price);
      }
      const submitButton = this.querySelector('[data-rack-submit]');
      if (submitButton) submitButton.toggleAttribute('disabled', !matchedVariant.available);
    }

    this.#updateTotal();
  }

  #setFrameColor(hexColor) {
    if (!hexColor || !this.#THREE) return;
    this.#frameMaterials.forEach((material) => {
      material.color.set(hexColor);
    });
  }

  // Recomputes the displayed price: selected variant price + any checked
  // add-ons' real variant prices.
  #updateTotal = () => {
    const totalEl = this.querySelector('[data-rack-total]');
    const variantIdInput = this.querySelector('[data-rack-variant-id]');
    if (!totalEl || !variantIdInput) return;

    const variantCents = Number(variantIdInput.dataset.price || 0);

    let addonCents = 0;
    this.querySelectorAll('[data-rack-toggle]:checked').forEach((checkbox) => {
      if (checkbox.dataset.variantId) addonCents += Number(checkbox.dataset.price || 0);
    });

    totalEl.textContent = this.#formatMoney(variantCents + addonCents);
  };

  #formatMoney(cents) {
    const currency = this.dataset.currency || 'USD';
    return new Intl.NumberFormat(document.documentElement.lang || undefined, {
      style: 'currency',
      currency,
    }).format(cents / 100);
  }

  #onSubmit = (event) => {
    event.preventDefault();
    const statusEl = this.querySelector('[data-rack-cart-status]');
    const submitButton = this.querySelector('[data-rack-submit]');
    const variantIdInput = this.querySelector('[data-rack-variant-id]');
    // The quantity selector (snippets/quantity-selector.liquid) renders a
    // plain <input name="quantity">, whether or not its custom element's
    // increment/decrement JS has loaded — reading it directly here doesn't
    // depend on that component at all.
    const quantityInput = this.querySelector('input[name="quantity"]');
    const quantity = Number(quantityInput?.value || 1);

    const items = [{ id: variantIdInput?.value, quantity }];
    this.querySelectorAll('[data-rack-toggle]:checked').forEach((checkbox) => {
      if (checkbox.dataset.variantId) items.push({ id: checkbox.dataset.variantId, quantity });
    });

    submitButton?.setAttribute('disabled', 'disabled');
    if (statusEl) statusEl.textContent = 'Adding to cart…';

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.status) {
          if (statusEl) statusEl.textContent = data.message || data.description || 'Could not add to cart.';
          return;
        }
        if (statusEl) statusEl.textContent = 'Added to cart!';
      })
      .catch(() => {
        if (statusEl) statusEl.textContent = 'Could not add to cart.';
      })
      .finally(() => {
        submitButton?.removeAttribute('disabled');
      });
  };
}

if (!customElements.get('rack-builder-component')) {
  customElements.define('rack-builder-component', RackBuilderComponent);
}
