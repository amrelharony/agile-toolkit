import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Quick Vote: a hand raised beside a ballot box, a ticked ballot going into its slot. */
const art: InkDrawing = {
  name: "quick-vote",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 54, rx: 40, ry: 32, seed: 4202, tone: "accent" }],
  strokes: [
    { d: "M36.4 48.4L46.2 40.6L88.4 40.8L80.2 48.6Z", fill: "accent2" },
    {
      d: "M51 44.8L52.6 20.4Q52.8 18.4 54.8 18.6L72.6 19.8Q74.6 20 74.4 22L72.8 44.8",
      fill: "paper",
      fillD: "M51 44.8L52.6 20.4Q52.8 18.4 54.8 18.6L72.6 19.8Q74.6 20 74.4 22L72.8 44.8Z",
    },
    { d: "M57.6 33L61.6 38.2L68.6 27.2", tone: "accent", w: 2.8 },
    { d: "M48.4 44.8L75.4 44.8", w: 2.8 },
    { d: "M36.4 48.4L80.2 48.6L78.6 86.2L38 86Z", fill: "paper" },
    { d: "M80.2 48.6L88.4 40.8L87.4 76.8L78.6 86.2", fill: "paper" },
    { d: "M47 62.4L69.4 62.4", tone: "sub", w: 1.6 },
    {
      d: "M14.6 52.6L13.6 31Q13.4 28.4 15.6 28.4Q17.8 28.4 18 31L18 22Q18 19.6 20.2 19.6Q22.4 19.6 22.4 22L22.6 19Q22.6 16.6 24.8 16.6Q27 16.6 27 19L27.2 22.6Q27.4 20.2 29.6 20.4Q31.8 20.6 31.6 23L31.2 36.4Q33.4 33 35.6 34Q37.4 35 36 37.6L30.8 47.8Q29.2 50.8 26.4 52.4Z",
      fill: "paper",
    },
    { d: "M18 31L18.4 37.4M22.4 22L22.6 35.4M27.1 22.6L27 35.4", tone: "sub", w: 1.4 },
    { d: "M14.6 52.6L13.2 88M26.4 52.4L27.8 88", w: 2.2 },
    { d: "M6.4 22.4L9.6 24.6M5.6 31.6L9.2 31.6M36.2 14.6L33.4 17.6", tone: "accent", w: 1.8 },
  ],
};

export default art;
