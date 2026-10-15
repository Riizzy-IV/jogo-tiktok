// Gera AvataresDaLive.rbxlx (mapa do Roblox Studio) com o cenário e os scripts da pasta roblox/.
// Rode depois de mexer nos .lua ou aqui: npm run build:roblox
//
// Cena pensada para live vertical: a câmera (CameraLive) olha para -Z e o recorte 9:16 do centro
// da janela pega o palco inteiro (20 studs de largura), o telão e os refletores.
// Nomes que o script usa: Palco (onde os avatares ficam), Cenario/Telao, Cenario/Refletor*, Cenario/Neon*.
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const lua = (file) => fs.readFileSync(path.join(dir, 'roblox', file), 'utf8');

let ref = 0;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cdata = (s) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

function item(cls, props, children = []) {
  return `<Item class="${cls}" referent="RBX${++ref}"><Properties>${props.join('')}</Properties>${children.join('')}</Item>`;
}
const str = (n, v) => `<string name="${n}">${esc(v)}</string>`;
const bool = (n, v) => `<bool name="${n}">${v}</bool>`;
const float = (n, v) => `<float name="${n}">${v}</float>`;
const token = (n, v) => `<token name="${n}">${v}</token>`;
const vec3 = (n, [x, y, z]) => `<Vector3 name="${n}"><X>${x}</X><Y>${y}</Y><Z>${z}</Z></Vector3>`;
const color = (n, [r, g, b]) => `<Color3uint8 name="${n}">${((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0}</Color3uint8>`;
const color3 = (n, [r, g, b]) => `<Color3 name="${n}"><R>${r / 255}</R><G>${g / 255}</G><B>${b / 255}</B></Color3>`;
const source = (code) => `<ProtectedString name="Source">${cdata(code)}</ProtectedString>`;

// CFrame posicionado em `pos` olhando para `target` (mesma conta do CFrame.lookAt do Roblox)
function lookAt(pos, target) {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const look = norm(sub(target, pos));
  const right = norm(cross(look, [0, 1, 0]));
  const up = cross(right, look);
  const back = look.map((v) => -v);
  const [x, y, z] = pos;
  const r = (v) => +v.toFixed(6);
  return `<CoordinateFrame name="CFrame"><X>${x}</X><Y>${y}</Y><Z>${z}</Z>`
    + `<R00>${r(right[0])}</R00><R01>${r(up[0])}</R01><R02>${r(back[0])}</R02>`
    + `<R10>${r(right[1])}</R10><R11>${r(up[1])}</R11><R12>${r(back[1])}</R12>`
    + `<R20>${r(right[2])}</R20><R21>${r(up[2])}</R21><R22>${r(back[2])}</R22></CoordinateFrame>`;
}
const at = ([x, y, z]) => `<CoordinateFrame name="CFrame"><X>${x}</X><Y>${y}</Y><Z>${z}</Z>`
  + '<R00>1</R00><R01>0</R01><R02>0</R02><R10>0</R10><R11>1</R11><R12>0</R12><R20>0</R20><R21>0</R21><R22>1</R22></CoordinateFrame>';

const MAT = { plastic: 256, smooth: 272, neon: 288, metal: 1088, glass: 1568 };
// part(nome, centro ou CFrame pronto, tamanho, cor, material, { solid, transparency, children })
function part(name, pos, size, rgb, mat, opt = {}) {
  const props = [str('Name', name), bool('Anchored', true), typeof pos === 'string' ? pos : at(pos), vec3('size', size),
    color('Color3uint8', rgb), token('Material', MAT[mat]), token('TopSurface', 0), token('BottomSurface', 0)];
  if (opt.solid === false) props.push(bool('CanCollide', false), bool('CanQuery', false));
  if (opt.transparency) props.push(float('Transparency', opt.transparency));
  if (opt.castShadow === false) props.push(bool('CastShadow', false));
  return item('Part', props, opt.children || []);
}
const pointLight = (rgb, range, brightness) =>
  item('PointLight', [str('Name', 'Luz'), color3('Color', rgb), float('Range', range), float('Brightness', brightness)]);
const neon = (name, pos, size, rgb, light) =>
  part(name, pos, size, rgb, 'neon', { solid: false, castShadow: false, children: light ? [pointLight(rgb, light, 1.2)] : [] });

