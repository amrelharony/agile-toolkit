import type { Panel } from "@/lib/comics/types";

/** What the panel shows and says: the speech is baked into the art. */
export function PanelTranscript({ panel }: { panel: Panel }) {
  return (
    <>
      <p>{panel.alt}</p>
      {panel.dialogue.map((d, i) => (
        <p key={i}>
          {d.speaker ? <span className="font-semibold text-text">{d.speaker}: </span> : null}
          {d.line}
        </p>
      ))}
      {panel.signs.map((sign, i) => (
        <p key={i}>
          <span className="font-semibold text-text">Sign:</span> {sign}
        </p>
      ))}
    </>
  );
}
