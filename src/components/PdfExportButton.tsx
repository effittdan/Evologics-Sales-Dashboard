import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { downloadReportPdf } from "../lib/pdfExport";

export function PdfExportButton({ target, title, disabled = false }: { target: string; title: string; disabled?: boolean }) {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  async function exportPdf() {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const report = document.querySelector<HTMLElement>(target);
      if (!report) throw new Error("Report not found. Refresh the dashboard and try again.");
      await downloadReportPdf(report, title);
      setMessage("PDF download requested. Check your browser's downloads.");
    } catch (error) {
      setFailed(true);
      setMessage(`PDF export failed: ${error instanceof Error ? error.message : "Please try again."}`);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return <div className="pdf-export-control no-print">
    <button type="button" className="upload-button" onClick={exportPdf} disabled={disabled || busy} aria-busy={busy}>
      <Download size={18} />{busy ? "Preparing PDF…" : "Export PDF"}
    </button>
    {message && <p className="pdf-export-message" role={failed ? "alert" : "status"}>{message}</p>}
  </div>;
}
