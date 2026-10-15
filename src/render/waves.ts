/* ── Ripples on open water ──────────────────────────────────────
   The water's slope from ten travelling ripple trains, wavelengths
   from 6 m down to 15 cm, spread round a westerly breeze, each moving
   at its deep-water speed. The water's own material lights its
   glitter with them and the post pass bends its reflections by them,
   so the two agree. Each train fades where its wavelength comes near
   the size of a pixel on the water (pix, m), so far water smooths to
   a sheen instead of shimmering. */
export const waterTime = { value: 0 };

export const WAVES_GLSL = /* glsl */ `
vec2 waterSlope(vec2 q, float t, float pix) {
  vec2 g = vec2(0.0);
  float k = 1.05;
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    float h1 = fract(sin(fi * 12.9898 + 1.3) * 43758.5453), h2 = fract(sin(fi * 78.233 + 2.1) * 43758.5453);
    float ang = 0.3 + (h1 - 0.5) * 2.2;
    vec2 d = vec2(cos(ang), sin(ang));
    float lam = 6.2831853 / k;
    float fade = smoothstep(4.0 * pix, 10.0 * pix, lam);
    g += d * 0.011 * cos(dot(q, d) * k - sqrt(9.81 * k) * t + h2 * 6.2831853) * fade;
    k *= 1.38 + 0.25 * h2;
  }
  return g;
}
`;
