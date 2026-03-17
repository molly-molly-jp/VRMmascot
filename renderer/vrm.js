// renderer/vrm.js  — Three.js + @pixiv/three-vrm によるVRM表示
// Phase 7: 複数VRM対応（遅延ロード方式）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { getLipSyncValue } from './lipsync.js';

export let currentVRM = null;
let lipSyncExpressionName = null;

// Three.js共有オブジェクト
let renderer, scene, camera;
const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

// ベースURL（VRMパス解決用）
function getBaseUrl() {
  return window.location.href.replace(/\/renderer\/[^/]+$/, '');
}

function resolveLipSyncExpression(vrm) {
  if (!vrm.expressionManager) return null;
  const em = vrm.expressionManager;
  const names = em.expressionMap instanceof Map
    ? [...em.expressionMap.keys()]
    : Object.keys(em.expressionMap ?? {});
  console.log('[VRM] Expression一覧:', names);
  for (const candidate of ['aa', 'A', 'a']) {
    if (names.includes(candidate)) return candidate;
  }
  return null;
}

// Three.jsシーン初期化（一度だけ呼ぶ）
function initScene(canvas) {
  const W = window.innerWidth  || 400;
  const H = window.innerHeight || 600;
  canvas.width  = W;
  canvas.height = H;

  // ── position:absolute を使う ──────────────────────────────
  // Electronの transparent:true + alwaysOnTop:true 環境で
  // setPosition() IPC呼び出し中に position:fixed が画面座標基準に
  // なってしまうバグを回避するため、absolute で統一する。
  canvas.style.cssText = `position:absolute; top:0; left:0; width:${W}px; height:${H}px; z-index:0;`;

  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(1, 2, 2);
  scene.add(dirLight);

  camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 20);
  camera.position.set(0, 1.3, 3.0);
  camera.lookAt(0, 1.3, 0);
}

// VRMファイルをロードしてシーンに追加
async function loadVRM(vrmPath) {
  const vrmUrl = getBaseUrl() + '/' + vrmPath;
  console.log('[VRM] Loading:', vrmUrl);
  let gltf;
  try { gltf = await loader.loadAsync(vrmUrl); }
  catch (e) { throw new Error(`VRM読み込み失敗: ${e.message}`); }

  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('gltf.userData.vrm が undefined');
  if (vrm.meta?.metaVersion === '0') VRMUtils.rotateVRM0(vrm);
  return vrm;
}

// カメラをモデルに合わせて調整
function adjustCamera(vrm) {
  const box    = new THREE.Box3().setFromObject(vrm.scene);
  const size   = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const torsoY = center.y + size.y * 0.1;
  const W = renderer.domElement.width;
  const H = renderer.domElement.height;
  camera.position.set(center.x, torsoY, size.y * 1.8);
  camera.lookAt(center.x, torsoY, 0);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}

// アニメーションループ（一度だけ起動）
let animLoopStarted = false;
const clock = new THREE.Clock();

function startAnimLoop() {
  if (animLoopStarted) return;
  animLoopStarted = true;
  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (currentVRM) {
      if (lipSyncExpressionName && currentVRM.expressionManager) {
        const lipValue = getLipSyncValue();
        currentVRM.expressionManager.setValue(lipSyncExpressionName, lipValue);
      }
      currentVRM.update(delta);
    }
    renderer.render(scene, camera);
  }
  animate();
}

// ── 公開API ───────────────────────────────────────────────────

export async function initVRM(canvasId, vrmPath) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) throw new Error(`canvas#${canvasId} が見つかりません`);
  initScene(canvas);

  const path = vrmPath || 'assets/model.vrm';
  const vrm = await loadVRM(path);
  scene.add(vrm.scene);
  currentVRM = vrm;
  lipSyncExpressionName = resolveLipSyncExpression(vrm);
  console.log('[VRM] 口パクExpression:', lipSyncExpressionName);
  adjustCamera(vrm);
  startAnimLoop();
}

export async function switchVRM(vrmPath) {
  console.log('[VRM] モデル切り替え:', vrmPath);
  if (currentVRM) {
    scene.remove(currentVRM.scene);
    VRMUtils.deepDispose(currentVRM.scene);
    currentVRM = null;
    lipSyncExpressionName = null;
  }
  const vrm = await loadVRM(vrmPath);
  scene.add(vrm.scene);
  currentVRM = vrm;
  lipSyncExpressionName = resolveLipSyncExpression(vrm);
  console.log('[VRM] 切り替え完了 口パクExpression:', lipSyncExpressionName);
  adjustCamera(vrm);
}
