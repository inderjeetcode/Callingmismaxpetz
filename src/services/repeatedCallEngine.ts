/**
 * Max PetZ Hospitals — Repeated Call Tracking Engine
 *
 * Implements rigorous identification and grouping of repeated customer interactions:
 * 1. Normalized phone numbers (Indian standards +91, 10-digit, 11-digit leading 0, scientific notation).
 * 2. Deduplicates multiple routing legs sharing Call UID.
 * 3. Identifies:
 *    - Repeated Incoming Calls (>= 2 distinct incoming calls)
 *    - Repeated Outgoing Calls (>= 2 distinct outgoing attempts)
 *    - Repeated Missed Calls (>= 2 missed incoming calls)
 *    - Repeat Callback Attempts (outgoing call following missed incoming call within configurable window, 1:1 match)
 *    - Connected Repeat Calls (explicitly connected status)
 * 4. Labels: Callback Candidate, Callback Attempted, Callback Connected, Callback Confirmed.
 * 5. Reconciles with manual callback confirmations and global filters.
 */

import {
  CallbackStoreRecord,
  CustomerCallbackStatus,
  ParsedCallRecord,
  RepeatCallCategory,
  RepeatCustomerRecord,
  RepeatedCallKPIs,
} from '../types/callAnalytics';
import { maskPhoneNumber } from './dataParser';

/**
 * Normalizes any phone number format (Indian +91, 0-prefixed, scientific notation 9.20E+11, spaces, hyphens).
 */
export function normalizeCustomerPhone(raw: string | undefined | null): string {
  if (!raw || typeof raw !== 'string') return 'Unknown';

  const trimmed = raw.trim();
  if (!trimmed) return 'Unknown';

  // Check scientific notation like 9.20E+11 or 9.19e+11 from Excel
  if (/^[0-9]\.[0-9]+[eE]\+[0-9]+$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  // Strip all whitespace, hyphens, dots, parentheses
  let cleaned = trimmed.replace(/[\s\-\(\)\.]+/g, '');

  // Strip leading international or trunk prefixes for Indian numbers
  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.slice(3);
  } else if (cleaned.startsWith('0091')) {
    cleaned = cleaned.slice(4);
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.slice(1);
  }

  return cleaned || 'Unknown';
}

/**
 * Formats a normalized phone for clean, readable display
 */
export function formatDisplayPhone(normalizedPhone: string): string {
  if (!normalizedPhone || normalizedPhone === 'Unknown') return 'Unknown';
  if (/^[0-9]\.[0-9]+[eE]\+[0-9]+$/i.test(normalizedPhone)) {
    return `Customer (${normalizedPhone})`;
  }
  if (normalizedPhone.length === 10) {
    return `+91 ${normalizedPhone.slice(0, 5)} ${normalizedPhone.slice(5)}`;
  }
  return normalizedPhone;
}

export interface RepeatedCallEngineOptions {
  callbackMatchingWindowHours?: number; // default 24
}

/**
 * Analyzes and groups call records into repeat customer profiles
 */
