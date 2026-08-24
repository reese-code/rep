import { DialogComponent } from '@theme/dialog';

// Vendored as theme assets (rather than pulled from a third-party CDN at
// runtime) so this doesn't depend on an external host being reachable, or
// on the storefront's CSP allowing it. Relative imports resolve against
// this file's own asset URL, so this works whether Shopify serves assets
// from cdn.shopify.com or a versioned local dev path.
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

function clampRange(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * A single shared Three.js scene holding one model per unique cart
 * product. Drag the background to orbit the camera; click and drag a
 * product to move it to a new spot on the floor.
 */
class CasScene {
  /** @type {{ root: any, hitMesh: any, ring: any, title: string, setDragging: (isDragging: boolean) => void }[]} */
  groups = [];
  /** @type {any} */
  selected = null;
  #frameId = 0;

  constructor({ THREE, GLTFLoader, OrbitControls, container, labelEl }) {
    this.THREE = THREE;
    this.container = container;
    this.labelEl = labelEl;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 480;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf1f1ef);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(4, 5, 8);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.5, 0);
    this.controls.maxPolarAngle = Math.PI / 2.1;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 20;
    this.controls.update();

    const hemi = new THREE.HemisphereLight(0xffffff, 0x555555, 1.2);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(5, 10, 5);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    this.scene.add(dir);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(8, 48),
      new THREE.MeshStandardMaterial({ color: 0xe2e2de, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.scene.add(new THREE.GridHelper(16, 32, 0xbdbdb8, 0xd8d8d3));

    this.loader = new GLTFLoader();
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.raycaster = new THREE.Raycaster();
    this.pointerNDC = new THREE.Vector2();
    this.dragOffset = new THREE.Vector3();

    this.#bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }

  #bindEvents() {
    // Registered on the wrapping container (an ancestor of the canvas) in
    // the capture phase so a hit on a product is detected, and its drag
    // started, before OrbitControls' own listener on the canvas itself
    // (which fires in the later "at target" phase) can begin a camera
    // rotate for the same gesture.
    this.container.addEventListener('pointerdown', this.#onPointerDown, { capture: true });
    window.addEventListener('pointermove', this.#onPointerMove);
    window.addEventListener('pointerup', this.#onPointerUp);
  }

  #setPointer(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  #onPointerDown = (event) => {
    this.#setPointer(event);
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.groups.map((group) => group.hitMesh),
      false
    );
    if (!hits.length) return;

    const group = this.groups.find((candidate) => candidate.hitMesh === hits[0].object);
    if (!group) return;

    event.preventDefault();
    event.stopPropagation();

    this.selected = group;
    this.controls.enabled = false;

    const groundHit = new this.THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.dragPlane, groundHit)) {
      this.dragOffset.copy(group.root.position).sub(groundHit);
    } else {
      this.dragOffset.set(0, 0, 0);
    }

    group.setDragging(true);
    if (this.labelEl) {
      this.labelEl.hidden = false;
      this.labelEl.textContent = group.title;
    }
  };

  #onPointerMove = (event) => {
    if (!this.selected) return;
    this.#setPointer(event);
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    const groundHit = new this.THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, groundHit)) return;
    groundHit.add(this.dragOffset);
    this.selected.root.position.x = clampRange(groundHit.x, -7, 7);
    this.selected.root.position.z = clampRange(groundHit.z, -7, 7);
  };

  #onPointerUp = () => {
    if (!this.selected) return;
    this.selected.setDragging(false);
    this.selected = null;
    this.controls.enabled = true;
    if (this.labelEl) this.labelEl.hidden = true;
  };

  async load(items) {
    const spacing = 2.4;
    const startX = -((items.length - 1) * spacing) / 2;

    await Promise.all(
      items.map((item, index) =>
        this.#loadOne(item, startX + index * spacing).catch((error) => {
          console.error('[cart-ar-setup] failed to load model', item.glbUrl, error);
        })
      )
    );
  }

  #loadOne(item, x) {
    const THREE = this.THREE;
    return new Promise((resolve, reject) => {
      this.loader.load(
        item.glbUrl,
        (gltf) => {
          const object = gltf.scene;
          object.traverse((node) => {
            if (node.isMesh) {
              node.castShadow = true;
              node.receiveShadow = true;
            }
          });

          const box = new THREE.Box3().setFromObject(object);
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          object.scale.setScalar(1.6 / maxDim);

          const scaledBox = new THREE.Box3().setFromObject(object);
          object.position.y -= scaledBox.min.y;

          const root = new THREE.Group();
          root.add(object);
          root.position.set(x, 0, 0);
          this.scene.add(root);

          const hitSize = new THREE.Vector3();
          new THREE.Box3().setFromObject(root).getSize(hitSize);
          const hitMesh = new THREE.Mesh(
            new THREE.BoxGeometry(Math.max(hitSize.x, 0.4), Math.max(hitSize.y, 0.4), Math.max(hitSize.z, 0.4)),
            new THREE.MeshBasicMaterial({ visible: false })
          );
          hitMesh.position.y = hitSize.y / 2;
          root.add(hitMesh);

          const ringRadius = Math.max(hitSize.x, hitSize.z) / 2;
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(ringRadius + 0.05, ringRadius + 0.12, 32),
            new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0 })
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.01;
          root.add(ring);

          this.groups.push({
            root,
            hitMesh,
            title: item.title,
            setDragging(isDragging) {
              ring.material.opacity = isDragging ? 0.35 : 0;
            },
          });

          resolve();
        },
        undefined,
        reject
      );
    });
  }

  resize() {
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 480;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  start() {
    if (this.#frameId) return;
    const tick = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.#frameId = requestAnimationFrame(tick);
    };
    this.#frameId = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.#frameId);
    this.#frameId = 0;
  }

  dispose() {
    this.stop();
    this.resizeObserver.disconnect();
    this.container.removeEventListener('pointerdown', this.#onPointerDown, { capture: true });
    window.removeEventListener('pointermove', this.#onPointerMove);
    window.removeEventListener('pointerup', this.#onPointerUp);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/**
 * "View your new setup" — a shared 3D scene showing every product
 * currently in the cart that has model media, arranged on a floor.
 * Each piece can be clicked and dragged to a new spot; dragging the
 * background orbits the camera around the whole scene.
 *
 * @extends {DialogComponent}
 */
class CartArSetupComponent extends DialogComponent {
  /** @type {CasScene | undefined} */
  #scene;

  connectedCallback() {
    super.connectedCallback();
    this.refs.dialog?.addEventListener('close', this.#handleDialogClose);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.refs.dialog?.removeEventListener('close', this.#handleDialogClose);
    this.#scene?.dispose();
    this.#scene = undefined;
  }

  #handleDialogClose = () => {
    this.#scene?.stop();
  };

  open() {
    this.showDialog();
    this.#initScene().catch((error) => {
      console.error('[cart-ar-setup] failed to load scene', error);
      const loadingEl = this.querySelector('[data-cas-loading]');
      if (loadingEl instanceof HTMLElement) {
        loadingEl.hidden = false;
        loadingEl.textContent = "Couldn't load your setup. Try closing and reopening this window.";
      }
    });
  }

  close() {
    this.closeDialog();
  }

  async #initScene() {
    if (this.#scene) {
      this.#scene.resize();
      this.#scene.start();
      return;
    }

    const wrap = this.querySelector('[data-cas-canvas-wrap]');
    const itemsScript = this.querySelector('[data-cas-items]');
    const loadingEl = this.querySelector('[data-cas-loading]');
    const labelEl = this.querySelector('[data-cas-label]');
    if (!(wrap instanceof HTMLElement) || !itemsScript) return;

    /** @type {{ title: string, glbUrl: string }[]} */
    let items = [];
    try {
      items = JSON.parse(itemsScript.textContent || '[]');
    } catch {
      items = [];
    }
    if (!items.length) return;

    const { THREE, GLTFLoader, OrbitControls } = await loadThree();

    this.#scene = new CasScene({ THREE, GLTFLoader, OrbitControls, container: wrap, labelEl });
    this.#scene.start();
    await this.#scene.load(items);
    if (loadingEl instanceof HTMLElement) loadingEl.hidden = true;
  }
}

if (!customElements.get('cart-ar-setup-component')) {
  customElements.define('cart-ar-setup-component', CartArSetupComponent);
}
