// Hero background — the "beams" treatment: a wall of vertical light columns
// rippling through a directional key light. Ported from the React Bits
// <Beams /> component (three + @react-three/fiber + drei) into a vanilla
// three.js mount function so it matches the prototype's plain-DOM lifecycle,
// the same way aurora.js was ported. R3F only ever wrapped the scene graph
// here, so dropping it costs nothing but the two extra dependencies.
//
// The aurora curtain still runs the tour section below — see aurora.js.

import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  ShaderLib,
  ShaderMaterial,
  UniformsUtils,
  WebGLRenderer,
} from "three";

const DEFAULTS = {
  beamWidth: 2,
  beamHeight: 15,
  beamNumber: 12,
  lightColor: "#ffffff",
  // Not a React Bits prop. The upstream component hardcodes intensity 1, which
  // was tuned against an opaque black scene; ours composites over the page and
  // then gets dimmed again by the layer mask, so the key has to be dialled up
  // to survive both.
  lightIntensity: 1,
  speed: 2,
  noiseIntensity: 1.75,
  scale: 0.2,
  rotation: 0,
};

// Vertical tessellation of each beam. The ripple is a per-vertex displacement,
// so this is what decides whether the wave reads as a curve or a fold.
const HEIGHT_SEGMENTS = 100;
const BEAM_SPACING = 0;

const CAMERA_FOV = 30;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1000;
const CAMERA_Z = 20;

const KEY_LIGHT_POSITION = [0, 3, 10];
const AMBIENT_INTENSITY = 1;

// Cap at 2x so the shader stays crisp on Retina without paying for 3x panels
// — same ceiling aurora.js uses.
const MAX_DPR = 2;

// Frame advance for the ripple clock. Multiplied by the frame delta, so the
// wave keeps its speed regardless of refresh rate.
const TIME_STEP = 0.1;

// Where the ripple is frozen under prefers-reduced-motion: far enough into the
// noise field that the beams read as sculpted rather than flat.
const REDUCED_MOTION_TIME = 6;

const MATERIAL_ROUGHNESS = 0.3;
const MATERIAL_METALNESS = 0.3;
const MATERIAL_ENV_INTENSITY = 10;
// Beams are black bodies; every value you see on them is reflected key light.
const MATERIAL_DIFFUSE = "#000000";

const NOISE_GLSL = /* glsl */ `
float random (in vec2 st) {
    return fract(sin(dot(st.xy,
                         vec2(12.9898,78.233)))*
        43758.5453123);
}
float noise (in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) +
           (c - a)* u.y * (1.0 - u.x) +
           (d - b) * u.x * u.y;
}
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
vec3 fade(vec3 t) {return t*t*t*(t*(t*6.0-15.0)+10.0);}
float cnoise(vec3 P){
  vec3 Pi0 = floor(P);
  vec3 Pi1 = Pi0 + vec3(1.0);
  Pi0 = mod(Pi0, 289.0);
  Pi1 = mod(Pi1, 289.0);
  vec3 Pf0 = fract(P);
  vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;
  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);
  vec4 gx0 = ixy0 / 7.0;
  vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);
  vec4 gx1 = ixy1 / 7.0;
  vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);
  vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
  vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
  vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
  vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
  vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
  vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
  vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
  vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);
  vec4 norm0 = taylorInvSqrt(vec4(dot(g000,g000),dot(g010,g010),dot(g100,g100),dot(g110,g110)));
  g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001,g001),dot(g011,g011),dot(g101,g101),dot(g111,g111)));
  g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x,Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x,Pf1.y,Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy,Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy,Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x,Pf0.y,Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x,Pf1.yz));
  float n111 = dot(g111, Pf1);
  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000,n100,n010,n110),vec4(n001,n101,n011,n111),fade_xyz.z);
  vec2 n_yz = mix(n_z.xy,n_z.zw,fade_xyz.y);
  float n_xyz = mix(n_yz.x,n_yz.y,fade_xyz.x);
  return 2.2 * n_xyz;
}
`;

const hexToNormalizedRgb = (hex) => {
  const color = new Color(hex);
  return [color.r, color.g, color.b];
};