export function analyzeRepeatedCalls(
  records: ParsedCallRecord[],
  storedConfirmations: Map<string, CallbackStoreRecord> = new Map(),
  options: RepeatedCallEngineOptions = {}
): {
  repeatCustomers: RepeatCustomerRecord[];
  allCustomers: RepeatCustomerRecord[];
  kpis: RepeatedCallKPIs;
} {
  const windowHours = options.callbackMatchingWindowHours ?? 24;
  const windowMs = windowHours * 60 * 60 * 1000;

  // 1. Group records by normalized phone number, deduplicating by UID per phone
  const phoneGroups = new Map<string, { calls: ParsedCallRecord[]; seenUids: Set<string> }>();

  for (const record of records) {
    const rawPhone = record.from || record.normalizedPhone;
    const phone = normalizeCustomerPhone(rawPhone);
    if (!phone || phone === 'Unknown') continue;

    let group = phoneGroups.get(phone);
    if (!group) {
      group = { calls: [], seenUids: new Set() };
      phoneGroups.set(phone, group);
    }

    // Deduplicate by UID (multi-leg routing safety)
    if (record.uid && group.seenUids.has(record.uid)) {
      continue;
    }
    if (record.uid) {
      group.seenUids.add(record.uid);
    }
    group.calls.push(record);
  }

  const allCustomerProfiles: RepeatCustomerRecord[] = [];
  const repeatCustomerProfiles: RepeatCustomerRecord[] = [];

  // 2. Process each customer phone group
  for (const [phone, { calls }] of phoneGroups.entries()) {
    // Sort chronologically ascending (earliest to latest)
    calls.sort((a, b) => a.epochMs - b.epochMs);

    let incomingCount = 0;
    let incomingConnected = 0;
    let incomingMissed = 0;
    let outgoingCount = 0;
    let outgoingConnected = 0;
    let outgoingMissed = 0;

    const staffSet = new Set<string>();
    const departmentSet = new Set<string>();
    let customerName = '';

    for (const c of calls) {
      if (c.name && !customerName) customerName = c.name;
      if (c.staffName && c.staffName !== 'Unassigned') staffSet.add(c.staffName);
      if (c.department && c.department !== 'General') departmentSet.add(c.department);

      if (c.event === 'Incoming') {
        incomingCount++;
        if (c.status === 'Connected') incomingConnected++;
        else incomingMissed++;
      } else if (c.event === 'Outgoing') {
        outgoingCount++;
        if (c.status === 'Connected') outgoingConnected++;
        else outgoingMissed++;
      }
    }

    const totalCalls = calls.length;
    const connectedCount = incomingConnected + outgoingConnected;
    const missedCount = incomingMissed + outgoingMissed;

    const firstCall = calls[0];
    const latestCall = calls[calls.length - 1];

    // 3. Callback detection (1:1 matching within matching window)
    const missedCalls = calls.filter((c) => c.event === 'Incoming' && c.status === 'Missed');
    const outgoingCalls = calls.filter((c) => c.event === 'Outgoing');

    const usedOutgoingUids = new Set<string>();
    let hasCallbackAttempt = false;
    let hasConnectedCallback = false;
    let hasConfirmedCallback = false;

    for (const missed of missedCalls) {
      // Check if manually confirmed in callback store
      const stored = storedConfirmations.get(missed.uid);
      if (stored?.status === 'Confirmed Successful') {
        hasConfirmedCallback = true;
      }

      // Find first subsequent outgoing call within window not already matched
      const candidate = outgoingCalls.find((out) => {
        if (usedOutgoingUids.has(out.uid)) return false;
        if (out.epochMs <= missed.epochMs) return false;
        if (out.epochMs - missed.epochMs > windowMs) return false;
        return true;
      });

      if (candidate) {
        usedOutgoingUids.add(candidate.uid);
        hasCallbackAttempt = true;
        if (candidate.status === 'Connected' || candidate.durationSeconds > 0) {
          hasConnectedCallback = true;
        }
      }
    }

    // Determine accurate Callback Status
    let callbackStatus: CustomerCallbackStatus = 'No Missed Call';
    if (hasConfirmedCallback) {
      callbackStatus = 'Callback Confirmed';
    } else if (hasConnectedCallback) {
      callbackStatus = 'Callback Connected';
    } else if (hasCallbackAttempt) {
      callbackStatus = 'Callback Attempted';
    } else if (missedCalls.length > 0) {
      callbackStatus = 'Callback Candidate';
    }

    // Determine Repeat Call Category
    let category: RepeatCallCategory = 'Multi-Interaction Repeat';
    let categoryLabel = 'Multi-Interaction';

    if (hasConfirmedCallback) {
      category = 'Callback Confirmed';
      categoryLabel = 'Callback Confirmed';
    } else if (hasConnectedCallback) {
      category = 'Callback Connected';
      categoryLabel = 'Callback Connected';
    } else if (hasCallbackAttempt) {
      category = 'Callback Attempted';
      categoryLabel = 'Callback Attempted';
    } else if (incomingMissed >= 2 && connectedCount === 0) {
      category = 'Repeated Missed';
      categoryLabel = 'Repeated Missed';
    } else if (incomingMissed > 0 && outgoingCount === 0) {
      category = 'Callback Candidate';
      categoryLabel = 'Callback Candidate';
    } else if (totalCalls >= 4) {
      category = 'High Frequency Repeat';
      categoryLabel = 'High Frequency Repeat';
    } else if (incomingCount >= 2 && outgoingCount === 0) {
      category = 'Repeated Incoming';
      categoryLabel = 'Repeated Incoming';
    } else if (outgoingCount >= 2 && incomingCount === 0) {
      category = 'Repeated Outgoing';
      categoryLabel = 'Repeated Outgoing';
    } else if (incomingCount >= 2) {
      category = 'Repeated Incoming';
      categoryLabel = 'Repeated Incoming';
    } else if (outgoingCount >= 2) {
      category = 'Repeated Outgoing';
      categoryLabel = 'Repeated Outgoing';
    }

    // Determine whether this customer qualifies as a Repeat Customer
    // Qualification:
    // 1. Repeated Incoming (>=2 incoming calls)
    // 2. Repeated Outgoing (>=2 outgoing attempts)
    // 3. Repeated Missed (>=2 missed incoming calls)
    // 4. Repeat Callback Attempts (missed incoming followed by outgoing callback attempt)
    // 5. Total calls >= 2
    const isRepeatCustomer =
      totalCalls >= 2 ||
      incomingCount >= 2 ||
      outgoingCount >= 2 ||
      incomingMissed >= 2 ||
      hasCallbackAttempt;

    const profile: RepeatCustomerRecord = {
      normalizedPhone: phone,
      displayPhone: formatDisplayPhone(phone),
      maskedPhone: maskPhoneNumber(phone),
      customerName: customerName || 'Valued Pet Parent',
      totalCalls,
      incomingCount,
      incomingConnected,
      incomingMissed,
      outgoingCount,
      outgoingConnected,
      outgoingMissed,
      missedCount,
      connectedCount,
      firstCallTimestamp: firstCall.timestamp,
      firstCallEpochMs: firstCall.epochMs,
      latestCallTimestamp: latestCall.timestamp,
      latestCallEpochMs: latestCall.epochMs,
      latestCallStatus: latestCall.status,
      latestCallEvent: latestCall.event,
      latestCallDurationSeconds: latestCall.durationSeconds,
      latestStaffName: latestCall.staffName || 'Unassigned',
      latestDepartment: latestCall.department || 'General',
      staffList: Array.from(staffSet),
      departmentList: Array.from(departmentSet),
      category,
      categoryLabel,
      callbackStatus,
      hasCallbackAttempt,
      hasConnectedCallback,
      calls,
    };

    allCustomerProfiles.push(profile);
    if (isRepeatCustomer) {
      repeatCustomerProfiles.push(profile);
    }
  }

  // Sort repeat customers descending by latest call timestamp
  repeatCustomerProfiles.sort((a, b) => b.latestCallEpochMs - a.latestCallEpochMs);
  allCustomerProfiles.sort((a, b) => b.latestCallEpochMs - a.latestCallEpochMs);

  // 4. Calculate KPI Cards
  // - Unique Repeat Customers
  // - Repeated Incoming Calls
  // - Repeated Outgoing Attempts
  // - Repeated Missed Calls
  // - Callback Attempts
  // - Connected Repeat Calls
  let repeatedIncomingCalls = 0;
  let repeatedOutgoingAttempts = 0;
  let repeatedMissedCalls = 0;
  let callbackAttempts = 0;
  let connectedRepeatCalls = 0;

  for (const c of repeatCustomerProfiles) {
    repeatedIncomingCalls += c.incomingCount;
    repeatedOutgoingAttempts += c.outgoingCount;
    repeatedMissedCalls += c.missedCount;
    if (c.hasCallbackAttempt) {
      // count of outgoing calls after missed call for this customer
      callbackAttempts += c.calls.filter((call) => {
        if (call.event !== 'Outgoing') return false;
        // occurred after an incoming missed call
        return c.calls.some((m) => m.event === 'Incoming' && m.status === 'Missed' && call.epochMs > m.epochMs);
      }).length || 1;
    }
    connectedRepeatCalls += c.connectedCount;
  }

  const kpis: RepeatedCallKPIs = {
    uniqueRepeatCustomers: repeatCustomerProfiles.length,
    repeatedIncomingCalls,
    repeatedOutgoingAttempts,
    repeatedMissedCalls,
    callbackAttempts,
    connectedRepeatCalls,
  };

  return {
    repeatCustomers: repeatCustomerProfiles,
    allCustomers: allCustomerProfiles,
    kpis,
  };
}

