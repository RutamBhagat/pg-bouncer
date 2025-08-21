"use client";

import { useCallback, useState } from "react";

import { useQuery } from "@tanstack/react-query";

interface HostHealth {
  id: string;
  healthy: boolean;
  host: string;
  port: number;
  priority: number;
  error?: string | null;
}

interface HealthResponse {
  status: "healthy" | "unhealthy";
  timestamp: string;
  checkDurationMs: number;
  currentActiveHost: string | null;
  summary: {
    healthy: number;
    total: number;
    percentage: number;
  };
  hosts: HostHealth[];
}

export interface MonitoringResponse {
  data: HealthResponse;
  timestamp: string;
  requestId: string;
}

export function usePgBouncerMonitor() {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [responses, setResponses] = useState<MonitoringResponse[]>([]);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["pgbouncer-health"],
    queryFn: async () => {
      const response = await fetch(
        "http://localhost:3000/monitoring/health/detailed"
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: HealthResponse = await response.json();
      return data;
    },
    refetchInterval: isMonitoring ? 500 : false,
    enabled: isMonitoring,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const addResponse = useCallback((responseData: HealthResponse) => {
    const newResponse: MonitoringResponse = {
      data: responseData,
      timestamp: new Date().toISOString(),
      requestId: Math.random().toString(36).substring(7),
    };

    setResponses((prev) => [...prev, newResponse]);
  }, []);

  if (data && isMonitoring) {
    const lastResponse = responses[responses.length - 1];
    if (!lastResponse || lastResponse.data.timestamp !== data.timestamp) {
      addResponse(data);
    }
  }

  const startMonitoring = useCallback(() => {
    setIsMonitoring(true);
    setResponses([]);
  }, []);

  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false);
  }, []);

  const toggleMonitoring = useCallback(() => {
    if (isMonitoring) {
      stopMonitoring();
    } else {
      startMonitoring();
    }
  }, [isMonitoring, startMonitoring, stopMonitoring]);

  const getCurrentPgBouncer = () => {
    if (!data?.hosts || !data.currentActiveHost) return null;

    return (
      data.hosts.find((host) => host.id === data.currentActiveHost) || null
    );
  };

  const getFormattedHostsStatus = () => {
    if (!data?.hosts) return "No data available";

    const sortedHosts = [...data.hosts].sort((a, b) => a.priority - b.priority);

    return sortedHosts
      .map((host) => {
        const priorityName =
          host.priority === 1
            ? "primary"
            : host.priority === 2
            ? "secondary"
            : host.priority === 3
            ? "tertiary"
            : `priority-${host.priority}`;
        const status = host.healthy ? "healthy" : "unhealthy";
        return `${priorityName}:${status}`;
      })
      .join(" ");
  };

  return {
    isMonitoring,
    responses,
    data,
    error,
    isLoading,

    toggleMonitoring,
    startMonitoring,
    stopMonitoring,
    refetch,

    currentPgBouncer: getCurrentPgBouncer(),
    formattedHostsStatus: getFormattedHostsStatus(),
  };
}
