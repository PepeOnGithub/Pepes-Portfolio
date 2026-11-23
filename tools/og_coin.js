// Renders each creator's profile picture as a glossy 3D coin (transparent PNG) for the link-preview images.
// usage: node og_coin.js jobs.json outdir   jobs: [{ key, image, rim, side }]  (image = file path, colors = #rrggbb)
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), out = process.argv[3];
fs.mkdirSync(out, { recursive: true });
const root = path.join(__dirname, 'node_modules');
const srv = http.createServer((q, s) => {
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }); fs.createReadStream(f).pipe(s);
}).listen(0, async () => {
  const port = srv.address().port;
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 900, height: 900 } });
  p.on('pageerror', (e) => console.log('page error', e.message));
  await p.setContent(`<canvas id=c width=900 height=900></canvas>
  <script type=importmap>{"imports":{"three":"http://127.0.0.1:${port}/three/build/three.module.js","three/addons/":"http://127.0.0.1:${port}/three/examples/jsm/"}}</script>
  <script type=module>
  import * as THREE from 'three';
  import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
  const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(900, 900, false); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = .9; r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.enabled = true;
  const scene = new THREE.Scene(); scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .15;
  const cam = new THREE.PerspectiveCamera(24, 1, 100, 4000); cam.position.set(0, 0, 1400);
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-380, 520, 700); key.castShadow = true; scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 2.2); rim.position.set(500, -200, -300); scene.add(rim);
  window.draw = async (img, rimCol, sideCol, ry, rx) => {
    while (scene.children.length > 3) scene.remove(scene.children[scene.children.length - 1]);
    rim.color.set(rimCol);
    const tex = await new Promise((res) => new THREE.TextureLoader().load(img, res)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const g = new THREE.Group(); scene.add(g);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(200, 200, 40, 128), [
      new THREE.MeshPhysicalMaterial({ color: sideCol, metalness: .6, roughness: .3, clearcoat: 1 }),
      new THREE.MeshPhysicalMaterial({ map: tex, metalness: 0, roughness: .75, clearcoat: .08, clearcoatRoughness: .5 }),
      new THREE.MeshPhysicalMaterial({ color: sideCol, metalness: .6, roughness: .4 })]);
    body.rotation.x = Math.PI / 2; body.castShadow = true; g.add(body);
    // the cap texture is mapped upright for a cylinder lying on its side
    const ring = new THREE.Mesh(new THREE.TorusGeometry(204, 15, 40, 160), new THREE.MeshPhysicalMaterial({ color: rimCol, metalness: .35, roughness: .22, clearcoat: 1, clearcoatRoughness: .08 }));
    ring.scale.z = .95; ring.position.z = 2; ring.castShadow = true; g.add(ring);
    g.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), 0);
    r.render(scene, cam); return c.toDataURL('image/png');
  };
  window.ready = true;
  </script>`);
  await p.waitForFunction('window.ready', null, { timeout: 60000 });
  for (const j of jobs) {
    try {
      const data = 'data:image/png;base64,' + fs.readFileSync(j.image).toString('base64');
      const url = await p.evaluate(([i, a, s]) => window.draw(i, a, s, 0, -14), [data, j.rim, j.side]);
      fs.writeFileSync(path.join(out, j.key + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    } catch (e) { console.log('coin failed', j.key, e.message); }
  }
  await b.close(); srv.close();
});
