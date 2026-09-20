import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VRMLoaderPlugin} from '@pixiv/three-vrm';

const job = new URLSearchParams(location.search).get('job') || 'miku-reconstructed';
if (!/^[a-zA-Z0-9_-]+$/.test(job)) throw Error('Invalid job');
const base = `/jobs/${job}/`;
let engineName='真实重建';
fetch(base+'project.json').then(r=>r.ok?r.json():{}).then(p=>{
  if(p.name){document.querySelector('#character-name').textContent='模型验收 / '+p.name;document.title='Avatar Studio · '+p.name;}
  if(p.source || p.engine){engineName=p.source || p.engine;document.querySelector('#engine').textContent=engineName+' · VRM 1.0';}
  if((p.source||'').includes('Hunyuan'))document.querySelector('.note').textContent='豆包三视图联合重建草稿。视图差异、贴图接缝和未提供的另一侧细节仍需修正；骨骼为初步绑定，无表情或头发物理。';
}).catch(()=>{});
document.querySelector('#reference').src = base+'source.png';
document.querySelector('#download').href = base+'avatar.vrm';
document.querySelector('#download-glb').href = base+'avatar.glb';
const viewport = document.querySelector('#viewport');
const scene = new THREE.Scene(); scene.background = new THREE.Color('#111921');
const camera = new THREE.PerspectiveCamera(32,1,.01,100);
const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio,1.5),2));viewport.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0,.8,0); controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff,0x4b5568,2));
const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,4,5);scene.add(light);
const grid=new THREE.GridHelper(4,24,0x31545e,0x202f39);scene.add(grid);
let root, helper, vrm, mixer;
let previousTime = performance.now();
window.modelQA={ready:false,errors:[]};
window.addEventListener('error',e=>window.modelQA.errors.push(e.message));
function view(which){const pos={front:[0,.9,3.9],side:[3.9,.9,0],back:[0,.9,-3.9],face:[0,1.44,1.25]};camera.position.set(...pos[which]);controls.target.set(0,which==='face'?1.44:.8,which==='face'?.12:0);controls.update();}
window.setModelView=view;
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
document.querySelector('#bones').onchange=e=>{if(helper)helper.visible=e.target.checked;};
const loader = new GLTFLoader(); loader.register(parser=>new VRMLoaderPlugin(parser));
async function load(file){
 try{
  window.modelQA={ready:false,errors:[]};document.querySelector('#state').textContent='正在载入模型…';
  if(root)scene.remove(root);if(helper)scene.remove(helper);
  const gltf=await loader.loadAsync(base+file);root=gltf.scene;vrm=gltf.userData.vrm;
  scene.add(root);root.updateMatrixWorld(true);
  helper=new THREE.SkeletonHelper(root);helper.visible=document.querySelector('#bones').checked;scene.add(helper);
  mixer=new THREE.AnimationMixer(root);if(gltf.animations[0])mixer.clipAction(gltf.animations[0]).play();
  let vertices=0,triangles=0,skins=0,bones=0;const seen=new Set();root.traverse(o=>{if(o.isMesh){const p=o.geometry.attributes.position;if(!seen.has(p.array)){vertices+=p.count;seen.add(p.array);}triangles+=(o.geometry.index?.count||p.count)/3;if(o.material.map)o.material.map.anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());}if(o.isSkinnedMesh)skins++;if(o.isBone)bones++;});
  const bounds=new THREE.Box3().setFromObject(root);window.loadedAvatar={root,vrm,renderer,camera,scene};
  window.modelQA={ready:true,vrm:!!vrm,vertices,triangles,skins,bones,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},errors:[]};
  document.querySelector('#stats').textContent=`${vertices.toLocaleString()} 顶点\n${triangles.toLocaleString()} 三角形\n${bones} 骨骼 · ${skins} 蒙皮网格`;
  document.querySelector('#state').textContent=vrm?'VRM 已载入':'GLB 已载入';document.querySelector('#detail').textContent=vrm?'VRM 1.0 · 真实网格':engineName+' 原始输出';
  view('front');
 }catch(e){window.modelQA.errors.push(e.message);document.querySelector('#state').textContent='加载失败：'+e.message;console.error(e);}
}
document.querySelector('#model').onchange=e=>load(e.target.value);
new ResizeObserver(()=>{const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}).observe(viewport);
renderer.setAnimationLoop(()=>{const now=performance.now();const dt=(now-previousTime)/1000;previousTime=now;if(document.querySelector('#motion').checked){if(vrm){const head=vrm.humanoid.getNormalizedBoneNode('head');if(head)head.rotation.y=Math.sin(now/600)*.20;}else if(mixer)mixer.update(dt);}else if(vrm){const head=vrm.humanoid.getNormalizedBoneNode('head');if(head)head.rotation.y=0;}if(vrm)vrm.update(dt);controls.update();renderer.render(scene,camera);});
load(document.querySelector('#model').value);
