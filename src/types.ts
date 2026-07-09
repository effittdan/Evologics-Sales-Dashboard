export type SalesEntityType = "Salesperson" | "Distributor" | "Vendor" | "Unknown";
export type SourceReportType = "YTD" | "Weekly" | "Unknown";

export type SalesTransaction = {
  sourceFile: string;
  sourceReportType: SourceReportType;
  sourceSheetName?: string;
  sourceRowNumber: number;
  customerRaw: string;
  customerCode?: string;
  customerName: string;
  transactionType: string;
  transactionDate: string;
  accountingPeriod?: string;
  documentNumber: string;
  poNumber?: string;
  physicianId?: string;
  patient?: string;
  sku: string;
  productDescription: string;
  productClass?: string;
  quantity: number;
  unitPrice: number;
  revenue: number;
  salesRepVendor?: string;
  salesEntityType?: SalesEntityType;
  salesGroup?: string;
  shippingState?: string;
  dateCreated?: string;
  isCreditMemo: boolean;
};

export type RawSalesRow = {
  sourceFile: string;
  sourceReportType: SourceReportType;
  sourceSheetName?: string;
  sourceRowNumber: number;
  fields: Record<string, string>;
};

export type ParsedSalesRows = {
  sourceFile: string;
  sourceReportType: SourceReportType;
  sourceSheetName?: string;
  sourceDateRange?: { start: string; end: string };
  rows: RawSalesRow[];
  excludedTotalRows: number;
  excludedGroupRows: number;
  parseErrors: string[];
};

export type ImportQualitySummary = {
  batchId: string;
  sourceFile: string;
  sourceReportType: SourceReportType;
  sourceSheetName?: string;
  importedAt: string;
  fileFingerprint: string;
  parsedRowCount: number;
  transactionCount: number;
  acceptedTransactionCount: number;
  skippedDuplicateRows: number;
  skippedDuplicateFile: boolean;
  excludedTotalRows: number;
  excludedGroupRows: number;
  parseErrors: string[];
  dateRange?: { start: string; end: string };
  totalRevenue: number;
  duplicateRowCount: number;
  missingSalesRepVendorCount: number;
  missingProductClassCount: number;
  missingStateCount: number;
};

export type ImportResult = {
  transactions: SalesTransaction[];
  quality: ImportQualitySummary;
};

export type ImportLedger = {
  version: 1;
  transactions: SalesTransaction[];
  quality: ImportQualitySummary[];
  importedFileFingerprints: string[];
  importedTransactionKeys: string[];
};

export type SalesRepMapping = {
  salesRepVendor: string;
  salesEntityType: SalesEntityType;
  salesGroup?: string;
  territory?: string;
  notes?: string;
};

export type SkuEnrichment = {
  sku: string;
  productClass?: string;
  category?: string;
  notes?: string;
};

export type AppUserRole = "administrator" | "user";

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role: AppUserRole;
  status: "Active" | "Inactive";
  passwordHash: string;
  createdAt: string;
  lastLoginAt?: string;
};

export type AppSession = {
  userId: string;
  signedInAt: string;
};
