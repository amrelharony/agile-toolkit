import { dot, ring } from "../../pen";
import { SCENE_PEN, SCENE_VIEWBOX, type InkDrawing } from "../../types";

/**
 * Home's hero: the team's sprint board (to do, doing, done) under the loop of
 * the sprint, with a mug of coffee at its corner. Only the home page imports it.
 */
export const HOME_HERO: InkDrawing = {
  name: "home-hero",
  viewBox: SCENE_VIEWBOX,
  pen: SCENE_PEN,
  bleed: true,
  washes: [
    { cx: 160, cy: 110, rx: 146, ry: 80, seed: 501, tone: "accent2" },
    { cx: 274, cy: 172, rx: 38, ry: 22, seed: 502, tone: "accent" },
  ],
  strokes: [
    {
      d: "M28.6 40.4Q160 36.2 291.6 40",
      fill: "paper",
      fillD: "M30 40.4Q160 36.2 290 40L289.6 175.6Q160 179 30 175.4Z",
    },
    { d: "M289.4 38.4Q292 110 289.2 177" },
    { d: "M291.4 175.4Q160 179.2 27.6 175" },
    { d: "M30.2 177.2Q27.4 110 30.6 38.2" },
    { d: "M116.2 47Q117.6 110 115.4 169M203.4 47Q202.2 110 204.2 169", tone: "sub", w: 1.8 },
    { d: "M46.4 56.6L84.4 55.6M132.4 56.4L178.4 55.8M220.4 56.6L256.4 55.8", tone: "sub", w: 2.2 },
    { d: "M44.2 68.6L80.6 67.4L81.4 97.4L45 98.6Z", fill: "warning" },
    { d: "M51.4 77.4L72.4 76.6M51.4 85.4L66.4 85", tone: "sub", w: 1.8 },
    { d: "M60.4 108.8L96.4 108.2L96.2 138.4L60.6 139.2Z", fill: "accent2" },
    { d: "M67.4 117.6L88.4 117.2", tone: "sub", w: 1.8 },
    { d: "M130.4 70.4L168.6 71.2L167.4 102.6L129.6 101.6Z", fill: "accent" },
    { d: "M137.4 80.4L160.4 80.8M137.4 88.6L154.4 88.8", tone: "sub", w: 1.8 },
    { d: "M149.2 112.4L183.4 113L182.6 141.6L148.6 141Z", fill: "accent3" },
    { d: "M155.4 121.4L175.4 121.8", tone: "sub", w: 1.8 },
    { d: "M218.4 66.4L254.6 67.2L253.8 96.6L217.6 95.8Z", fill: "success" },
    { d: "M226.4 82.4L232.6 88.6L245.4 74.6", tone: "success", w: 3 },
    { d: "M236.4 110.4L272.4 109.6L272.8 139.6L236.8 140.4Z", fill: "success" },
    { d: "M244.4 126.4L250.6 132.6L263.4 118.6", tone: "success", w: 3 },
    { d: "M78.4 30.4Q160 2.4 243.6 26.2", tone: "accent", w: 3.2 },
    { d: "M231.4 17.6L245 26.6L231.2 32.8", tone: "accent", w: 3.2 },
    {
      d: "M259.4 151.6Q279 156 300.6 151.4",
      fill: "paper",
      fillD:
        "M260 152Q279 156 300 151.6L297.4 188Q296.4 192.4 291.4 192.4L270.6 192.6Q265.6 192.4 264.6 188Z",
    },
    {
      d: "M260.2 152.2L264.4 188Q265.4 192.6 270.6 192.6L291.4 192.4Q296.4 192.2 297.4 187.6L300.4 151.4",
    },
    { d: "M298.6 160.4Q311.4 159.6 309.6 170.4Q307.8 178.6 296.6 178.2" },
    {
      d: "M272.4 144.4Q268 138 273 132.4Q277.4 126.6 273 120.4M285.4 144.4Q281 138 286 132.4",
      tone: "sub",
      w: 1.8,
    },
    { d: ring(266.4, 31.4, 1.8), tone: "warning", w: 3 },
    { d: `${dot(48, 24.6)}${dot(296.4, 64.4)}`, tone: "warning", w: 3.4 },
  ],
};
