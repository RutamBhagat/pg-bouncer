import type { InstanceState } from "@/monitoring/HealthMonitorService.js";

import fs from "fs/promises";
import { healthLogger } from "@/logger.js";
import path from "path";

export interface PersistedState {
  version: number;
  timestamp: string;
  states: Record<string, SerializableInstanceState>;
  lastActiveHost: string | null;
}

interface SerializableInstanceState {
  id: string;
  priority: number;
  isHealthy: boolean;
  status: string;
  lastCheckTime: string;
  lastStateChange?: string;
  failedAt?: string;
  recoveredAt?: string;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export class StateStore {
  private readonly stateFilePath: string;
  private readonly version = 1;

  constructor(stateDir: string = "data") {
    this.stateFilePath = path.join(process.cwd(), stateDir, "health-state.json");
  }

  async ensureStateDirectory(): Promise<void> {
    const stateDir = path.dirname(this.stateFilePath);
    try {
      await fs.access(stateDir);
    } catch {
      await fs.mkdir(stateDir, { recursive: true });
      healthLogger.info({ stateDir }, "Created state directory");
    }
  }

  async saveState(states: Map<string, InstanceState>, activeHost: string | null): Promise<void> {
    try {
      await this.ensureStateDirectory();

      const serializedStates: Record<string, SerializableInstanceState> = {};
      
      for (const [id, state] of states) {
        serializedStates[id] = {
          id: state.id,
          priority: state.priority,
          isHealthy: state.isHealthy,
          status: state.status,
          lastCheckTime: state.lastCheckTime.toISOString(),
          lastStateChange: state.lastStateChange?.toISOString(),
          failedAt: state.failedAt?.toISOString(),
          recoveredAt: state.recoveredAt?.toISOString(),
          consecutiveFailures: state.consecutiveFailures,
          consecutiveSuccesses: state.consecutiveSuccesses,
        };
      }

      const persistedState: PersistedState = {
        version: this.version,
        timestamp: new Date().toISOString(),
        states: serializedStates,
        lastActiveHost: activeHost,
      };

      await fs.writeFile(this.stateFilePath, JSON.stringify(persistedState, null, 2));

      healthLogger.debug(
        { 
          stateCount: states.size,
          activeHost,
          filePath: this.stateFilePath 
        },
        "State saved successfully"
      );
    } catch (error) {
      healthLogger.error(
        { 
          error: error instanceof Error ? error.message : "Unknown error",
          filePath: this.stateFilePath 
        },
        "Failed to save state"
      );
    }
  }

  async loadState(): Promise<{
    states: Map<string, InstanceState>;
    lastActiveHost: string | null;
  } | null> {
    try {
      const data = await fs.readFile(this.stateFilePath, "utf-8");
      const persistedState: PersistedState = JSON.parse(data);

      // Check version compatibility
      if (persistedState.version !== this.version) {
        healthLogger.warn(
          { 
            fileVersion: persistedState.version,
            currentVersion: this.version 
          },
          "State file version mismatch, ignoring saved state"
        );
        return null;
      }

      // Deserialize states
      const states = new Map<string, InstanceState>();
      
      for (const [id, serializedState] of Object.entries(persistedState.states)) {
        states.set(id, {
          id: serializedState.id,
          priority: serializedState.priority,
          isHealthy: serializedState.isHealthy,
          status: serializedState.status as any,
          lastCheckTime: new Date(serializedState.lastCheckTime),
          lastStateChange: serializedState.lastStateChange ? new Date(serializedState.lastStateChange) : undefined,
          failedAt: serializedState.failedAt ? new Date(serializedState.failedAt) : undefined,
          recoveredAt: serializedState.recoveredAt ? new Date(serializedState.recoveredAt) : undefined,
          consecutiveFailures: serializedState.consecutiveFailures,
          consecutiveSuccesses: serializedState.consecutiveSuccesses,
        });
      }

      healthLogger.info(
        { 
          stateCount: states.size,
          lastActiveHost: persistedState.lastActiveHost,
          savedAt: persistedState.timestamp
        },
        "State loaded successfully"
      );

      return {
        states,
        lastActiveHost: persistedState.lastActiveHost,
      };
    } catch (error) {
      if ((error as any).code === "ENOENT") {
        healthLogger.info("No existing state file found, starting fresh");
        return null;
      }

      healthLogger.error(
        { 
          error: error instanceof Error ? error.message : "Unknown error",
          filePath: this.stateFilePath 
        },
        "Failed to load state"
      );
      return null;
    }
  }

  async clearState(): Promise<void> {
    try {
      await fs.unlink(this.stateFilePath);
      healthLogger.info("State file cleared");
    } catch (error) {
      if ((error as any).code !== "ENOENT") {
        healthLogger.error(
          { 
            error: error instanceof Error ? error.message : "Unknown error" 
          },
          "Failed to clear state file"
        );
      }
    }
  }

  async getStateFilePath(): Promise<string> {
    return this.stateFilePath;
  }

  async stateExists(): Promise<boolean> {
    try {
      await fs.access(this.stateFilePath);
      return true;
    } catch {
      return false;
    }
  }
}

export const stateStore = new StateStore();