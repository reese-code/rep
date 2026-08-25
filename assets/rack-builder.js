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

/**
 * A "part" (frame, bar, weight plates, bench, ...) is often more than one
 * mesh in the .glb — e.g. a bench is its cushion + frame + adjustment pin
 * as three separate objects. Section settings accept a comma-separated
 * list for exactly this reason.
 * @param {string | undefined} raw
 * @returns {string[]}
 */
function parseObjectNameList(raw) {
  return (raw || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * True if a node's actual name is a configured name, or an exporter-uniquified
 * duplicate of it (Blender/glTF exporters rename repeated siblings — e.g. two
 * bench adjustment pins named "pins" export as "pins" and "pins.001"). Without
 * this, only the first of each duplicate pair gets tracked, so the other stays
 * stuck at its default visibility no matter what a toggle does.
 * @param {string} nodeName
 * @param {string} wantedName
 * @returns {boolean}
 */
function nameMatches(nodeName, wantedName) {
  return nodeName === wantedName || nodeName.startsWith(`${wantedName}.`);
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
  /** @type {Map<string, any[]>} named objects found in the loaded model, keyed by configured name — an array because exporters uniquify duplicate names (e.g. left/right pins become "pins" and "pins.001") */
  #namedObjects = new Map();
  /** @type {any[]} rubber end-cap materials found on the frame/bench, so a color swap can update all of them */
  #capMaterials = [];
  /** @type {{ id: string, price: number, available: boolean, options: string[] }[]} main product's variants */
  #variants = [];
  /** @type {string[]} currently selected value per product option index (Color, Size, ...) */
  #selectedOptions = [];

  connectedCallback() {
    this.#loadVariants();
    this.#initSelectedOptions();

    this.#init().catch((error) => {
      console.error('[rack-builder] failed to load viewer', error);
      // Surface the real error text (not just a generic message) so it's
      // visible without opening devtools — e.g. a WebGL failure, a 404 on
      // the .glb, or a CORS error all say something different here.
      const statusEl = this.querySelector('[data-rack-cart-status]');
      if (statusEl) statusEl.textContent = `Couldn't load the 3D model: ${error.message}`;
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
    this.querySelector('[data-rack-zoom-in]')?.addEventListener('click', () => this.#zoomBy(0.8));
    this.querySelector('[data-rack-zoom-out]')?.addEventListener('click', () => this.#zoomBy(1.25));
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

  /** Maps a checkbox's semantic data-object ("bar", "weight_plates", "bench") to the actual object name(s) in this model, as configured in the section's settings. */
  get #addonObjectNames() {
    return {
      bar: parseObjectNameList(this.dataset.barObject),
      weight_plates: parseObjectNameList(this.dataset.weightPlatesObject),
      bench: parseObjectNameList(this.dataset.benchObject),
    };
  }

  get #frameObjectNames() {
    return parseObjectNameList(this.dataset.frameObject);
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
    // 2x the original 1.1 exposure — a flat global brightness multiplier
    // on top of the lighting rig below, per request.
    this.#renderer.toneMappingExposure = 2.2;
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
    // Slow idle spin so the model isn't static — OrbitControls only applies
    // this while the shopper isn't actively dragging (state === NONE), so
    // it automatically pauses on interaction and resumes after release.
    this.#controls.autoRotate = true;
    this.#controls.autoRotateSpeed = 0.6;

    // Simple studio-style lighting rig: soft ambient fill + a strong key
    // light, a softer fill light from the opposite side to open up
    // shadows, and a rim light from behind to separate the model from
    // the background — the same idea as a 3-point photo/product shot,
    // rather than one flat directional light. Intensities are 2x the
    // original values, per request.
    this.#scene.add(new THREE.AmbientLight(0xffffff, 1.4));

    const key = new THREE.DirectionalLight(0xffffff, 4.8);
    key.position.set(5, 8, 6);
    this.#scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 2.2);
    fill.position.set(-6, 4, 2);
    this.#scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 3.2);
    rim.position.set(-2, 6, -8);
    this.#scene.add(rim);

    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => loader.load(glbUrl, resolve, undefined, reject));
    const model = gltf.scene;
    this.#scene.add(model);

    const frameObjectNames = this.#frameObjectNames;
    const addonObjectNames = Object.values(this.#addonObjectNames).flat();
    const wantedNames = new Set([...frameObjectNames, ...addonObjectNames]);

    // Walk the model and stash a reference to each named object we care
    // about, so the toggle/color controls don't have to re-search the
    // scene graph every time they're used. A configured name can match
    // several nodes (see nameMatches), so each wanted name maps to an
    // array. Also collect every object name that actually exists in the
    // file, purely for the diagnostic log below — comparing "what we
    // wanted" against "what's really there" is the fastest way to spot a
    // typo/mismatch.
    const allObjectNames = [];
    const allMaterialNames = new Set();
    model.traverse((node) => {
      if (node.name) allObjectNames.push(node.name);
      if (node.isMesh) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => {
          if (material?.name) allMaterialNames.add(material.name);
        });
      }
      for (const wantedName of wantedNames) {
        if (!nameMatches(node.name, wantedName)) continue;
        const matches = this.#namedObjects.get(wantedName) || [];
        matches.push(node);
        this.#namedObjects.set(wantedName, matches);
      }
    });

    const missingNames = [...wantedNames].filter((name) => !this.#namedObjects.has(name));
    console.info(
      `[rack-builder] configured object names found: [${[...this.#namedObjects.keys()].join(', ')}]`,
      missingNames.length ? `\nNOT found (typo, or not this model): [${missingNames.join(', ')}]` : '',
      `\nAll object names actually in this .glb: [${allObjectNames.join(', ')}]`,
      `\nAll material names actually in this .glb (use these for "Bench pad / rubber cap material name(s)" in section settings): [${[...allMaterialNames].join(', ')}]`
    );

    // Hide add-on parts by default; only the frame shows until a
    // checkbox is switched on.
    addonObjectNames.forEach((name) => {
      const objects = this.#namedObjects.get(name) || [];
      objects.forEach((object) => (object.visible = false));
    });

    // Collect materials to recolor. This has two parts:
    //
    // 1. Named-material matching, scoped to the frame and bench object(s)
    //    only (via "Rubber cap material name(s)") — e.g. the bench pad
    //    material and, once you know its real name from the console log
    //    below, the rack's rubber end-cap material. A color is a material
    //    concept, and the same material can be shared across several
    //    separate meshes (both ends of the rack, each leg of the bench),
    //    so matching by name within this scope is more precise than
    //    "every material found on the frame/bench object(s)". Leaving the
    //    setting blank falls back to recoloring every material on the
    //    frame/bench object(s) instead.
    // 2. The weight plates always get every one of their materials
    //    recolored, unconditionally — no name filter — so their default
    //    metal look is fully replaced by the swatch color instead of
    //    staying plain steel.
    const frameObjects = frameObjectNames.flatMap((name) => this.#namedObjects.get(name) || []);
    const benchObjectNames = this.#addonObjectNames.bench;
    const benchObjects = benchObjectNames.flatMap((name) => this.#namedObjects.get(name) || []);
    const weightPlatesObjects = this.#addonObjectNames.weight_plates.flatMap(
      (name) => this.#namedObjects.get(name) || []
    );
    const namedColorableObjects = [...frameObjects, ...benchObjects];

    const capMaterialNames = parseObjectNameList(this.dataset.capMaterialNames).map((name) =>
      name.toLowerCase()
    );

    if (capMaterialNames.length) {
      const seenMaterialNames = new Set();
      namedColorableObjects.forEach((object) => {
        object.traverse((node) => {
          if (!node.isMesh) return;
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          materials.forEach((material) => {
            if (!material || this.#capMaterials.includes(material)) return;
            if (capMaterialNames.includes((material.name || '').toLowerCase())) {
              this.#capMaterials.push(material);
              seenMaterialNames.add(material.name);
            }
          });
        });
      });
      const missingMaterialNames = capMaterialNames.filter(
        (name) => ![...seenMaterialNames].some((seen) => seen.toLowerCase() === name)
      );
      if (missingMaterialNames.length) {
        console.warn(`[rack-builder] configured cap material name(s) not found on the frame/bench object(s): [${missingMaterialNames.join(', ')}]`);
      }
    } else {
      namedColorableObjects.forEach((object) => {
        object.traverse((node) => {
          if (!node.isMesh) return;
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          materials.forEach((material) => {
            if (material && !this.#capMaterials.includes(material)) this.#capMaterials.push(material);
          });
        });
      });
    }

    weightPlatesObjects.forEach((object) => {
      object.traverse((node) => {
        if (!node.isMesh) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => {
          if (material && !this.#capMaterials.includes(material)) this.#capMaterials.push(material);
        });
      });
    });

    // Frame the camera around whatever loaded, regardless of the model's
    // native scale/origin.
    const box = new THREE.Box3();
    if (frameObjects.length) {
      frameObjects.forEach((frameObject) => box.expandByObject(frameObject));
    } else {
      box.setFromObject(model);
    }
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
    if (checkedSwatch) this.#setCapColor(checkedSwatch.dataset.color);

    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(canvasWrap);

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

  // Moves the camera along its existing line to the orbit target rather than
  // calling OrbitControls' internal dolly methods (not part of its public
  // API) — controls.update() re-derives spherical.radius from the camera's
  // position every frame and re-clamps it to minDistance/maxDistance, so a
  // plain position scale ends up identical to a real dolly in/out.
  #zoomBy(factor) {
    if (!this.#camera || !this.#controls) return;
    const offset = this.#camera.position.clone().sub(this.#controls.target).multiplyScalar(factor);
    this.#camera.position.copy(this.#controls.target).add(offset);
    this.#controls.update();
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
    const objectNames = this.#addonObjectNames[checkbox.dataset.object] || [];
    objectNames.forEach((name) => {
      const objects = this.#namedObjects.get(name) || [];
      objects.forEach((object) => (object.visible = checkbox.checked));
    });
    this.#updateTotal();
  };

  #onSwatchChange = (event) => {
    const radio = event.currentTarget;
    this.#setCapColor(radio.dataset.color);
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

  #setCapColor(hexColor) {
    if (!hexColor || !this.#THREE) return;
    this.#capMaterials.forEach((material) => {
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
