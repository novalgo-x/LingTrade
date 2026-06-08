import { useEffect, useRef, useState } from "react";

export interface LogEntry {
  timestamp: string;
  message: string;
}

export interface SSEState {
  logs: LogEntry[];
  status: "connecting" | "streaming" | "completed" | "error";
  reportId: number | null;
  errorMessage: string | null;
}

export function useSSE(taskId: number | null): SSEState {
  const [state, setState] = useState<SSEState>({
    logs: [],
    status: "connecting",
    reportId: null,
    errorMessage: null,
  });
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (taskId === null) {
      setState({ logs: [], status: "connecting", reportId: null, errorMessage: null });
      return;
    }

    const es = new EventSource(`/api/tasks/${taskId}/logs`);
    eventSourceRef.current = es;

    es.addEventListener("log", (e) => {
      const data = JSON.parse(e.data) as LogEntry;
      setState((prev) => ({
        ...prev,
        status: "streaming",
        logs: [...prev.logs, data],
      }));
    });

    es.addEventListener("status", (e) => {
      const data = JSON.parse(e.data) as { status: string; reportId: number | null };
      setState((prev) => ({
        ...prev,
        status: "completed",
        reportId: data.reportId,
      }));
      es.close();
    });

    es.addEventListener("error", (e) => {
      if (e instanceof MessageEvent) {
        const data = JSON.parse(e.data) as { message: string };
        setState((prev) => ({
          ...prev,
          status: "error",
          errorMessage: data.message,
        }));
      } else {
        setState((prev) => ({ ...prev, status: "error", errorMessage: "Connection lost" }));
      }
      es.close();
    });

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [taskId]);

  return state;
}
