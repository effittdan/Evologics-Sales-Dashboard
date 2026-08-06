import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  AlertTriangle,
  BarChart3,
  Database,
  FileUp,
  LockKeyhole,
  LogOut,
  MapPinned,
  PackageSearch,
  Printer,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  TrendingUp,
  UserPlus,
  UsersRound
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  applyEnrichments,
  applyFilters,
  buildImportQualitySummary,
  countDuplicateRows,
  createEmptyImportLedger,
  customerPerformance,
  dateRange,
  emptyFilters,
  entityMomentum,
  formatCurrency,
  formatNumber,
  formatPercent,
  kpis,
  managerOptions,
  optionValues,
  partitionNewTransactions,
  productPerformance,
  productFamilyOptions,
  rankMomentumRows,
  rankMomentumRowsByVolume,
  repPerformance,
  resolveDateRange,
  salesDate,
  salesTransactionKey,
  skuOptionsForProductFamilies,
  timeSeries,
  topByRevenue,
  withoutShippingStateFilter,
  type DashboardFilters,
  type DateBasis,
  type MomentumEntity,
  type MomentumMetric,
  type MomentumRow,
  type TimeSeriesGrain
} from "./lib/analytics";
import {
  activeSessionUser,
  approvedUserForEmail,
  authenticateUser,
  createUserRecord,
  initializeUsers
} from "./lib/auth";
import {
  isSpreadsheetMLExport,
  normalizeSalesTransactionRows,
  parseNetSuiteSavedSearchCSV,
  parseNetSuiteSavedSearchXML,
  parseNetSuiteSpreadsheetMLReport
} from "./lib/importers";
import {
  checkNetlifyIdentitySettings,
  completeNetlifyIdentityChallenge,
  createNetlifyIdentityAccount,
  initializeNetlifyIdentity,
  loginWithNetlifyIdentity,
  logoutNetlifyIdentity,
  shouldUseNetlifyIdentity,
  watchNetlifyIdentity,
  type NetlifyAuthChallenge
} from "./lib/netlifyAuth";
import {
  loadAutomatedImportHistory,
  loadSharedSalesLedger,
  saveSharedSalesLedger,
  shouldUseSharedLedger
} from "./lib/sharedLedger";
import { buildSalesMapPayload } from "./lib/mapData";
import type {
  AppSession,
  AutomatedImportJob,
  AppUser,
  AppUserRole,
  ImportLedger,
  ImportQualitySummary,
  SalesEntityType,
  SalesRepMapping,
  SalesTransaction,
  SkuEnrichment
} from "./types";

const chartColors = ["#1F4F45", "#4F7D6D", "#C9B27E", "#7B9C8D", "#AAB7BA"];
const storageKeys = {
  ledger: "evologics-import-ledger",
  reps: "evologics-sales-rep-mappings",
  skus: "evologics-sku-enrichments",
  users: "evologics-users",
  session: "evologics-session",
  lastLoginEmail: "evologics-last-login-email"
};