/**
 * Rebuild three's `physical` (MeshStandardMaterial) program as a raw
 * ShaderMaterial with extra code spliced into its `#include` seams. This is the
 * only way to get real PBR lighting on geometry that is displaced per-vertex:
 * the ripple has to run BEFORE the normal is computed, and no stock material
 * exposes that point. Both stock shaders already carry `#define STANDARD`, so
 * no defines have to be reconstructed here.
 *
 * @param {{ header: string, vertexHeader: string, vertex: Record<string, string>, fragment: Record<string, string>, uniforms: Record<string, unknown> }} config
 * @returns {ShaderMaterial}
 */
function extendPhysicalMaterial(config) {
  const physical = ShaderLib.physical;
  const uniforms = UniformsUtils.clone(physical.uniforms);
  const defaults = new MeshStandardMaterial();

  uniforms.diffuse.value = defaults.color;
  uniforms.roughness.value = defaults.roughness;
  uniforms.metalness.value = defaults.metalness;

  for (const [key, value] of Object.entries(config.uniforms)) {
    uniforms[key] = { value };
  }

  defaults.dispose();

  let vertexShader = `${config.header}\n${config.vertexHeader}\n${physical.vertexShader}`;
  let fragmentShader = `${config.header}\n${physical.fragmentShader}`;

  for (const [include, code] of Object.entries(config.vertex)) {
    vertexShader = vertexShader.replace(include, `${include}\n${code}`);
  }

  for (const [include, code] of Object.entries(config.fragment)) {
    fragmentShader = fragmentShader.replace(include, `${include}\n${code}`);
  }

  return new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    lights: true,
  });
}

/**
 * One BufferGeometry holding every beam side by side. Merged rather than
 * instanced because each beam needs its own random UV origin — that offset is
 * what stops all the columns rippling in lockstep.
 *
 * @param {number} count
 * @param {number} width
 * @param {number} height
 * @returns {BufferGeometry}
 */
