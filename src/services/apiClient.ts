/**
 * Resilient API Client & Client-Side Google Sheets Synchronization Service
 * 
 * Guarantees that the application never crashes with:
 * "SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON"
 * 
 * Supports both:
 * 1. Full-stack Express backend (in AI Studio or custom server)
 * 2. Standalone / Vercel Vite SPA deployment with direct client-side Google Sheet sync & localStorage fallback
 */

import { parseSpreadsheetData } from './dataParser';
import {
  CallbackAuditLog,
  CallbackStoreRecord,
  DataSourceSettings,
  ParsedCallRecord,
  SheetConnectionStatus,
} from '../types/callAnalytics';

export interface SafeFetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  isHtml: boolean;
  errorMessage?: string;
}

/**
 * Safely fetches an endpoint and ensures JSON parsing never throws on HTML responses
 * (such as Vercel SPA rewrites, Nginx 502/504 errors, or Vite 404 fallbacks).
 */
export async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<SafeFetchResult<T>> {
  try {
    const res = await fetch(input, init);
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    const trimmed = text.trim();
    const isHtmlOrXml =
      trimmed.startsWith('<') ||
      trimmed.toLowerCase().startsWith('<!doctype') ||
      contentType.includes('text/html');

    if (isHtmlOrXml) {
      return {
        ok: false,
        status: res.status,
        data: null,
        isHtml: true,
        errorMessage: 'Received HTML response instead of JSON (server may be offline or SPA route rewrite)',
      };
    }

    if (!text) {
      return {
        ok: res.ok,
        status: res.status,
        data: null,
        isHtml: false,
      };
    }

    try {
      const data = JSON.parse(text) as T;
      return {
        ok: res.ok,
        status: res.status,
        data,
        isHtml: false,
      };
    } catch (parseErr: any) {
      return {
        ok: false,
        status: res.status,
        data: null,
        isHtml: false,
        errorMessage: `JSON parse error: ${parseErr.message}`,
      };
    }
  } catch (netErr: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      isHtml: false,
      errorMessage: netErr?.message || 'Network fetch failed',
    };
  }
}

// LocalStorage Persistence Keys
const LS_SETTINGS_KEY = 'maxpetz_datasource_settings';
const LS_CALLBACKS_KEY = 'maxpetz_callback_store';
const LS_AUDIT_LOGS_KEY = 'maxpetz_audit_logs';
const LS_CACHED_CSV_KEY = 'maxpetz_cached_csv';

export function getLocalSettings(fallback: DataSourceSettings): DataSourceSettings {
  try {
    const saved = localStorage.getItem(LS_SETTINGS_KEY);
    if (saved) {
      return { ...fallback, ...JSON.parse(saved) };
    }
  } catch {
    // Ignore storage errors
  }
  return fallback;
}

