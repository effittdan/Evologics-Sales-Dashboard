import {
  buildImportQualitySummary,
  salesTransactionKey
} from "./analytics";
import {
  isSpreadsheetMLExport,
  normalizeSalesTransactionRows,
  parseNetSuiteSavedSearchCSV,
  parseNetSuiteSavedSearchXML,
  parseNetSuiteSpreadsheetMLReport,
  parseNetSuiteXlsxReport
} from "./importers";
import type { ImportQualitySummary, ParsedSalesRows, SalesTransaction } from "../types";

export const nightlySalesSubject = "Evologics Sales Transactions Created Yesterday";
export const nightlySalesSenders = new Set([
  "system@sent-via.netsuite.com",
  "wendy@evologicsamerica.com"
]);

export type GraphSalesMessage = {
  id: string;
  internetMessageId?: string;
  subject?: string;
  receivedDateTime?: string;
  hasAttachments?: boolean;
  from?: { emailAddress?: { address?: string; name?: string } };
  sender?: { emailAddress?: { address?: string; name?: string } };
};

export type GraphFileAttachment = {
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentBytes?: string;
  item?: { attachments?: GraphFileAttachment[] };
  "@odata.type"?: string;
};

export type PreparedAutomatedImport = {
  fileFingerprint: string;
  parsed: ParsedSalesRows;
  transactions: SalesTransaction[];
  transactionKeys: string[];
  quality: ImportQualitySummary;
  reviewReasons: string[];
};

export function isNightlySalesMessage(message: GraphSalesMessage) {
  if (message.subject?.trim() !== nightlySalesSubject || !message.hasAttachments) return false;

  const addresses = [message.from?.emailAddress, message.sender?.emailAddress];
  return addresses.some((emailAddress) => {
    const address = emailAddress?.address?.trim().toLowerCase() ?? "";
    const displayName = emailAddress?.name?.toLowerCase() ?? "";
    return nightlySalesSenders.has(address) || displayName.includes("wendy@evologicsamerica.com");
  });
}

export function isSupportedSalesAttachment(attachment: GraphFileAttachment) {
  if (attachment.isInline) return false;
  if (attachment["@odata.type"] && attachment["@odata.type"] !== "#microsoft.graph.fileAttachment") {
    return false;
  }
  const name = attachment.name?.trim().toLowerCase() ?? "";
  return name.endsWith(".xls") || name.endsWith(".xlsx") || name.endsWith(".xml") || name.endsWith(".csv");
}

export async function prepareAutomatedSalesImport(
  fileName: string,
  content: string | Uint8Array,
  importedAt: string,
  batchId: string
): Promise<PreparedAutomatedImport> {
  const parsed = await parseSalesFile(fileName, content);
  const transactions = normalizeSalesTransactionRows(parsed.rows);
  const fileFingerprint = await fingerprintSalesFile(fileName, content);
  const transactionKeys = transactions.map(salesTransactionKey);
  const quality = buildImportQualitySummary(parsed, transactions, {
    batchId,
    importedAt,
    fileFingerprint,
    importSource: "Automated"
  });
  const reviewReasons = automatedImportReviewReasons(parsed, transactions);

  return {
    fileFingerprint,
    parsed,
    transactions,
    transactionKeys,
    quality,
    reviewReasons
  };
}

export async function parseSalesFile(fileName: string, content: string | Uint8Array) {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".xlsx")) {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    return parseNetSuiteXlsxReport(fileName, bytes);
  }
  const text = typeof content === "string" ? content : new TextDecoder("utf-8").decode(content);
  if (isSpreadsheetMLExport(text)) {
    return parseNetSuiteSpreadsheetMLReport(fileName, text);
  }
  if (lowerName.endsWith(".csv")) {
    return parseNetSuiteSavedSearchCSV(fileName, text);
  }
  return parseNetSuiteSavedSearchXML(fileName, text);
}

export async function fingerprintSalesFile(fileName: string, content: string | Uint8Array) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${fileName.toLowerCase()}::${hash}`;
}

function automatedImportReviewReasons(
  parsed: ParsedSalesRows,
  transactions: SalesTransaction[]
) {
  const reasons = [...parsed.parseErrors];
  if (!parsed.rows.length) reasons.push("The attachment did not contain any detail rows.");
  if (!transactions.length) reasons.push("No canonical sales transactions could be normalized.");
  const droppedRows = parsed.rows.length - transactions.length;
  if (droppedRows > 0) {
    reasons.push(`${droppedRows} detail row${droppedRows === 1 ? " was" : "s were"} missing a date, document number, or SKU.`);
  }
  if (parsed.sourceReportType === "Unknown") {
    reasons.push("The attachment headers did not match a recognized NetSuite sales export.");
  }
  return reasons;
}
