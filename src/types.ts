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
  sourceFile: string;
  sourceReportType: SourceReportType;
  sourceSheetName?: string;
  parsedRowCount: number;
  transactionCount: number;
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
