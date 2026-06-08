import { useState, useEffect, useCallback, type CSSProperties, type ReactNode } from "react";
import { Btn } from "./Btn";
import { simApi } from "../api";

const STORAGE_KEY = "lingtrade_onboarding_done";

export function useOnboarding() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setShow(true);
      return;
    }
    Promise.all([
      simApi.getTushare().catch(() => ({ verified: false })),
      simApi.getLlmStatus().catch(() => ({ verified: false })),
    ]).then(([ts, llm]) => {
      if (!(ts as { verified?: boolean }).verified && !(llm as { verified?: boolean }).verified) {
        localStorage.removeItem(STORAGE_KEY);
        setShow(true);
      }
    });
  }, []);

  const open = useCallback(() => setShow(true), []);
  const close = useCallback(() => {
    setShow(false);
    localStorage.setItem(STORAGE_KEY, "1");
  }, []);

  return { show, open, close };
}

interface OnboardingGuideProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (page: string) => void;
}

interface ConfigStatus {
  tushare: boolean;
  llm: boolean;
  loading: boolean;
}

function useConfigStatus(open: boolean): ConfigStatus {
  const [status, setStatus] = useState<ConfigStatus>({ tushare: false, llm: false, loading: true });

  useEffect(() => {
    if (!open) return;
    setStatus(prev => ({ ...prev, loading: true }));
    Promise.all([
      simApi.getTushare().catch(() => ({ verified: false })),
      simApi.getLlmStatus().catch(() => ({ verified: false })),
    ]).then(([ts, llm]) => {
      setStatus({
        tushare: Boolean((ts as { verified?: boolean }).verified),
        llm: Boolean((llm as { verified?: boolean }).verified),
        loading: false,
      });
    });
  }, [open]);

  return status;
}

const STEPS = [
  { id: "welcome", title: "LingTrade" },
  { id: "config", title: "必要配置" },
  { id: "workflow", title: "操作流程" },
  { id: "pages", title: "功能一览" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

export function OnboardingGuide({ open, onClose, onNavigate }: OnboardingGuideProps) {
  const [step, setStep] = useState<StepId>("welcome");
  const config = useConfigStatus(open);

  useEffect(() => {
    if (open) setStep("welcome");
  }, [open]);

  if (!open) return null;

  const idx = STEPS.findIndex(s => s.id === step);
  const isFirst = idx === 0;
  const isLast = idx === STEPS.length - 1;

  const next = () => {
    if (isLast) {
      onClose();
    } else {
      setStep(STEPS[idx + 1]!.id);
    }
  };
  const prev = () => {
    if (!isFirst) setStep(STEPS[idx - 1]!.id);
  };

  const goSettings = () => { onClose(); onNavigate("settings"); };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={e => e.stopPropagation()}>
        {/* Progress bar */}
        <div style={{ display: "flex", gap: 4, padding: "20px 28px 0" }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: i <= idx ? "var(--sim-brand)" : "var(--sim-border)",
              transition: "background 0.2s",
            }} />
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: "24px 28px 20px", minHeight: 380 }}>
          {step === "welcome" && <WelcomeStep />}
          {step === "config" && <ConfigStep config={config} onGoSettings={goSettings} />}
          {step === "workflow" && <WorkflowStep />}
          {step === "pages" && <PagesStep />}
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 28px", borderTop: "1px solid var(--sim-hairline)",
        }}>
          <span style={{ fontSize: 12, color: "var(--sim-text-mute)" }}>
            {idx + 1} / {STEPS.length}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {!isFirst && (
              <Btn kind="ghost" size="sm" onClick={prev}>上一步</Btn>
            )}
            {isFirst && (
              <Btn kind="ghost" size="sm" onClick={onClose}>跳过</Btn>
            )}
            <Btn kind="primary" size="sm" onClick={next}>
              {isLast ? "开始使用" : "下一步"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Steps ----

function WelcomeStep() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", paddingTop: 16 }}>
      <div style={logoBadgeStyle}>
        <svg width="36" height="36" viewBox="0 0 22 22">
          <rect x="0" y="0" width="22" height="22" rx="5" fill="var(--sim-brand)" />
          <path d="M4 14 L8 9 L12 12 L18 5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="18" cy="5" r="1.6" fill="var(--sim-accent)" />
        </svg>
      </div>
      <h2 style={{ margin: "20px 0 8px", fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
        欢迎使用 LingTrade
      </h2>
      <p style={{ margin: 0, fontSize: 14, color: "var(--sim-text-soft)", lineHeight: 1.7, maxWidth: 420 }}>
        A 股投研 + 模拟交易一体化平台。AI Agent 帮你分析个股、生成投研报告、自动执行交易决策。
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 28, width: "100%" }}>
        <FeatureRow icon={<IconDoc />} title="AI 投研报告" desc="基于财报、行情、舆情数据，大模型自动生成深度分析" />
        <FeatureRow icon={<IconBot />} title="Agent 自动决策" desc="结合投研报告与风控规则，自主做出买卖判断" />
        <FeatureRow icon={<IconShield />} title="风控体系" desc="仓位上限、止损线、T+1 限制，全流程风险管控" />
        <FeatureRow icon={<IconChart />} title="模拟交易" desc="百万虚拟资金，实时行情撮合，无风险验证策略" />
      </div>
    </div>
  );
}

