export type KeepTogether = { top: number; bottom: number };

/** Bound each canvas to one PDF page, and avoid cutting table rows and charts. */
export function pageSlices(height: number, pageHeight: number, blocks: KeepTogether[]) {
  if (!(height > 0) || !(pageHeight > 0)) throw new Error("The report has no printable content.");
  const slices: Array<{ top: number; height: number }> = [];
  for (let top = 0; top < height;) {
    let bottom = Math.min(top + pageHeight, height);
    // Moving a break may intersect another block in a neighbouring column.
    for (;;) {
      const crossing = blocks.filter((b) => b.top > top + 0.5 && b.top < bottom - 0.5 && b.bottom > bottom + 0.5 && b.bottom - b.top <= pageHeight);
      if (!crossing.length) break;
      bottom = Math.min(...crossing.map((b) => b.top));
    }
    slices.push({ top, height: bottom - top });
    top = bottom;
  }
  return slices;
}

export function pdfFilename(title: string) {
  return `${title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim().slice(0, 160) || "Evologics report"}.pdf`;
}

export async function downloadReportPdf(source: HTMLElement, title: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  await document.fonts.ready;
  const stage = document.createElement("div");
  stage.className = "pdf-export-stage";
  stage.setAttribute("aria-hidden", "true");
  const report = source.cloneNode(true) as HTMLElement;
  // Never change the live page's title, filters, print classes or scroll position.
  report.querySelectorAll(".no-print, button, .product-class-unit-report-empty").forEach((el) => el.remove());
  report.querySelectorAll("details").forEach((el) => el.setAttribute("open", ""));
  stage.append(report);
  document.body.append(stage);
  try {
    await Promise.all(Array.from(report.querySelectorAll("img"), (img) => img.decode().catch(() => undefined)));
    const bounds = report.getBoundingClientRect();
    const width = Math.ceil(Math.max(bounds.width, report.scrollWidth));
    const height = Math.ceil(Math.max(bounds.height, report.scrollHeight));
    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4", compress: true });
    pdf.setProperties({ title, subject: "Evologics filtered sales report", creator: "Evologics Sales Dashboard" });
    const margin = 24;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const ratio = (pageWidth - margin * 2) / width;
    const printableHeight = Math.floor((pageHeight - margin * 2 - 16) / ratio);
    const blocks = Array.from(report.querySelectorAll("tr, .recharts-wrapper, .kpi-card, h1, h2, h3"), (el) => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top - bounds.top, bottom: rect.bottom - bounds.top };
    });
    const pages = pageSlices(height, printableHeight, blocks);
    for (const [index, page] of pages.entries()) {
      const canvas = await html2canvas(report, {
        backgroundColor: "#ffffff", scale: 1.5, logging: false,
        width, height: page.height, y: page.top, windowWidth: 1440,
        scrollX: 0, scrollY: 0
      });
      if (index) pdf.addPage();
      pdf.addImage(canvas, "PNG", margin, margin, width * ratio, page.height * ratio);
      pdf.setFontSize(9);
      pdf.setTextColor(90);
      pdf.text(`Evologics | Page ${index + 1} of ${pages.length}`, margin, pageHeight - 14);
      canvas.width = canvas.height = 0;
    }
    await pdf.save(pdfFilename(title), { returnPromise: true });
  } finally {
    stage.remove();
  }
}
