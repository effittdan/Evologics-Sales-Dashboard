import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeSalesTransactionRows,
  parseNetSuiteSpreadsheetMLReport
} from "../src/lib/importers";

const root = process.cwd();
const ytdSample = "CustomSalesbyCustomerDetail-699 YTD.xls";
const weeklySample = "Weekly Report Test 7-9-26.xls";

describe("NetSuite SpreadsheetML import adapters", () => {
  it("detects a YTD header on row 7 and excludes group/total rows", () => {
    const parsed = parseNetSuiteSpreadsheetMLReport("synthetic-ytd.xls", syntheticYtdXml);
    const transactions = normalizeSalesTransactionRows(parsed.rows);

    expect(parsed.sourceReportType).toBe("YTD");
    expect(parsed.sourceSheetName).toBe("CustomSalesbyCustomerDeta");
    expect(parsed.sourceDateRange).toEqual({ start: "2026-01-01", end: "2026-06-30" });
    expect(parsed.excludedGroupRows).toBe(1);
    expect(parsed.excludedTotalRows).toBe(1);
    expect(transactions).toHaveLength(2);
    expect(sumRevenue(transactions)).toBe(6200);
    expect(transactions[0]).toMatchObject({
      customerCode: "CUST00001",
      customerName: "Alpha Hospital",
      accountingPeriod: "Jan 2026",
      sku: "EAP-48",
      shippingState: "TX"
    });
  });

  it("detects a weekly header on row 1, excludes final total, and keeps duplicate lines", () => {
    const parsed = parseNetSuiteSpreadsheetMLReport("synthetic-weekly.xls", syntheticWeeklyXml);
    const transactions = normalizeSalesTransactionRows(parsed.rows);

    expect(parsed.sourceReportType).toBe("Weekly");
    expect(parsed.sourceSheetName).toBe("WRScheduledPrevWeekSalesTransS");
    expect(parsed.excludedTotalRows).toBe(1);
    expect(transactions).toHaveLength(3);
    expect(sumRevenue(transactions)).toBe(10100);
    expect(transactions.filter((row) => row.documentNumber === "EV-90001")).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      customerName: "Houston Methodist Hospital",
      productClass: "Amniotic Tissue : EvoPatch",
      dateCreated: "2026-06-29T07:23:00.000Z"
    });
  });

  const realYtdIt = existsSync(join(root, ytdSample)) ? it : it.skip;
  realYtdIt("validates the local YTD export sample stats when present", () => {
    const text = readFileSync(join(root, ytdSample), "utf8");
    const parsed = parseNetSuiteSpreadsheetMLReport(ytdSample, text);
    const transactions = normalizeSalesTransactionRows(parsed.rows);

    expect(parsed.sourceReportType).toBe("YTD");
    expect(parsed.sourceSheetName).toBe("CustomSalesbyCustomerDeta");
    expect(parsed.excludedGroupRows).toBeGreaterThanOrEqual(6);
    expect(parsed.excludedTotalRows).toBeGreaterThanOrEqual(1);
    expect(transactions).toHaveLength(2386);
    expect(sumRevenue(transactions)).toBeCloseTo(8106592.05, 2);
    expect(parsed.sourceDateRange).toEqual({ start: "2026-01-01", end: "2026-06-30" });
    expect(transactions[0].transactionDate).toBe("2026-01-05");
    expect(transactions.at(-1)?.transactionDate).toBe("2026-06-30");
  });

  const realWeeklyIt = existsSync(join(root, weeklySample)) ? it : it.skip;
  realWeeklyIt("validates the local weekly export sample stats when present", () => {
    const text = readFileSync(join(root, weeklySample), "utf8");
    const parsed = parseNetSuiteSpreadsheetMLReport(weeklySample, text);
    const transactions = normalizeSalesTransactionRows(parsed.rows);
    const quantity = transactions.reduce((total, row) => total + row.quantity, 0);

    expect(parsed.sourceReportType).toBe("Weekly");
    expect(parsed.sourceSheetName).toBe("WRScheduledPrevWeekSalesTransS");
    expect(parsed.excludedTotalRows).toBe(1);
    expect(transactions).toHaveLength(101);
    expect(sumRevenue(transactions)).toBeCloseTo(386784.08, 2);
    expect(quantity).toBe(382);
    expect(transactions[0].transactionDate).toBe("2026-06-29");
    expect(transactions.at(-1)?.transactionDate).toBe("2026-07-02");
  });
});

function sumRevenue(rows: { revenue: number }[]) {
  return rows.reduce((total, row) => total + row.revenue, 0);
}

