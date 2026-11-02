"""
Render the 104 lettered book panels from a finished poster PDF, for the portal's
book import. The poster artwork zip's own JPGs have no lettering: the balloons and
speech are a separate layer of the finished PDF, so each panel is cut from there.

    python scripts/render-book-panels.py <Building_01 PDF> <output folder>

Needs PyMuPDF (pip install pymupdf). The output folder gets
Panels/Episode_NN/ENN_Panel_MM.png; choose it in the portal's book import. The art
stays outside the repo.
"""

import os
import re
import sys

import pymupdf

SIZE = 1536  # The largest size the site serves.
EPISODES = 26
PANELS = 4


def main(pdf_path: str, out_dir: str) -> None:
    doc = pymupdf.open(pdf_path)
    if len(doc) != EPISODES:
        sys.exit(f"Expected {EPISODES} posters, found {len(doc)}.")
    for number, page in enumerate(doc, 1):
        printed = re.search(r"EPISODE (\d+) / 26", page.get_text())
        if not printed or int(printed.group(1)) != number:
            sys.exit(f"Page {number} doesn't say it is episode {number}.")
        # The QR code is also an image, but far smaller than a panel.
        art = [info for info in page.get_image_info() if info["width"] > 1500]
        if len(art) != PANELS:
            sys.exit(f"Episode {number} has {len(art)} panels, not {PANELS}.")
        # Reading order: rows top to bottom, then left to right.
        boxes = sorted(
            (pymupdf.Rect(info["bbox"]) for info in art),
            key=lambda box: (round(box.y0 / 50), box.x0),
        )
        folder = os.path.join(out_dir, "Panels", f"Episode_{number:02d}")
        os.makedirs(folder, exist_ok=True)
        for index, box in enumerate(boxes, 1):
            zoom = SIZE / box.width
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=box, alpha=False)
            pixmap.save(os.path.join(folder, f"E{number:02d}_Panel_{index:02d}.png"))
    print(f"Rendered {EPISODES * PANELS} panels into {out_dir}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
