import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AuthSession,
  AuthStatusResponse,
  ConnectedStation,
  HotelState,
  NetworkInfo,
  WorkstationRole,
} from '../types';

export interface ToastNotice {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

export function useHotelStore() {
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  // Bearer session held strictly in React memory (never localStorage/sessionStorage)
  const [session, setSession] = useState<AuthSession | null>(null);
  const [state, setState] = useState<HotelState | null>(null);
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [stationRole, setStationRoleState] = useState<WorkstationRole>('Front Desk');
  const [stationName, setStationNameState] = useState<string>('Front Desk Terminal');
  const [notice, setNotice] = useState<ToastNotice | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const roleRef = useRef<WorkstationRole>(stationRole);
  const nameRef = useRef<string>(stationName);
  const tokenRef = useRef<string | null>(session?.token ?? null);
  const noticeTimerRef = useRef<number | null>(null);

  roleRef.current = stationRole;
  nameRef.current = stationName;
  tokenRef.current = session?.token ?? null;

  const showNotice = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    setNotice({ id: Date.now(), message, kind });
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
    }, 3600);
  }, []);

  const fetchAuthStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status');
      if (!res.ok) throw new Error('Unable to reach local Hosila PMS server');
      const data = (await res.json()) as AuthStatusResponse;
      setAuthStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuthStatus();
  }, [fetchAuthStatus]);

  const fetchBootstrap = useCallback(async (tokenOverride?: string) => {
    const token = tokenOverride ?? tokenRef.current;
    if (!token) return;
    try {
      const res = await fetch('/api/bootstrap', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        setSession(null);
        setState(null);
        return;
      }
      if (!res.ok) throw new Error('Unable to reach local Hosila PMS server');
      const data = (await res.json()) as { state: HotelState; network: NetworkInfo };
      setState(data.state);
      setNetwork(data.network);
      setLastSyncAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    }
  }, []);

  const sendStationIdentity = useCallback((role: WorkstationRole, name: string, token?: string | null) => {
    const ws = wsRef.current;
    const activeToken = token ?? tokenRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && activeToken) {
      ws.send(
        JSON.stringify({
          type: 'station:identify',
          payload: { role, stationName: name, token: activeToken },
        })
      );
    }
  }, []);

  const setStationIdentity = useCallback(
    (role: WorkstationRole, name?: string) => {
      const nextName =
        name ??
        (role === 'Front Desk'
          ? 'Front Desk Terminal'
          : role === 'Restaurant POS'
            ? 'Restaurant POS Counter'
            : 'Management Office PC');
      setStationRoleState(role);
      setStationNameState(nextName);
      sendStationIdentity(role, nextName);
    },
    [sendStationIdentity]
  );

  // Manage WebSocket when authenticated
  useEffect(() => {
    if (!session) {
      wsRef.current?.close();
      wsRef.current = null;
      setWsConnected(false);
      return;
    }

    fetchBootstrap(session.token);

    let cancelled = false;
    let attempt = 0;

    function connect() {
      if (cancelled || !tokenRef.current) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setWsConnected(true);
        ws.send(
          JSON.stringify({
            type: 'station:identify',
            payload: { role: roleRef.current, stationName: nameRef.current, token: tokenRef.current },
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            type: string;
            payload?: {
              state?: HotelState;
              network?: NetworkInfo;
              connectedStations?: ConnectedStation[];
            };
            timestamp?: string;
          };

          if ((msg.type === 'state:init' || msg.type === 'state:sync') && msg.payload?.state) {
            setState(msg.payload.state);
            if (msg.payload.network) setNetwork(msg.payload.network);
            setLastSyncAt(msg.timestamp ?? new Date().toISOString());
          } else if (msg.type === 'presence:update' && msg.payload?.connectedStations) {
            setNetwork((prev) =>
              prev ? { ...prev, connectedStations: msg.payload!.connectedStations! } : prev
            );
          }
        } catch {
          // Ignore malformed message
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!cancelled && tokenRef.current) {
          const delay = Math.min(1000 * 2 ** attempt, 8000);
          attempt += 1;
          reconnectTimerRef.current = window.setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [session, fetchBootstrap]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    const token = tokenRef.current;
    const headers = new Headers(init?.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(url, { ...init, headers });
    if (res.status === 401) {
      setSession(null);
      setState(null);
      fetchAuthStatus();
    }
    return res;
  }, [fetchAuthStatus]);

  const mutate = useCallback(
    async <T = unknown>(
      url: string,
      method: 'POST' | 'PATCH' | 'DELETE',
      body?: Record<string, unknown>,
      successMessage?: string
    ): Promise<T | null> => {
      try {
        const res = await authFetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify({ ...body, station: nameRef.current }) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errMsg = typeof data?.error === 'string' ? data.error : 'Request failed';
          showNotice(errMsg, 'error');
          return null;
        }
        if (successMessage) showNotice(successMessage, 'info');
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          await fetchBootstrap();
        }
        return data as T;
      } catch {
        showNotice('Could not reach local LAN server', 'error');
        return null;
      }
    },
    [authFetch, fetchBootstrap, showNotice]
  );

  const setupInitialAdmin = useCallback(
    async (payload: {
      hotel_name?: string;
      hotel_tagline?: string;
      hotel_address?: string;
      hotel_phone?: string;
      hotel_email?: string;
      hotel_website?: string;
      hotel_logo_url?: string;
      check_in_time?: string;
      check_out_time?: string;
      currency_symbol?: string;
      tax_id?: string;
      tax_enabled?: boolean;
      tax_name?: string;
      tax_rate?: number;
      tax_mode?: 'exclusive' | 'inclusive';
      tax_applies_to?: 'accommodation' | 'restaurant' | 'both';
      full_name: string;
      username: string;
      password: string;
      create_team_profiles: boolean;
      team_password: string;
    }): Promise<string | null> => {
      try {
        const res = await fetch('/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return data?.error ?? 'Setup failed';
        setStationRoleState('Management Office');
        setStationNameState('Management Office PC');
        setSession(data.session as AuthSession);
        await fetchAuthStatus();
        return null;
      } catch {
        return 'Unable to reach local server';
      }
    },
    [fetchAuthStatus]
  );

  const login = useCallback(
    async (payload: { username: string; password: string; opening_cash: number }): Promise<string | null> => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            station_name: nameRef.current,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return data?.error ?? 'Sign-in failed';
        const loggedIn = data.session as AuthSession;
        const defaultRole: WorkstationRole =
          loggedIn.role === 'restaurant'
            ? 'Restaurant POS'
            : loggedIn.role === 'management' || loggedIn.role === 'accountant'
              ? 'Management Office'
              : 'Front Desk';
        setStationRoleState(defaultRole);
        setStationNameState(
          defaultRole === 'Front Desk'
            ? 'Front Desk Terminal'
            : defaultRole === 'Restaurant POS'
              ? 'Restaurant POS Counter'
              : 'Management Office PC'
        );
        setSession(loggedIn);
        return null;
      } catch {
        return 'Unable to reach local server';
      }
    },
    []
  );

  const logout = useCallback(async () => {
    if (tokenRef.current) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      }).catch(() => {});
    }
    setSession(null);
    setState(null);
    await fetchAuthStatus();
    showNotice('Signed out cleanly');
  }, [fetchAuthStatus, showNotice]);

  const closeShift = useCallback(
    async (closingCash: number, notes: string): Promise<boolean> => {
      const ok = await mutate('/api/auth/close-shift', 'POST', {
        closing_cash: closingCash,
        notes,
      });
      if (!ok) return false;
      setSession(null);
      setState(null);
      await fetchAuthStatus();
      showNotice('Shift closed and logged');
      return true;
    },
    [mutate, fetchAuthStatus, showNotice]
  );

  const activateLicense = useCallback(
    async (licenseKey: string): Promise<string | null> => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (tokenRef.current) headers.Authorization = `Bearer ${tokenRef.current}`;
        const res = await fetch('/api/license/activate', {
          method: 'POST',
          headers,
          body: JSON.stringify({ license_key: licenseKey }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return typeof data?.error === 'string' ? data.error : 'Activation failed';
        }
        await fetchAuthStatus();
        showNotice('Hosila PMS license activated');
        return null;
      } catch {
        return 'Unable to reach local Hosila PMS server';
      }
    },
    [fetchAuthStatus, showNotice]
  );

  const startTrial = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/license/trial', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return typeof data?.error === 'string' ? data.error : 'Could not start trial';
      }
      await fetchAuthStatus();
      showNotice('14-day evaluation trial started');
      return null;
    } catch {
      return 'Unable to reach local Hosila PMS server';
    }
  }, [fetchAuthStatus, showNotice]);

  return {
    authStatus,
    session,
    state,
    network,
    loading,
    error,
    wsConnected,
    lastSyncAt,
    stationRole,
    stationName,
    setStationIdentity,
    notice,
    showNotice,
    authFetch,
    mutate,
    setupInitialAdmin,
    login,
    logout,
    closeShift,
    activateLicense,
    startTrial,
    refresh: () => {
      fetchAuthStatus();
      fetchBootstrap();
    },
  };
}
