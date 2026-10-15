/**
 * Max PetZ Hospitals — Repeated Call Tracking View
 *
 * Implements:
 * 1. 6 KPI Cards:
 *    - Unique Repeat Customers
 *    - Repeated Incoming Calls
 *    - Repeated Outgoing Attempts
 *    - Repeated Missed Calls
 *    - Callback Attempts
 *    - Connected Repeat Calls
 * 2. Click-to-filter on all KPI cards.
 * 3. Detailed customer table with sorting, pagination, search, and category filters.
 * 4. Expandable call history drill-down drawer/modal showing every individual call with UID, time, duration, staff, and notes.
 * 5. Full styling using the Max PetZ Purple & Cyan brutalist palette.
 */

import React, { useState, useMemo } from 'react';
import {
  Users,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  PhoneForwarded,
  CheckCircle2,
  Search,
  Filter,
  Download,
  ChevronDown,
  ChevronUp,
  Clock,
  ArrowUpDown,
  X,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  Building2,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import {
  ParsedCallRecord,
  RepeatCallCategory,
  RepeatCustomerRecord,
  RepeatedCallKPIs,
} from '../../types/callAnalytics';
import { filterRepeatCustomers } from '../../services/repeatedCallEngine';

interface RepeatedCallTrackingViewProps {
  repeatCustomers: RepeatCustomerRecord[];
  kpis: RepeatedCallKPIs;
  maskPhones: boolean;
  onFilterCategory?: (category: string) => void;
  staffMembers: string[];
  departments: string[];
}

type SortField =
  | 'latestEpoch'
  | 'totalCalls'
  | 'incoming'
  | 'outgoing'
  | 'missed'
  | 'connected'
  | 'phone';

export const RepeatedCallTrackingView: React.FC<RepeatedCallTrackingViewProps> = ({
  repeatCustomers,
  kpis,
  maskPhones,
  staffMembers,
  departments,
}) => {
  // KPI Filter toggle
  const [activeKpiFilter, setActiveKpiFilter] = useState<
    'all' | 'unique' | 'incoming' | 'outgoing' | 'missed' | 'callbacks' | 'connected'
  >('all');

  // Secondary filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDirection, setSelectedDirection] = useState<'all' | 'Incoming' | 'Outgoing'>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'Connected' | 'Missed'>('all');
  const [selectedCategory, setSelectedCategory] = useState<'all' | RepeatCallCategory>('all');
  const [selectedStaff, setSelectedStaff] = useState('all');
  const [selectedDepartment, setSelectedDepartment] = useState('all');

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('latestEpoch');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Drilldown modal for a customer's individual calls
  const [expandedCustomer, setExpandedCustomer] = useState<RepeatCustomerRecord | null>(null);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  // Copy phone handler
  const handleCopyPhone = (phone: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(phone);
    setCopiedPhone(phone);
    setTimeout(() => setCopiedPhone(null), 2000);
  };

  // Toggle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Apply filters
  const filteredCustomers = useMemo(() => {
    const list = filterRepeatCustomers(repeatCustomers, {
      kpiFilter: activeKpiFilter,
      callDirection: selectedDirection,
      callStatus: selectedStatus,
      category: selectedCategory,
      staff: selectedStaff,
      department: selectedDepartment,
      searchQuery,
    });

    // Apply sorting
    return list.slice().sort((a, b) => {
      let comp = 0;
      switch (sortField) {
        case 'latestEpoch':
          comp = a.latestCallEpochMs - b.latestCallEpochMs;
          break;
        case 'totalCalls':
          comp = a.totalCalls - b.totalCalls;
          break;
        case 'incoming':
          comp = a.incomingCount - b.incomingCount;
          break;
        case 'outgoing':
          comp = a.outgoingCount - b.outgoingCount;
          break;
        case 'missed':
          comp = a.missedCount - b.missedCount;
          break;
        case 'connected':
          comp = a.connectedCount - b.connectedCount;
          break;
        case 'phone':
          comp = a.normalizedPhone.localeCompare(b.normalizedPhone);
          break;
        default:
          comp = 0;
      }
      return sortDirection === 'asc' ? comp : -comp;
    });
  }, [
    repeatCustomers,
    activeKpiFilter,
    selectedDirection,
    selectedStatus,
    selectedCategory,
    selectedStaff,
    selectedDepartment,
    searchQuery,
    sortField,
    sortDirection,
  ]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredCustomers.length / pageSize) || 1;
  const paginatedCustomers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredCustomers.slice(start, start + pageSize);
  }, [filteredCustomers, page, pageSize]);

  // Format IST datetime
  const formatDateTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return isoString || 'N/A';
    }
  };

  // Format Duration seconds
  const formatDuration = (sec: number) => {
    if (!sec || sec <= 0) return '0s';
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    if (mins > 0) return `${mins}m ${s}s`;
    return `${s}s`;
  };

  // Reset all filters
  const handleResetFilters = () => {
    setActiveKpiFilter('all');
    setSearchQuery('');
    setSelectedDirection('all');
    setSelectedStatus('all');
    setSelectedCategory('all');
    setSelectedStaff('all');
    setSelectedDepartment('all');
    setPage(1);
  };

  // Export to CSV
  const handleExportCsv = () => {
    const headers = [
      'Customer Phone',
      'Customer Name',
      'Total Calls',
      'Incoming Calls',
      'Outgoing Attempts',
      'Missed Calls',
      'Connected Calls',
      'First Call (IST)',
      'Latest Call (IST)',
      'Latest Status',
      'Latest Staff',
      'Latest Department',
      'Repeat Category',
      'Callback Status',
    ];

    const rows = filteredCustomers.map((c) => [
      `"${maskPhones ? c.maskedPhone : c.normalizedPhone}"`,
      `"${c.customerName}"`,
      c.totalCalls,
      c.incomingCount,
      c.outgoingCount,
      c.missedCount,
      c.connectedCount,
      `"${formatDateTime(c.firstCallTimestamp)}"`,
      `"${formatDateTime(c.latestCallTimestamp)}"`,
      `"${c.latestCallStatus}"`,
      `"${c.latestStaffName}"`,
      `"${c.latestDepartment}"`,
      `"${c.categoryLabel}"`,
      `"${c.callbackStatus}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `max_petz_repeated_calls_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Top Header Banner */}
      <div className="border-3 border-black bg-white p-4 shadow-[4px_4px_0px_#000] md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="border-2 border-black bg-[#581C87] px-2.5 py-0.5 text-xs font-black uppercase text-white shadow-[2px_2px_0px_#000]">
                CALLER INTELLIGENCE
              </span>
              <span className="border-2 border-black bg-[#00D8F6] px-2.5 py-0.5 text-xs font-black uppercase text-black shadow-[2px_2px_0px_#000]">
                MAX PETZ BRANDED
              </span>
            </div>
            <h2 className="mt-1.5 text-xl font-black uppercase tracking-tight text-black md:text-2xl">
              REPEATED CALL TRACKING & RECURRING CALLER ANALYSIS
            </h2>
            <p className="text-xs font-bold text-gray-700">
              Normalized phone matching across Indian formats (+91), deduplicated Call UIDs, 24h
              callback tracking, and repeat caller retention.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 border-2 border-black bg-[#00D8F6] px-3 py-1.5 text-xs font-black uppercase text-black shadow-[2px_2px_0px_#000] transition-all hover:bg-[#22D3EE] active:translate-x-0.5 active:translate-y-0.5"
            >
              <Download className="h-4 w-4" />
              <span>EXPORT REPEAT CALLERS ({filteredCustomers.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* 6 KPI Cards with click-to-filter */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* KPI 1: Unique Repeat Customers */}
        <div
          onClick={() => {
            setActiveKpiFilter(activeKpiFilter === 'unique' ? 'all' : 'unique');
            setPage(1);
          }}
          className={`cursor-pointer border-2 border-black bg-white p-3.5 transition-all hover:-translate-y-0.5 ${
            activeKpiFilter === 'unique'
              ? 'ring-3 ring-black shadow-[4px_4px_0px_#581C87] bg-purple-50'
              : 'shadow-[2px_2px_0px_#000]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-700">
              UNIQUE REPEAT CUSTOMERS
            </span>
            <Users className="h-4 w-4 text-[#581C87]" />
          </div>
          <div className="mt-2 font-mono text-2xl font-black text-black">
            {kpis.uniqueRepeatCustomers}
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-gray-500">
            <span>&ge; 2 distinct calls</span>
            <span className="text-[#581C87]">Click to filter</span>
          </div>
        </div>

        {/* KPI 2: Repeated Incoming Calls */}
        <div
          onClick={() => {
            setActiveKpiFilter(activeKpiFilter === 'incoming' ? 'all' : 'incoming');
            setPage(1);
          }}
          className={`cursor-pointer border-2 border-black bg-white p-3.5 transition-all hover:-translate-y-0.5 ${
            activeKpiFilter === 'incoming'
              ? 'ring-3 ring-black shadow-[4px_4px_0px_#00D8F6] bg-cyan-50'
              : 'shadow-[2px_2px_0px_#000]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-700">
              REPEATED INCOMING CALLS
            </span>
            <PhoneIncoming className="h-4 w-4 text-[#0891B2]" />
          </div>
          <div className="mt-2 font-mono text-2xl font-black text-black">
            {kpis.repeatedIncomingCalls}
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-gray-500">
            <span>Inbound volume</span>
            <span className="text-[#0891B2]">Click to filter</span>
          </div>
        </div>

        {/* KPI 3: Repeated Outgoing Attempts */}
        <div
          onClick={() => {
            setActiveKpiFilter(activeKpiFilter === 'outgoing' ? 'all' : 'outgoing');
            setPage(1);
          }}
          className={`cursor-pointer border-2 border-black bg-white p-3.5 transition-all hover:-translate-y-0.5 ${
            activeKpiFilter === 'outgoing'
              ? 'ring-3 ring-black shadow-[4px_4px_0px_#581C87] bg-purple-50'
              : 'shadow-[2px_2px_0px_#000]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-700">
              REPEATED OUTGOING ATTEMPTS
            </span>
            <PhoneOutgoing className="h-4 w-4 text-[#581C87]" />
          </div>
          <div className="mt-2 font-mono text-2xl font-black text-black">
            {kpis.repeatedOutgoingAttempts}
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-gray-500">
            <span>Outbound attempts</span>
            <span className="text-[#581C87]">Click to filter</span>
          </div>
        </div>

        {/* KPI 4: Repeated Missed Calls */}
        <div
          onClick={() => {
            setActiveKpiFilter(activeKpiFilter === 'missed' ? 'all' : 'missed');
            setPage(1);
          }}
          className={`cursor-pointer border-2 border-black bg-white p-3.5 transition-all hover:-translate-y-0.5 ${
            activeKpiFilter === 'missed'
              ? 'ring-3 ring-black shadow-[4px_4px_0px_#FF334B] bg-red-50'
              : 'shadow-[2px_2px_0px_#000]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-700">
              REPEATED MISSED CALLS
            </span>
            <PhoneMissed className="h-4 w-4 text-[#FF334B]" />
          </div>
          <div className="mt-2 font-mono text-2xl font-black text-[#FF334B]">
            {kpis.repeatedMissedCalls}
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-gray-500">
            <span>Unanswered calls</span>
            <span className="text-[#FF334B]">Click to filter</span>
          </div>
        </div>

        {/* KPI 5: Callback Attempts */}
        <div
          onClick={() => {
            setActiveKpiFilter(activeKpiFilter === 'callbacks' ? 'all' : 'callbacks');
            setPage(1);
          }}
          className={`cursor-pointer border-2 border-black bg-white p-3.5 transition-all hover:-translate-y-0.5 ${
            activeKpiFilter === 'callbacks'
              ? 'ring-3 ring-black shadow-[4px_4px_0px_#00D8F6] bg-cyan-50'
              : 'shadow-[2px_2px_0px_#000]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-700">
              CALLBACK ATTEMPTS
            </span>
            <PhoneForwarded className="h-4 w-4 text-[#0891B2]" />
          </div>
          <div className="mt-2 font-mono text-2xl font-black text-black">
            {kpis.callbackAttempts}
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-gray-500">
            <span>24h window matches</span>
            <span className="text-[#0891B2]">Click to filter</span>
          </div>
        </div>

        {/* KPI 6: Connected Repeat Calls */}
        <div
          onClick={() => {
            setActiveKpiFilter(activeKpiFilter === 'connected' ? 'all' : 'connected');
            setPage(1);
          }}
          className={`cursor-pointer border-2 border-black bg-white p-3.5 transition-all hover:-translate-y-0.5 ${
            activeKpiFilter === 'connected'
              ? 'ring-3 ring-black shadow-[4px_4px_0px_#00D26A] bg-emerald-50'
              : 'shadow-[2px_2px_0px_#000]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-700">
              CONNECTED REPEAT CALLS
            </span>
            <CheckCircle2 className="h-4 w-4 text-[#00D26A]" />
          </div>
          <div className="mt-2 font-mono text-2xl font-black text-[#00D26A]">
            {kpis.connectedRepeatCalls}
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-gray-500">
            <span>Answered interactions</span>
            <span className="text-[#00D26A]">Click to filter</span>
          </div>
        </div>
      </div>

      {/* Active KPI Filter Banner */}
      {activeKpiFilter !== 'all' && (
        <div className="flex items-center justify-between border-2 border-black bg-[#581C87] px-3.5 py-2 text-xs font-black text-white shadow-[2px_2px_0px_#000]">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-[#00D8F6]" />
            <span>
              FILTERING TABLE BY KPI:{' '}
              <span className="uppercase text-[#00D8F6]">{activeKpiFilter}</span> (
              {filteredCustomers.length} repeat customers match)
            </span>
          </div>
          <button
            onClick={() => setActiveKpiFilter('all')}
            className="border border-white bg-white/20 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-white/40"
          >
            Clear KPI Filter
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="border-3 border-black bg-white p-3.5 shadow-[3px_3px_0px_#000]">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
          {/* Search Box */}
          <div className="relative sm:col-span-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search by phone, name, staff, department..."
              className="w-full border-2 border-black bg-white py-1.5 pl-8 pr-3 text-xs font-bold text-black placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00D8F6]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-gray-500 hover:text-black"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Direction Filter */}
          <div>
            <label className="block text-[10px] font-black uppercase text-gray-600">DIRECTION</label>
            <select
              value={selectedDirection}
              onChange={(e) => {
                setSelectedDirection(e.target.value as any);
                setPage(1);
              }}
              className="mt-0.5 w-full border-2 border-black bg-white px-2 py-1.5 text-xs font-bold text-black focus:outline-none focus:ring-2 focus:ring-[#00D8F6]"
            >
              <option value="all">All Directions</option>
              <option value="Incoming">Has Incoming</option>
              <option value="Outgoing">Has Outgoing</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-[10px] font-black uppercase text-gray-600">STATUS</label>
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value as any);
                setPage(1);
              }}
              className="mt-0.5 w-full border-2 border-black bg-white px-2 py-1.5 text-xs font-bold text-black focus:outline-none focus:ring-2 focus:ring-[#00D8F6]"
            >
              <option value="all">All Statuses</option>
              <option value="Connected">Has Connected</option>
              <option value="Missed">Has Missed</option>
            </select>
          </div>

          {/* Category Filter */}
          <div>
            <label className="block text-[10px] font-black uppercase text-gray-600">REPEAT CATEGORY</label>
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value as any);
                setPage(1);
              }}
              className="mt-0.5 w-full border-2 border-black bg-white px-2 py-1.5 text-xs font-bold text-black focus:outline-none focus:ring-2 focus:ring-[#00D8F6]"
            >
              <option value="all">All Categories</option>
              <option value="Repeated Incoming">Repeated Incoming</option>
              <option value="Repeated Outgoing">Repeated Outgoing</option>
              <option value="Repeated Missed">Repeated Missed</option>
              <option value="Callback Candidate">Callback Candidate</option>
              <option value="Callback Attempted">Callback Attempted</option>
              <option value="Callback Connected">Callback Connected</option>
              <option value="Callback Confirmed">Callback Confirmed</option>
              <option value="High Frequency Repeat">High Frequency Repeat</option>
            </select>
          </div>

          {/* Department Filter */}
          <div>
            <label className="block text-[10px] font-black uppercase text-gray-600">DEPARTMENT</label>
            <select
              value={selectedDepartment}
              onChange={(e) => {
                setSelectedDepartment(e.target.value);
                setPage(1);
              }}
              className="mt-0.5 w-full border-2 border-black bg-white px-2 py-1.5 text-xs font-bold text-black focus:outline-none focus:ring-2 focus:ring-[#00D8F6]"
            >
              <option value="all">All Departments</option>
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Active Filter Tags & Reset */}
        {(selectedDirection !== 'all' ||
          selectedStatus !== 'all' ||
          selectedCategory !== 'all' ||
          selectedStaff !== 'all' ||
          selectedDepartment !== 'all' ||
          searchQuery !== '' ||
          activeKpiFilter !== 'all') && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-2.5">
            <span className="text-[11px] font-bold text-gray-600">Active Filters:</span>
            {activeKpiFilter !== 'all' && (
              <span className="border border-black bg-[#581C87] px-2 py-0.5 text-[10px] font-black text-white">
                KPI: {activeKpiFilter}
              </span>
            )}
            {selectedDirection !== 'all' && (
              <span className="border border-black bg-cyan-100 px-2 py-0.5 text-[10px] font-black text-black">
                Direction: {selectedDirection}
              </span>
            )}
            {selectedStatus !== 'all' && (
              <span className="border border-black bg-purple-100 px-2 py-0.5 text-[10px] font-black text-black">
                Status: {selectedStatus}
              </span>
            )}
            {selectedCategory !== 'all' && (
              <span className="border border-black bg-amber-100 px-2 py-0.5 text-[10px] font-black text-black">
                Category: {selectedCategory}
              </span>
            )}
            {selectedDepartment !== 'all' && (
              <span className="border border-black bg-gray-100 px-2 py-0.5 text-[10px] font-black text-black">
                Dept: {selectedDepartment}
              </span>
            )}
            {searchQuery && (
              <span className="border border-black bg-yellow-100 px-2 py-0.5 text-[10px] font-black text-black">
                Search: "{searchQuery}"
              </span>
            )}
            <button
              onClick={handleResetFilters}
              className="ml-auto text-xs font-black text-red-600 underline hover:text-red-800"
            >
              Reset All Filters
            </button>
          </div>
        )}
      </div>

      {/* Main Repeat Customer Table */}
      <div className="border-3 border-black bg-white shadow-[4px_4px_0px_#000]">
        <div className="flex flex-wrap items-center justify-between border-b-2 border-black bg-[#581C87] px-4 py-2.5 text-white">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[#00D8F6]" />
            <h3 className="text-xs font-black uppercase tracking-wider text-white">
              REPEATED CALLERS DIRECTORY ({filteredCustomers.length} RECORDS FOUND)
            </h3>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-gray-200">
            <span>Showing page {page} of {totalPages}</span>
            <div className="flex items-center gap-1">
              <label className="text-[10px] uppercase text-gray-300">Page size:</label>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="border border-white bg-black px-1.5 py-0.5 text-xs font-bold text-white focus:outline-none"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b-2 border-black bg-[#00D8F6] font-black uppercase text-black">
                <th
                  onClick={() => handleSort('phone')}
                  className="cursor-pointer px-3 py-2.5 hover:bg-[#22D3EE]"
                >
                  <div className="flex items-center gap-1">
                    <span>CUSTOMER PHONE</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('totalCalls')}
                  className="cursor-pointer px-2.5 py-2.5 text-center hover:bg-[#22D3EE]"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>TOTAL</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('incoming')}
                  className="cursor-pointer px-2 py-2.5 text-center hover:bg-[#22D3EE]"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>INCOMING</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('outgoing')}
                  className="cursor-pointer px-2 py-2.5 text-center hover:bg-[#22D3EE]"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>OUTGOING</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('missed')}
                  className="cursor-pointer px-2 py-2.5 text-center hover:bg-[#22D3EE]"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>MISSED</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('connected')}
                  className="cursor-pointer px-2 py-2.5 text-center hover:bg-[#22D3EE]"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>CONNECTED</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th className="px-3 py-2.5">FIRST CALL (IST)</th>
                <th
                  onClick={() => handleSort('latestEpoch')}
                  className="cursor-pointer px-3 py-2.5 hover:bg-[#22D3EE]"
                >
                  <div className="flex items-center gap-1">
                    <span>LATEST CALL (IST)</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th className="px-2.5 py-2.5">LATEST STATUS</th>
                <th className="px-3 py-2.5">AGENT / STAFF</th>
                <th className="px-3 py-2.5">DEPARTMENT</th>
                <th className="px-3 py-2.5">REPEAT CATEGORY</th>
                <th className="px-3 py-2.5 text-center">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 font-medium">
              {paginatedCustomers.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-8 text-center">
                    <AlertCircle className="mx-auto h-8 w-8 text-gray-400" />
                    <p className="mt-2 text-sm font-black uppercase text-black">
                      No Repeated Call Records Found
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Try adjusting the date range, status, or search filters above.
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedCustomers.map((cust) => {
                  const phoneDisplay = maskPhones ? cust.maskedPhone : cust.displayPhone;

                  // Repeat Category Badge Styling in Max PetZ theme
                  let catBadgeBg = 'bg-gray-100 text-black border-black';
                  if (cust.category === 'Callback Confirmed') {
                    catBadgeBg = 'bg-[#581C87] text-white border-black';
                  } else if (cust.category === 'Callback Connected') {
                    catBadgeBg = 'bg-[#00D8F6] text-black border-black';
                  } else if (cust.category === 'Callback Attempted') {
                    catBadgeBg = 'bg-cyan-100 text-cyan-900 border-black';
                  } else if (cust.category === 'Repeated Missed') {
                    catBadgeBg = 'bg-[#FF334B] text-white border-black';
                  } else if (cust.category === 'High Frequency Repeat') {
                    catBadgeBg = 'bg-purple-100 text-purple-900 border-black';
                  } else if (cust.category === 'Repeated Incoming') {
                    catBadgeBg = 'bg-emerald-100 text-emerald-900 border-black';
                  } else if (cust.category === 'Repeated Outgoing') {
                    catBadgeBg = 'bg-blue-100 text-blue-900 border-black';
                  }

                  return (
                    <tr
                      key={cust.normalizedPhone}
                      className="transition-colors hover:bg-purple-50/50"
                    >
                      {/* Customer Phone */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5 font-mono font-black text-black">
                          <span>{phoneDisplay}</span>
                          <button
                            onClick={(e) => handleCopyPhone(cust.normalizedPhone, e)}
                            title="Copy Phone Number"
                            className="border border-black p-0.5 text-gray-600 hover:bg-[#00D8F6] hover:text-black"
                          >
                            {copiedPhone === cust.normalizedPhone ? (
                              <Check className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                        {cust.customerName && cust.customerName !== 'Valued Pet Parent' && (
                          <p className="text-[10px] font-bold text-gray-500">{cust.customerName}</p>
                        )}
                      </td>

                      {/* Total Calls */}
                      <td className="px-2.5 py-2.5 text-center">
                        <span className="border-2 border-black bg-black px-2 py-0.5 font-mono font-black text-xs text-white">
                          {cust.totalCalls}
                        </span>
                      </td>

                      {/* Incoming Count */}
                      <td className="px-2 py-2.5 text-center font-mono font-black text-gray-900">
                        {cust.incomingCount > 0 ? (
                          <span className="text-[#0891B2]">{cust.incomingCount}</span>
                        ) : (
                          <span className="text-gray-300">0</span>
                        )}
                      </td>

                      {/* Outgoing Count */}
                      <td className="px-2 py-2.5 text-center font-mono font-black text-gray-900">
                        {cust.outgoingCount > 0 ? (
                          <span className="text-[#581C87]">{cust.outgoingCount}</span>
                        ) : (
                          <span className="text-gray-300">0</span>
                        )}
                      </td>

                      {/* Missed Count */}
                      <td className="px-2 py-2.5 text-center font-mono font-black">
                        {cust.missedCount > 0 ? (
                          <span className="border border-black bg-red-100 px-1.5 py-0.5 text-red-700">
                            {cust.missedCount}
                          </span>
                        ) : (
                          <span className="text-gray-300">0</span>
                        )}
                      </td>

                      {/* Connected Count */}
                      <td className="px-2 py-2.5 text-center font-mono font-black">
                        {cust.connectedCount > 0 ? (
                          <span className="border border-black bg-emerald-100 px-1.5 py-0.5 text-emerald-800">
                            {cust.connectedCount}
                          </span>
                        ) : (
                          <span className="text-gray-300">0</span>
                        )}
                      </td>

                      {/* First Call (IST) */}
                      <td className="px-3 py-2.5 text-[11px] font-bold text-gray-600">
                        {formatDateTime(cust.firstCallTimestamp)}
                      </td>

                      {/* Latest Call (IST) */}
                      <td className="px-3 py-2.5 text-[11px] font-bold text-black">
                        {formatDateTime(cust.latestCallTimestamp)}
                      </td>

                      {/* Latest Status */}
                      <td className="px-2.5 py-2.5">
                        <span
                          className={`border-2 border-black px-2 py-0.5 text-[10px] font-black uppercase ${
                            cust.latestCallStatus === 'Connected'
                              ? 'bg-[#00D26A] text-black'
                              : 'bg-[#FF334B] text-white'
                          }`}
                        >
                          {cust.latestCallStatus}
                        </span>
                      </td>

                      {/* Agent / Staff */}
                      <td className="px-3 py-2.5 text-[11px] font-bold text-gray-900">
                        <div className="flex items-center gap-1">
                          <UserCheck className="h-3 w-3 text-[#581C87]" />
                          <span className="line-clamp-1">{cust.latestStaffName}</span>
                        </div>
                      </td>

                      {/* Department */}
                      <td className="px-3 py-2.5 text-[11px] font-bold text-gray-900">
                        <div className="flex items-center gap-1">
                          <Building2 className="h-3 w-3 text-[#0891B2]" />
                          <span className="line-clamp-1">{cust.latestDepartment}</span>
                        </div>
                      </td>

                      {/* Repeat Category */}
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-block border-2 px-2 py-0.5 text-[10px] font-black uppercase shadow-[1px_1px_0px_#000] ${catBadgeBg}`}
                        >
                          {cust.categoryLabel}
                        </span>
                      </td>

                      {/* Action: View Calls */}
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => setExpandedCustomer(cust)}
                          className="border-2 border-black bg-white px-2.5 py-1 text-[11px] font-black uppercase text-black shadow-[2px_2px_0px_#000] transition-all hover:bg-[#00D8F6] active:translate-x-0.5 active:translate-y-0.5"
                        >
                          View {cust.totalCalls} Calls
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="flex flex-col items-center justify-between gap-3 border-t-2 border-black bg-gray-50 px-4 py-3 sm:flex-row">
          <div className="text-xs font-bold text-gray-700">
            Showing{' '}
            <span className="font-mono font-black text-black">
              {filteredCustomers.length === 0 ? 0 : (page - 1) * pageSize + 1}
            </span>{' '}
            to{' '}
            <span className="font-mono font-black text-black">
              {Math.min(page * pageSize, filteredCustomers.length)}
            </span>{' '}
            of{' '}
            <span className="font-mono font-black text-black">{filteredCustomers.length}</span> repeat
            customers
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 border-2 border-black bg-white px-2.5 py-1 text-xs font-black uppercase text-black shadow-[2px_2px_0px_#000] hover:bg-gray-100 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Prev</span>
            </button>

            <span className="border-2 border-black bg-white px-3 py-1 font-mono text-xs font-black text-black">
              {page} / {totalPages}
            </span>

            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 border-2 border-black bg-white px-2.5 py-1 text-xs font-black uppercase text-black shadow-[2px_2px_0px_#000] hover:bg-gray-100 disabled:opacity-40"
            >
              <span>Next</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Expandable Customer History Modal */}
      {expandedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative max-h-[90vh] w-full max-w-4xl overflow-hidden border-3 border-black bg-white shadow-[6px_6px_0px_#000]">
            {/* Modal Header in Max PetZ Purple */}
            <div className="flex items-center justify-between border-b-3 border-black bg-[#581C87] p-4 text-white">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center border-2 border-white bg-[#00D8F6] text-black">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-black uppercase tracking-tight text-white">
                      CALL HISTORY: {maskPhones ? expandedCustomer.maskedPhone : expandedCustomer.displayPhone}
                    </h3>
                    <span className="border border-white bg-[#00D8F6] px-2 py-0.5 text-[10px] font-black uppercase text-black">
                      {expandedCustomer.categoryLabel}
                    </span>
                  </div>
                  <p className="text-xs text-gray-200">
                    Chronological history of all {expandedCustomer.calls.length} calls for this
                    customer. Deduplicated by Call UID.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setExpandedCustomer(null)}
                className="border-2 border-white bg-black p-1 text-white hover:bg-white hover:text-black"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Customer Summary Cards */}
            <div className="grid grid-cols-2 gap-2 border-b-2 border-black bg-gray-50 p-3 sm:grid-cols-4">
              <div className="border border-black bg-white p-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase">Incoming Calls</span>
                <p className="font-mono text-base font-black text-[#0891B2]">
                  {expandedCustomer.incomingCount} ({expandedCustomer.incomingConnected} connected)
                </p>
              </div>
              <div className="border border-black bg-white p-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase">Outgoing Attempts</span>
                <p className="font-mono text-base font-black text-[#581C87]">
                  {expandedCustomer.outgoingCount} ({expandedCustomer.outgoingConnected} connected)
                </p>
              </div>
              <div className="border border-black bg-white p-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase">Missed Calls</span>
                <p className="font-mono text-base font-black text-[#FF334B]">
                  {expandedCustomer.missedCount}
                </p>
              </div>
              <div className="border border-black bg-white p-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase">Callback Status</span>
                <p className="text-xs font-black text-black">
                  {expandedCustomer.callbackStatus}
                </p>
              </div>
            </div>

            {/* Individual Calls List */}
            <div className="max-h-[55vh] overflow-y-auto p-4">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b-2 border-black bg-[#00D8F6] font-black uppercase text-black">
                    <th className="px-2.5 py-2">#</th>
                    <th className="px-3 py-2">CALL UID</th>
                    <th className="px-3 py-2">DATE & TIME (IST)</th>
                    <th className="px-2.5 py-2">DIRECTION</th>
                    <th className="px-2.5 py-2">STATUS</th>
                    <th className="px-2.5 py-2">DURATION</th>
                    <th className="px-3 py-2">STAFF</th>
                    <th className="px-3 py-2">DEPARTMENT</th>
                    <th className="px-3 py-2">NOTES / DETAILS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {expandedCustomer.calls.map((c, idx) => (
                    <tr key={c.uid} className="hover:bg-purple-50">
                      <td className="px-2.5 py-2 font-mono font-bold text-gray-500">{idx + 1}</td>
                      <td className="px-3 py-2 font-mono text-[11px] font-black text-gray-900">
                        {c.uid}
                      </td>
                      <td className="px-3 py-2 font-bold text-gray-800">
                        {formatDateTime(c.timestamp)}
                      </td>
                      <td className="px-2.5 py-2">
                        <span
                          className={`border border-black px-1.5 py-0.5 text-[10px] font-black uppercase ${
                            c.event === 'Incoming'
                              ? 'bg-cyan-100 text-[#0891B2]'
                              : 'bg-purple-100 text-[#581C87]'
                          }`}
                        >
                          {c.event}
                        </span>
                      </td>
                      <td className="px-2.5 py-2">
                        <span
                          className={`border border-black px-1.5 py-0.5 text-[10px] font-black uppercase ${
                            c.status === 'Connected'
                              ? 'bg-[#00D26A] text-black'
                              : 'bg-[#FF334B] text-white'
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="px-2.5 py-2 font-mono font-bold text-gray-700">
                        {formatDuration(c.durationSeconds)}
                      </td>
                      <td className="px-3 py-2 font-bold text-gray-900">{c.staffName}</td>
                      <td className="px-3 py-2 font-bold text-gray-700">{c.department}</td>
                      <td className="max-w-xs px-3 py-2 text-[11px] text-gray-600">
                        {c.anyNote || c.userDetail || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end border-t-2 border-black bg-gray-50 p-3">
              <button
                onClick={() => setExpandedCustomer(null)}
                className="border-2 border-black bg-black px-4 py-1.5 text-xs font-black uppercase text-white shadow-[2px_2px_0px_#00D8F6] hover:bg-neutral-800"
              >
                Close History
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
