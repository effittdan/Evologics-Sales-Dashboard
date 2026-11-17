import { describe, expect, it } from "vitest";
import { pageSlices, pdfFilename } from "../src/lib/pdfExport";

describe("PDF export pagination", () => {
  it("covers long reports without gaps, overlaps or a giant canvas", () => {
    const pages = pageSlices(25100, 700, []);
    expect(pages.reduce((sum, p) => sum + p.height, 0)).toBe(25100);
    pages.forEach((p, i) => { expect(p.height).toBeLessThanOrEqual(700); if (i) expect(p.top).toBe(pages[i-1].top + pages[i-1].height); });
  });
  it("keeps rows and charts together across neighbouring columns", () => {
    expect(pageSlices(1300, 700, [{top: 600, bottom: 780}, {top: 550, bottom: 650}])[0]).toEqual({top: 0, height: 550});
  });
  it("can split oversized blocks and rejects empty output", () => {
    expect(pageSlices(1600, 700, [{top: 0, bottom: 1600}])).toHaveLength(3);
    expect(() => pageSlices(0, 700, [])).toThrow();
  });
  it("creates a safe download filename", () => {
    expect(pdfFilename('Evologics units - 2026/11')).toBe('Evologics units - 2026-11.pdf');
    expect(pdfFilename('')).toBe('Evologics report.pdf');
  });
  it("does not cascade through touching fractional-height table rows", () => {
    const rows = Array.from({length:100}, (_,i)=>({top: i*38.3, bottom: (i+1)*38.3}));
    expect(pageSlices(3830, 700, rows).length).toBe(6);
  });
});
