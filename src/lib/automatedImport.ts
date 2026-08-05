import {
  buildImportQualitySummary,
  salesTransactionKey
} from "./analytics";
import {
  isSpreadsheetMLExport,
  normalizeSalesTransactionRows,
  parseNetSuiteSavedSearchCSV,
  parseNetSuiteSavedSearchXML,
  parseNetSuiteSpreadsheetMLReport
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
  return name.endsWith(".xls") || name.endsWith(".xml") || name.endsWith(".csv");
}

export async function prepareAutomatedSalesImport(
  fileName: string,
  text: string,
  importedAt: string,
  batchId: string
): Promise<PreparedAutomatedImport> {
  const parsed = parseSalesFile(fileName, text);
  const transactions = normalizeSalesTransactionRows(parsed.rows);
  const fileFingerprint = await fingerprintSalesFile(fileName, text);
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

export function parseSalesFile(fileName: string, text: string) {
  const lowerName = fileName.toLowerCase();
  if (isSpreadsheetMLExport(text)) {
    return parseNetSuiteSpreadsheetMLReport(fileName, text);
  }
  if (lowerName.endsWith(".csv")) {
    return parseNetSuiteSavedSearchCSV(fileName, text);
  }
  return parseNetSuiteSavedSearchXML(fileName, text);
}

export async function fingerprintSalesFile(fileName: string, text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
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