const syntheticYtdXml = `<?xml version="1.0" encoding="UTF-8"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="CustomSalesbyCustomerDeta">
    <Table>
      <Row><Cell><Data ss:Type="String">Evologics LLC</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Parent Company : Evologics LLC</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Custom Sales by Customer Detail</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">January 1, 2026 - June 30, 2026</Data></Cell></Row>
      <Row />
      <Row />
      <Row>
        <Cell><Data ss:Type="String">Accounting Period: Name</Data></Cell>
        <Cell ss:Index="2"><Data ss:Type="String">Customer</Data></Cell>
        <Cell ss:Index="3"><Data ss:Type="String">Transaction Type</Data></Cell>
        <Cell ss:Index="4"><Data ss:Type="String">Date</Data></Cell>
        <Cell ss:Index="5"><Data ss:Type="String">Document Number</Data></Cell>
        <Cell ss:Index="6"><Data ss:Type="String">PO Number</Data></Cell>
        <Cell ss:Index="7"><Data ss:Type="String">Physician ID</Data></Cell>
        <Cell ss:Index="8"><Data ss:Type="String">Patient</Data></Cell>
        <Cell ss:Index="9"><Data ss:Type="String">Item</Data></Cell>
        <Cell ss:Index="10"><Data ss:Type="String">Item: Description (Sales)</Data></Cell>
        <Cell ss:Index="11"><Data ss:Type="String">Quantity</Data></Cell>
        <Cell ss:Index="12"><Data ss:Type="String">Unit Price</Data></Cell>
        <Cell ss:Index="13"><Data ss:Type="String">Total Revenue</Data></Cell>
        <Cell ss:Index="14"><Data ss:Type="String">Sales Rep - Vendor</Data></Cell>
        <Cell ss:Index="15"><Data ss:Type="String">Address: Shipping Address State</Data></Cell>
      </Row>
      <Row><Cell><Data ss:Type="String">Jan 2026</Data></Cell></Row>
      <Row>
        <Cell><Data ss:Type="String"></Data></Cell>
        <Cell ss:Index="2"><Data ss:Type="String">CUST00001 Alpha Hospital</Data></Cell>
        <Cell ss:Index="3"><Data ss:Type="String">Invoice</Data></Cell>
        <Cell ss:Index="4"><Data ss:Type="String">2026-01-05T00:00:00.000</Data></Cell>
        <Cell ss:Index="5"><Data ss:Type="String">EV-10001</Data></Cell>
        <Cell ss:Index="6"><Data ss:Type="String">PO-1</Data></Cell>
        <Cell ss:Index="7"><Data ss:Type="String">Dr. Sample</Data></Cell>
        <Cell ss:Index="8"><Data ss:Type="String">Patient A</Data></Cell>
        <Cell ss:Index="9"><Data ss:Type="String">EAP-48</Data></Cell>
        <Cell ss:Index="10"><Data ss:Type="String">EvoPatch Dual Layer Amnion 4x8cm</Data></Cell>
        <Cell ss:Index="11"><Data ss:Type="Number">2</Data></Cell>
        <Cell ss:Index="12"><Data ss:Type="Number">2300</Data></Cell>
        <Cell ss:Index="13"><Data ss:Type="Number">4600</Data></Cell>
        <Cell ss:Index="14"><Data ss:Type="String">Sample Distributor LLC</Data></Cell>
        <Cell ss:Index="15"><Data ss:Type="String">TX</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String"></Data></Cell>
        <Cell ss:Index="2"><Data ss:Type="String">CUST00002 Beta Surgery Center</Data></Cell>
        <Cell ss:Index="3"><Data ss:Type="String">Credit Memo</Data></Cell>
        <Cell ss:Index="4"><Data ss:Type="String">2026-01-20T00:00:00.000</Data></Cell>
        <Cell ss:Index="5"><Data ss:Type="String">CM-10002</Data></Cell>
        <Cell ss:Index="9"><Data ss:Type="String">EAP-24</Data></Cell>
        <Cell ss:Index="10"><Data ss:Type="String">EvoPatch Dual Layer Amnion 2x4cm</Data></Cell>
        <Cell ss:Index="11"><Data ss:Type="Number">1</Data></Cell>
        <Cell ss:Index="12"><Data ss:Type="Number">1600</Data></Cell>
        <Cell ss:Index="13"><Data ss:Type="Number">1600</Data></Cell>
        <Cell ss:Index="15"><Data ss:Type="String">LA</Data></Cell>
      </Row>
      <Row><Cell><Data ss:Type="String">Total - Jan 2026</Data></Cell></Row>
    </Table>
  </Worksheet>
</Workbook>`;