export function saveLocalSettings(settings: DataSourceSettings): void {
  try {
    localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

export function getLocalCallbacks(): Map<string, CallbackStoreRecord> {
  const map = new Map<string, CallbackStoreRecord>();
  try {
    const saved = localStorage.getItem(LS_CALLBACKS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.entries(parsed).forEach(([k, v]) => map.set(k, v as CallbackStoreRecord));
    }
  } catch {
    // Ignore storage errors
  }
  return map;
}

export function saveLocalCallbacks(callbacks: Map<string, CallbackStoreRecord>): void {
  try {
    const obj: Record<string, CallbackStoreRecord> = {};
    callbacks.forEach((v, k) => {
      obj[k] = v;
    });
    localStorage.setItem(LS_CALLBACKS_KEY, JSON.stringify(obj));
  } catch {
    // Ignore storage errors
  }
}

export function getLocalAuditLogs(): CallbackAuditLog[] {
  try {
    const saved = localStorage.getItem(LS_AUDIT_LOGS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Ignore storage errors
  }
  return [];
}

export function saveLocalAuditLogs(logs: CallbackAuditLog[]): void {
  try {
    localStorage.setItem(LS_AUDIT_LOGS_KEY, JSON.stringify(logs.slice(0, 500)));
  } catch {
    // Ignore storage errors
  }
}

export function getLocalCachedCsv(): string | null {
  try {
    return localStorage.getItem(LS_CACHED_CSV_KEY);
  } catch {
    return null;
  }
}

export function saveLocalCachedCsv(csv: string): void {
  try {
    localStorage.setItem(LS_CACHED_CSV_KEY, csv);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Direct client-side Google Sheet fetcher.
 * Works seamlessly in pure client/Vercel static deployments without backend!
 */
export async function directClientFetchGoogleSheet(
  spreadsheetId: string,
  tabName: string,
  options?: { apiKey?: string; appsScriptUrl?: string }
): Promise<{
  success: boolean;
  csv: string | null;
  status: SheetConnectionStatus;
  authMethod: string;
  latencyMs: number;
  errorMessage?: string;
}> {
  const start = Date.now();

  // 1. If Apps Script URL provided
  if (options?.appsScriptUrl && options.appsScriptUrl.trim()) {
    try {
      const res = await fetch(options.appsScriptUrl.trim());
      const latencyMs = Date.now() - start;
      if (res.ok) {
        const text = await res.text();
        if (text.includes('UID') && text.includes('Event') && !text.includes('<!DOCTYPE html>')) {
          return {
            success: true,
            csv: text,
            status: 'Connected',
            authMethod: 'Apps Script',
            latencyMs,
          };
        }
      }
    } catch {
      // Continue to next method
    }
  }

  // 2. If API Key provided
  if (options?.apiKey && options.apiKey.trim()) {
    try {
      const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
        tabName
      )}?key=${options.apiKey.trim()}&valueRenderOption=FORMATTED_VALUE`;
      const res = await fetch(apiUrl);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        const json = await res.json();
        if (json.values && Array.isArray(json.values) && json.values.length > 0) {
          const csv = json.values
            .map((row: any[]) =>
              row
                .map((val) => {
                  const s = String(val ?? '');
                  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
                    return `"${s.replace(/"/g, '""')}"`;
                  }
                  return s;
                })
                .join(',')
            )
            .join('\r\n');
          return {
            success: true,
            csv,
            status: 'Connected',
            authMethod: 'API Key',
            latencyMs,
          };
        }
      }
    } catch {
      // Continue to next method
    }
  }

  // 3. Direct Google Visualization (GViz) CSV endpoint
  try {
    const gvizUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
      tabName
    )}`;
    const res = await fetch(gvizUrl);
    const latencyMs = Date.now() - start;

    if (res.ok) {
      const text = await res.text();
      if (text.includes('UID') && text.includes('Event') && !text.includes('<!DOCTYPE html>')) {
        return {
          success: true,
          csv: text,
          status: 'Connected',
          authMethod: 'Public Sheet',
          latencyMs,
        };
      } else if (text.includes('accounts.google.com') || text.includes('ServiceLogin') || text.includes('<!DOCTYPE html>')) {
        return {
          success: false,
          csv: null,
          status: 'Permission Error',
          authMethod: 'None',
          latencyMs,
          errorMessage:
            'Google Sheet requires authorization. Share sheet with Viewer access to "Anyone with the link", or provide Google Service Account/Apps Script.',
        };
      }
    } else if (res.status === 403 || res.status === 401) {
      return {
        success: false,
        csv: null,
        status: 'Permission Error',
        authMethod: 'None',
        latencyMs,
        errorMessage: 'Spreadsheet access restricted (403/401). Configure Google authorization or grant Viewer link access.',
      };
    }
  } catch (err: any) {
    return {
      success: false,
      csv: null,
      status: 'Connection Error',
      authMethod: 'None',
      latencyMs: Date.now() - start,
      errorMessage: err.message || 'Direct network connection to Google Sheets failed.',
    };
  }

  return {
    success: false,
    csv: null,
    status: 'Connection Error',
    authMethod: 'None',
    latencyMs: Date.now() - start,
    errorMessage: 'Unable to connect to Google Sheets with current configuration.',
  };
}
