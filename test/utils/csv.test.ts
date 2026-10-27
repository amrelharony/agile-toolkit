/**
 * The shared CSV parser: quoted delimiters and line breaks, doubled quotes,
 * CRLF / LF / CR, a byte-order mark, blank lines dropped with the line
 * numbers kept, tab-separated pastes, and Canvas's table import (which pads
 * ragged rows) reading through it.
 */

import { describe, expect, it } from "vitest";
import { headerKey, padRows, parseCsv, parseCsvRows, sniffDelimiter } from "@/lib/utils/csv";
import { parseCsv as parseTableCsv } from "@/lib/whiteboard/csv-to-table";

describe("parseCsv", () => {
  it("keeps a quoted comma inside its cell", () => {
    expect(parseCsv('kind,verbatim\nnps,"Fast, but pricey"')).toEqual([
      ["kind", "verbatim"],
      ["nps", "Fast, but pricey"],
    ]);
  });

  it("reads a doubled quote as one quote", () => {
    expect(parseCsv('a,"He said ""hi"""\n')).toEqual([["a", 'He said "hi"']]);
    expect(parseCsv('"""quoted"""')).toEqual([['"quoted"']]);
  });

  it("splits on CRLF, LF and CR alike, and keeps a line break inside quotes", () => {
    expect(parseCsv("a,b\r\nc,d\re,f\ng,h")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
      ["g", "h"],
    ]);
    expect(parseCsv('a,"two\r\nlines"\r\nb,c')).toEqual([
      ["a", "two\r\nlines"],
      ["b", "c"],
    ]);
  });

  it("strips a byte-order mark", () => {
    expect(parseCsv("﻿score,date\n9,2026-10-20")).toEqual([
      ["score", "date"],
      ["9", "2026-10-20"],
    ]);
  });

  it("drops blank lines, including whitespace-only and all-empty ones", () => {
    expect(parseCsv("\n\na,b\n\n   \n,,\nc,d\n\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\r\n\r\n")).toEqual([]);
  });

  it("keeps cells as written: untrimmed, empty ones included, ragged rows their own length", () => {
    expect(parseCsv(" a , b ,\nc")).toEqual([[" a ", " b ", ""], ["c"]]);
  });

  it("reads a tab-separated paste with the tab delimiter", () => {
    expect(parseCsv("kind\tscore\nnps\t9", "\t")).toEqual([
      ["kind", "score"],
      ["nps", "9"],
    ]);
    expect(parseCsv('a;"b;c"', ";")).toEqual([["a", "b;c"]]);
  });
});

describe("parseCsvRows", () => {
  it("numbers each row by the line it starts on, blank lines and quoted breaks counted", () => {
    const rows = parseCsvRows('h1,h2\r\n\r\nx,"multi\nline"\ny,z\n\n\nlast,1');
    expect(rows.map((r) => [r.line, r.cells[0]])).toEqual([
      [1, "h1"],
      [3, "x"],
      [5, "y"],
      [8, "last"],
    ]);
  });
});

describe("helpers", () => {
  it("sniffDelimiter picks the delimiter of the first non-blank line, outside quotes", () => {
    expect(sniffDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(sniffDelimiter("\n\na\tb\tc")).toBe("\t");
    expect(sniffDelimiter("a;b;c")).toBe(";");
    expect(sniffDelimiter('"a;b;c",d')).toBe(",");
    expect(sniffDelimiter("one column")).toBe(",");
    expect(sniffDelimiter("")).toBe(",");
  });

  it("padRows evens rows out to the widest", () => {
    expect(padRows([["a"], ["b", "c", "d"], []])).toEqual([
      ["a", "", ""],
      ["b", "c", "d"],
      ["", "", ""],
    ]);
    expect(padRows([])).toEqual([]);
  });

  it("headerKey matches column names however they're written", () => {
    expect(headerKey("Opened at")).toBe("openedat");
    expect(headerKey("opened_at")).toBe("openedat");
    expect(headerKey("﻿OpenedAt")).toBe("openedat");
    expect(headerKey("  PR # ")).toBe("pr");
  });
});

describe("Canvas's table import reads through it", () => {
  it("pads ragged rows to the widest and drops blank ones, as before", () => {
    expect(parseTableCsv('Name,Role,Team\n"Lee, J",Dev\n\nSam,PO,Core\n')).toEqual([
      ["Name", "Role", "Team"],
      ["Lee, J", "Dev", ""],
      ["Sam", "PO", "Core"],
    ]);
    expect(parseTableCsv("")).toEqual([]);
  });
});