const CYAN = [37, 244, 238];
const PINK = [254, 44, 85];
const YELLOW = [255, 210, 63];
const PURPLE = [150, 80, 255];

// ---------- Palco em degraus (o de trás mais alto, para ninguém ficar escondido) ----------
const W = 20;              // largura do palco
const STEP = { depth: 8, rise: 1.5 };
const tiers = [0, 1, 2, 3].map((i) => ({ i, top: STEP.rise * (i + 1), z: 12 - i * STEP.depth }));
const tierColors = [[46, 36, 84], [40, 32, 74], [46, 36, 84], [40, 32, 74]];
const stripColors = [CYAN, PINK, YELLOW, PURPLE];
const backZ = tiers[3].z - STEP.depth / 2; // -16
const topY = tiers[3].top;                 // 6

const palco = item('Model', [str('Name', 'Palco')], tiers.map((t) =>
  part(`Degrau${t.i + 1}`, [0, t.top / 2, t.z], [W, t.top, STEP.depth], tierColors[t.i], 'smooth')));

// ---------- Cenário ----------
const cena = [];
// Bordas neon na frente de cada degrau
for (const t of tiers) cena.push(neon(`NeonDegrau${t.i + 1}`, [0, t.top - 0.15, t.z + STEP.depth / 2 + 0.05], [W, 0.3, 0.3], stripColors[t.i], 10));
// Faixa neon no chão, na frente do palco
cena.push(neon('NeonFrente', [0, 0.1, 17.5], [W + 4, 0.2, 0.6], CYAN, 12));

// Telão no fundo com moldura neon
const tel = { w: 22, h: 16, z: backZ - 1 };
const telY = topY + tel.h / 2 + 0.5;
cena.push(part('Telao', [0, telY, tel.z], [tel.w, tel.h, 1], [10, 10, 18], 'smooth'));
cena.push(part('BaseTelao', [0, (topY + 0.5) / 2, tel.z], [tel.w + 2, topY + 0.5, 1.4], [24, 22, 36], 'metal'));
const fz = tel.z + 0.6;
cena.push(neon('NeonMolduraTopo', [0, telY + tel.h / 2 + 0.3, fz], [tel.w + 1.2, 0.6, 0.4], PINK));
cena.push(neon('NeonMolduraBase', [0, telY - tel.h / 2 - 0.3, fz], [tel.w + 1.2, 0.6, 0.4], PINK));
cena.push(neon('NeonMolduraEsq', [-tel.w / 2 - 0.3, telY, fz], [0.6, tel.h + 1.2, 0.4], PINK));
cena.push(neon('NeonMolduraDir', [tel.w / 2 + 0.3, telY, fz], [0.6, tel.h + 1.2, 0.4], PINK));

// Torres e travessa com os refletores
const towerX = W / 2 + 3;
const towerZ = -4;
const towerH = 28;
for (const s of [-1, 1]) {
  cena.push(part(`Torre${s < 0 ? 'Esq' : 'Dir'}`, [s * towerX, towerH / 2, towerZ], [1.4, towerH, 1.4], [38, 38, 48], 'metal'));
  cena.push(neon(`NeonTorre${s < 0 ? 'Esq' : 'Dir'}`, [s * towerX, towerH / 2, towerZ + 0.75], [0.25, towerH - 2, 0.15], s < 0 ? CYAN : PINK));
}
cena.push(part('Travessa', [0, towerH, towerZ], [towerX * 2 + 1.4, 1.2, 1.2], [38, 38, 48], 'metal'));
[-9, -3, 3, 9].forEach((x, k) => cena.push(part(`Refletor${k + 1}`, lookAt([x, towerH - 1.4, towerZ], [x * 0.3, 2, 4]),
  [1.4, 1.4, 2.2], [20, 20, 26], 'metal', { castShadow: false })));

// Caixas de som nas laterais da frente
for (const s of [-1, 1]) {
  const x = s * (W / 2 + 2.5);
  cena.push(part(`Caixa${s < 0 ? 'Esq' : 'Dir'}`, [x, 3.5, 11], [3.6, 7, 3.6], [18, 18, 22], 'smooth'));
  cena.push(neon(`NeonCaixa${s < 0 ? 'Esq' : 'Dir'}`, [x, 6.4, 12.85], [2.8, 0.25, 0.1], s < 0 ? CYAN : PINK));
  cena.push(part(`Alto${s < 0 ? 'Esq' : 'Dir'}`, [x, 3, 12.85], [2.6, 2.6, 0.1], [40, 40, 52], 'metal'));
}