function createStackedPlanesGeometry(count, width, height) {
  const geometry = new BufferGeometry();
  const vertexCount = count * (HEIGHT_SEGMENTS + 1) * 2;
  const faceCount = count * HEIGHT_SEGMENTS * 2;
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(faceCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  let vertexOffset = 0;
  let indexOffset = 0;
  let uvOffset = 0;
  const totalWidth = count * width + (count - 1) * BEAM_SPACING;
  const xOffsetBase = -totalWidth / 2;

  for (let beam = 0; beam < count; beam += 1) {
    const xOffset = xOffsetBase + beam * (width + BEAM_SPACING);
    const uvXOffset = Math.random() * 300;
    const uvYOffset = Math.random() * 300;

    for (let segment = 0; segment <= HEIGHT_SEGMENTS; segment += 1) {
      const y = height * (segment / HEIGHT_SEGMENTS - 0.5);
      positions.set([xOffset, y, 0, xOffset + width, y, 0], vertexOffset * 3);

      const uvY = segment / HEIGHT_SEGMENTS;
      uvs.set(
        [uvXOffset, uvY + uvYOffset, uvXOffset + 1, uvY + uvYOffset],
        uvOffset,
      );

      if (segment < HEIGHT_SEGMENTS) {
        const a = vertexOffset;
        const b = vertexOffset + 1;
        const c = vertexOffset + 2;
        const d = vertexOffset + 3;
        indices.set([a, b, c, c, b, d], indexOffset);
        indexOffset += 6;
      }

      vertexOffset += 2;
      uvOffset += 4;
    }
  }

  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Mount the beams field into `layer`. Mirrors mountAurora(): renders only while
 * the layer is on screen, freezes instead of animating under reduced motion,
 * and hands back a dispose() that releases the GL context.
 *
 * @param {Element | null} layer
 * @param {Partial<typeof DEFAULTS>} [options]
 * @returns {{ dispose: () => void }}
 */
export function mountBeams(layer, options = {}) {
  if (!layer) {
    return { dispose: () => {} };
  }

  const settings = { ...DEFAULTS, ...options };

  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.setClearAlpha(0);
  renderer.domElement.classList.add("beams-canvas");

  const material = extendPhysicalMaterial({
    header: `
      varying vec3 vEye;
      varying float vNoise;
      varying vec2 vUv;
      varying vec3 vPosition;
      uniform float time;
      uniform float uSpeed;
      uniform float uNoiseIntensity;
      uniform float uScale;
      ${NOISE_GLSL}`,
    vertexHeader: `
      float getPos(vec3 pos) {
        vec3 noisePos =
          vec3(pos.x * 0., pos.y - uv.y, pos.z + time * uSpeed * 3.) * uScale;
        return cnoise(noisePos);
      }
      vec3 getCurrentPos(vec3 pos) {
        vec3 newpos = pos;
        newpos.z += getPos(pos);
        return newpos;
      }
      vec3 getNormal(vec3 pos) {
        vec3 curpos = getCurrentPos(pos);
        vec3 nextposX = getCurrentPos(pos + vec3(0.01, 0.0, 0.0));
        vec3 nextposZ = getCurrentPos(pos + vec3(0.0, -0.01, 0.0));
        vec3 tangentX = normalize(nextposX - curpos);
        vec3 tangentZ = normalize(nextposZ - curpos);
        return normalize(cross(tangentZ, tangentX));
      }`,
    vertex: {
      "#include <begin_vertex>": "transformed.z += getPos(transformed.xyz);",
      "#include <beginnormal_vertex>":
        "objectNormal = getNormal(position.xyz);",
    },
    fragment: {
      "#include <dithering_fragment>": `
        float randomNoise = noise(gl_FragCoord.xy);
        gl_FragColor.rgb -= randomNoise / 15. * uNoiseIntensity;`,
    },
    uniforms: {
      diffuse: new Color(...hexToNormalizedRgb(MATERIAL_DIFFUSE)),
      time: 0,
      roughness: MATERIAL_ROUGHNESS,
      metalness: MATERIAL_METALNESS,
      uSpeed: settings.speed,
      envMapIntensity: MATERIAL_ENV_INTENSITY,
      uNoiseIntensity: settings.noiseIntensity,
      uScale: settings.scale,
    },
  });

  const geometry = createStackedPlanesGeometry(
    settings.beamNumber,
    settings.beamWidth,
    settings.beamHeight,
  );

  const scene = new Scene();
  const group = new Group();
  group.rotation.z = MathUtils.degToRad(settings.rotation);
  group.add(new Mesh(geometry, material));

  const keyLight = new DirectionalLight(
    new Color(settings.lightColor),
    settings.lightIntensity,
  );
  keyLight.position.set(...KEY_LIGHT_POSITION);
  group.add(keyLight);

  scene.add(group);
  scene.add(new AmbientLight(0xffffff, AMBIENT_INTENSITY));

  const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  camera.position.z = CAMERA_Z;

  layer.appendChild(renderer.domElement);

  function resize() {
    const width = layer.offsetWidth;
    const height = layer.offsetHeight;

    if (width === 0 || height === 0) {
      return;
    }

    // Track dpr too, so dragging the window between Retina and an external
    // display keeps the beams sharp instead of locking to the launch display.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  window.addEventListener("resize", resize);
  resize();

  let frameId = 0;
  let lastTime = 0;

  const update = (now) => {
    frameId = requestAnimationFrame(update);
    const delta = lastTime === 0 ? 0 : (now - lastTime) / 1000;
    lastTime = now;
    material.uniforms.time.value += TIME_STEP * delta;
    renderer.render(scene, camera);
  };

  function start() {
    if (frameId === 0) {
      lastTime = 0;
      frameId = requestAnimationFrame(update);
    }
  }

  function stop() {
    cancelAnimationFrame(frameId);
    frameId = 0;
  }

  // Skip GPU work while the field is scrolled offscreen — the tour below runs
  // its own WebGL curtain, and only the visible one should be rendering.
  const observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(([entry]) => {
          if (prefersReducedMotion) {
            return;
          }

          if (entry?.isIntersecting ?? true) {
            start();
          } else {
            stop();
          }
        })
      : null;
  observer?.observe(layer);

  if (prefersReducedMotion) {
    material.uniforms.time.value = REDUCED_MOTION_TIME;
    renderer.render(scene, camera);
  } else {
    start();
  }

  return {
    dispose() {
      stop();
      observer?.disconnect();
      window.removeEventListener("resize", resize);

      if (renderer.domElement.parentNode === layer) {
        layer.removeChild(renderer.domElement);
      }

      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
