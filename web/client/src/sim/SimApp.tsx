import { useState, useEffect, useCallback } from "react";
import { TopNav } from "./components/TopNav";
import { OnboardingGuide, useOnboarding } from "./components/OnboardingGuide";
import { simApi } from "./api";
import type { SchedulerStatus } from "./types";
import "./SimApp.css";

import { Dashboard } from "./pages/Dashboard";
import { HoldingsPage } from "./pages/HoldingsPage";
import { TradesPage } from "./pages/TradesPage";
import { AgentPage } from "./pages/AgentPage";
import { MarketPage } from "./pages/MarketPage";
import { ResearchPage } from "./pages/ResearchPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { SettingsPage } from "./pages/SettingsPage";

export function SimApp() {
  const [page, setPage] = useState("dashboard");
  const [scheduler, setScheduler] = useState<SchedulerStatus>({ running: false, lastRunAt: null, nextRunAt: null });
  const onboarding = useOnboarding();

  const refreshScheduler = useCallback(async () => {
    try {
      const s = await simApi.getSchedulerStatus();
      setScheduler(s);
    } catch {}
  }, []);

  useEffect(() => {
    refreshScheduler();
    const id = setInterval(refreshScheduler, 10000);
    return () => clearInterval(id);
  }, [refreshScheduler]);

  const toggleScheduler = useCallback(async () => {
    try {
      if (scheduler.running) {
        await simApi.stopScheduler();
      } else {
        await simApi.startScheduler();
      }
      await refreshScheduler();
    } catch {}
  }, [scheduler.running, refreshScheduler]);

  return (
    <div className="sim-root">
      <TopNav page={page.split(":")[0]!} setPage={setPage} schedulerRunning={scheduler.running} onToggleScheduler={toggleScheduler} onOpenGuide={onboarding.open} />
      <div style={{ maxWidth: 1640, margin: "0 auto", padding: "20px 28px" }}>
        {page === "dashboard" && <Dashboard onNavigate={setPage} />}
        {page === "holdings" && <HoldingsPage />}
        {page === "trades" && <TradesPage onNavigate={setPage} />}
        {page.startsWith("agent") && <AgentPage initialDecisionId={page.includes(":") ? parseInt(page.split(":")[1]!) : undefined} onNavigate={setPage} />}
        {page === "market" && <MarketPage />}
        {page.startsWith("research") && <ResearchPage initialReportId={page.includes(":") ? parseInt(page.split(":")[1]!) : undefined} />}
        {page === "knowledge" && <KnowledgePage onNavigate={setPage} />}
        {page.startsWith("settings") && <SettingsPage schedulerStatus={scheduler} onSchedulerChange={refreshScheduler} initialSection={page.includes(":") ? page.split(":")[1] : undefined} />}
      </div>
      <OnboardingGuide open={onboarding.show} onClose={onboarding.close} onNavigate={setPage} />
    </div>
  );
}