/**
 * Filters repeat customer records based on secondary filters
 */
export function filterRepeatCustomers(
  customers: RepeatCustomerRecord[],
  filters: {
    callDirection?: 'all' | 'Incoming' | 'Outgoing';
    callStatus?: 'all' | 'Connected' | 'Missed';
    category?: 'all' | RepeatCallCategory;
    staff?: string;
    department?: string;
    searchQuery?: string;
    kpiFilter?: 'all' | 'unique' | 'incoming' | 'outgoing' | 'missed' | 'callbacks' | 'connected';
  }
): RepeatCustomerRecord[] {
  return customers.filter((cust) => {
    // KPI Quick Filter
    if (filters.kpiFilter === 'incoming' && cust.incomingCount < 2) return false;
    if (filters.kpiFilter === 'outgoing' && cust.outgoingCount < 2) return false;
    if (filters.kpiFilter === 'missed' && cust.missedCount < 2) return false;
    if (filters.kpiFilter === 'callbacks' && !cust.hasCallbackAttempt) return false;
    if (filters.kpiFilter === 'connected' && cust.connectedCount === 0) return false;

    // Call Direction
    if (filters.callDirection && filters.callDirection !== 'all') {
      if (filters.callDirection === 'Incoming' && cust.incomingCount === 0) return false;
      if (filters.callDirection === 'Outgoing' && cust.outgoingCount === 0) return false;
    }

    // Call Status
    if (filters.callStatus && filters.callStatus !== 'all') {
      if (filters.callStatus === 'Connected' && cust.connectedCount === 0) return false;
      if (filters.callStatus === 'Missed' && cust.missedCount === 0) return false;
    }

    // Category
    if (filters.category && filters.category !== 'all') {
      if (cust.category !== filters.category) return false;
    }

    // Staff
    if (filters.staff && filters.staff !== 'all') {
      const hasStaff =
        cust.latestStaffName === filters.staff || cust.staffList.includes(filters.staff);
      if (!hasStaff) return false;
    }

    // Department
    if (filters.department && filters.department !== 'all') {
      const hasDept =
        cust.latestDepartment === filters.department ||
        cust.departmentList.includes(filters.department);
      if (!hasDept) return false;
    }

    // Search query
    if (filters.searchQuery && filters.searchQuery.trim()) {
      const q = filters.searchQuery.toLowerCase().trim();
      const matchPhone = cust.normalizedPhone.toLowerCase().includes(q);
      const matchMasked = cust.maskedPhone.toLowerCase().includes(q);
      const matchDisplay = cust.displayPhone.toLowerCase().includes(q);
      const matchName = cust.customerName.toLowerCase().includes(q);
      const matchStaff = cust.staffList.some((s) => s.toLowerCase().includes(q));
      const matchDept = cust.departmentList.some((d) => d.toLowerCase().includes(q));
      const matchCat = cust.categoryLabel.toLowerCase().includes(q);
      if (!matchPhone && !matchMasked && !matchDisplay && !matchName && !matchStaff && !matchDept && !matchCat) {
        return false;
      }
    }

    return true;
  });
}
