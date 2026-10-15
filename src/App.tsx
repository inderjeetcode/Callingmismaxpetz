/**
 * Max PetZ Hospitals — Call Analytics Dashboard
 * Main Application Component
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RAW_MAIN_DATA_CSV } from './data/rawSpreadsheetData';
import { parseSpreadsheetData } from './services/dataParser';
import { matchCallbacks } from './services/callbackEngine';
import {
  filterRecords,
  calculateKPICards,
  calculateDailyGrowth,
  calculateHourlyDistribution,
  calculateDepartmentMetrics,
  calculateStaffMetrics,
} from './services/analyticsCalculator';
import {
  CallbackAuditLog,
  CallbackMatch,
  CallbackMatchStatus,
  CallbackStoreRecord,
  DataSourceSettings,
  FilterState,
  ParsedCallRecord,
} from './types/callAnalytics';

import { Header } from './components/Header';
import { Sidebar, DashboardView } from './components/Sidebar';
import { FilterBar } from './components/FilterBar';
import { OverviewView } from './components/views/OverviewView';
import { CallAnalyticsView } from './components/views/CallAnalyticsView';
import { DailyGrowthView } from './components/views/DailyGrowthView';
import { MissedCallsView } from './components/views/MissedCallsView';
import { CallbackTrackingView } from './components/views/CallbackTrackingView';
import { RepeatedCallTrackingView } from './components/views/RepeatedCallTrackingView';
import { DepartmentPerformanceView } from './components/views/DepartmentPerformanceView';
import { CallRecordsView } from './components/views/CallRecordsView';
import { DataSourceSettingsView } from './components/views/DataSourceSettingsView';
import { CallbackTriageModal } from './components/CallbackTriageModal';
import { AuditTrailModal } from './components/AuditTrailModal';
import { AutomatedTestRunner } from './components/AutomatedTestRunner';
import { analyzeRepeatedCalls } from './services/repeatedCallEngine';

import {
  directClientFetchGoogleSheet,
  getLocalAuditLogs,
  getLocalCachedCsv,
  getLocalCallbacks,
  getLocalSettings,
  safeFetchJson,
  saveLocalAuditLogs,
  saveLocalCachedCsv,
  saveLocalCallbacks,
  saveLocalSettings,
} from './services/apiClient';

const INITIAL_FILTERS: FilterState = {
  datePreset: 'all',
  department: 'all',
  staff: 'all',
  event: 'all',
  status: 'all',
  callbackStatus: 'all',
  searchQuery: '',
};

export default function App() {
  const [currentView, setCurrentView] = useState<DashboardView>('overview');
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [maskPhones, setMaskPhones] = useState(true);

  // Raw & Parsed records state
  const [allRecords, setAllRecords] = useState<ParsedCallRecord[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [nextRefreshInSeconds, setNextRefreshInSeconds] = useState(300); // 5 mins

  // Backend settings & persistent callback store
  const [settings, setSettings] = useState<DataSourceSettings>(() => {
    return getLocalSettings({
      spreadsheetId: '170_JWT44cFX0QIvJ62KeLqe9io3hTkuNYJosVs2oCBA',
      tabName: 'Main data',
      callbackMatchingWindowHours: 24,
      autoRefreshIntervalMinutes: 5,
      managementAnswerRateTarget: 85,
      timezone: 'Asia/Kolkata',
      lastSyncTime: new Date().toISOString(),
      lastSuccessfulLiveSyncTime: null,
      recordCount: 0,
      connectionStatus: 'Offline / Cached Data',
      columnsDetected: [],
      missingRequiredColumns: [],
    });
  });

  const [callbackConfirmations, setCallbackConfirmations] = useState<Map<string, CallbackStoreRecord>>(() => getLocalCallbacks());
  const [auditLogs, setAuditLogs] = useState<CallbackAuditLog[]>(() => getLocalAuditLogs());

  // Modals state
  const [triageMatch, setTriageMatch] = useState<CallbackMatch | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{
    tested: boolean;
    connected: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);

  // Initialize with verified seed or cached data immediately
  useEffect(() => {
    const cachedCsv = getLocalCachedCsv() || RAW_MAIN_DATA_CSV;
    const initialParsed = parseSpreadsheetData(cachedCsv);
    setAllRecords(initialParsed.records);
    setSettings((prev) => {
      const updated = {
        ...prev,
        recordCount: initialParsed.records.length,
        columnsDetected: initialParsed.headers,
        missingRequiredColumns: initialParsed.missingRequired,
      };
      saveLocalSettings(updated);
      return updated;
    });
  }, []);

  // Fetch live data & settings from Express backend if available
  const loadBackendData = useCallback(async () => {
    try {
      const [sheetsRes, callbacksRes] = await Promise.all([
        safeFetchJson<{
          success: boolean;
          records?: ParsedCallRecord[];
          settings?: DataSourceSettings;
          csv?: string;
        }>('/api/sheets/data'),
        safeFetchJson<{
          success: boolean;
          confirmations?: Record<string, CallbackStoreRecord>;
          auditLogs?: CallbackAuditLog[];
        }>('/api/callbacks'),
      ]);

      if (sheetsRes.ok && sheetsRes.data?.records && sheetsRes.data.records.length > 0) {
        setAllRecords(sheetsRes.data.records);
        if (sheetsRes.data.csv) {
          saveLocalCachedCsv(sheetsRes.data.csv);
        }
        if (sheetsRes.data.settings) {
          setSettings(sheetsRes.data.settings);
          saveLocalSettings(sheetsRes.data.settings);
        }
      }

      if (callbacksRes.ok && callbacksRes.data?.confirmations) {
        const map = new Map<string, CallbackStoreRecord>();
        Object.entries(callbacksRes.data.confirmations).forEach(([k, v]) => {
          map.set(k, v as CallbackStoreRecord);
        });
        setCallbackConfirmations(map);
        saveLocalCallbacks(map);
        if (callbacksRes.data.auditLogs) {
          setAuditLogs(callbacksRes.data.auditLogs);
          saveLocalAuditLogs(callbacksRes.data.auditLogs);
        }
      }
    } catch (err) {
      console.log('Backend fetch fell back to client storage:', err);
    }
  }, []);

  useEffect(() => {
    loadBackendData();
  }, [loadBackendData]);

  // Auto-refresh countdown timer (every 5 minutes or configured interval)
  useEffect(() => {
    const interval = setInterval(() => {
      setNextRefreshInSeconds((prev) => {
        if (prev <= 1) {
          handleRefreshData();
          return (settings.autoRefreshIntervalMinutes || 5) * 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [settings.autoRefreshIntervalMinutes]);

  // Manual / Auto Refresh Data
  const handleRefreshData = async () => {
    setIsSyncing(true);
    try {
      // 1. First attempt through the backend sync endpoint
      const res = await safeFetchJson<{
        success: boolean;
        liveSync?: boolean;
        records?: ParsedCallRecord[];
        settings?: DataSourceSettings;
        status?: string;
        error?: string;
      }>('/api/sheets/sync', { method: 'POST' });

      if (res.ok && res.data && res.data.records && res.data.records.length > 0) {
        setAllRecords(res.data.records);
        if (res.data.settings) {
          setSettings(res.data.settings);
          saveLocalSettings(res.data.settings);
        }
        setIsSyncing(false);
        setNextRefreshInSeconds((settings.autoRefreshIntervalMinutes || 5) * 60);
        return;
      }

      // 2. If backend is not available, returned HTML (e.g. Vercel SPA rewrite), or returned no records:
      // Perform direct client-side synchronization from the browser!
      const clientFetch = await directClientFetchGoogleSheet(
        settings.spreadsheetId,
        settings.tabName,
        {
          apiKey: settings.apiKey,
          appsScriptUrl: settings.appsScriptUrl,
        }
      );

      if (clientFetch.success && clientFetch.csv) {
        const parsed = parseSpreadsheetData(clientFetch.csv);
        if (parsed.records.length > 0) {
          setAllRecords(parsed.records);
          saveLocalCachedCsv(clientFetch.csv);

          const now = new Date().toISOString();
          const updatedSettings: DataSourceSettings = {
            ...settings,
            recordCount: parsed.records.length,
            columnsDetected: parsed.headers,
            missingRequiredColumns: parsed.missingRequired,
            lastSyncTime: now,
            lastSuccessfulLiveSyncTime: now,
            connectionStatus: 'Connected',
            authMethod: clientFetch.authMethod as any,
            errorMessage: undefined,
          };
          setSettings(updatedSettings);
          saveLocalSettings(updatedSettings);
        }
      } else {
        // Failed: preserve previous records safely and report clear status
        const now = new Date().toISOString();
        const updatedSettings: DataSourceSettings = {
          ...settings,
          lastSyncTime: now,
          connectionStatus: clientFetch.status,
          errorMessage: clientFetch.errorMessage || 'Could not connect to Google Sheets.',
        };
        setSettings(updatedSettings);
        saveLocalSettings(updatedSettings);
      }
    } catch (err: any) {
      console.error('Safe sync handled:', err);
    } finally {
      setIsSyncing(false);
      setNextRefreshInSeconds((settings.autoRefreshIntervalMinutes || 5) * 60);
    }
  };

  // Test Connection
  const handleTestConnection = async () => {
    try {
      const res = await safeFetchJson<{
        connected: boolean;
        message: string;
        latencyMs?: number;
      }>('/api/sheets/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheetId: settings.spreadsheetId,
          tabName: settings.tabName,
          apiKey: settings.apiKey,
          appsScriptUrl: settings.appsScriptUrl,
        }),
      });

      if (res.ok && res.data) {
        setConnectionTestResult({
          tested: true,
          connected: res.data.connected,
          message: res.data.message,
          latencyMs: res.data.latencyMs,
        });
        return;
      }

      // Backend unavailable or returned HTML (e.g. Vercel static) — test directly in client!
      const clientTest = await directClientFetchGoogleSheet(
        settings.spreadsheetId,
        settings.tabName,
        {
          apiKey: settings.apiKey,
          appsScriptUrl: settings.appsScriptUrl,
        }
      );

      setConnectionTestResult({
        tested: true,
        connected: clientTest.success,
        message: clientTest.success
          ? `Live Google Sheet verified via ${clientTest.authMethod} (${clientTest.latencyMs}ms)`
          : clientTest.errorMessage || 'Could not connect to Google Sheets.',
        latencyMs: clientTest.latencyMs,
      });
    } catch (err: any) {
      setConnectionTestResult({
        tested: true,
        connected: false,
        message: err.message || 'Network error testing Google Sheets connection',
      });
    }
  };

  // Save Settings
  const handleSaveSettings = async (updates: Partial<DataSourceSettings>) => {
    const merged = { ...settings, ...updates };
    setSettings(merged);
    saveLocalSettings(merged);

    try {
      await safeFetchJson('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    } catch {
      // Local settings are already safely persisted
    }
  };

  // Upload/Paste CSV
  const handleUploadCsv = async (csvText: string) => {
    setIsSyncing(true);
    try {
      const parsed = parseSpreadsheetData(csvText);
      if (parsed.records.length > 0) {
        setAllRecords(parsed.records);
        saveLocalCachedCsv(csvText);

        const updated: DataSourceSettings = {
          ...settings,
          recordCount: parsed.records.length,
          columnsDetected: parsed.headers,
          missingRequiredColumns: parsed.missingRequired,
          lastSyncTime: new Date().toISOString(),
          connectionStatus: 'Offline / Cached Data',
          errorMessage: undefined,
        };
        setSettings(updated);
        saveLocalSettings(updated);
      }

      await safeFetchJson('/api/sheets/upload-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText }),
      });
    } catch (err: any) {
      console.error('Error uploading CSV:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  // Callback Confirmation / Status update
  const handleConfirmCallback = async (
    missedCallUid: string,
    status: CallbackMatchStatus,
    verifiedBy: string,
    notes: string
  ) => {
    try {
      const updatedRecord: CallbackStoreRecord = {
        missedCallUid,
        status,
        verifiedBy,
        verifiedAt: new Date().toISOString(),
        notes,
      };

      setCallbackConfirmations((prev) => {
        const next = new Map(prev);
        next.set(missedCallUid, updatedRecord);
        saveLocalCallbacks(next);
        return next;
      });

      const previousStatus = callbackConfirmations.get(missedCallUid)?.status || 'Pending';
      const localAuditEntry: CallbackAuditLog = {
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        missedCallUid,
        previousStatus,
        newStatus: status,
        changedBy: verifiedBy || 'Staff User',
        timestamp: new Date().toISOString(),
        note: notes || '',
      };

      setAuditLogs((prev) => {
        const next = [localAuditEntry, ...prev];
        saveLocalAuditLogs(next);
        return next;
      });

      await safeFetchJson('/api/callbacks/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missedCallUid, status, verifiedBy, notes }),
      });
    } catch (err) {
      console.error('Error confirming callback:', err);
    }
  };

  // Derive all Callback Matches across entire dataset
  const callbackMatches = useMemo(() => {
    return matchCallbacks(allRecords, callbackConfirmations, {
      matchingWindowHours: settings.callbackMatchingWindowHours || 24,
    });
  }, [allRecords, callbackConfirmations, settings.callbackMatchingWindowHours]);

  // Filter options lists
  const departments = useMemo(() => {
    const set = new Set<string>();
    allRecords.forEach((r) => {
      if (r.department) set.add(r.department);
    });
    return Array.from(set).sort();
  }, [allRecords]);

  const staffMembers = useMemo(() => {
    const set = new Set<string>();
    allRecords.forEach((r) => {
      if (r.staffName && r.staffName !== 'Unassigned') set.add(r.staffName);
    });
    return Array.from(set).sort();
  }, [allRecords]);

  // Filtered records based on active filter state
  const { filtered, previousPeriodFiltered, dateRangeInfo } = useMemo(() => {
    return filterRecords(allRecords, filters);
  }, [allRecords, filters]);

  // Derived KPI metrics
  const kpis = useMemo(() => {
    return calculateKPICards(filtered, previousPeriodFiltered, callbackMatches);
  }, [filtered, previousPeriodFiltered, callbackMatches]);

  // Daily growth points
  const dailyGrowth = useMemo(() => {
    return calculateDailyGrowth(filtered, callbackMatches);
  }, [filtered, callbackMatches]);

  // Hourly distribution
  const hourlyDistribution = useMemo(() => {
    return calculateHourlyDistribution(filtered);
  }, [filtered]);

  // Department metrics
  const departmentMetrics = useMemo(() => {
    return calculateDepartmentMetrics(filtered, callbackMatches);
  }, [filtered, callbackMatches]);

  // Staff metrics
  const staffMetrics = useMemo(() => {
    return calculateStaffMetrics(filtered);
  }, [filtered]);

  // Missed incoming calls subset for missed calls view
  const missedIncomingCalls = useMemo(() => {
    return filtered.filter((r) => r.event === 'Incoming' && r.status === 'Missed');
  }, [filtered]);

  // Derived Repeated Call Tracking profiles & KPIs
  const { repeatCustomers, kpis: repeatKpis } = useMemo(() => {
    return analyzeRepeatedCalls(filtered, callbackConfirmations, {
      callbackMatchingWindowHours: settings.callbackMatchingWindowHours || 24,
    });
  }, [filtered, callbackConfirmations, settings.callbackMatchingWindowHours]);

  // Quick filter by KPI card click
  const handleFilterByCategory = (category: string) => {
    if (category === 'all') {
      setFilters((prev) => ({ ...prev, event: 'all', status: 'all' }));
      setCurrentView('call_records');
    } else if (category === 'Incoming') {
      setFilters((prev) => ({ ...prev, event: 'Incoming', status: 'all' }));
      setCurrentView('call_records');
    } else if (category === 'Outgoing') {
      setFilters((prev) => ({ ...prev, event: 'Outgoing', status: 'all' }));
      setCurrentView('call_records');
    } else if (category === 'Connected') {
      setFilters((prev) => ({ ...prev, status: 'Connected' }));
      setCurrentView('call_records');
    } else if (category === 'Missed' || category === 'Incoming-Missed') {
      setFilters((prev) => ({ ...prev, event: 'Incoming', status: 'Missed' }));
      setCurrentView('missed_calls');
    } else if (category === 'Incoming-Connected') {
      setFilters((prev) => ({ ...prev, event: 'Incoming', status: 'Connected' }));
      setCurrentView('call_records');
    } else if (category === 'Outgoing-Connected') {
      setFilters((prev) => ({ ...prev, event: 'Outgoing', status: 'Connected' }));
      setCurrentView('call_records');
    } else if (category === 'Outgoing-Missed') {
      setFilters((prev) => ({ ...prev, event: 'Outgoing', status: 'Missed' }));
      setCurrentView('call_records');
    } else if (category === 'Callbacks' || category === 'Estimated-Successful' || category === 'Confirmed-Successful' || category === 'Pending') {
      setCurrentView('callback_tracking');
    } else if (category === 'Repeated' || category === 'repeated_calls') {
      setCurrentView('repeated_calls');
    }
  };

  const handleResetFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  // Quality diagnostics summary
  const qualitySummary = useMemo(() => {
    return parseSpreadsheetData(RAW_MAIN_DATA_CSV).summary;
  }, []);

  return (
    <div className="min-h-screen bg-[#F4F5F7] text-[#121212] font-sans">
      {/* Top Header */}
      <Header
        settings={settings}
        isSyncing={isSyncing}
        onRefresh={handleRefreshData}
        nextRefreshInSeconds={nextRefreshInSeconds}
        maskPhones={maskPhones}
        onToggleMaskPhones={() => setMaskPhones(!maskPhones)}
        onOpenTestModal={() => setIsTestModalOpen(true)}
      />

      <div className="flex flex-col md:flex-row">
        {/* Navigation Sidebar */}
        <Sidebar
          currentView={currentView}
          onViewChange={setCurrentView}
          missedCallsCount={missedIncomingCalls.length}
          pendingCallbacksCount={kpis.pendingCallbacks}
          repeatCustomersCount={repeatCustomers.length}
        />

        {/* Main Content Area */}
        <main className="flex-1 overflow-x-hidden">
          {/* Global Filter Bar */}
          <FilterBar
            filters={filters}
            onFilterChange={(updates) => setFilters((prev) => ({ ...prev, ...updates }))}
            onResetFilters={handleResetFilters}
            departments={departments}
            staffMembers={staffMembers}
            dateRangeLabel={dateRangeInfo.label}
          />

          {/* View Render */}
          {currentView === 'overview' && (
            <OverviewView
              kpis={kpis}
              dailyGrowth={dailyGrowth}
              hourlyDistribution={hourlyDistribution}
              onFilterCategory={handleFilterByCategory}
              targetAnswerRate={settings.managementAnswerRateTarget}
            />
          )}

          {currentView === 'call_analytics' && (
            <CallAnalyticsView
              records={filtered}
              kpis={kpis}
              staffMetrics={staffMetrics}
            />
          )}

          {currentView === 'daily_growth' && (
            <DailyGrowthView
              dailyGrowth={dailyGrowth}
              hourlyDistribution={hourlyDistribution}
              targetAnswerRate={settings.managementAnswerRateTarget}
            />
          )}

          {currentView === 'missed_calls' && (
            <MissedCallsView
              missedCalls={missedIncomingCalls}
              callbackMatches={callbackMatches}
              onOpenTriageModal={setTriageMatch}
              maskPhones={maskPhones}
            />
          )}

          {currentView === 'callback_tracking' && (
            <CallbackTrackingView
              matches={callbackMatches}
              onOpenTriageModal={setTriageMatch}
              onOpenAuditTrail={() => setIsAuditModalOpen(true)}
              maskPhones={maskPhones}
            />
          )}

          {currentView === 'repeated_calls' && (
            <RepeatedCallTrackingView
              repeatCustomers={repeatCustomers}
              kpis={repeatKpis}
              maskPhones={maskPhones}
              staffMembers={staffMembers}
              departments={departments}
            />
          )}

          {currentView === 'department_performance' && (
            <DepartmentPerformanceView metrics={departmentMetrics} />
          )}

          {currentView === 'call_records' && (
            <CallRecordsView
              records={filtered}
              callbackMatches={callbackMatches}
              maskPhones={maskPhones}
            />
          )}

          {currentView === 'data_settings' && (
            <DataSourceSettingsView
              settings={settings}
              qualitySummary={qualitySummary}
              onSaveSettings={handleSaveSettings}
              onTestConnection={handleTestConnection}
              onRefreshData={handleRefreshData}
              onUploadCsv={handleUploadCsv}
              isSyncing={isSyncing}
              connectionTestResult={connectionTestResult}
            />
          )}
        </main>
      </div>

      {/* Modals */}
      <CallbackTriageModal
        match={triageMatch}
        onClose={() => setTriageMatch(null)}
        onConfirmCallback={handleConfirmCallback}
      />

      <AuditTrailModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
        logs={auditLogs}
      />

      <AutomatedTestRunner
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
      />
    </div>
  );
}
