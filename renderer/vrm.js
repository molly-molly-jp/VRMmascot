// renderer/vrm.js  — Three.js + @pixiv/three-vrm によるVRM表示
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { getLipSyncValue } from './lipsync.js';

export let currentVRM = null;
let lipSyncExpressionName = null;

// タスク9-1: モデル個別の口パク設定（config.json の lipsync オブジェクト）
let lipSyncSensitivity  = 1.0;
let lipSyncMaxMouthOpen = 1.0;

let renderer, scene, camera;
const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

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

function initScene(canvas) {
  const W = window.innerWidth  || 400;
  const H = window.innerHeight || 600;
  const dpr = window.devicePixelRatio || 1;

  // バッファサイズ（実ピクセル）
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);

  // ── CSSサイズは固定px ──────────────────────────────────────
  // width:100% にするとドラッグ中の setPosition() IPC で
  // Chromium がレイアウト再計算して一瞬膨張するバグが起きる。
  // UIなしウィンドウなので固定pxで問題ない。
  canvas.style.cssText =
    `position:absolute; top:0; left:0; width:${W}px; height:${H}px; z-index:0;`;

  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true, // readPixels でアルファ値を読むために必要
  });
  renderer.setPixelRatio(dpr);
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

function adjustCamera(vrm) {
  const box    = new THREE.Box3().setFromObject(vrm.scene);
  const size   = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const torsoY = center.y + size.y * 0.1;
  const W = window.innerWidth;
  const H = window.innerHeight;
  camera.position.set(center.x, torsoY, size.y * 1.8);
  camera.lookAt(center.x, torsoY, 0);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}

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
        currentVRM.expressionManager.setValue(
          lipSyncExpressionName,
          getLipSyncValue(lipSyncSensitivity, lipSyncMaxMouthOpen)
        );
      }
      currentVRM.update(delta);
    }
    renderer.render(scene, camera);
  }
  animate();
}

// ── ヒットテスト: 指定CSS座標のアルファ値をWebGLから読む ─────────
// canvas.getContext('2d') はWebGLキャンバスに使えないため
// WebGL の readPixels を使う（preserveDrawingBuffer:true が必須）
export function getAlphaAtPixel(clientX, clientY) {
  if (!renderer) return 0;
  const gl  = renderer.getContext();
  const dpr = window.devicePixelRatio || 1;
  const px  = Math.floor(clientX * dpr);
  const py  = Math.floor(renderer.domElement.height - clientY * dpr); // Y軸フリップ
  if (px < 0 || py < 0 ||
      px >= renderer.domElement.width ||
      py >= renderer.domElement.height) return 0;
  const buf = new Uint8Array(4);
  gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  return buf[3]; // 0=透明 〜 255=不透明
}

// ── 公開API ───────────────────────────────────────────────────

export async function initVRM(canvasId, vrmPath, lipsyncConfig = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) throw new Error(`canvas#${canvasId} が見つかりません`);
  initScene(canvas);
  const vrm = await loadVRM(vrmPath || 'assets/model.vrm');
  scene.add(vrm.scene);
  currentVRM = vrm;
  lipSyncExpressionName = resolveLipSyncExpression(vrm);
  lipSyncSensitivity    = lipsyncConfig.sensitivity  ?? 1.0;
  lipSyncMaxMouthOpen   = lipsyncConfig.maxMouthOpen ?? 1.0;
  console.log('[VRM] 口パクExpression:', lipSyncExpressionName,
    '| sensitivity:', lipSyncSensitivity, '| maxMouthOpen:', lipSyncMaxMouthOpen);
  adjustCamera(vrm);
  startAnimLoop();
}

export async function switchVRM(vrmPath, lipsyncConfig = {}) {
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
  lipSyncSensitivity    = lipsyncConfig.sensitivity  ?? 1.0;
  lipSyncMaxMouthOpen   = lipsyncConfig.maxMouthOpen ?? 1.0;
  console.log('[VRM] 切り替え完了 口パクExpression:', lipSyncExpressionName,
    '| sensitivity:', lipSyncSensitivity, '| maxMouthOpen:', lipSyncMaxMouthOpen);
  adjustCamera(vrm);
}