const syntheticWeeklyXml = `<?xml version="1.0" encoding="utf-8"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="WRScheduledPrevWeekSalesTransS">
    <Table>
      <Row>
        <Cell><Data ss:Type="String">Name</Data></Cell>
        <Cell><Data ss:Type="String">Type</Data></Cell>
        <Cell><Data ss:Type="String">Date</Data></Cell>
        <Cell><Data ss:Type="String">Document Number</Data></Cell>
        <Cell><Data ss:Type="String">PO/Check Number</Data></Cell>
        <Cell><Data ss:Type="String">Physician ID</Data></Cell>
        <Cell><Data ss:Type="String">Patient</Data></Cell>
        <Cell><Data ss:Type="String">Item</Data></Cell>
        <Cell><Data ss:Type="String">Description</Data></Cell>
        <Cell><Data ss:Type="String">Quantity</Data></Cell>
        <Cell><Data ss:Type="String">Item Rate</Data></Cell>
        <Cell><Data ss:Type="String">Amount</Data></Cell>
        <Cell><Data ss:Type="String">Sales Rep - Vendor</Data></Cell>
        <Cell><Data ss:Type="String">Shipping State/Province</Data></Cell>
        <Cell><Data ss:Type="String">Class</Data></Cell>
        <Cell><Data ss:Type="String">Date Created</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">Houston Methodist Hospital</Data></Cell>
        <Cell><Data ss:Type="String">Invoice</Data></Cell>
        <Cell><Data ss:Type="String">2026-06-29T00:00:00</Data></Cell>
        <Cell><Data ss:Type="String">EV-90001</Data></Cell>
        <Cell><Data ss:Type="String">PO-1</Data></Cell>
        <Cell><Data ss:Type="String"></Data></Cell>
        <Cell><Data ss:Type="String"></Data></Cell>
        <Cell><Data ss:Type="String">EAP-48</Data></Cell>
        <Cell><Data ss:Type="String">EvoPatch Dual Layer Amnion 4x8cm</Data></Cell>
        <Cell><Data ss:Type="Number">1</Data></Cell>
        <Cell><Data ss:Type="Number">2250</Data></Cell>
        <Cell><Data ss:Type="Number">2250</Data></Cell>
        <Cell><Data ss:Type="String">Sample Distributor LLC</Data></Cell>
        <Cell><Data ss:Type="String">TX</Data></Cell>
        <Cell><Data ss:Type="String">Amniotic Tissue : EvoPatch</Data></Cell>
        <Cell><Data ss:Type="String">2026-06-29T07:23:00</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">Houston Methodist Hospital</Data></Cell>
        <Cell><Data ss:Type="String">Invoice</Data></Cell>
        <Cell><Data ss:Type="String">2026-06-29T00:00:00</Data></Cell>
        <Cell><Data ss:Type="String">EV-90001</Data></Cell>
        <Cell><Data ss:Type="String">PO-1</Data></Cell>
        <Cell ss:Index="8"><Data ss:Type="String">EAP-48</Data></Cell>
        <Cell><Data ss:Type="String">EvoPatch Dual Layer Amnion 4x8cm</Data></Cell>
        <Cell><Data ss:Type="Number">1</Data></Cell>
        <Cell><Data ss:Type="Number">2250</Data></Cell>
        <Cell><Data ss:Type="Number">2250</Data></Cell>
        <Cell><Data ss:Type="String">Sample Distributor LLC</Data></Cell>
        <Cell><Data ss:Type="String">TX</Data></Cell>
        <Cell><Data ss:Type="String">Amniotic Tissue : EvoPatch</Data></Cell>
        <Cell><Data ss:Type="String">2026-06-29T07:23:00</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">Grace Surgical Hospital</Data></Cell>
        <Cell><Data ss:Type="String">Invoice</Data></Cell>
        <Cell><Data ss:Type="String">2026-06-30T00:00:00</Data></Cell>
        <Cell><Data ss:Type="String">EV-90002</Data></Cell>
        <Cell><Data ss:Type="String">PO-2</Data></Cell>
        <Cell ss:Index="8"><Data ss:Type="String">EVD483</Data></Cell>
        <Cell><Data ss:Type="String">EvoDerm, 4x8cm, Thick (3mm)</Data></Cell>
        <Cell><Data ss:Type="Number">1</Data></Cell>
        <Cell><Data ss:Type="Number">5600</Data></Cell>
        <Cell><Data ss:Type="Number">5600</Data></Cell>
        <Cell><Data ss:Type="String">Sample Rep</Data></Cell>
        <Cell><Data ss:Type="String">TX</Data></Cell>
        <Cell><Data ss:Type="String">Acellular Dermal Matrix</Data></Cell>
        <Cell><Data ss:Type="String">2026-06-30T08:15:00</Data></Cell>
      </Row>
      <Row><Cell><Data ss:Type="String">Total</Data></Cell></Row>
    </Table>
  </Worksheet>
</Workbook>`;
