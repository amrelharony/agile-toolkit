# Fonts for the link-preview images

`ShantellSans-SemiBold.ttf` is Shantell Sans (weight 600) by the Shantell Sans
Project Authors, from Google Fonts, under the SIL Open Font License 1.1
(`OFL.txt`). It is the site's hand-lettering face (`--font-hand`), kept here as
a TTF because the image renderer behind `app/og` can't read the web-font files.

It is subset to the characters the cards draw (Basic Latin, Latin-1, general
punctuation, arrows, ×, −, ≤, ≥, €, ™) to keep the edge function small:

    pyftsubset ShantellSans-SemiBold.ttf \
      --unicodes="U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030,U+2039-203A,U+20AC,U+2122,U+2190-2193,U+2212,U+2264-2265,U+00D7" \
      --layout-features="kern,liga,calt" --output-file=ShantellSans-SemiBold.ttf

A tool name or description using a character outside that set draws it as a
blank; widen the subset from the full font if one does.
