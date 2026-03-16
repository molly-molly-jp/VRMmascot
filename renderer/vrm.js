// renderer/vrm.js  — Three.js + @pixiv/three-vrm によるVRM表示
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { getLipSyncValue } from './lipsync.js';

export let currentVRM = null;

// VRMバージョンによって口のExpression名が異なるため起動時に解決する
let lipSyncExpressionName = null;

function resolveLipSyncExpression(vrm) {
  if (!vrm.expressionManager) return null;
  const em = vrm.expressionManager;
  const names = em.expressionMap instanceof Map
    ? [...em.expressionMap.keys()]
    : Object.keys(em.expressionMap ?? {});
  console.log('[VRM] Expression一覧:', names);
  // VRM1: 'aa' / VRM0: 'A' を優先探索
  for (const candidate of ['aa', 'A', 'a']) {
    if (names.includes(candidate)) return candidate;
  }
  return null;
}

export async function initVRM(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) throw new Error(`canvas#${canvasId} が見つかりません`);

  const W = window.innerWidth  || 400;
  const H = window.innerHeight || 600;
  canvas.width  = W;
  canvas.height = H;
  canvas.style.cssText = `position:fixed; top:0; left:0; width:${W}px; height:${H}px;`;

  // ── レンダラー ──────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // ── シーン / ライト ──────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(1, 2, 2);
  scene.add(dirLight);

  // ── カメラ ───────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 20);
  camera.position.set(0, 1.3, 3.0);
  camera.lookAt(0, 1.3, 0);

  // ── VRMロード ─────────────────────────────────────────────────
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const base   = window.location.href.replace(/\/renderer\/[^/]+$/, '');
  const vrmUrl = base + '/assets/model.vrm';
  console.log('[VRM] Loading:', vrmUrl);

  let gltf;
  try { gltf = await loader.loadAsync(vrmUrl); }
  catch (e) { throw new Error(`VRM読み込み失敗: ${e.message}`); }

  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('gltf.userData.vrm が undefined');
  if (vrm.meta?.metaVersion === '0') VRMUtils.rotateVRM0(vrm);

  scene.add(vrm.scene);
  currentVRM = vrm;

  // 口パク用ExpressionNameを解決
  lipSyncExpressionName = resolveLipSyncExpression(vrm);
  console.log('[VRM] 口パクExpression:', lipSyncExpressionName);

  // BoundingBoxからカメラを上半身に自動調整
  const box    = new THREE.Box3().setFromObject(vrm.scene);
  const size   = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const torsoY = center.y + size.y * 0.1;
  camera.position.set(center.x, torsoY, size.y * 1.8);
  camera.lookAt(center.x, torsoY, 0);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();

  // ── アニメーションループ ──────────────────────────────────────
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    // 口パク: AnalyserNodeから音量を取得してBlendShapeに反映
    if (lipSyncExpressionName && vrm.expressionManager) {
      const lipValue = getLipSyncValue();
      vrm.expressionManager.setValue(lipSyncExpressionName, lipValue);
    }

    vrm.update(delta);
    renderer.render(scene, camera);
  }
  animate();
}