function ConfigStep({ config, onGoSettings }: { config: ConfigStatus; onGoSettings: () => void }) {
  const allDone = config.tushare && config.llm;
  return (
    <div>
      <StepHeader
        title="必要配置"
        desc="开始使用前，需要配置并验证以下两项服务。在设置中填入信息后点击「测试连接」通过即为验证成功。"
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 20 }}>
        <ConfigCard
          title="数据源 — Tushare"
          desc="提供 A 股行情、财报、基本面数据。投研报告和 Agent 决策都依赖此数据。"
          done={config.tushare}
          loading={config.loading}
          howto="前往 tushare.pro 注册并获取 Token，在「设置 → 数据源」中填入并点击「测试连接」验证。"
        />
        <ConfigCard
          title="大模型 API"
          desc="驱动投研分析与交易决策的核心。支持 DeepSeek、通义千问、Kimi 等国内外主流模型。"
          done={config.llm}
          loading={config.loading}
          howto="在「设置 → 模型 API」中选择供应商，填入 API Key 并点击「测试调用」验证。然后在「Agent 模型分配」中指定模型。"
        />
      </div>
      {!config.loading && !allDone && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          marginTop: 16, padding: "12px 16px", borderRadius: 10,
          background: "#FFF6E0", border: "1px solid #F0DDA1",
          fontSize: 12.5, color: "#7A5C00", lineHeight: 1.6,
        }}>
          <IconInfo color="#9A6700" />
          <span>
            尚有未验证的配置。请在设置中填入信息后点击「测试连接 / 测试调用」完成验证。
          </span>
        </div>
      )}
      {!config.loading && allDone && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          marginTop: 16, padding: "12px 16px", borderRadius: 10,
          background: "var(--sim-down-soft)", border: "1px solid #C7E3D4",
          fontSize: 12.5, color: "var(--sim-down)", fontWeight: 500, lineHeight: 1.6,
        }}>
          <IconCheck />
          <span>所有配置已验证通过，可以开始使用了！</span>
        </div>
      )}
      {!config.loading && !allDone && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
          <Btn kind="primary" size="sm" onClick={onGoSettings}>
            前往设置
          </Btn>
        </div>
      )}
    </div>
  );
}

function WorkflowStep() {
  return (
    <div>
      <StepHeader
        title="操作流程"
        desc="从添加标的到 Agent 自动交易，只需四步。"
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 0, marginTop: 20 }}>
        <FlowItem step={1} title="添加自选股" desc="在「投研报告」页面点击添加按钮，输入股票代码加入自选。支持 A 股全市场标的。" last={false} />
        <FlowItem step={2} title="生成投研报告" desc="点击「分析」按钮，AI 将自动拉取财报、行情等数据，生成包含多空辩论的深度分析报告。" last={false} />
        <FlowItem step={3} title="Agent 自动决策" desc="在「Agent 决策」页面，点击「立即执行」或启用定时任务。Agent 综合投研报告、持仓状况和风控规则做出买卖判断。" last={false} />
        <FlowItem step={4} title="跟踪收益" desc="在「总览」查看账户净值和今日损益，「持仓」页面查看持仓详情，「交易明细」查看历史成交记录。" last />
      </div>
    </div>
  );
}

function PagesStep() {
  return (
    <div>
      <StepHeader
        title="功能一览"
        desc="各页面对应不同功能模块，点击顶部导航栏随时切换。"
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 20 }}>
        <PageCard icon={<PageIcon d="M3 3h18v18H3zM3 9h18M9 21V9" />} name="总览" desc="账户总资产、净值曲线、今日决策、指数行情一览" />
        <PageCard icon={<PageIcon d="M22 12h-4l-3 9L9 3l-3 9H2" />} name="行情" desc="实时盘口、分时图、K 线图，支持个股快速检索" />
        <PageCard icon={<PageIcon d="M20 21V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v16m16 0H4m16 0h2M4 21H2M8 7h8M8 11h6M8 15h4" />} name="持仓" desc="当前持仓明细、浮动盈亏、仓位占比分析" />
        <PageCard icon={<PageIcon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" />} name="交易明细" desc="历史成交记录、手续费统计、交易流水" />
        <PageCard icon={<PageIcon d="M12 2a4 4 0 0 1 4 4v1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2V6a4 4 0 0 1 4-4zM9 16h.01M15 16h.01M9 12h6" />} name="Agent 决策" desc="查看每次决策的推理过程、风控检查结果和执行状态" />
        <PageCard icon={<PageIcon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" />} name="投研报告" desc="大模型生成的个股深度分析，含估值、风险、多空辩论" />
        <PageCard icon={<PageIcon d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" />} name="知识库" desc="上传研报或文档，提炼要点辅助决策" />
        <PageCard icon={<PageIcon d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />} name="设置" desc="数据源、模型 API、风控参数、定时任务等全局配置" />
      </div>
    </div>
  );
}

// ---- Sub-components ----

function StepHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <>
      <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>{title}</h3>
      <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--sim-text-soft)", lineHeight: 1.6 }}>{desc}</p>
    </>
  );
}

