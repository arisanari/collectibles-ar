/**
 * A lens flare drawn by a fragment shader (plain WebGL, no library): how a real light looks through a camera, not a drawn star.
 * Layers, all computed per pixel and then tone-mapped so the middle burns out to white smoothly:
 *   core and halo   - brightness falls with the square of the distance, with a wide soft halo
 *   blades          - six thin diffraction spikes (what a lens aperture does to a point light) and six fainter ones between them
 *   fine rays       - many hair-thin streaks of uneven strength (noise round the circle), longest right after the burst
 *   streak          - the wide horizontal line of an anamorphic lens, slightly blue
 *   ring            - a thin halo running outward, split into colours at its edge
 *   ghosts          - faint coloured discs on the line through the middle of the screen
 * The canvas is black where there is no light; the page blends it over the camera image with mix-blend-mode: screen.
 */
const VERT = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";
const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform vec2 uC;
uniform float uT;
uniform vec3 uTint;
uniform float uSeed;
uniform float uPower;
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 ghost(vec2 p, vec2 c, float r, vec3 tint) {
  float d = length(p - c);
  float disc = 1.0 - smoothstep(r * 0.86, r, d);
  float rim = smoothstep(r * 0.6, r, d) * 0.7 + 0.3;
  return tint * disc * rim;
}
void main() {
  vec2 p = (gl_FragCoord.xy - uC) / uRes.y;
  float d = length(p) + 1e-4;
  vec2 dir = p / d;
  float t = uT;
  // before the opening the light builds a little; at the opening it jumps, then dies away
  float build = smoothstep(-0.4, 0.0, t);
  float pop = smoothstep(0.0, 0.05, t);
  float burst = t < 0.0 ? 0.0 : exp(-t * 2.2);
  float power = uPower * (0.1 * build * build * (1.0 - pop) + pop * (0.3 + 1.5 * burst));

  float core = 0.0009 / (d * d + 0.00002);
  float halo = 0.35 * exp(-d * 7.0) + 0.12 * exp(-d * 2.2);

  float a = atan(p.y, p.x);
  float blades = pow(abs(cos(a * 3.0 + uSeed)), 90.0) + 0.5 * pow(abs(cos(a * 3.0 + uSeed + 0.52)), 300.0);
  float bladeLen = 0.22 + 0.95 * pop * (0.35 + burst);
  float spikes = blades * 0.05 / (d + 0.02) * (1.0 - smoothstep(0.0, bladeLen, d));

  float n1 = vnoise(dir * 14.0 + uSeed * 10.0);
  float n2 = vnoise(dir * 37.0 + uSeed * 3.0 + t * 0.6);
  float fine = pow(n1, 5.0) * 1.2 + pow(n2, 9.0) * 1.5;
  float rayLen = 0.14 + 0.8 * pop * (0.3 + burst);
  float rays = fine * 0.03 / (d + 0.03) * (1.0 - smoothstep(0.0, rayLen, d));

  float streak = (exp(-abs(p.y) * 140.0) * 0.5 + exp(-abs(p.y) * 600.0) * 0.6) / (abs(p.x) * 6.0 + 0.6) * (0.5 + 0.9 * pop);

  vec3 warm = mix(vec3(1.0), uTint, 0.55);
  vec3 col = (core + halo) * mix(vec3(1.0), uTint, 0.3) + spikes * warm + rays * uTint * 1.2 + streak * vec3(0.72, 0.84, 1.0);
  col *= power;

  if (t > 0.0) {
    float r0 = 0.1 + 0.6 * (1.0 - exp(-t * 5.0));
    float w = 0.01 + 0.025 * t;
    vec3 q = (vec3(d) - r0 * vec3(1.035, 1.0, 0.965)) / w;
    vec3 ring = exp(-q * q);
    col += ring * 0.3 * exp(-t * 4.5) * uPower;
    vec2 sc = (uRes * 0.5 - uC) / uRes.y;
    vec3 gh = ghost(p, sc * 0.55, 0.035, vec3(0.5, 0.9, 0.7)) + ghost(p, sc * 1.35, 0.06, vec3(0.9, 0.6, 0.4)) + ghost(p, sc * 2.0, 0.11, vec3(0.45, 0.55, 1.0)) + ghost(p, sc * 2.6, 0.03, vec3(1.0, 0.9, 0.5));
    col += gh * 0.07 * burst * uPower;
  }
  col = 1.0 - exp(-col * 1.6);
  gl_FragColor = vec4(col, 1.0);
}`;

export type Flare = {
  /** t = seconds from the opening (negative while it builds); x, y = the light's place in CSS px from the canvas's top left; tint 0..255. */
  draw: (o: { t: number; x: number; y: number; tint: [number, number, number]; seed: number; power: number }) => void;
  dispose: () => void;
};

/** Sets up the shader on the canvas. Null when WebGL is not available (the caller then simply shows no flare). */
export function createFlare(canvas: HTMLCanvasElement): Flare | null {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false });
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string) => gl.getUniformLocation(prog, name);
  const uRes = u("uRes");
  const uC = u("uC");
  const uT = u("uT");
  const uTint = u("uTint");
  const uSeed = u("uSeed");
  const uPower = u("uPower");
  return {
    draw({ t, x, y, tint, seed, power }) {
      // one canvas pixel per CSS pixel is enough for light this soft, and keeps a full-screen shader cheap on a phone
      const w = Math.max(1, Math.round(canvas.clientWidth));
      const h = Math.max(1, Math.round(canvas.clientHeight));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
      gl.uniform2f(uC, x, h - y);
      gl.uniform1f(uT, t);
      gl.uniform3f(uTint, tint[0] / 255, tint[1] / 255, tint[2] / 255);
      gl.uniform1f(uSeed, seed);
      gl.uniform1f(uPower, power);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      // the context belongs to the canvas and is reused if the effect runs again (losing it here would leave the next run without one)
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
    },
  };
}
