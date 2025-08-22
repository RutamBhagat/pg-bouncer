import { Button } from "@/components/ui/button";
import JSONPretty from "react-json-pretty";
import Link from "next/link";
import React from "react";
import { usePgBouncerMonitor } from "@/hooks/use-pgbouncer-monitor";

export default function HeroSection() {
  const {
    currentPgBouncer,
    responses,
    data,
    isMonitoring,
    toggleMonitoring,
  } = usePgBouncerMonitor();

  const getCurrentInstanceName = () => {
    if (!currentPgBouncer) return "No Active Connection";

    const priorityName =
      currentPgBouncer.priority === 1
        ? "Primary"
        : currentPgBouncer.priority === 2
        ? "Secondary"
        : currentPgBouncer.priority === 3
        ? "Tertiary"
        : `Priority ${currentPgBouncer.priority}`;
    return `Connected to ${priorityName} PgBouncer`;
  };

  const latestResponse = responses[responses.length - 1];

  return (
    <>
      <main className="overflow-x-hidden">
        <section>
          <div className="pb-24 pt-12 md:pb-32 lg:pb-56 lg:pt-44">
            <div className="relative min-h-screen mx-auto flex max-w-6xl flex-col px-6 lg:block">
              <div className="mx-auto max-w-lg text-center lg:ml-0 lg:w-1/2 lg:text-left">
                <h1 className="mt-8 max-w-2xl text-balance text-5xl font-medium md:text-6xl lg:mt-16 xl:text-7xl">
                  {getCurrentInstanceName()}
                </h1>
                <div className="mt-8 max-w-2xl">
                  <div className="flex flex-wrap gap-3 justify-center lg:justify-start">
                    {data?.hosts?.sort((a, b) => a.priority - b.priority).map((host) => {
                      const priorityName = host.priority === 1 ? "Primary" : 
                                          host.priority === 2 ? "Secondary" : 
                                          host.priority === 3 ? "Tertiary" : 
                                          `Priority ${host.priority}`;
                      const isActive = data.currentActiveHost === host.id;
                      return (
                        <div
                          key={host.id}
                          className={`px-3 py-1 rounded-full text-sm font-medium border transition-all ${
                            host.healthy
                              ? isActive
                                ? "bg-green-500/20 text-green-400 border-green-500/30 ring-2 ring-green-500/50"
                                : "bg-green-500/10 text-green-400 border-green-500/20"
                              : "bg-red-500/10 text-red-400 border-red-500/20"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-2 h-2 rounded-full ${
                                host.healthy ? "bg-green-400" : "bg-red-400"
                              }`}
                            />
                            {priorityName}
                            {isActive && <span className="text-xs">(Active)</span>}
                          </div>
                        </div>
                      );
                    }) || (
                      <div className="text-muted-foreground">Loading status...</div>
                    )}
                  </div>
                </div>

                <div className="mt-12 flex flex-col items-center justify-center gap-2 sm:flex-row lg:justify-start">
                  <Button
                    onClick={toggleMonitoring}
                    size="lg"
                    className="px-5 text-base"
                    variant={isMonitoring ? "destructive" : "default"}
                  >
                    <span className="text-nowrap">
                      {isMonitoring ? "Stop Monitoring" : "Start Monitoring"}
                    </span>
                  </Button>
                  <Button
                    key={2}
                    asChild
                    size="lg"
                    variant="ghost"
                    className="px-5 text-base"
                  >
                    <Link href="http://localhost:3002">
                      <span className="text-nowrap">View Grafana</span>
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Right side - Latest JSON Response */}
              <div className="mx-auto mt-12 lg:mt-0 max-w-lg lg:absolute lg:right-0 lg:top-0 lg:w-1/2 lg:max-w-none">
                <div className="bg-card/50 border rounded-xl p-6 backdrop-blur-sm">
                  <h3 className="text-lg font-semibold mb-4">
                    Latest Response
                  </h3>
                  {latestResponse ? (
                    <div className="bg-background/50 rounded-lg p-4 text-xs overflow-auto">
                      <JSONPretty
                        data={latestResponse.data}
                        theme={{
                          main: "line-height:1.3;color:hsl(var(--foreground));background:transparent;overflow:auto;",
                          error:
                            "line-height:1.3;color:hsl(var(--destructive));background:transparent;overflow:auto;",
                          key: "color:hsl(var(--primary));",
                          string: "color:hsl(var(--muted-foreground));",
                          value: "color:hsl(var(--foreground));",
                          boolean: "color:hsl(var(--accent-foreground));",
                        }}
                      />
                    </div>
                  ) : (
                    <div className="text-center text-muted-foreground py-8">
                      {isMonitoring
                        ? "Waiting for response..."
                        : "Start monitoring to see responses"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