export function App() {
  const [ledger, setLedger] = useState<ImportLedger>(() =>
    loadStored(storageKeys.ledger, createEmptyImportLedger())
  );
  const [filters, setFilters] = useState<DashboardFilters>(emptyFilters);
  const [activeView, setActiveView] = useState("overview");
  const [trendGrain, setTrendGrain] = useState<TimeSeriesGrain>("month");
  const [repMappings, setRepMappings] = useState<SalesRepMapping[]>(() =>
    loadStored(storageKeys.reps, [])
  );
  const [skuEnrichments, setSkuEnrichments] = useState<SkuEnrichment[]>(() =>
    loadStored(storageKeys.skus, [])
  );
  const [users, setUsers] = useState<AppUser[]>(() =>
    initializeUsers(loadStored<AppUser[] | undefined>(storageKeys.users, undefined))
  );
  const [session, setSession] = useState<AppSession | null>(() =>
    shouldUseNetlifyIdentity() ? null : loadStored<AppSession | null>(storageKeys.session, null)
  );
  const [lastLoginEmail, setLastLoginEmail] = useState(() =>
    loadStored(storageKeys.lastLoginEmail, "")
  );
  const [importMessage, setImportMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(() => shouldUseNetlifyIdentity());
  const [authNotice, setAuthNotice] = useState("");
  const [authChallenge, setAuthChallenge] = useState<NetlifyAuthChallenge | null>(null);
  const [selectedRepVendor, setSelectedRepVendor] = useState<string | null>(null);
  const [sharedLedgerMessage, setSharedLedgerMessage] = useState("");
  const [automatedImportJobs, setAutomatedImportJobs] = useState<AutomatedImportJob[]>([]);
  const [sharedLedgerMeta, setSharedLedgerMeta] = useState<{
    stateVersion: number;
    updatedAt?: string | null;
    updatedByEmail?: string | null;
  } | null>(null);

  const transactions = ledger.transactions;
  const quality = ledger.quality;
  const currentUser = activeSessionUser(users, session);
  const netlifyIdentityEnabled = shouldUseNetlifyIdentity();
  const sharedLedgerEnabled = shouldUseSharedLedger();
  const canManageSalesData = currentUser?.role === "administrator";

  useEffect(() => {
    localStorage.setItem(storageKeys.ledger, JSON.stringify(ledger));
  }, [ledger]);

  useEffect(() => {
    localStorage.setItem(storageKeys.reps, JSON.stringify(repMappings));
  }, [repMappings]);

  useEffect(() => {
    localStorage.setItem(storageKeys.skus, JSON.stringify(skuEnrichments));
  }, [skuEnrichments]);

  useEffect(() => {
    localStorage.setItem(storageKeys.users, JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    if (lastLoginEmail) {
      localStorage.setItem(storageKeys.lastLoginEmail, JSON.stringify(lastLoginEmail));
    }
  }, [lastLoginEmail]);

  useEffect(() => {
    if (netlifyIdentityEnabled) return;
    if (session) {
      localStorage.setItem(storageKeys.session, JSON.stringify(session));
    } else {
      localStorage.removeItem(storageKeys.session);
    }
  }, [netlifyIdentityEnabled, session]);

  useEffect(() => {
    if (!netlifyIdentityEnabled) {
      setAuthLoading(false);
      return;
    }

    let mounted = true;
    function applyNetlifyUser(email?: string | null) {
      const approvedUser = approvedUserForEmail(users, email);
      if (!approvedUser) {
        setSession(null);
        return;
      }
      setLastLoginEmail(approvedUser.email);
      setSession({
        userId: approvedUser.id,
        signedInAt: new Date().toISOString(),
        provider: "netlify"
      });
    }

    initializeNetlifyIdentity()
      .then(({ user: netlifyUser, challenge }) => {
        if (!mounted) return;
        setAuthChallenge(challenge);
        applyNetlifyUser(netlifyUser?.email);
      })
      .catch((error) => {
        if (!mounted) return;
        setAuthNotice(error instanceof Error ? error.message : "Netlify Identity is not configured.");
      })
      .finally(() => {
        if (mounted) setAuthLoading(false);
      });

    checkNetlifyIdentitySettings().then((message) => {
      if (mounted && message) {
        setAuthNotice(
          "Netlify Identity is not enabled for this site yet. Enable Identity in Netlify, then invite the approved users."
        );
      }
    });

    const unsubscribe = watchNetlifyIdentity((netlifyUser) => {
      applyNetlifyUser(netlifyUser?.email);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [netlifyIdentityEnabled, users]);

  useEffect(() => {
    if (!sharedLedgerEnabled || !currentUser) return;

    let mounted = true;
    setSharedLedgerMessage("Loading shared sales data...");
    loadSharedSalesLedger()
      .then((result) => {
        if (!mounted) return;
        setLedger(result.ledger);
        setSharedLedgerMeta({
          stateVersion: result.stateVersion,
          updatedAt: result.updatedAt,
          updatedByEmail: result.updatedByEmail
        });
        setSharedLedgerMessage(
          result.updatedAt
            ? `Shared data loaded. Last updated ${formatShortDateTime(result.updatedAt)}${
                result.updatedByEmail ? ` by ${result.updatedByEmail}` : ""
              }.`
            : "Shared data loaded. No imports have been saved yet."
        );
      })
      .catch((error) => {
        if (!mounted) return;
        setSharedLedgerMessage(
          error instanceof Error
            ? `${error.message} Using this browser's local sales data for now.`
            : "Shared sales storage is not available. Using this browser's local sales data for now."
        );
      });

    loadAutomatedImportHistory()
      .then((jobs) => {
        if (mounted) setAutomatedImportJobs(jobs);
      })
      .catch(() => {
        if (mounted) setAutomatedImportJobs([]);
      });

    return () => {
      mounted = false;
    };
  }, [currentUser, sharedLedgerEnabled]);

  const enriched = useMemo(
    () => applyEnrichments(transactions, repMappings, skuEnrichments),
    [transactions, repMappings, skuEnrichments]
  );
  const filtered = useMemo(() => applyFilters(enriched, filters), [enriched, filters]);
  const filteredWithoutState = useMemo(
    () => applyFilters(enriched, withoutShippingStateFilter(filters)),
    [enriched, filters]
  );
  const metrics = useMemo(() => kpis(filtered), [filtered]);
  const sourceRange = dateRange(enriched);
  const importedSourceRange = useMemo(() => combineQualityRanges(quality), [quality]);
  const filteredRange = dateRange(filtered, filters.dateBasis);
  const selectedRange = resolveDateRange(enriched, filters);
  const yearsLoaded = new Set(enriched.map((row) => salesDate(row, filters.dateBasis).slice(0, 4))).size;

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    if (sharedLedgerEnabled && !canManageSalesData) {
      setImportMessage("Only administrators can update shared sales data.");
      return;
    }
    const nextTransactions: SalesTransaction[] = [];
    const nextQuality: ImportQualitySummary[] = [];
    const messages: string[] = [];
    const existingFileFingerprints = new Set(ledger.importedFileFingerprints);
    const existingTransactionKeys = new Set(ledger.importedTransactionKeys);

    for (const file of Array.from(files)) {
      const text = await file.text();
      const fileFingerprint = await fingerprintFile(file.name, text);
      const importedAt = new Date().toISOString();
      const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const lowerName = file.name.toLowerCase();
      const parsed = isSpreadsheetMLExport(text)
        ? parseNetSuiteSpreadsheetMLReport(file.name, text)
        : lowerName.endsWith(".csv")
          ? parseNetSuiteSavedSearchCSV(file.name, text)
          : parseNetSuiteSavedSearchXML(file.name, text);
      const normalized = normalizeSalesTransactionRows(parsed.rows);
      const skippedDuplicateFile = existingFileFingerprints.has(fileFingerprint);
      const existingKeysBeforeFile = new Set(existingTransactionKeys);
      const duplicatePartition = skippedDuplicateFile
        ? { accepted: [], skippedDuplicateRows: normalized.length }
        : partitionNewTransactions(normalized, existingKeysBeforeFile);
      const { accepted, skippedDuplicateRows } = duplicatePartition;

      if (!skippedDuplicateFile) {
        nextTransactions.push(...accepted);
        existingFileFingerprints.add(fileFingerprint);
        accepted.forEach((row) => existingTransactionKeys.add(salesTransactionKey(row)));
      }

      nextQuality.push(
        buildImportQualitySummary(parsed, normalized, {
          batchId,
          importedAt,
          fileFingerprint,
          importSource: "Manual",
          acceptedTransactionCount: accepted.length,
          skippedDuplicateRows,
          skippedDuplicateFile
        })
      );
      messages.push(
        skippedDuplicateFile
          ? `${file.name}: already imported, skipped`
          : `${file.name}: ${accepted.length.toLocaleString()} added (${formatCurrency(
              accepted.reduce((total, row) => total + row.revenue, 0)
            )}), ${skippedDuplicateRows.toLocaleString()} skipped`
      );
    }

    const nextLedger: ImportLedger = {
      version: 1,
      transactions: [...ledger.transactions, ...nextTransactions],
      quality: [...ledger.quality, ...nextQuality],
      importedFileFingerprints: [...existingFileFingerprints],
      importedTransactionKeys: [...existingTransactionKeys]
    };
    setLedger(nextLedger);
    setImportMessage(messages.join(" | "));
    await saveSharedLedgerIfEnabled(nextLedger);
  }

  async function clearAllData() {
    if (sharedLedgerEnabled && !canManageSalesData) {
      setImportMessage("Only administrators can clear shared sales data.");
      return;
    }
    const nextLedger = createEmptyImportLedger();
    setLedger(nextLedger);
    setImportMessage("");
    setFilters(emptyFilters);
    await saveSharedLedgerIfEnabled(nextLedger);
  }

  async function refreshSharedLedger() {
    if (!sharedLedgerEnabled) return;
    setSharedLedgerMessage("Refreshing shared sales data...");
    try {
      const result = await loadSharedSalesLedger();
      const jobs = await loadAutomatedImportHistory().catch(() => automatedImportJobs);
      setLedger(result.ledger);
      setAutomatedImportJobs(jobs);
      setSharedLedgerMeta({
        stateVersion: result.stateVersion,
        updatedAt: result.updatedAt,
        updatedByEmail: result.updatedByEmail
      });
      setSharedLedgerMessage(
        result.updatedAt
          ? `Shared data refreshed. Last updated ${formatShortDateTime(result.updatedAt)}${
              result.updatedByEmail ? ` by ${result.updatedByEmail}` : ""
            }.`
          : "Shared data refreshed. No imports have been saved yet."
      );
    } catch (error) {
      setSharedLedgerMessage(
        error instanceof Error ? error.message : "Shared sales storage is not available."
      );
    }
  }

  async function saveSharedLedgerIfEnabled(nextLedger: ImportLedger) {
    if (!sharedLedgerEnabled) return;
    if (!sharedLedgerMeta) {
      setSharedLedgerMessage("Sync the latest shared sales data before saving an import.");
      return;
    }
    setSharedLedgerMessage("Saving shared sales data...");
    try {
      const result = await saveSharedSalesLedger(nextLedger, sharedLedgerMeta.stateVersion);
      setSharedLedgerMeta({
        stateVersion: result.stateVersion,
        updatedAt: result.updatedAt,
        updatedByEmail: result.updatedByEmail
      });
      setSharedLedgerMessage(
        result.updatedAt
          ? `Shared data saved. Last updated ${formatShortDateTime(result.updatedAt)}${
              result.updatedByEmail ? ` by ${result.updatedByEmail}` : ""
            }.`
          : "Shared data saved."
      );
    } catch (error) {
      setSharedLedgerMessage(
        error instanceof Error
          ? `${error.message} Changes are only saved in this browser until shared storage is restored.`
          : "Shared sales storage is not available. Changes are only saved in this browser for now."
      );
    }
  }

  async function signIn(email: string, password: string) {
    if (netlifyIdentityEnabled) {
      const result = await loginWithNetlifyIdentity(email, password);
      if (!result.user) return result.error || "Netlify Identity sign-in failed.";
      const approvedUser = approvedUserForEmail(users, result.user.email);
      if (!approvedUser) {
        await logoutNetlifyIdentity();
        return "This Netlify user is not approved for the Evologics dashboard.";
      }
      const signedInAt = new Date().toISOString();
      setUsers((current) =>
        current.map((item) =>
          item.id === approvedUser.id ? { ...item, lastLoginAt: signedInAt } : item
        )
      );
      setLastLoginEmail(approvedUser.email);
      setSession({ userId: approvedUser.id, signedInAt, provider: "netlify" });
      return "";
    }

    const user = await authenticateUser(users, email, password);
    if (!user) return "Email or password did not match an active user.";
    const signedInAt = new Date().toISOString();
    setUsers((current) =>
      current.map((item) => (item.id === user.id ? { ...item, lastLoginAt: signedInAt } : item))
    );
    setLastLoginEmail(user.email);
    setSession({ userId: user.id, signedInAt, provider: "local" });
    return "";
  }

  async function createApprovedAccount(email: string, password: string) {
    if (!netlifyIdentityEnabled) return "Account creation is only available on the deployed site.";
    const approvedUser = approvedUserForEmail(users, email);
    if (!approvedUser || approvedUser.status !== "Active") {
      return "This email is not approved for the Evologics dashboard.";
    }

    const result = await createNetlifyIdentityAccount(email, password, approvedUser.name);
    if (!result.user) return result.error || "Netlify Identity account creation failed.";
    if (result.needsConfirmation) {
      return "Account created. Check that email inbox for the Netlify confirmation link, then sign in here.";
    }

    const signedInAt = new Date().toISOString();
    setUsers((current) =>
      current.map((item) =>
        item.id === approvedUser.id ? { ...item, lastLoginAt: signedInAt } : item
      )
    );
    setLastLoginEmail(approvedUser.email);
    setSession({ userId: approvedUser.id, signedInAt, provider: "netlify" });
    return "";
  }

  async function completeAuthChallenge(password: string) {
    if (!authChallenge) return "The invite or recovery link is no longer active.";
    const result = await completeNetlifyIdentityChallenge(authChallenge, password);
    if (!result.user) return result.error || "Netlify Identity password setup failed.";

    const approvedUser = approvedUserForEmail(users, result.user.email);
    if (!approvedUser || approvedUser.status !== "Active") {
      await logoutNetlifyIdentity();
      setAuthChallenge(null);
      return "This Netlify user is not approved for the Evologics dashboard.";
    }

    const signedInAt = new Date().toISOString();
    setUsers((current) =>
      current.map((item) =>
        item.id === approvedUser.id ? { ...item, lastLoginAt: signedInAt } : item
      )
    );
    setLastLoginEmail(approvedUser.email);
    setSession({ userId: approvedUser.id, signedInAt, provider: "netlify" });
    setAuthChallenge(null);
    return "";
  }

  async function signOut() {
    if (netlifyIdentityEnabled) {
      await logoutNetlifyIdentity();
    }
    setSession(null);
    setActiveView("overview");
  }

  async function addUser(input: { name: string; email: string; role: AppUserRole; password: string }) {
    const email = input.email.trim().toLowerCase();
    if (users.some((user) => user.email.toLowerCase() === email)) {
      return "A user with that email already exists.";
    }
    const user = await createUserRecord(input);
    setUsers((current) => [...current, user]);
    return "";
  }

  function toggleUserStatus(userId: string) {
    setUsers((current) =>
      current.map((user) =>
        user.id === userId
          ? { ...user, status: user.status === "Active" ? "Inactive" : "Active" }
          : user
      )
    );
  }

  if (authLoading) {
    return <LoadingAuthPanel />;
  }

  if (authChallenge) {
    return (
      <CredentialSetupPanel
        mode={authChallenge.type}
        onSubmit={completeAuthChallenge}
      />
    );
  }

  if (!currentUser) {
    return (
      <LoginPanel
        authNotice={authNotice}
        initialEmail={lastLoginEmail}
        isNetlifyIdentity={netlifyIdentityEnabled}
        onCreateAccount={createApprovedAccount}
        onSignIn={signIn}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <img src="/evologics-logo-wide-white.png" alt="Evologics" />
          <span>Sales Analytics</span>
        </div>
        <nav className="nav-list">
          <NavButton icon={<BarChart3 />} id="overview" active={activeView} onClick={setActiveView}>
            Overview
          </NavButton>
          <NavButton icon={<RefreshCcw />} id="trend" active={activeView} onClick={setActiveView}>
            Sales Trend
          </NavButton>
          <NavButton icon={<UsersRound />} id="reps" active={activeView} onClick={setActiveView}>
            Reps & Distributors
          </NavButton>
          <NavButton icon={<PackageSearch />} id="products" active={activeView} onClick={setActiveView}>
            Products
          </NavButton>
          <NavButton icon={<Database />} id="customers" active={activeView} onClick={setActiveView}>
            Customers & States
          </NavButton>
          <NavButton icon={<TrendingUp />} id="momentum" active={activeView} onClick={setActiveView}>
            Growth & Risk
          </NavButton>
          <NavButton icon={<MapPinned />} id="map" active={activeView} onClick={setActiveView}>
            National Sales Map
          </NavButton>
          <NavButton icon={<AlertTriangle />} id="quality" active={activeView} onClick={setActiveView}>
            Import Quality
          </NavButton>
          <NavButton icon={<UsersRound />} id="users" active={activeView} onClick={setActiveView}>
            Users
          </NavButton>
        </nav>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-heading">
            <p className="eyebrow">NetSuite source-agnostic import MVP</p>
            <h1>Evologics Sales Analytics</h1>
            <p className="subtle">
              {filtered.length.toLocaleString()} of {enriched.length.toLocaleString()} normalized line
              items
              {filteredRange
                ? ` | active ${filters.dateBasis === "created" ? "created dates" : "transaction dates"} ${filteredRange.start} to ${filteredRange.end}`
                : ""}
            </p>
          </div>
          <GlobalFilterSearch
            rows={enriched}
            filters={filters}
            setFilters={setFilters}
          />
          <div className="import-actions">
            <div className="user-chip">
              <span>{currentUser.name}</span>
              <small>{currentUser.role}</small>
            </div>
            {sharedLedgerEnabled ? (
              <button className="ghost-button" onClick={() => void refreshSharedLedger()}>
                <RefreshCcw size={18} />
                Sync
              </button>
            ) : null}
            {canManageSalesData ? (
              <>
                <label className="upload-button">
                  <FileUp size={18} />
                  Import files
                  <input
                    type="file"
                    multiple
                    accept=".xls,.xml,.csv,text/xml,text/csv"
                    onChange={(event) => {
                      const files = event.currentTarget.files;
                      void importFiles(files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <button
                  className="ghost-button"
                  onClick={() => void clearAllData()}
                  disabled={!enriched.length}
                >
                  Clear
                </button>
              </>
            ) : null}
            <button
              className="ghost-button icon-button"
              onClick={() => void signOut()}
              aria-label="Sign out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {sharedLedgerMessage ? <div className="status-strip">{sharedLedgerMessage}</div> : null}
        {importMessage ? <div className="status-strip">{importMessage}</div> : null}

        <FilterPanel
          rows={enriched}
          filters={filters}
          setFilters={setFilters}
          selectedRange={selectedRange}
        />

        {activeView === "users" ? (
          <UserList
            currentUser={currentUser}
            isNetlifyIdentity={netlifyIdentityEnabled}
            users={users}
            onAddUser={addUser}
            onToggleStatus={toggleUserStatus}
          />
        ) : !enriched.length ? (
          <EmptyState />
        ) : (
          <>
            {activeView === "overview" && (
              <Overview rows={filtered} metrics={metrics} dateBasis={filters.dateBasis} />
            )}
            {activeView === "trend" && (
              <TrendView
                rows={filtered}
                grain={trendGrain}
                setGrain={setTrendGrain}
                yearsLoaded={yearsLoaded}
                dateBasis={filters.dateBasis}
              />
            )}
            {activeView === "reps" && (
              <RepView
                rows={filtered}
                allRows={enriched}
                mappings={repMappings}
                selectedRepVendor={selectedRepVendor}
                setMappings={setRepMappings}
                onClearReport={() => setSelectedRepVendor(null)}
                onSelectReport={setSelectedRepVendor}
                dateBasis={filters.dateBasis}
              />
            )}
            {activeView === "products" && (
              <ProductView
                rows={filtered}
                allRows={enriched}
                enrichments={skuEnrichments}
                setEnrichments={setSkuEnrichments}
                dateBasis={filters.dateBasis}
              />
            )}
            {activeView === "customers" && (
              <CustomerGeoView rows={filtered} dateBasis={filters.dateBasis} />
            )}
            {activeView === "momentum" && (
              <GrowthRiskView
                rows={filtered}
                distributorDetailRows={filteredWithoutState}
                dateBasis={filters.dateBasis}
              />
            )}
            {activeView === "map" && (
              <NationalSalesMap
                rows={filtered}
                dateBasis={filters.dateBasis}
                sourceUpdatedAt={sharedLedgerMeta?.updatedAt}
              />
            )}
            {activeView === "quality" && (
              <QualityView
                rows={enriched}
                quality={quality}
                automatedImportJobs={automatedImportJobs}
                sourceRange={importedSourceRange ?? sourceRange}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function CredentialSetupPanel({
  mode,
  onSubmit
}: {
  mode: NetlifyAuthChallenge["type"];
  onSubmit: (password: string) => Promise<string>;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    const message = await onSubmit(password);
    if (message) setError(message);
    setIsSubmitting(false);
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-brand">
          <img src="/evologics-logo-wide.png" alt="Evologics" />
          <span>Sales Analytics</span>
        </div>
        <div>
          <p className="eyebrow">Netlify Identity</p>
          <h1>{mode === "invite" ? "Create your password" : "Reset your password"}</h1>
          <p className="subtle">
            {mode === "invite"
              ? "Finish accepting your dashboard invitation."
              : "Choose a new password for your dashboard account."}
          </p>
        </div>
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button className="upload-button login-submit" type="submit" disabled={isSubmitting}>
            <LockKeyhole size={18} />
            {mode === "invite" ? "Accept invitation" : "Save new password"}
          </button>
        </form>
        <p className="security-note">Your password is stored and managed by Netlify Identity.</p>
      </section>
    </main>
  );
}

function LoadingAuthPanel() {
  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-brand">
          <img src="/evologics-logo-wide.png" alt="Evologics" />
          <span>Sales Analytics</span>
        </div>
        <div>
          <p className="eyebrow">Netlify Identity</p>
          <h1>Checking session</h1>
          <p className="subtle">Connecting to the deployed authentication service.</p>
        </div>
      </section>
    </main>
  );
}

function LoginPanel({
  authNotice,
  initialEmail,
  isNetlifyIdentity,
  onCreateAccount,
  onSignIn
}: {
  authNotice: string;
  initialEmail: string;
  isNetlifyIdentity: boolean;
  onCreateAccount: (email: string, password: string) => Promise<string>;
  onSignIn: (email: string, password: string) => Promise<string>;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSubmitting(true);
    const signInError = await onSignIn(email, password);
    if (signInError) setError(signInError);
    setIsSubmitting(false);
  }

  async function createAccount() {
    setError("");
    setMessage("");
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    setIsSubmitting(true);
    const accountMessage = await onCreateAccount(email, password);
    if (accountMessage.startsWith("Account created")) {
      setMessage(accountMessage);
    } else if (accountMessage) {
      setError(accountMessage);
    }
    setIsSubmitting(false);
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-brand">
          <img src="/evologics-logo-wide.png" alt="Evologics" />
          <span>Sales Analytics</span>
        </div>
        <div>
          <p className="eyebrow">{isNetlifyIdentity ? "Netlify Identity" : "Secure local MVP"}</p>
          <h1>Sign in</h1>
          <p className="subtle">
            {isNetlifyIdentity
              ? "Access the deployed Evologics sales dashboard with Netlify authentication."
              : "Access imports, analytics, and the local user directory for this browser."}
          </p>
        </div>
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {authNotice ? <div className="form-note">{authNotice}</div> : null}
          {message ? <div className="form-note">{message}</div> : null}
          {error ? <div className="form-error">{error}</div> : null}
          <button className="upload-button login-submit" type="submit" disabled={isSubmitting}>
            <LockKeyhole size={18} />
            Sign in
          </button>
          {isNetlifyIdentity ? (
            <button
              className="ghost-button login-submit"
              type="button"
              disabled={isSubmitting}
              onClick={() => void createAccount()}
            >
              <UserPlus size={18} />
              Create approved account
            </button>
          ) : null}
        </form>
        <p className="security-note">
          {isNetlifyIdentity
            ? "User accounts and passwords are handled by Netlify Identity on the deployed site."
            : "Local prototype auth only. Production access should move to a server-backed identity provider before live company use."}
        </p>
      </section>
    </main>
  );
}

function UserList({
  currentUser,
  isNetlifyIdentity,
  users,
  onAddUser,
  onToggleStatus
}: {
  currentUser: AppUser;
  isNetlifyIdentity: boolean;
  users: AppUser[];
  onAddUser: (input: {
    name: string;
    email: string;
    role: AppUserRole;
    password: string;
  }) => Promise<string>;
  onToggleStatus: (userId: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppUserRole>("user");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (!name.trim() || !email.trim() || password.length < 8) {
      setMessage("Add a name, email, and temporary password with at least 8 characters.");
      return;
    }
    const error = await onAddUser({ name, email, role, password });
    if (error) {
      setMessage(error);
      return;
    }
    setName("");
    setEmail("");
    setPassword("");
    setRole("user");
    setMessage("User added to this browser.");
  }

  return (
    <section className="view-stack">
      <div className="section-header">
        <div>
          <p className="eyebrow">Access</p>
          <h2>User list</h2>
          <p className="subtle">
            {isNetlifyIdentity
              ? "Approved dashboard users mapped to Netlify Identity accounts."
              : "Local users for this dashboard prototype."}
          </p>
        </div>
        <div className="user-chip">
          <span>{users.filter((user) => user.status === "Active").length} active</span>
          <small>{users.length} total</small>
        </div>
      </div>
      <div className="table-card">
        <h2>Users</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last sign-in</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>{user.role}</td>
                <td>
                  <span className={`status-pill ${user.status === "Active" ? "active" : "inactive"}`}>
                    {user.status}
                  </span>
                </td>
                <td>{user.lastLoginAt ? formatShortDateTime(user.lastLoginAt) : "Not yet"}</td>
                <td>
                  {isNetlifyIdentity ? (
                    <span className="subtle">Manage in Netlify</span>
                  ) : (
                    <button
                      className="table-action"
                      disabled={user.id === currentUser.id}
                      onClick={() => onToggleStatus(user.id)}
                    >
                      {user.status === "Active" ? "Deactivate" : "Activate"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isNetlifyIdentity ? (
        <div className="soft-empty">
          Invite and password changes are managed in Netlify Identity. This table is the dashboard's
          approved access directory.
        </div>
      ) : (
      <form className="user-form" onSubmit={(event) => void submit(event)}>
        <div className="form-title">
          <UserPlus size={18} />
          <h2>Add User</h2>
        </div>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value as AppUserRole)}>
            <option value="administrator">administrator</option>
            <option value="user">user</option>
          </select>
        </label>
        <label>
          Temporary password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button className="upload-button" type="submit">
          <UserPlus size={18} />
          Add
        </button>
        {message ? <div className="form-note">{message}</div> : null}
      </form>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <section className="empty-state">
      <FileUp size={34} />
      <h2>Import NetSuite sales exports to begin.</h2>
      <p>
        The MVP accepts current SpreadsheetML/XML `.xls` exports plus future CSV/XML saved-search
        exports, then normalizes each line into the same transaction model.
      </p>
    </section>
  );
}

function FilterPanel({
  rows,
  filters,
  setFilters,
  selectedRange
}: {
  rows: SalesTransaction[];
  filters: DashboardFilters;
  setFilters: (filters: DashboardFilters) => void;
  selectedRange: { start?: string; end?: string };
}) {
  const set = <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) =>
    setFilters({ ...filters, [key]: value });
  const displayedRange =
    selectedRange.start || selectedRange.end
      ? selectedRange
      : dateRange(rows, filters.dateBasis) ?? {};

  return (
    <section className="filter-panel">
      <div className="filter-title">
        <SlidersHorizontal size={18} />
        <span>Global filters</span>
        <button className="link-button" onClick={() => setFilters(emptyFilters)}>
          Clear all
        </button>
      </div>
      <div className="filter-rows">
      <div className="filter-row filter-row-dates">
        <div className="filter-field">
          <span>Date basis</span>
          <div className="segmented date-basis-control">
            {(["transaction", "created"] as const).map((basis) => (
              <button
                key={basis}
                className={filters.dateBasis === basis ? "active" : ""}
                onClick={() => set("dateBasis", basis)}
                type="button"
              >
                {basis === "transaction" ? "Transaction date" : "Date created"}
              </button>
            ))}
          </div>
        </div>
        <label>
          Date range
          <select value={filters.datePreset} onChange={(event) => set("datePreset", event.target.value as never)}>
            <option value="all">All data</option>
            <option value="ytd">YTD</option>
            <option value="quarter">Current quarter</option>
            <option value="month">Current month</option>
            <option value="previousMonth">Previous month</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          Start
          <input
            type="date"
            value={filters.datePreset === "custom" ? filters.customStart ?? "" : displayedRange.start ?? ""}
            onChange={(event) =>
              setFilters({
                ...filters,
                datePreset: "custom",
                customStart: event.target.value,
                customEnd: filters.customEnd ?? displayedRange.end
              })
            }
          />
        </label>
        <label>
          End
          <input
            type="date"
            value={filters.datePreset === "custom" ? filters.customEnd ?? "" : displayedRange.end ?? ""}
            onChange={(event) =>
              setFilters({
                ...filters,
                datePreset: "custom",
                customStart: filters.customStart ?? displayedRange.start,
                customEnd: event.target.value
              })
            }
          />
        </label>
      </div>
      <div className="filter-row">
        <MultiSelect
          label="Sales rep / vendor"
          values={filters.salesRepVendor}
          options={optionValues(rows, "salesRepVendor")}
          onChange={(values) => set("salesRepVendor", values)}
        />
        <MultiSelect
          label="Sales group"
          values={filters.salesGroup}
          options={optionValues(rows, "salesGroup")}
          onChange={(values) => set("salesGroup", values)}
        />
        <QuickFilterLinks
          label="Managers"
          values={filters.managers}
          options={[...managerOptions]}
          onChange={(values) => set("managers", values)}
        />
      </div>
      <div className="filter-row">
        <MultiSelect
          label="Category"
          values={filters.salesCategory}
          options={optionValues(rows, "salesCategory")}
          onChange={(values) => set("salesCategory", values)}
        />
        <MultiSelect
          label="Product class"
          values={filters.productClass}
          options={productFamilyOptions(rows)}
          onChange={(values) => {
            const availableSkus = new Set(skuOptionsForProductFamilies(rows, values));
            setFilters({
              ...filters,
              productClass: values,
              sku: filters.sku.filter((sku) => availableSkus.has(sku))
            });
          }}
        />
        <MultiSelect
          label="SKU"
          values={filters.sku}
          options={skuOptionsForProductFamilies(rows, filters.productClass)}
          onChange={(values) => set("sku", values)}
        />
      </div>
      <div className="filter-row">
        <MultiSelect
          label="Customer"
          values={filters.customerName}
          options={optionValues(rows, "customerName")}
          onChange={(values) => set("customerName", values)}
        />
        <MultiSelect
          label="State"
          values={filters.shippingState}
          options={optionValues(rows, "shippingState")}
          onChange={(values) => set("shippingState", values)}
        />
        <MultiSelect
          label="Transaction type"
          values={filters.transactionType}
          options={optionValues(rows, "transactionType")}
          onChange={(values) => set("transactionType", values)}
        />
      </div>
      </div>
    </section>
  );
}

type HeaderFilterOption = {
  type: string;
  key:
    | "datePreset"
    | "dateBasis"
    | "salesRepVendor"
    | "salesGroup"
    | "managers"
    | "salesCategory"
    | "productClass"
    | "sku"
    | "customerName"
    | "shippingState"
    | "transactionType";
  value: string;
  label: string;
};

function GlobalFilterSearch({
  rows,
  filters,
  setFilters
}: {
  rows: SalesTransaction[];
  filters: DashboardFilters;
  setFilters: (filters: DashboardFilters) => void;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const options = useMemo<HeaderFilterOption[]>(
    () => [
      { type: "Date basis", key: "dateBasis", value: "transaction", label: "Transaction date" },
      { type: "Date basis", key: "dateBasis", value: "created", label: "Date created" },
      { type: "Date range", key: "datePreset", value: "all", label: "All data" },
      { type: "Date range", key: "datePreset", value: "ytd", label: "YTD" },
      { type: "Date range", key: "datePreset", value: "quarter", label: "Current quarter" },
      { type: "Date range", key: "datePreset", value: "month", label: "Current month" },
      { type: "Date range", key: "datePreset", value: "previousMonth", label: "Previous month" },
      ...optionValues(rows, "salesRepVendor").map((value) => ({
        type: "Rep / vendor" as const,
        key: "salesRepVendor" as const,
        value,
        label: value
      })),
      ...optionValues(rows, "salesGroup").map((value) => ({
        type: "Sales group",
        key: "salesGroup" as const,
        value,
        label: value
      })),
      ...managerOptions.map((value) => ({
        type: "Manager",
        key: "managers" as const,
        value,
        label: value
      })),
      ...optionValues(rows, "salesCategory").map((value) => ({
        type: "Category",
        key: "salesCategory" as const,
        value,
        label: value
      })),
      ...productFamilyOptions(rows).map((value) => ({
        type: "Product class" as const,
        key: "productClass" as const,
        value,
        label: value
      })),
      ...skuFilterOptions(rows).map(({ value, label }) => ({
        type: "SKU" as const,
        key: "sku" as const,
        value,
        label
      })),
      ...optionValues(rows, "customerName").map((value) => ({
        type: "Customer",
        key: "customerName" as const,
        value,
        label: value
      })),
      ...optionValues(rows, "shippingState").map((value) => ({
        type: "State",
        key: "shippingState" as const,
        value,
        label: value
      })),
      ...optionValues(rows, "transactionType").map((value) => ({
        type: "Transaction type",
        key: "transactionType" as const,
        value,
        label: value
      }))
    ],
    [rows]
  );
  const matches = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return options
      .map((option) => {
        const searchable = `${option.type} ${option.label} ${option.value}`.toLowerCase();
        if (!terms.every((term) => searchable.includes(term))) return null;
        const label = option.label.toLowerCase();
        const value = option.value.toLowerCase();
        const phrase = terms.join(" ");
        const score = label === phrase || value === phrase ? 0 : label.startsWith(phrase) ? 1 : 2;
        return { option, score };
      })
      .filter((match): match is { option: HeaderFilterOption; score: number } => Boolean(match))
      .sort((a, b) => a.score - b.score || a.option.label.localeCompare(b.option.label))
      .slice(0, 10)
      .map((match) => match.option);
  }, [options, query]);

  useEffect(() => setActiveIndex(0), [query]);

  function selectOption(option: HeaderFilterOption) {
    if (option.key === "datePreset") {
      setFilters({ ...filters, datePreset: option.value as DashboardFilters["datePreset"] });
    } else if (option.key === "dateBasis") {
      setFilters({ ...filters, dateBasis: option.value as DateBasis });
    } else if (option.key === "salesRepVendor") {
      setFilters({
        ...filters,
        salesRepVendor: addUnique(filters.salesRepVendor, option.value)
      });
    } else if (option.key === "salesGroup") {
      setFilters({ ...filters, salesGroup: addUnique(filters.salesGroup, option.value) });
    } else if (option.key === "managers") {
      setFilters({ ...filters, managers: addUnique(filters.managers, option.value) });
    } else if (option.key === "salesCategory") {
      setFilters({ ...filters, salesCategory: addUnique(filters.salesCategory, option.value) });
    } else if (option.key === "productClass") {
      const productClass = addUnique(filters.productClass, option.value);
      const availableSkus = new Set(skuOptionsForProductFamilies(rows, productClass));
      setFilters({
        ...filters,
        productClass,
        sku: filters.sku.filter((sku) => availableSkus.has(sku))
      });
    } else if (option.key === "sku") {
      setFilters({ ...filters, sku: addUnique(filters.sku, option.value) });
    } else if (option.key === "customerName") {
      setFilters({ ...filters, customerName: addUnique(filters.customerName, option.value) });
    } else if (option.key === "shippingState") {
      setFilters({ ...filters, shippingState: addUnique(filters.shippingState, option.value) });
    } else {
      setFilters({
        ...filters,
        transactionType: addUnique(filters.transactionType, option.value)
      });
    }
    setQuery("");
    setIsOpen(false);
  }

  return (
    <div
      className="header-filter-search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsOpen(false);
      }}
    >
      <Search size={18} aria-hidden="true" />
      <input
        type="search"
        value={query}
        placeholder="Search any filter"
        aria-label="Search global filters"
        aria-controls="header-filter-results"
        aria-expanded={isOpen && Boolean(query.trim())}
        role="combobox"
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(event) => {
          if (!matches.length) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            selectOption(matches[activeIndex] ?? matches[0]);
          } else if (event.key === "Escape") {
            setIsOpen(false);
          }
        }}
      />
      {isOpen && query.trim() ? (
        <div className="header-filter-results" id="header-filter-results" role="listbox">
          {matches.length ? (
            matches.map((option, index) => (
              <button
                key={`${option.key}-${option.value}`}
                className={index === activeIndex ? "active" : ""}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
              >
                <span>{option.label}</span>
                <small>{option.type}</small>
              </button>
            ))
          ) : (
            <div className="header-filter-empty">No matching filters</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function addUnique(values: string[], value: string) {
  return values.includes(value) ? values : [...values, value];
}

function Overview({
  rows,
  metrics,
  dateBasis
}: {
  rows: SalesTransaction[];
  metrics: ReturnType<typeof kpis>;
  dateBasis: DateBasis;
}) {
  const monthly = timeSeries(rows, "month", dateBasis);
  const quarterly = timeSeries(rows, "quarter", dateBasis);
  const topReps = topByRevenue(rows, "salesRepVendor", 10);
  const topProducts = topByRevenue(rows, "sku", 10);
  const salesCategories = topByRevenue(rows, "salesCategory", 10);
  const productClass = topByRevenue(rows, "productClass", 10);

  return (
    <section className="view-stack">
      <div className="kpi-grid">
        <Kpi label="Total revenue" value={formatCurrency(metrics.revenue)} />
        <Kpi label="Total quantity" value={formatNumber(metrics.quantity)} />
        <Kpi label="Line items" value={metrics.transactionCount.toLocaleString()} />
        <Kpi label="Customers" value={metrics.uniqueCustomers.toLocaleString()} />
        <Kpi label="Unique SKUs" value={metrics.uniqueSkus.toLocaleString()} />
        <Kpi label="Avg revenue / line" value={formatCurrency(metrics.averageRevenuePerLine)} />
      </div>
      <div className="dashboard-grid">
        <ChartCard title="Revenue by Month">
          <RevenueArea data={monthly} />
        </ChartCard>
        <ChartCard title="Revenue by Quarter">
          <RevenueBar data={quarterly} />
        </ChartCard>
        <ChartCard title="Top Sales Reps / Vendors">
          <RevenueBar data={topReps} nameKey="name" />
        </ChartCard>
        <ChartCard title="Top Products / SKUs">
          <RevenueBar data={topProducts} nameKey="name" />
        </ChartCard>
        <ChartCard title="Sales by Category">
          {salesCategories.length ? <RevenueBar data={salesCategories} nameKey="name" /> : <SoftEmpty text="Upload a report with Category data to enable category reporting." />}
        </ChartCard>
        <ChartCard title="Sales by Product Class">
          {productClass.length ? <RevenueBar data={productClass} nameKey="name" /> : <SoftEmpty text="Upload a report with Class data or enrich SKUs to enable product-class reporting." />}
        </ChartCard>
      </div>
    </section>
  );
}

function TrendView({
  rows,
  grain,
  setGrain,
  yearsLoaded,
  dateBasis
}: {
  rows: SalesTransaction[];
  grain: TimeSeriesGrain;
  setGrain: (grain: TimeSeriesGrain) => void;
  yearsLoaded: number;
  dateBasis: DateBasis;
}) {
  const data = timeSeries(rows, grain, dateBasis);

  return (
    <section className="view-stack">
      <div className="section-header">
        <div>
          <p className="eyebrow">Movement</p>
          <h2>Sales trend</h2>
        </div>
        <div className="segmented">
          {(["day", "month", "quarter", "year"] as const).map((item) => (
            <button key={item} className={grain === item ? "active" : ""} onClick={() => setGrain(item)}>
              {item}
            </button>
          ))}
        </div>
      </div>
      <ChartCard title={`${grainLabel(grain)} Revenue and Change`}>
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#DDE7E1" vertical={false} />
            <XAxis dataKey="period" tick={{ fill: "#6F7775", fontSize: 12 }} />
            <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} tick={{ fill: "#6F7775", fontSize: 12 }} />
            <Tooltip formatter={(value) => formatCurrency(Number(value))} />
            <Line type="monotone" dataKey="revenue" stroke="#1F4F45" strokeWidth={3} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th>Revenue</th>
              <th>Quantity</th>
              <th>Line items</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.period}>
                <td>{row.period}</td>
                <td>{formatCurrency(row.revenue)}</td>
                <td>{formatNumber(row.quantity)}</td>
                <td>{row.transactions.toLocaleString()}</td>
                <td className={row.changePct && row.changePct < 0 ? "negative" : "positive"}>
                  {formatPercent(row.changePct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {yearsLoaded < 2 ? (
        <SoftEmpty text="Upload prior-year NetSuite reports to enable year-over-year comparison." />
      ) : null}
    </section>
  );
}

function RepView({
  rows,
  allRows,
  mappings,
  selectedRepVendor,
  setMappings,
  onClearReport,
  onSelectReport,
  dateBasis
}: {
  rows: SalesTransaction[];
  allRows: SalesTransaction[];
  mappings: SalesRepMapping[];
  selectedRepVendor: string | null;
  setMappings: (mappings: SalesRepMapping[]) => void;
  onClearReport: () => void;
  onSelectReport: (name: string) => void;
  dateBasis: DateBasis;
}) {
  const data = repPerformance(rows, dateBasis);
  const reps = optionValues(allRows, "salesRepVendor");
  const selectedRows = selectedRepVendor
    ? rows.filter((row) => (row.salesRepVendor || "Unassigned") === selectedRepVendor)
    : [];
  const selectedMapping = selectedRepVendor
    ? mappings.find((mapping) => mapping.salesRepVendor === selectedRepVendor)
    : undefined;

  return (
    <section className="view-stack">
      {selectedRepVendor ? (
        <RepVendorReport
          entityName={selectedRepVendor}
          mapping={selectedMapping}
          rows={selectedRows}
          onBack={onClearReport}
          dateBasis={dateBasis}
        />
      ) : null}
      <ChartCard title="Revenue Trend for Current Rep / Vendor Filter">
        <RevenueArea data={timeSeries(rows, "month", dateBasis)} />
      </ChartCard>
      <div className="table-card">
        <h2>Sales Rep / Distributor Performance</h2>
        <table>
          <thead>
            <tr>
              <th>Rep / vendor</th>
              <th>Revenue</th>
              <th>Qty</th>
              <th>Lines</th>
              <th>Customers</th>
              <th>Top product</th>
              <th>MoM</th>
              <th>QoQ</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.name}>
                <td>
                  <button
                    className={`text-action ${selectedRepVendor === row.name ? "selected" : ""}`}
                    aria-pressed={selectedRepVendor === row.name}
                    onClick={() => onSelectReport(row.name)}
                  >
                    {row.name}
                  </button>
                </td>
                <td>{formatCurrency(row.revenue)}</td>
                <td>{formatNumber(row.quantity)}</td>
                <td>{row.transactions.toLocaleString()}</td>
                <td>{row.customerCount.toLocaleString()}</td>
                <td>{row.topProduct}</td>
                <td>{formatPercent(row.momChange)}</td>
                <td>{formatPercent(row.qoqChange)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MappingEditor reps={reps} mappings={mappings} setMappings={setMappings} />
    </section>
  );
}

function RepVendorReport({
  entityName,
  mapping,
  rows,
  onBack,
  dateBasis
}: {
  entityName: string;
  mapping?: SalesRepMapping;
  rows: SalesTransaction[];
  onBack: () => void;
  dateBasis: DateBasis;
}) {
  const metrics = kpis(rows);
  const range = dateRange(rows, dateBasis);
  const weekly = timeSeries(rows, "week", dateBasis).slice(-10);
  const topClients = customerPerformance(rows).slice(0, 10);
  const topProducts = productPerformance(rows).slice(0, 10);
  const entityType =
    mapping?.salesEntityType ??
    rows.find((row) => row.salesEntityType && row.salesEntityType !== "Unknown")?.salesEntityType ??
    "Rep / Distributor";
  const reportTitle = `${entityName} weekly sales report`;

  function printReport() {
    document.title = reportTitle;
    window.print();
  }

  return (
    <article className="rep-report" aria-label={reportTitle}>
      <div className="report-toolbar no-print">
        <button className="ghost-button" onClick={onBack}>
          <ArrowLeft size={18} />
          Back
        </button>
        <button className="upload-button" onClick={printReport}>
          <Printer size={18} />
          Save PDF
        </button>
      </div>
      <div className="report-page">
        <div className="report-header">
          <div>
            <p className="eyebrow">{entityType}</p>
            <h2>{entityName}</h2>
            <p className="subtle">
              Weekly sales report
              {range ? ` | ${range.start} to ${range.end}` : ""}
              {mapping?.territory ? ` | ${mapping.territory}` : ""}
            </p>
          </div>
          <img src="/evologics-logo-wide.png" alt="Evologics" />
        </div>

        {!rows.length ? (
          <SoftEmpty text="No sales rows match this rep/distributor under the current filters." />
        ) : (
          <>
            <div className="kpi-grid compact">
              <Kpi label="Sales" value={formatCurrency(metrics.revenue)} />
              <Kpi label="Quantity" value={formatNumber(metrics.quantity)} />
              <Kpi label="Customers" value={metrics.uniqueCustomers.toLocaleString()} />
              <Kpi label="Products" value={metrics.uniqueSkus.toLocaleString()} />
              <Kpi label="Line items" value={metrics.transactionCount.toLocaleString()} />
              <Kpi label="Avg revenue / line" value={formatCurrency(metrics.averageRevenuePerLine)} />
            </div>

            <div className="dashboard-grid report-grid">
              <ChartCard title="Weekly Sales Trend">
                <RevenueBar data={weekly} />
              </ChartCard>
              <ChartCard title="Top Clients">
                <RevenueBar data={topClients.slice(0, 8)} nameKey="name" />
              </ChartCard>
            </div>

            <div className="report-tables">
              <div className="table-card">
                <h2>Top Clients</h2>
                <table>
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Sales</th>
                      <th>Qty</th>
                      <th>Lines</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topClients.map((row) => (
                      <tr key={row.name}>
                        <td>{row.name}</td>
                        <td>{formatCurrency(row.revenue)}</td>
                        <td>{formatNumber(row.quantity)}</td>
                        <td>{row.transactions.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="table-card">
                <h2>Top Products</h2>
                <table>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Description</th>
                      <th>Sales</th>
                      <th>Qty</th>
                      <th>Clients</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((row) => (
                      <tr key={row.sku}>
                        <td>{row.sku}</td>
                        <td>{row.description}</td>
                        <td>{formatCurrency(row.revenue)}</td>
                        <td>{formatNumber(row.quantity)}</td>
                        <td>{row.topCustomers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function ProductView({
  rows,
  allRows,
  enrichments,
  setEnrichments,
  dateBasis
}: {
  rows: SalesTransaction[];
  allRows: SalesTransaction[];
  enrichments: SkuEnrichment[];
  setEnrichments: (enrichments: SkuEnrichment[]) => void;
  dateBasis: DateBasis;
}) {
  const data = productPerformance(rows);
  const topSkus = data.slice(0, 12);

  return (
    <section className="view-stack">
      <ChartCard title="Revenue by SKU Over Time">
        <RevenueArea data={timeSeries(rows, "month", dateBasis)} />
      </ChartCard>
      <div className="table-card">
        <h2>Product Performance</h2>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Description</th>
              <th>Class</th>
              <th>Revenue</th>
              <th>Qty</th>
              <th>Avg unit price</th>
              <th>Lines</th>
              <th>Top customers</th>
              <th>Top reps</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.sku}>
                <td>{row.sku}</td>
                <td>{row.description}</td>
                <td>{row.productClass || "Unassigned"}</td>
                <td>{formatCurrency(row.revenue)}</td>
                <td>{formatNumber(row.quantity)}</td>
                <td>{formatCurrency(row.averageUnitPrice)}</td>
                <td>{row.transactions.toLocaleString()}</td>
                <td>{row.topCustomers}</td>
                <td>{row.topReps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SkuEditor
        skus={topSkus.map((row) => row.sku)}
        allRows={allRows}
        enrichments={enrichments}
        setEnrichments={setEnrichments}
      />
    </section>
  );
}

function NationalSalesMap({
  rows,
  dateBasis,
  sourceUpdatedAt
}: {
  rows: SalesTransaction[];
  dateBasis: DateBasis;
  sourceUpdatedAt?: string | null;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [mapConnected, setMapConnected] = useState(false);
  const mapUrl = useMemo(resolveSalesMapUrl, []);
  const mapOrigin = useMemo(() => new URL(mapUrl).origin, [mapUrl]);
  const payload = useMemo(
    () => buildSalesMapPayload(rows, { dateBasis, sourceUpdatedAt }),
    [rows, dateBasis, sourceUpdatedAt]
  );

  useEffect(() => {
    setMapConnected(false);

    function sendMapData() {
      frameRef.current?.contentWindow?.postMessage(
        { type: "evologics:sales-map-data", payload },
        mapOrigin
      );
    }

    function handleMapMessage(event: MessageEvent) {
      if (
        event.origin === mapOrigin &&
        event.source === frameRef.current?.contentWindow &&
        event.data?.type === "evologics:sales-map-ready"
      ) {
        sendMapData();
      }
      if (
        event.origin === mapOrigin &&
        event.source === frameRef.current?.contentWindow &&
        event.data?.type === "evologics:sales-map-rendered"
      ) {
        setMapConnected(true);
      }
    }

    window.addEventListener("message", handleMapMessage);
    sendMapData();
    return () => window.removeEventListener("message", handleMapMessage);
  }, [mapOrigin, payload]);

  return (
    <section className="sales-map-panel">
      <div className="sales-map-heading">
        <div>
          <p className="eyebrow">Shared ledger geography</p>
          <h2>National Sales Map</h2>
        </div>
        <div className={`sales-map-status${mapConnected ? " connected" : ""}`}>
          <span aria-hidden="true" />
          {mapConnected
            ? `Live filtered data | ${payload.mappedStateCount.toLocaleString()} states`
            : "Connecting to map"}
        </div>
      </div>
      <iframe
        ref={frameRef}
        className="sales-map-frame"
        src={mapUrl}
        title="Evologics National Sales Map"
        referrerPolicy="strict-origin"
        onLoad={() =>
          frameRef.current?.contentWindow?.postMessage(
            { type: "evologics:sales-map-data", payload },
            mapOrigin
          )
        }
      />
    </section>
  );
}

function resolveSalesMapUrl() {
  const configuredUrl = (
    import.meta as ImportMeta & { env?: { VITE_SALES_MAP_URL?: string } }
  ).env?.VITE_SALES_MAP_URL;
  if (configuredUrl) return configuredUrl;
  if (["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
    return "http://127.0.0.1:5176/?embedded=1&v=20260805";
  }
  return "https://evologics-map.netlify.app/?embedded=1&v=20260805";
}

function CustomerGeoView({ rows, dateBasis }: { rows: SalesTransaction[]; dateBasis: DateBasis }) {
  return (
    <section className="view-stack">
      <div className="dashboard-grid">
        <ChartCard title="Revenue by State">
          <RevenueBar data={topByRevenue(rows, "shippingState", 15)} nameKey="name" />
        </ChartCard>
        <ChartCard title="Customer Trend">
          <RevenueArea data={timeSeries(rows, "month", dateBasis)} />
        </ChartCard>
      </div>
      <div className="table-card">
        <h2>Top Customers</h2>
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Revenue</th>
              <th>Quantity</th>
              <th>Line items</th>
            </tr>
          </thead>
          <tbody>
            {customerPerformance(rows).map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{formatCurrency(row.revenue)}</td>
                <td>{formatNumber(row.quantity)}</td>
                <td>{row.transactions.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GrowthRiskView({
  rows,
  distributorDetailRows,
  dateBasis
}: {
  rows: SalesTransaction[];
  distributorDetailRows: SalesTransaction[];
  dateBasis: DateBasis;
}) {
  const [entity, setEntity] = useState<MomentumEntity>("distributor");
  const [metric, setMetric] = useState<MomentumMetric>("change");
  const [selectedDistributor, setSelectedDistributor] = useState<string | null>(null);
  const analysis = useMemo(() => entityMomentum(rows, entity, dateBasis), [rows, entity, dateBasis]);
  const topRows = rankMomentumRows(analysis?.rows ?? [], metric, "top");
  const bottomRows = rankMomentumRows(analysis?.rows ?? [], metric, "bottom");
  const volumeRows = rankMomentumRowsByVolume(analysis?.rows ?? []);
  const currentRevenue = analysis?.rows.reduce((total, row) => total + row.currentRevenue, 0) ?? 0;
  const previousRevenue = analysis?.rows.reduce((total, row) => total + row.previousRevenue, 0) ?? 0;
  const growingCount = analysis?.rows.filter((row) => row.changeRevenue > 0).length ?? 0;
  const decliningCount = analysis?.rows.filter((row) => row.changeRevenue < 0).length ?? 0;
  const entityLabel = entity === "distributor" ? "Distributors" : entity === "state" ? "States" : "Hospitals";
  const selectedRows = selectedDistributor
    ? distributorDetailRows.filter(
        (row) => isDistributorCategory(row.salesCategory) && row.customerName === selectedDistributor
      )
    : [];

  if (selectedDistributor) {
    return (
      <DistributorAccountReport
        distributorName={selectedDistributor}
        rows={selectedRows}
        dateBasis={dateBasis}
        onBack={() => setSelectedDistributor(null)}
      />
    );
  }

  return (
    <section className="view-stack">
      <div className="section-header momentum-header">
        <div>
          <p className="eyebrow">Completed-week comparison</p>
          <h2>Growth & Risk</h2>
          {analysis ? (
            <p className="subtle">
              Current {analysis.currentRange.start} to {analysis.currentRange.end} compared with {analysis.previousRange.start} to {analysis.previousRange.end}
            </p>
          ) : null}
        </div>
        <div className="momentum-controls">
          <div className="segmented" aria-label="Entity type">
            {(["distributor", "state", "hospital"] as const).map((item) => (
              <button
                key={item}
                className={entity === item ? "active" : ""}
                onClick={() => {
                  setEntity(item);
                  setSelectedDistributor(null);
                }}
              >
                {item === "hospital" ? "Hospitals" : `${item[0].toUpperCase()}${item.slice(1)}s`}
              </button>
            ))}
          </div>
          <div className="segmented" aria-label="Ranking metric">
            {(["change", "revenue"] as const).map((item) => (
              <button key={item} className={metric === item ? "active" : ""} onClick={() => setMetric(item)}>
                {item === "change" ? "Growth / loss" : "Sales"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!analysis || !analysis.rows.length ? (
        <SoftEmpty text={`No ${entityLabel.toLowerCase()} have sales in the latest eight completed weeks under the current filters.`} />
      ) : (
        <>
          <div className="kpi-grid compact momentum-kpis">
            <Kpi label="Current 4-week sales" value={formatCurrency(currentRevenue)} />
            <Kpi label="Prior 4-week sales" value={formatCurrency(previousRevenue)} />
            <Kpi label="Growing" value={growingCount.toLocaleString()} />
            <Kpi label="Declining" value={decliningCount.toLocaleString()} />
          </div>
          <div className="momentum-tables">
            <MomentumTable
              title={metric === "change" ? `Top 20 Growing ${entityLabel}` : `Top 20 ${entityLabel} by Sales`}
              rows={topRows}
              tone="positive"
              onSelectName={entity === "distributor" ? setSelectedDistributor : undefined}
            />
            <MomentumTable
              title={metric === "change" ? `Bottom 20 Declining ${entityLabel}` : `Bottom 20 ${entityLabel} by Sales`}
              rows={bottomRows}
              tone="negative"
              onSelectName={entity === "distributor" ? setSelectedDistributor : undefined}
            />
            <MomentumTable
              title={`Top 50 ${entityLabel} by 8-Week Sales Volume`}
              rows={volumeRows}
              tone="positive"
              showChangePercent={false}
              onSelectName={entity === "distributor" ? setSelectedDistributor : undefined}
            />
          </div>
        </>
      )}
    </section>
  );
}

function MomentumTable({
  title,
  rows,
  tone,
  showChangePercent = true,
  onSelectName
}: {
  title: string;
  rows: MomentumRow[];
  tone: "positive" | "negative";
  showChangePercent?: boolean;
  onSelectName?: (name: string) => void;
}) {
  return (
    <div className="table-card momentum-table">
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            <th>8-week trend</th>
            <th>Current</th>
            <th>Prior</th>
            <th>Change</th>
            {showChangePercent ? <th>Change %</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.name}>
              <td>{index + 1}</td>
              <td className="momentum-name">
                {onSelectName ? (
                  <button className="text-action" onClick={() => onSelectName(row.name)}>
                    {row.name}
                  </button>
                ) : row.name}
              </td>
              <td><MomentumSparkline row={row} tone={tone} /></td>
              <td>{formatCurrency(row.currentRevenue)}</td>
              <td>{formatCurrency(row.previousRevenue)}</td>
              <td className={row.changeRevenue < 0 ? "negative" : "positive"}>
                {formatSignedCurrency(row.changeRevenue)}
              </td>
              {showChangePercent ? (
                <td className={row.changeRevenue < 0 ? "negative" : "positive"}>
                  {row.previousRevenue === 0 && row.currentRevenue !== 0 ? "New" : formatPercent(row.changePct)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DistributorAccountReport({
  distributorName,
  rows,
  dateBasis,
  onBack
}: {
  distributorName: string;
  rows: SalesTransaction[];
  dateBasis: DateBasis;
  onBack: () => void;
}) {
  const metrics = kpis(rows);
  const range = dateRange(rows, dateBasis);
  const weekly = timeSeries(rows, "week", dateBasis);
  const states = topByRevenue(rows, "shippingState", 20);
  const products = productPerformance(rows).slice(0, 15);
  const transactions = [...rows].sort((a, b) => salesDate(b, dateBasis).localeCompare(salesDate(a, dateBasis)));

  return (
    <article className="rep-report distributor-account-report">
      <div className="report-toolbar no-print">
        <button className="ghost-button" onClick={onBack}>
          <ArrowLeft size={18} />
          Back to rankings
        </button>
        <button className="upload-button" onClick={() => window.print()}>
          <Printer size={18} />
          Save PDF
        </button>
      </div>
      <div className="report-page">
        <div className="report-header">
          <div>
            <p className="eyebrow">Distributor account | all shipping states</p>
            <h2>{distributorName}</h2>
            <p className="subtle">
              {range ? `${range.start} to ${range.end} | ` : ""}State filter ignored; all other dashboard filters retained
            </p>
          </div>
          <img src="/evologics-logo-wide.png" alt="Evologics" />
        </div>

        {!rows.length ? (
          <SoftEmpty text="No distributor sales match the active date and product filters." />
        ) : (
          <>
            <div className="kpi-grid compact distributor-account-kpis">
              <Kpi label="Total sales" value={formatCurrency(metrics.revenue)} />
              <Kpi label="Shipping states" value={optionValues(rows, "shippingState").length.toLocaleString()} />
              <Kpi label="Products" value={metrics.uniqueSkus.toLocaleString()} />
              <Kpi label="Quantity" value={formatNumber(metrics.quantity)} />
              <Kpi label="Sales lines" value={metrics.transactionCount.toLocaleString()} />
              <Kpi label="Avg revenue / line" value={formatCurrency(metrics.averageRevenuePerLine)} />
            </div>

            <div className="dashboard-grid report-grid">
              <ChartCard title="Weekly Sales Trend">
                <RevenueArea data={weekly} />
              </ChartCard>
              <ChartCard title="Sales by Shipping State">
                <RevenueBar data={states} nameKey="name" />
              </ChartCard>
            </div>

            <div className="table-card">
              <h2>Top Products</h2>
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Description</th>
                    <th>Sales</th>
                    <th>Quantity</th>
                    <th>Line items</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.sku}>
                      <td>{product.sku}</td>
                      <td>{product.description}</td>
                      <td>{formatCurrency(product.revenue)}</td>
                      <td>{formatNumber(product.quantity)}</td>
                      <td>{product.transactions.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="table-card distributor-sales-table">
              <h2>All Sales</h2>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Document</th>
                    <th>State</th>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Quantity</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((transaction) => (
                    <tr key={`${salesTransactionKey(transaction)}-${transaction.sourceRowNumber}`}>
                      <td>{salesDate(transaction, dateBasis)}</td>
                      <td>{transaction.documentNumber || "n/a"}</td>
                      <td>{transaction.shippingState || "Unassigned"}</td>
                      <td>{transaction.sku}</td>
                      <td>{transaction.productDescription}</td>
                      <td>{formatNumber(transaction.quantity)}</td>
                      <td>{formatCurrency(transaction.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function isDistributorCategory(category?: string) {
  return category?.replace(/\s+/g, "").toLowerCase() === "distributor";
}

function MomentumSparkline({ row, tone }: { row: MomentumRow; tone: "positive" | "negative" }) {
  const stroke = row.changeRevenue < 0 ? "#A63F3F" : tone === "positive" ? "#1F4F45" : "#8A6B1F";
  return (
    <div className="momentum-sparkline" aria-label={`${row.name} eight-week sales trend`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={row.trend} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <Tooltip
            labelFormatter={(value) => `Week of ${value}`}
            formatter={(value) => [formatCurrency(Number(value)), "Sales"]}
          />
          <Line type="monotone" dataKey="revenue" stroke={stroke} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function QualityView({
  rows,
  quality,
  automatedImportJobs,
  sourceRange
}: {
  rows: SalesTransaction[];
  quality: ImportQualitySummary[];
  automatedImportJobs: AutomatedImportJob[];
  sourceRange?: { start: string; end: string };
}) {
  const duplicateCount = countDuplicateRows(rows);
  const acceptedRows = quality.reduce((total, item) => total + item.acceptedTransactionCount, 0);
  const skippedRows = quality.reduce((total, item) => total + item.skippedDuplicateRows, 0);
  const skippedFiles = quality.filter((item) => item.skippedDuplicateFile).length;
  const missingReps = rows.filter((row) => !row.salesRepVendor).length;
  const missingClasses = rows.filter((row) => !row.productClass).length;
  const missingCategories = rows.filter((row) => !row.salesCategory).length;
  const missingStates = rows.filter((row) => !row.shippingState).length;

  return (
    <section className="view-stack">
      <div className="kpi-grid compact">
        <Kpi label="Import batches" value={quality.length.toLocaleString()} />
        <Kpi label="Accepted rows" value={acceptedRows.toLocaleString()} />
        <Kpi label="Skipped duplicates" value={skippedRows.toLocaleString()} />
        <Kpi label="Duplicate files" value={skippedFiles.toLocaleString()} />
        <Kpi label="Source coverage" value={sourceRange ? `${sourceRange.start} to ${sourceRange.end}` : "n/a"} />
        <Kpi label="Possible duplicates" value={duplicateCount.toLocaleString()} />
        <Kpi label="Missing rep/vendor" value={missingReps.toLocaleString()} />
        <Kpi label="Missing category" value={missingCategories.toLocaleString()} />
        <Kpi label="Missing class" value={missingClasses.toLocaleString()} />
        <Kpi label="Missing state" value={missingStates.toLocaleString()} />
      </div>
      <div className="table-card">
        <h2>Automated Import History</h2>
        <table>
          <thead>
            <tr>
              <th>Attachment</th>
              <th>Received</th>
              <th>Status</th>
              <th>Parsed</th>
              <th>Accepted</th>
              <th>Duplicates</th>
              <th>Revenue</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {automatedImportJobs.length ? (
              automatedImportJobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.attachmentName}</td>
                  <td>{formatShortDateTime(job.receivedAt ?? job.createdAt)}</td>
                  <td>{formatImportJobStatus(job.status)}</td>
                  <td>{job.parsedRowCount.toLocaleString()}</td>
                  <td>{job.acceptedTransactionCount.toLocaleString()}</td>
                  <td>{job.skippedDuplicateRows.toLocaleString()}</td>
                  <td>{formatCurrency(job.totalRevenue)}</td>
                  <td>{job.errorMessage || "Clean"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8}>No automated mailbox imports have run yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-card">
        <h2>Import Quality</h2>
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Source</th>
              <th>Imported</th>
              <th>Type</th>
              <th>Sheet</th>
              <th>Parsed rows</th>
              <th>Transactions</th>
              <th>Accepted</th>
              <th>Skipped duplicates</th>
              <th>Excluded totals</th>
              <th>Excluded groups</th>
              <th>Date coverage</th>
              <th>Revenue</th>
              <th>Warnings</th>
            </tr>
          </thead>
          <tbody>
            {quality.map((item) => (
              <tr key={item.batchId}>
                <td>{item.sourceFile}</td>
                <td>{item.importSource ?? "Manual"}</td>
                <td>{formatShortDateTime(item.importedAt)}</td>
                <td>{item.sourceReportType}</td>
                <td>{item.sourceSheetName ?? "n/a"}</td>
                <td>{item.parsedRowCount.toLocaleString()}</td>
                <td>{item.transactionCount.toLocaleString()}</td>
                <td>{item.acceptedTransactionCount.toLocaleString()}</td>
                <td>{item.skippedDuplicateRows.toLocaleString()}</td>
                <td>{item.excludedTotalRows.toLocaleString()}</td>
                <td>{item.excludedGroupRows.toLocaleString()}</td>
                <td>{item.dateRange ? `${item.dateRange.start} to ${item.dateRange.end}` : "n/a"}</td>
                <td>{formatCurrency(item.totalRevenue)}</td>
                <td>
                  {[
                    item.duplicateRowCount ? `${item.duplicateRowCount} duplicate-looking rows` : "",
                    item.skippedDuplicateFile ? "file already imported" : "",
                    item.skippedDuplicateRows ? `${item.skippedDuplicateRows} previously imported rows skipped` : "",
                    item.missingSalesRepVendorCount ? `${item.missingSalesRepVendorCount} missing rep` : "",
                    item.missingSalesCategoryCount ? `${item.missingSalesCategoryCount} missing category` : "",
                    item.missingProductClassCount ? `${item.missingProductClassCount} missing class` : "",
                    item.missingStateCount ? `${item.missingStateCount} missing state` : "",
                    ...item.parseErrors
                  ]
                    .filter(Boolean)
                    .join("; ") || "Clean"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatImportJobStatus(status: AutomatedImportJob["status"]) {
  const labels: Record<AutomatedImportJob["status"], string> = {
    processing: "Processing",
    imported: "Imported",
    duplicate: "Duplicate",
    review_required: "Review required",
    failed: "Failed"
  };
  return labels[status];
}

function MappingEditor({
  reps,
  mappings,
  setMappings
}: {
  reps: string[];
  mappings: SalesRepMapping[];
  setMappings: (mappings: SalesRepMapping[]) => void;
}) {
  function update(rep: string, patch: Partial<SalesRepMapping>) {
    const existing = mappings.find((mapping) => mapping.salesRepVendor === rep);
    const created: SalesRepMapping = { salesRepVendor: rep, salesEntityType: "Unknown", ...patch };
    const next = existing
      ? mappings.map((mapping) =>
          mapping.salesRepVendor === rep ? { ...mapping, ...patch } : mapping
        )
      : [...mappings, created];
    setMappings(next);
  }

  return (
    <div className="table-card">
      <h2>Rep / Vendor Mapping</h2>
      <table>
        <thead>
          <tr>
            <th>Rep / vendor</th>
            <th>Entity type</th>
            <th>Sales group</th>
            <th>Territory</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {reps.slice(0, 40).map((rep) => {
            const mapping = mappings.find((item) => item.salesRepVendor === rep);
            return (
              <tr key={rep}>
                <td>{rep}</td>
                <td>
                  <select
                    value={mapping?.salesEntityType ?? "Unknown"}
                    onChange={(event) =>
                      update(rep, { salesEntityType: event.target.value as SalesEntityType })
                    }
                  >
                    <option>Unknown</option>
                    <option>Salesperson</option>
                    <option>Distributor</option>
                    <option>Vendor</option>
                  </select>
                </td>
                <td>
                  <input value={mapping?.salesGroup ?? ""} onChange={(event) => update(rep, { salesGroup: event.target.value })} />
                </td>
                <td>
                  <input value={mapping?.territory ?? ""} onChange={(event) => update(rep, { territory: event.target.value })} />
                </td>
                <td>
                  <input value={mapping?.notes ?? ""} onChange={(event) => update(rep, { notes: event.target.value })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SkuEditor({
  skus,
  allRows,
  enrichments,
  setEnrichments
}: {
  skus: string[];
  allRows: SalesTransaction[];
  enrichments: SkuEnrichment[];
  setEnrichments: (enrichments: SkuEnrichment[]) => void;
}) {
  function update(sku: string, patch: Partial<SkuEnrichment>) {
    const existing = enrichments.find((item) => item.sku === sku);
    const next = existing
      ? enrichments.map((item) => (item.sku === sku ? { ...item, ...patch } : item))
      : [...enrichments, { sku, ...patch }];
    setEnrichments(next);
  }

  return (
    <div className="table-card">
      <h2>SKU / Category Enrichment</h2>
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Current description</th>
            <th>Product class / category</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {skus.map((sku) => {
            const enrichment = enrichments.find((item) => item.sku === sku);
            const description = allRows.find((row) => row.sku === sku)?.productDescription ?? "";
            return (
              <tr key={sku}>
                <td>{sku}</td>
                <td>{description}</td>
                <td>
                  <input
                    value={enrichment?.productClass ?? ""}
                    onChange={(event) => update(sku, { productClass: event.target.value })}
                  />
                </td>
                <td>
                  <input value={enrichment?.notes ?? ""} onChange={(event) => update(sku, { notes: event.target.value })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="chart-card">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function RevenueArea({ data }: { data: { period: string; revenue: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4F7D6D" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#4F7D6D" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#DDE7E1" vertical={false} />
        <XAxis dataKey="period" tick={{ fill: "#6F7775", fontSize: 12 }} />
        <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} tick={{ fill: "#6F7775", fontSize: 12 }} />
        <Tooltip formatter={(value) => formatCurrency(Number(value))} />
        <Area dataKey="revenue" stroke="#1F4F45" strokeWidth={3} fill="url(#revenueFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function RevenueBar({
  data,
  nameKey = "period"
}: {
  data: { revenue: number; [key: string]: string | number | null }[];
  nameKey?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#DDE7E1" vertical={false} />
        <XAxis dataKey={nameKey} tick={{ fill: "#6F7775", fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={68} />
        <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} tick={{ fill: "#6F7775", fontSize: 12 }} />
        <Tooltip formatter={(value) => formatCurrency(Number(value))} />
        <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
          {data.map((_, index) => (
            <Cell key={index} fill={chartColors[index % chartColors.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function MultiSelect({
  label,
  values,
  options,
  onChange
}: {
  label: string;
  values: string[];
  options: Array<string | { value: string; label: string }>;
  onChange: (values: string[]) => void;
}) {
  return (
    <label>
      {label}
      <select
        multiple
        value={values}
        onChange={(event) =>
          onChange(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))
        }
      >
        {options.slice(0, 300).map((option) => {
          const value = typeof option === "string" ? option : option.value;
          const optionLabel = typeof option === "string" ? option : option.label;
          return <option key={value} value={value}>
            {optionLabel}
          </option>
        })}
      </select>
    </label>
  );
}

function QuickFilterLinks({
  label,
  values,
  options,
  onChange
}: {
  label: string;
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="filter-field">
      <span>{label}</span>
      <div className="manager-links">
        {options.map((option) => {
          const selected = values.includes(option);
          return (
            <button
              key={option}
              className={selected ? "selected" : ""}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(selected ? values.filter((value) => value !== option) : [...values, option])}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function skuFilterOptions(rows: SalesTransaction[]) {
  const descriptions = new Map<string, string>();
  rows.forEach((row) => {
    if (row.sku && !descriptions.has(row.sku)) descriptions.set(row.sku, row.productDescription.trim());
  });
  return Array.from(descriptions, ([value, description]) => ({
    value,
    label: description ? `${description} — ${value}` : value
  })).sort((a, b) => a.label.localeCompare(b.label));
}

function NavButton({
  icon,
  id,
  active,
  onClick,
  children
}: {
  icon: React.ReactNode;
  id: string;
  active: string;
  onClick: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <button className={active === id ? "active" : ""} onClick={() => onClick(id)}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

function SoftEmpty({ text }: { text: string }) {
  return <div className="soft-empty">{text}</div>;
}

function grainLabel(grain: TimeSeriesGrain) {
  if (grain === "day") return "Day-over-day";
  if (grain === "week") return "Week-over-week";
  return grain === "month"
    ? "Month-over-month"
    : grain === "quarter"
      ? "Quarter-over-quarter"
      : "Year-over-year";
}

function loadStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function fingerprintFile(fileName: string, text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${fileName.toLowerCase()}::${hash}`;
}

function formatShortDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatSignedCurrency(value: number) {
  if (value === 0) return formatCurrency(0);
  return `${value > 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
}

function combineQualityRanges(quality: ImportQualitySummary[]) {
  const dates = quality.flatMap((item) =>
    item.dateRange ? [item.dateRange.start, item.dateRange.end] : []
  );
  if (!dates.length) return undefined;
  const sorted = dates.sort();
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}