// Cidade ao fundo (aparece acima do telão na câmera vertical)
const predios = [];
for (let i = 0; i < 11; i++) {
  const x = -75 + i * 15;
  const z = -70 - (i % 3) * 14;
  const h = 30 + ((i * 37) % 34);
  const w = 11 + (i % 2) * 3;
  predios.push(part(`Predio${i + 1}`, [x, h / 2, z], [w, h, 10], [26, 22, 44], 'smooth', { castShadow: false }));
  const janela = [CYAN, PINK, PURPLE][i % 3];
  predios.push(part(`Janela${i + 1}`, [x, h * 0.55, z + 5.05], [w * 0.6, h * 0.7, 0.1], janela, 'neon', { solid: false, transparency: 0.75, castShadow: false }));
}
cena.push(item('Folder', [str('Name', 'Cidade')], predios));

// Luz de frente (de onde está a câmera) para os avatares não ficarem no escuro
cena.push(part('LuzFrente', lookAt([0, 16, 34], [0, 4, 0]), [1, 1, 1], [255, 255, 255], 'plastic', {
  solid: false, transparency: 1, castShadow: false,
  children: [item('SpotLight', [str('Name', 'Luz'), color3('Color', [255, 236, 220]), float('Range', 60), float('Brightness', 1.4),
    float('Angle', 70), token('Face', 5), bool('Shadows', true)])],
}));

// Câmera: recorte 9:16 do centro da janela pega o palco inteiro
const camera = part('CameraLive', lookAt([0, 12.5, 43], [0, 10, -4]), [1, 1, 1], [255, 255, 255], 'plastic',
  { solid: false, transparency: 1, castShadow: false });

const workspace = item('Workspace', [str('Name', 'Workspace')], [
  part('Chao', [0, -1, 0], [600, 2, 600], [16, 14, 28], 'smooth'),
  palco,
  item('Folder', [str('Name', 'Cenario')], cena),
  camera,
]);

// Noite com bruma roxa e brilho no neon
const lighting = item('Lighting', [
  str('Name', 'Lighting'), str('TimeOfDay', '20:45:00'), float('Brightness', 1.2), float('ExposureCompensation', 0),
  color3('Ambient', [70, 60, 105]), color3('OutdoorAmbient', [95, 85, 140]), bool('GlobalShadows', true), token('Technology', 4),
  float('EnvironmentDiffuseScale', 1), float('EnvironmentSpecularScale', 1),
], [
  item('Atmosphere', [str('Name', 'Atmosphere'), float('Density', 0.32), float('Offset', 0.2), color3('Color', [110, 70, 170]),
    color3('Decay', [70, 30, 120]), float('Glare', 0), float('Haze', 1.4)]),
  item('BloomEffect', [str('Name', 'Brilho'), float('Intensity', 0.4), float('Size', 24), float('Threshold', 1.8)]),
  item('ColorCorrectionEffect', [str('Name', 'Cores'), float('Saturation', 0.15), float('Contrast', 0.1)]),
]);

const xml = `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" version="4">${[
  workspace,
  lighting,
  item('Players', [str('Name', 'Players'), bool('CharacterAutoLoads', false)]),
  item('HttpService', [str('Name', 'HttpService'), bool('HttpEnabled', true)]),
  item('ServerScriptService', [str('Name', 'ServerScriptService')], [
    item('Script', [str('Name', 'AvataresDaLive'), source(lua('AvataresDaLive.server.lua'))]),
  ]),
  item('StarterPlayer', [str('Name', 'StarterPlayer')], [
    item('StarterPlayerScripts', [str('Name', 'StarterPlayerScripts')], [
      item('LocalScript', [str('Name', 'AvataresTela'), source(lua('AvataresTela.client.lua'))]),
    ]),
  ]),
].join('\n')}\n</roblox>\n`;

const out = path.join(dir, 'AvataresDaLive.rbxlx');
fs.writeFileSync(out, xml);
console.log(`Gerado ${path.relative(process.cwd(), out)}`);