function FeatureRow({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 14,
      padding: "14px 16px", borderRadius: 10,
      background: "var(--sim-surface)", border: "1px solid var(--sim-border)",
      textAlign: "left",
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 9, flexShrink: 0,
        background: "var(--sim-bg-soft)", border: "1px solid var(--sim-border)",
        display: "flex", alignItems: "center", justifyContent: "center", color: "var(--sim-brand)",
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--sim-text-soft)", marginTop: 2, lineHeight: 1.5 }}>{desc}</div>
      </div>
    </div>
  );
}

function ConfigCard({ title, desc, done, loading, howto }: {
  title: string; desc: string; done: boolean; loading: boolean; howto: string;
}) {
  return (
    <div style={{
      padding: "16px 18px", borderRadius: 10,
      background: "var(--sim-surface)", border: `1px solid ${done ? "#C7E3D4" : "var(--sim-border)"}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {loading ? (
          <div style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--sim-bg-soft)" }} />
        ) : done ? (
          <div style={{
            width: 20, height: 20, borderRadius: "50%", background: "var(--sim-down)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        ) : (
          <div style={{
            width: 20, height: 20, borderRadius: "50%",
            border: "2px solid var(--sim-border-strong)", background: "var(--sim-surface)",
          }} />
        )}
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
          {!loading && (
            <span style={{
              marginLeft: 8, fontSize: 11, fontWeight: 600,
              color: done ? "var(--sim-down)" : "#9A6700",
            }}>
              {done ? "已验证" : "未验证"}
            </span>
          )}
        </div>
      </div>
      <p style={{ margin: "8px 0 0 30px", fontSize: 12.5, color: "var(--sim-text-soft)", lineHeight: 1.6 }}>{desc}</p>
      {!done && !loading && (
        <div style={{
          margin: "10px 0 0 30px", padding: "8px 12px", borderRadius: 6,
          background: "var(--sim-bg-soft)", fontSize: 12, color: "var(--sim-text-soft)", lineHeight: 1.6,
        }}>
          {howto}
        </div>
      )}
    </div>
  );
}

function FlowItem({ step, title, desc, last }: { step: number; title: string; desc: string; last: boolean }) {
  return (
    <div style={{ display: "flex", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{
          width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
          background: "var(--sim-brand)", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 700,
        }}>
          {step}
        </div>
        {!last && (
          <div style={{ width: 2, flex: 1, background: "var(--sim-border)", margin: "4px 0" }} />
        )}
      </div>
      <div style={{ paddingBottom: last ? 0 : 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--sim-text-soft)", marginTop: 4, lineHeight: 1.6 }}>{desc}</div>
      </div>
    </div>
  );
}

function PageIcon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function PageCard({ icon, name, desc }: { icon: ReactNode; name: string; desc: string }) {
  return (
    <div style={{
      padding: "12px 14px", borderRadius: 8,
      background: "var(--sim-surface)", border: "1px solid var(--sim-border)",
      display: "flex", alignItems: "flex-start", gap: 10,
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: 7, flexShrink: 0,
        background: "var(--sim-bg-soft)", border: "1px solid var(--sim-border)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--sim-brand)",
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 11.5, color: "var(--sim-text-soft)", marginTop: 2, lineHeight: 1.5 }}>{desc}</div>
      </div>
    </div>
  );
}

// ---- Icons ----

function IconDoc() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function IconBot() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4M8 16h.01M16 16h.01" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function IconInfo({ color = "currentColor" }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

// ---- Styles ----

const overlayStyle: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000,
  background: "rgba(20, 17, 13, 0.5)",
  backdropFilter: "blur(4px)",
  display: "flex", alignItems: "center", justifyContent: "center",
  animation: "sim-fade-in 0.15s ease-out",
};

const dialogStyle: CSSProperties = {
  width: 560, maxWidth: "92vw", maxHeight: "90vh",
  background: "var(--sim-bg)",
  borderRadius: 16,
  boxShadow: "0 24px 64px -16px rgba(20,17,13,0.25), 0 4px 16px rgba(20,17,13,0.10)",
  display: "flex", flexDirection: "column",
  overflow: "hidden",
  overflowY: "auto",
};

const logoBadgeStyle: CSSProperties = {
  width: 64, height: 64, borderRadius: 16,
  background: "var(--sim-bg-soft)", border: "1px solid var(--sim-border)",
  display: "flex", alignItems: "center", justifyContent: "center",
};
