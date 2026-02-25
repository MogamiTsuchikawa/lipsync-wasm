import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin } from "@pixiv/three-vrm";

const MOUTH_KEYS = ["aa", "ih", "ou", "ee", "oh"] as const;

export class VrmScene {
  private readonly container: HTMLElement;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly clock: THREE.Clock;
  private readonly controls: OrbitControls;
  private currentVrm: VRM | null = null;
  private animationId: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#0f1b2e");

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 1.4, 2.3);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.3, 0);
    this.controls.enablePan = false;
    this.controls.update();

    this.clock = new THREE.Clock();
    this.addLights();
    this.start();
    window.addEventListener("resize", this.onResize);
    this.onResize();
  }

  dispose(): void {
    if (this.animationId !== null) {
      window.cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    window.removeEventListener("resize", this.onResize);
    if (this.currentVrm) {
      this.scene.remove(this.currentVrm.scene);
      this.currentVrm = null;
    }
    this.controls.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  async loadVrm(file: File): Promise<void> {
    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();
    loader.register((parser: any) => new VRMLoaderPlugin(parser));

    try {
      const gltf = await loader.loadAsync(url);
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm) {
        throw new Error("Selected file is not a valid VRM model");
      }

      if (this.currentVrm) {
        this.scene.remove(this.currentVrm.scene);
      }

      this.currentVrm = vrm;
      this.currentVrm.scene.rotation.y = Math.PI;
      this.scene.add(this.currentVrm.scene);
      this.resetMouth();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  applyMouth(phonemeIndex: number, intensity: number): void {
    if (!this.currentVrm?.expressionManager) {
      return;
    }

    for (let i = 0; i < MOUTH_KEYS.length; i += 1) {
      const value = i === phonemeIndex ? intensity : 0;
      this.currentVrm.expressionManager.setValue(MOUTH_KEYS[i], value);
    }
    this.currentVrm.expressionManager.update();
  }

  resetMouth(): void {
    if (!this.currentVrm?.expressionManager) {
      return;
    }
    for (const key of MOUTH_KEYS) {
      this.currentVrm.expressionManager.setValue(key, 0);
    }
    this.currentVrm.expressionManager.update();
  }

  hasVrm(): boolean {
    return this.currentVrm !== null;
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight("#f0f7ff", "#2b3242", 1.5));
    const dir = new THREE.DirectionalLight("#ffffff", 2.0);
    dir.position.set(1, 3, 2);
    this.scene.add(dir);
  }

  private onResize = (): void => {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth < 1 || clientHeight < 1) {
      return;
    }
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight);
  };

  private start(): void {
    const tick = (): void => {
      const delta = this.clock.getDelta();
      this.currentVrm?.update(delta);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.animationId = window.requestAnimationFrame(tick);
    };
    tick();
  }
}
