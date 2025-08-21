"use client";

import { Activity, Clock, Play, Server, Square } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePgBouncerMonitor } from "@/hooks/use-pgbouncer-monitor";

export function PgBouncerMonitor() {
  const {
    isMonitoring,
    responses,
    currentPgBouncer,
    error,
    toggleMonitoring,
  } = usePgBouncerMonitor();

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [responses]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
        return "bg-green-500/10 text-green-500 border-green-500/20";
      case "degraded":
        return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      case "unhealthy":
        return "bg-red-500/10 text-red-500 border-red-500/20";
      default:
        return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  const getPriorityLabel = (priority: number) => {
    switch (priority) {
      case 1:
        return "Primary";
      case 2:
        return "Secondary";
      case 3:
        return "Tertiary";
      default:
        return `Priority ${priority}`;
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-7xl mx-auto">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                PgBouncer Monitor
              </CardTitle>
              <Button
                onClick={toggleMonitoring}
                variant={isMonitoring ? "destructive" : "default"}
                size="sm"
                className="flex items-center gap-2"
              >
                {isMonitoring ? (
                  <>
                    <Square className="h-4 w-4" />
                    Stop
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Start
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentPgBouncer ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Current Connection:</span>
                  <Badge className={getStatusColor(currentPgBouncer.status)}>
                    {getPriorityLabel(currentPgBouncer.priority)}
                  </Badge>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Host:</span>
                    <p className="font-mono">{currentPgBouncer.host}:{currentPgBouncer.port}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <p className="capitalize font-medium">{currentPgBouncer.status}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">ID:</span>
                    <p className="font-mono">{currentPgBouncer.id}</p>
                  </div>
                  {currentPgBouncer.responseTime && (
                    <div>
                      <span className="text-muted-foreground">Response:</span>
                      <p>{currentPgBouncer.responseTime}ms</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                {isMonitoring ? "No healthy PgBouncer instances" : "Start monitoring to see connection status"}
              </div>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-500 text-sm">
                <p className="font-medium">Connection Error:</p>
                <p>{error.message}</p>
              </div>
            )}

            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Polling every 500ms when active
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Response Log</span>
            <Badge variant="secondary">
              {responses.length} responses
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 min-h-0">
          <ScrollArea className="h-[400px] w-full">
            <div ref={scrollRef} className="space-y-2">
              {responses.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  {isMonitoring ? "Waiting for responses..." : "Start monitoring to see responses"}
                </div>
              ) : (
                responses.map((response, index) => (
                  <div
                    key={response.requestId}
                    className="bg-muted/30 rounded-lg p-3 text-xs border"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant="outline" className="text-xs">
                        #{index + 1}
                      </Badge>
                      <span className="text-muted-foreground">
                        {new Date(response.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words">
                      {JSON.stringify(response.data, null, 2)}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}