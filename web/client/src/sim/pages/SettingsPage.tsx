import { Fragment, useState, useEffect, useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { Card } from "../components/Card";
import { Tag } from "../components/Tag";
import { Btn } from "../components/Btn";
import { simApi } from "../api";
import { TRADING_STYLE_PRESETS } from "../tradingStyles";
import { pickDefaultChatModel } from "../llmModels";

// ---- LLM 供应商目录 ----
const LLM_PROVIDERS = [
  { id: "deepseek", name: "DeepSeek", short: "深度求索", region: "国内" as const, color: "#4F46E5", baseUrl: "https://api.deepseek.com/v1", keyHint: "sk-..." },
  { id: "qwen", name: "阿里云百炼", short: "通义千问", region: "国内" as const, color: "#6B21A8", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", keyHint: "sk-..." },
  { id: "zhipu", name: "智谱 AI", short: "GLM", region: "国内" as const, color: "#0E7490", baseUrl: "https://open.bigmodel.cn/api/paas/v4", keyHint: "..." },
  { id: "moonshot", name: "月之暗面", short: "Kimi", region: "国内" as const, color: "#14110D", baseUrl: "https://api.moonshot.cn/v1", keyHint: "sk-..." },
  { id: "minimax", name: "MiniMax", short: "海螺", region: "国内" as const, color: "#B91C2C", baseUrl: "https://api.minimax.chat/v1", keyHint: "..." },
  { id: "baichuan", name: "百川智能", short: "Baichuan", region: "国内" as const, color: "#9A3412", baseUrl: "https://api.baichuan-ai.com/v1", keyHint: "sk-..." },
  { id: "anthropic", name: "Anthropic", short: "Claude", region: "海外" as const, color: "#C2410C", baseUrl: "https://api.anthropic.com/v1", keyHint: "sk-ant-..." },
  { id: "openai", name: "OpenAI", short: "GPT", region: "海外" as const, color: "#1F8A5B", baseUrl: "https://api.openai.com/v1", keyHint: "sk-..." },
  { id: "google", name: "Google", short: "Gemini", region: "海外" as const, color: "#1B4F8C", baseUrl: "https://generativelanguage.googleapis.com/v1", keyHint: "AIza..." },
  { id: "custom", name: "自定义 / 兼容 OpenAI", short: "Custom", region: "自建" as const, color: "#5A554D", baseUrl: "https://your-endpoint/v1", keyHint: "兼容 OpenAI 协议的任意端点" },
];

const AGENT_ROLES = [
  { id: "research", name: "投研分析", desc: "生成与更新投研报告，需强推理能力", icon: "doc" as const },
  { id: "decision", name: "交易决策", desc: "仓位管理 / 买卖 / 风控，低延迟优先", icon: "bolt" as const },
  { id: "summary",  name: "知识库总结", desc: "解析上传文件、提炼要点，性价比优先", icon: "layers" as const },
];

type IconName = "database" | "cpu" | "bot" | "shield" | "doc" | "user" | "bolt" | "layers" | "clock";

interface ProviderCfg { key: string; baseUrl: string; enabled: boolean }
interface RoleModelCfg { provider: string; model: string }

// ---- 主页面 ----
interface SettingsPageProps {
  schedulerStatus?: { running: boolean; lastRunAt: string | null; nextRunAt: string | null };
  onSchedulerChange?: () => void;
  initialSection?: string;
}

export function SettingsPage({ schedulerStatus, onSchedulerChange, initialSection }: SettingsPageProps = {}) {
  const [section, setSection] = useState(initialSection ?? "data");
  const [tushareToken, setTushareToken] = useState("");
  const [tushareUrl, setTushareUrl] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [xqCookie, setXqCookie] = useState("");

  const [providerCfg, setProviderCfg] = useState<Record<string, ProviderCfg>>(() => {
    const init: Record<string, ProviderCfg> = {};
    LLM_PROVIDERS.forEach(p => {
      init[p.id] = { key: "", baseUrl: p.baseUrl, enabled: false };
    });
    return init;
  });

  const [roleModel, setRoleModel] = useState<Record<string, RoleModelCfg>>({
    research: { provider: "", model: "" },
    decision: { provider: "", model: "" },
    summary:  { provider: "", model: "" },
  });

  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
  const [providerBlocked, setProviderBlocked] = useState<Record<string, string[]>>({});

  useEffect(() => {
    simApi.getTushare().then(ts => {
      if (ts.rawToken) setTushareToken(ts.rawToken);
      if (ts.baseUrl) setTushareUrl(ts.baseUrl);
    }).catch(() => {});
    simApi.getXueqiu().then(xq => {
      if (xq.cookie) setXqCookie(xq.cookie);
    }).catch(() => {});

    simApi.getConfig().then(cfg => {
      setConfig(cfg);
      LLM_PROVIDERS.forEach(p => {
        const key = cfg[`llm.${p.id}.key`];
        const baseUrl = cfg[`llm.${p.id}.baseUrl`];
        const enabled = cfg[`llm.${p.id}.enabled`];
        if (key || baseUrl || enabled !== undefined) {
          setProviderCfg(prev => ({
            ...prev,
            [p.id]: {
              key: key ? String(key) : prev[p.id]!.key,
              baseUrl: baseUrl ? String(baseUrl) : prev[p.id]!.baseUrl,
              enabled: enabled !== undefined ? Boolean(enabled) : prev[p.id]!.enabled,
            },
          }));
        }
        const models = cfg[`llm.${p.id}.models`];
        if (Array.isArray(models) && models.length > 0) {
          setProviderModels(prev => ({ ...prev, [p.id]: models as string[] }));
        }
        const blocked = cfg[`llm.${p.id}.blockedModels`];
        if (Array.isArray(blocked) && blocked.length > 0) {
          setProviderBlocked(prev => ({ ...prev, [p.id]: blocked as string[] }));
        }
      });
      AGENT_ROLES.forEach(r => {
        const provider = cfg[`agent.${r.id}.provider`];
        const model = cfg[`agent.${r.id}.model`];
        if (provider || model) {
          setRoleModel(prev => ({
            ...prev,
            [r.id]: {
              provider: provider ? String(provider) : prev[r.id]!.provider,
              model: model ? String(model) : prev[r.id]!.model,
            },
          }));
        }
      });
    }).catch(() => {});
  }, []);

  const sections = [
    { id: "data",     label: "数据源",         icon: "database" as IconName },
    { id: "models",   label: "模型 API",       icon: "cpu" as IconName },
    { id: "agent",    label: "Agent 模型分配", icon: "bot" as IconName },
    { id: "trading",  label: "交易与风控",     icon: "shield" as IconName },
    { id: "scheduler", label: "定时任务",       icon: "clock" as IconName },
    { id: "account",  label: "账户",           icon: "user" as IconName },
  ];

  return (
    <>
    <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16, alignItems: "flex-start" }}>
      {/* 左侧分区导航 */}
      <Card padded={false} style={{ position: "sticky", top: 80 }}>
        <div style={{ padding: "14px 16px 8px", borderBottom: "1px solid var(--sim-hairline)" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>设置</div>
          <div style={{ fontSize: 11, color: "var(--sim-text-mute)", marginTop: 2 }}>平台与 Agent 配置</div>
        </div>
        <div style={{ padding: "8px 8px 12px" }}>
          {sections.map(s => {
            const active = s.id === section;
            return (
              <button key={s.id} onClick={() => setSection(s.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  border: "none", textAlign: "left" as const,
                  padding: "9px 10px", borderRadius: 7,
                  background: active ? "var(--sim-bg-soft)" : "transparent",
                  color: active ? "var(--sim-brand)" : "var(--sim-text-soft)",
                  fontSize: 13, fontWeight: active ? 600 : 500,
                  cursor: "pointer", fontFamily: "inherit",
                  borderLeft: active ? "2px solid var(--sim-brand)" : "2px solid transparent",
                }}>
                <SetIcon name={s.icon} />
                {s.label}
              </button>
            );
          })}
        </div>
      </Card>

      {/* 右侧内容 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {section === "data" && (
          <DataSourceSection token={tushareToken} setToken={setTushareToken} showToken={showToken} setShowToken={setShowToken} tushareUrl={tushareUrl} setTushareUrl={setTushareUrl} xqCookie={xqCookie} setXqCookie={setXqCookie} />
        )}
        {section === "models" && (
          <ModelsSection providerCfg={providerCfg} setProviderCfg={setProviderCfg} providerModels={providerModels} setProviderModels={setProviderModels} providerBlocked={providerBlocked} setProviderBlocked={setProviderBlocked} />
        )}
        {section === "agent" && (
          <AgentModelSection roleModel={roleModel} setRoleModel={setRoleModel} providerCfg={providerCfg} providerModels={providerModels} />
        )}
        {section === "trading" && <TradingSection config={config} setConfig={setConfig} />}
        {section === "scheduler" && <SchedulerSection config={config} setConfig={setConfig} schedulerStatus={schedulerStatus} onSchedulerChange={onSchedulerChange} />}
        {section === "account" && <AccountSection />}
      </div>
    </div>
    </>
  );
}

// ---- Icons ----
function SetIcon({ name, size = 15, color = "currentColor" }: { name: IconName; size?: number; color?: string }) {
  const paths: Record<IconName, ReactNode> = {
    database: <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></>,
    cpu: <><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" /></>,
    bot: <><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4M8 16h.01M16 16h.01" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></>,
    doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
    user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
    bolt: <><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></>,
    layers: <><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>,
    clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

// ---- 通用小组件 ----
function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{ paddingBottom: 2 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>{title}</h2>
      <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--sim-text-soft)", lineHeight: 1.6, maxWidth: 720 }}>{desc}</p>
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--sim-text)" }}>{label}</span>
        {required && <span style={{ fontSize: 11, color: "var(--sim-up)" }}>*</span>}
        {hint && <span style={{ fontSize: 11, color: "var(--sim-text-mute)" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: "100%", padding: "9px 12px",
  border: "1px solid var(--sim-border-strong)", borderRadius: 8,
  background: "var(--sim-surface)", fontSize: 13, color: "var(--sim-text)",
  fontFamily: "var(--sim-mono)", outline: "none",
};

function TextInput({ value, onChange, placeholder, type = "text", mono = true, suffix }: {
  value: string; onChange?: (v: string) => void; placeholder?: string; type?: string; mono?: boolean; suffix?: ReactNode;
}) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <input
        type={type} value={value} onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder}
        style={{ ...inputStyle, fontFamily: mono ? "var(--sim-mono)" : "var(--sim-sans)", paddingRight: suffix ? 80 : 12 }}
      />
      {suffix && <div style={{ position: "absolute", right: 8 }}>{suffix}</div>}
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600,
      background: ok ? "var(--sim-down-soft)" : "#FFF6E0",
      color: ok ? "var(--sim-down)" : "#9A6700",
      border: "1px solid " + (ok ? "#C7E3D4" : "#F0DDA1"),
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: ok ? "var(--sim-down)" : "#9A6700" }} />
      {label}
    </span>
  );
}

function InfoStat({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div style={{ padding: "12px 14px", background: "var(--sim-bg-soft)", borderRadius: 8 }}>
      <div style={{ fontSize: 10.5, color: "var(--sim-text-mute)", letterSpacing: "0.04em", textTransform: "uppercase" as const }}>{label}</div>
      <div className={`num ${cls || ""}`} style={{ fontSize: 17, fontWeight: 600, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--sim-text-mute)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function ToggleSwitch({ on, onClick }: { on: boolean; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <button onClick={onClick}
      style={{
        width: 38, height: 22, borderRadius: 999, border: "none", padding: 2,
        background: on ? "var(--sim-brand)" : "var(--sim-border-strong)",
        cursor: "pointer", flexShrink: 0, transition: "background 0.15s",
        display: "flex", justifyContent: on ? "flex-end" : "flex-start", alignItems: "center",
      }}>
      <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
    </button>
  );
}

function SelectBox({ value, onChange, options, width = "auto", mono = false }: {
  value: string; onChange?: (v: string) => void; options: { value: string; label: string }[]; width?: number | string; mono?: boolean;
}) {
  return (
    <div style={{ position: "relative", width }}>
      <select value={value} onChange={e => onChange?.(e.target.value)}
        style={{
          width: "100%", appearance: "none", WebkitAppearance: "none" as CSSProperties["WebkitAppearance"],
          padding: "9px 32px 9px 12px",
          border: "1px solid var(--sim-border-strong)", borderRadius: 8,
          background: "var(--sim-surface)", fontSize: 13, color: "var(--sim-text)",
          fontFamily: mono ? "var(--sim-mono)" : "var(--sim-sans)", cursor: "pointer", outline: "none",
        }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--sim-text-mute)" strokeWidth="2"
        style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" as const }}>
        <polyline points="6 9 12 15 18 9" /></svg>
    </div>
  );
}

function SegRadio({ value: initial, options, onChange }: {
  value: string; options: { value: string; label: string }[]; onChange?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div style={{ display: "inline-flex", gap: 2, padding: 2, background: "var(--sim-bg-soft)", borderRadius: 8, border: "1px solid var(--sim-border)" }}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button key={o.value} onClick={() => { setValue(o.value); onChange?.(o.value); }}
            style={{
              border: "none", background: active ? "var(--sim-surface)" : "transparent",
              color: active ? "var(--sim-text)" : "var(--sim-text-soft)",
              padding: "6px 16px", fontSize: 13, fontWeight: active ? 600 : 500,
              borderRadius: 6, cursor: "pointer",
              boxShadow: active ? "0 1px 2px rgba(20,17,13,0.05)" : "none",
              fontFamily: "inherit",
            }}>{o.label}</button>
        );
      })}
    </div>
  );
}

function HelpTip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--sim-text-mute)" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" style={{ cursor: "help" }}>
        <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      {show && (
        <span style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
          background: "var(--sim-text)", color: "var(--sim-bg)", fontSize: 11, lineHeight: 1.5,
          padding: "6px 10px", borderRadius: 6, whiteSpace: "nowrap", zIndex: 100,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)", pointerEvents: "none",
        }}>{text}</span>
      )}
    </span>
  );
}

const miniBtnStyle: CSSProperties = {
  border: "1px solid var(--sim-border)", background: "var(--sim-bg-soft)",
  borderRadius: 6, padding: "3px 8px", fontSize: 11, color: "var(--sim-text-soft)",
  cursor: "pointer", fontFamily: "var(--sim-sans)",
};

// ============================================================
// 数据源
// ============================================================
type TestResult = { ok: boolean; latency?: number; error?: string; mode?: string; model?: string; tried?: number; removed?: number } | null;

function XueqiuCard({ cookie, setCookie }: { cookie: string; setCookie: (v: string) => void }) {
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showCookie, setShowCookie] = useState(false);

  const handleTest = useCallback(async () => {
    setTesting(true); setTestResult(null); setSaveMsg(null);
    try {
      const r = await simApi.testXueqiu(cookie.trim() || undefined);
      setTestResult(r);
    } catch (e) {
      const msg = e instanceof DOMException && e.name === "TimeoutError" ? "请求超时，请检查网络连接" : "请求失败";
      setTestResult({ ok: false, error: msg });
    } finally {
      setTesting(false);
    }
  }, [cookie]);

  const handleSave = useCallback(async () => {
    setSaving(true); setSaveMsg(null);
    try {
      await simApi.saveXueqiu(cookie.trim());
      setSaveMsg({ ok: true, text: cookie.trim() ? "已保存自定义 Cookie" : "已清除，将使用自动获取" });
    } catch {
      setSaveMsg({ ok: false, text: "保存失败" });
    } finally {
      setSaving(false);
    }
  }, [cookie]);

  const connected = testResult?.ok === true;

  return (
    <Card title="雪球" subtitle="实时行情 / 盘口 / 分时 / K线数据源"
      action={testResult !== null ? <StatusPill ok={connected} label={connected ? "已连接" : "连接失败"} /> : undefined}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 8 }}>
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          padding: "10px 14px", borderRadius: 8,
          background: "var(--sim-bg-soft)", border: "1px solid var(--sim-hairline)",
          fontSize: 12, color: "var(--sim-text-soft)", lineHeight: 1.6,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--sim-text-mute)" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>Cookie 用于访问雪球行情接口。留空则系统自动获取匿名 Cookie（约 25 分钟刷新一次）；如需更稳定的连接，可填入浏览器中登录雪球后的 Cookie。</span>
        </div>

        <Field label="Cookie" hint="可选 · 留空 = 自动获取">
          <TextInput
            value={cookie}
            onChange={v => { setCookie(v); setTestResult(null); setSaveMsg(null); }}
            type={showCookie ? "text" : "password"}
            placeholder="留空使用自动获取，或粘贴浏览器 Cookie"
            suffix={
              cookie.trim() ? (
                <button onClick={() => setShowCookie(!showCookie)} style={miniBtnStyle}>
                  {showCookie ? "隐藏" : "显示"}
                </button>
              ) : undefined
            }
          />
        </Field>

        {testResult && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 14px", borderRadius: 8,
            background: testResult.ok ? "var(--sim-down-soft)" : "var(--sim-up-soft)",
            border: "1px solid " + (testResult.ok ? "#C7E3D4" : "#F5C7CE"),
            fontSize: 12.5, color: testResult.ok ? "var(--sim-down)" : "var(--sim-up)",
            fontWeight: 500,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {testResult.ok
                ? <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>
                : <><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>}
            </svg>
            {testResult.ok
              ? `连接成功，延迟 ${testResult.latency}ms（${testResult.mode === "auto" ? "自动 Cookie" : "手动 Cookie"}）`
              : `连接失败：${testResult.error}`}
          </div>
        )}

        {saveMsg && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 14px", borderRadius: 8,
            background: saveMsg.ok ? "var(--sim-down-soft)" : "var(--sim-up-soft)",
            border: "1px solid " + (saveMsg.ok ? "#C7E3D4" : "#F5C7CE"),
            fontSize: 12.5, color: saveMsg.ok ? "var(--sim-down)" : "var(--sim-up)",
            fontWeight: 500,
          }}>
            {saveMsg.text}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn kind="ghost" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? "测试中..." : "测试连接"}
          </Btn>
          <Btn kind="primary" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </Btn>
        </div>
      </div>
    </Card>
  );
}

function DataSourceSection({ token, setToken, showToken, setShowToken, tushareUrl, setTushareUrl, xqCookie, setXqCookie }: {
  token: string; setToken: (v: string) => void; showToken: boolean; setShowToken: (v: boolean) => void;
  tushareUrl: string; setTushareUrl: (v: string) => void;
  xqCookie: string; setXqCookie: (v: string) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showUrl, setShowUrl] = useState(false);

  const handleTest = useCallback(async () => {
    if (!token.trim()) { setTestResult({ ok: false, error: "Token 不能为空" }); return; }
    setTesting(true); setTestResult(null); setSaveMsg(null);
    try {
      const r = await simApi.testTushare(token.trim(), tushareUrl.trim());
      setTestResult(r);
    } catch (e) {
      const msg = e instanceof DOMException && e.name === "TimeoutError" ? "请求超时，请检查网络连接" : "请求失败";
      setTestResult({ ok: false, error: msg });
    } finally {
      setTesting(false);
    }
  }, [token, tushareUrl]);

  const handleSave = useCallback(async () => {
    setSaving(true); setSaveMsg(null);
    try {
      await simApi.saveTushare(token.trim(), tushareUrl.trim());
      setSaveMsg({ ok: true, text: token.trim() ? "已保存" : "已清除" });
      setTestResult(null);
    } catch {
      setSaveMsg({ ok: false, text: "保存失败" });
    } finally {
      setSaving(false);
    }
  }, [token, tushareUrl]);

  const connected = testResult?.ok === true;

  return (
    <>
      <SectionHeader
        title="数据源"
        desc="行情、财报、基本面数据来源。模拟交易使用 Tushare 提供的 A 股实时与历史数据。"
      />

      <Card title="Tushare" subtitle="A 股行情 / 财报 / 基本面主数据源"
        action={testResult !== null ? <StatusPill ok={connected} label={connected ? "已连接" : "连接失败"} /> : undefined}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 8 }}>
          <Field label="API Token" required hint="在 tushare.pro 个人主页获取">
            <TextInput
              value={token}
              onChange={v => { setToken(v); setTestResult(null); setSaveMsg(null); }}
              type={showToken ? "text" : "password"}
              placeholder="粘贴你的 Tushare token"
              suffix={
                <button onClick={() => setShowToken(!showToken)} style={miniBtnStyle}>
                  {showToken ? "隐藏" : "显示"}
                </button>
              }
            />
          </Field>

          {/* 折叠的 URL 字段 */}
          <div>
            <button onClick={() => setShowUrl(!showUrl)} style={{
              border: "none", background: "transparent", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 12, color: "var(--sim-text-mute)", padding: 0, fontFamily: "inherit",
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                style={{ transform: showUrl ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
              自定义 API 地址（中转 / 代理）
            </button>
            {showUrl && (
              <div style={{ marginTop: 10 }}>
                <Field label="Base URL" hint="留空使用官方地址 http://api.tushare.pro">
                  <TextInput
                    value={tushareUrl}
                    onChange={v => { setTushareUrl(v); setTestResult(null); setSaveMsg(null); }}
                    placeholder="http://api.tushare.pro"
                  />
                </Field>
              </div>
            )}
          </div>

          {/* 测试结果反馈 */}
          {testResult && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 14px", borderRadius: 8,
              background: testResult.ok ? "var(--sim-down-soft)" : "var(--sim-up-soft)",
              border: "1px solid " + (testResult.ok ? "#C7E3D4" : "#F5C7CE"),
              fontSize: 12.5, color: testResult.ok ? "var(--sim-down)" : "var(--sim-up)",
              fontWeight: 500,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {testResult.ok
                  ? <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>
                  : <><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>}
              </svg>
              {testResult.ok
                ? `连接成功，延迟 ${testResult.latency}ms，配置已保存`
                : `连接失败：${testResult.error}`}
            </div>
          )}

          {saveMsg && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 14px", borderRadius: 8,
              background: saveMsg.ok ? "var(--sim-down-soft)" : "var(--sim-up-soft)",
              border: "1px solid " + (saveMsg.ok ? "#C7E3D4" : "#F5C7CE"),
              fontSize: 12.5, color: saveMsg.ok ? "var(--sim-down)" : "var(--sim-up)",
              fontWeight: 500,
            }}>
              {saveMsg.text}
            </div>
          )}

          {/* 操作栏 */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn kind="ghost" size="sm" onClick={handleTest} disabled={testing || !token.trim()}>
              {testing ? "测试中..." : "测试连接"}
            </Btn>
            <Btn kind="primary" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </Btn>
          </div>
        </div>
      </Card>

      <XueqiuCard cookie={xqCookie} setCookie={setXqCookie} />

    </>
  );
}

// ============================================================
// 模型 API
// ============================================================
function ModelsSection({ providerCfg, setProviderCfg, providerModels, setProviderModels, providerBlocked, setProviderBlocked }: {
  providerCfg: Record<string, ProviderCfg>; setProviderCfg: React.Dispatch<React.SetStateAction<Record<string, ProviderCfg>>>;
  providerModels: Record<string, string[]>; setProviderModels: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  providerBlocked: Record<string, string[]>; setProviderBlocked: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const enabledCount = Object.values(providerCfg).filter(c => c.enabled).length;

  const setCfg = (id: string, patch: Partial<ProviderCfg>) =>
    setProviderCfg(prev => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));

  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testProgress, setTestProgress] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saveMsg, setSaveMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});
  const [newModelInput, setNewModelInput] = useState("");
  const [addingModel, setAddingModel] = useState(false);
  const [addModelErr, setAddModelErr] = useState("");
  const [hoverTest, setHoverTest] = useState<string | null>(null);
  // 点击测试后鼠标仍停在按钮上，立即变「取消测试」很突兀：5 秒后才允许悬停出现取消
  const [cancelReady, setCancelReady] = useState<Record<string, boolean>>({});
  const testAbort = useRef<Record<string, AbortController>>({});

  const clearFeedback = useCallback((id: string) => {
    setTestResults(prev => { const n = { ...prev }; delete n[id]; return n; });
    setSaveMsg(prev => { const n = { ...prev }; delete n[id]; return n; });
  }, []);

  const saveModels = useCallback((id: string, models: string[]) => {
    setProviderModels(prev => ({ ...prev, [id]: models }));
    simApi.setConfig({ [`llm.${id}.models`]: models }).catch(() => {});
  }, [setProviderModels]);

  const saveBlocked = useCallback((id: string, blocked: string[]) => {
    setProviderBlocked(prev => ({ ...prev, [id]: blocked }));
    simApi.setConfig({ [`llm.${id}.blockedModels`]: blocked }).catch(() => {});
  }, [setProviderBlocked]);

  const fetchModels = useCallback(async (id: string) => {
    const cfg = providerCfg[id]!;
    if (!cfg.key.trim() || !cfg.baseUrl.trim()) return;
    setLoadingModels(prev => ({ ...prev, [id]: true }));
    try {
      const r = await simApi.fetchLlmModels(cfg.key.trim(), cfg.baseUrl.trim());
      if (r.models.length > 0) {
        // 屏蔽名单只对上游真实存在的模型有意义：更换 Base URL / Key 后，旧的屏蔽项一并清掉
        let blocked = providerBlocked[id] ?? [];
        const kept = blocked.filter(b => r.models.includes(b));
        if (kept.length !== blocked.length) {
          blocked = kept;
          saveBlocked(id, kept);
        }
        // 已屏蔽的模型刷新后不再回到列表
        const fresh = r.models.filter(m => !blocked.includes(m));
        if (fresh.length > 0) saveModels(id, fresh);
      }
    } catch { /* user can add manually */ }
    finally { setLoadingModels(prev => ({ ...prev, [id]: false })); }
  }, [providerCfg, providerBlocked, saveModels, saveBlocked]);

  useEffect(() => {
    if (!expanded) return;
    const cfg = providerCfg[expanded];
    if (cfg?.key.trim() && cfg.baseUrl.trim() && !providerModels[expanded]?.length && !loadingModels[expanded]) {
      fetchModels(expanded);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const handleTest = useCallback(async (id: string) => {
    const cfg = providerCfg[id]!;
    if (!cfg.key.trim()) { setTestResults(prev => ({ ...prev, [id]: { ok: false, error: "API Key 不能为空" } })); return; }
    const ctrl = new AbortController();
    testAbort.current[id] = ctrl;
    setTesting(prev => ({ ...prev, [id]: true }));
    setCancelReady(prev => ({ ...prev, [id]: false }));
    const cancelTimer = setTimeout(() => setCancelReady(prev => ({ ...prev, [id]: true })), 5000);
    clearFeedback(id);
    try {
      let blocked = providerBlocked[id] ?? [];
      // 每次测试都重新拉取模型列表（已屏蔽的过滤掉）：更换 Key / Base URL 后旧列表可能已失效
      let models = providerModels[id] ?? [];
      setLoadingModels(prev => ({ ...prev, [id]: true }));
      try {
        const mr = await simApi.fetchLlmModels(cfg.key.trim(), cfg.baseUrl.trim());
        if (mr.models.length > 0) {
          // 屏蔽名单只对上游真实存在的模型有意义：更换 Base URL / Key 后，旧的屏蔽项一并清掉
          const kept = blocked.filter(b => mr.models.includes(b));
          if (kept.length !== blocked.length) {
            blocked = kept;
            saveBlocked(id, kept);
          }
          const fresh = mr.models.filter(m => !blocked.includes(m));
          if (fresh.length > 0) {
            models = fresh;
            saveModels(id, models);
          }
        }
      } finally {
        setLoadingModels(prev => ({ ...prev, [id]: false }));
      }
      if (!models.length) {
        setTestResults(prev => ({ ...prev, [id]: { ok: false, error: "未获取到可用模型，请手动添加" } }));
        return;
      }
      // 按列表顺序依次尝试，找到第一个可用模型即停止；无论返回什么错误都继续下一个，可随时取消。
      // 路上失败的模型在最终成功时屏蔽——大列表（如百炼 200+）逐次测试会越测越干净
      const total = models.length;
      let result: NonNullable<TestResult> = { ok: false, error: "无可测试的模型" };
      let completed = 0;
      let cancelled = false;
      const unavailable: string[] = [];
      for (const m of models) {
        if (ctrl.signal.aborted) { cancelled = true; break; }
        setTestProgress(prev => ({ ...prev, [id]: `${completed + 1}/${total}` }));
        try {
          const r = await simApi.testLlm(cfg.key.trim(), cfg.baseUrl.trim(), m, id, ctrl.signal);
          completed += 1;
          result = { ...r, model: m, tried: completed };
          if (r.ok) break;
          unavailable.push(m);
        } catch (e) {
          if (ctrl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) { cancelled = true; break; }
          completed += 1;
          result = { ok: false, error: e instanceof DOMException && e.name === "TimeoutError" ? "请求超时" : "请求失败", model: m, tried: completed };
          unavailable.push(m);
        }
      }
      if (cancelled) {
        result = { ok: false, error: completed > 0 ? `已取消（已测 ${completed}/${total} 个模型）` : "已取消" };
      }
      // 找到可用模型即证明 Key / 端点正常，把前面失败的屏蔽掉；整体失败时不屏蔽（多半是 Key / 端点问题）
      if (result.ok && unavailable.length > 0) {
        saveBlocked(id, [...new Set([...blocked, ...unavailable])]);
        saveModels(id, models.filter(m => !unavailable.includes(m)));
        result.removed = unavailable.length;
      }
      setTestResults(prev => ({ ...prev, [id]: result }));
    } catch (e) {
      const msg = e instanceof DOMException && e.name === "TimeoutError" ? "请求超时，请检查网络连接" : "请求失败";
      setTestResults(prev => ({ ...prev, [id]: { ok: false, error: msg } }));
    } finally {
      clearTimeout(cancelTimer);
      setTesting(prev => ({ ...prev, [id]: false }));
      setTestProgress(prev => { const n = { ...prev }; delete n[id]; return n; });
      setCancelReady(prev => { const n = { ...prev }; delete n[id]; return n; });
      delete testAbort.current[id];
    }
  }, [providerCfg, providerModels, providerBlocked, clearFeedback, saveModels, saveBlocked]);

  const handleSave = useCallback(async (id: string) => {
    const cfg = providerCfg[id]!;
    setSaving(prev => ({ ...prev, [id]: true }));
    setSaveMsg(prev => { const n = { ...prev }; delete n[id]; return n; });
    try {
      await simApi.saveLlmProvider(id, cfg.key.trim(), cfg.baseUrl.trim(), cfg.enabled);
      setSaveMsg(prev => ({ ...prev, [id]: { ok: true, text: "已保存" } }));
    } catch {
      setSaveMsg(prev => ({ ...prev, [id]: { ok: false, text: "保存失败" } }));
    } finally {
      setSaving(prev => ({ ...prev, [id]: false }));
    }
  }, [providerCfg]);

  const addModel = useCallback(async (id: string) => {
    const name = newModelInput.trim();
    if (!name) return;
    const current = providerModels[id] ?? [];
    if (current.includes(name)) { setAddModelErr("模型已存在"); return; }
    const cfg = providerCfg[id]!;
    if (!cfg.key.trim()) { setAddModelErr("请先填写 API Key"); return; }
    setAddingModel(true); setAddModelErr("");
    try {
      const r = await simApi.testLlm(cfg.key.trim(), cfg.baseUrl.trim(), name, id);
      if (r.ok) {
        saveModels(id, [...current, name]);
        // 手动添加并验证通过，视为用户要解除屏蔽
        const blocked = providerBlocked[id] ?? [];
        if (blocked.includes(name)) saveBlocked(id, blocked.filter(m => m !== name));
        setNewModelInput("");
      } else {
        setAddModelErr(r.error || "模型不可用");
      }
    } catch {
      setAddModelErr("验证请求失败");
    } finally {
      setAddingModel(false);
    }
  }, [newModelInput, providerModels, providerBlocked, providerCfg, saveModels, saveBlocked]);

  const removeModel = useCallback((id: string, model: string) => {
    // 手动移除同时加入屏蔽名单，否则下次自动刷新列表又会回来
    saveBlocked(id, [...new Set([...(providerBlocked[id] ?? []), model])]);
    saveModels(id, (providerModels[id] ?? []).filter(m => m !== model));
  }, [providerModels, providerBlocked, saveModels, saveBlocked]);

  const restoreModel = useCallback((id: string, model: string) => {
    saveBlocked(id, (providerBlocked[id] ?? []).filter(m => m !== model));
    const current = providerModels[id] ?? [];
    if (!current.includes(model)) saveModels(id, [...current, model]);
  }, [providerModels, providerBlocked, saveModels, saveBlocked]);

  const restoreAllModels = useCallback((id: string) => {
    const blocked = providerBlocked[id] ?? [];
    if (!blocked.length) return;
    const current = providerModels[id] ?? [];
    saveBlocked(id, []);
    saveModels(id, [...current, ...blocked.filter(m => !current.includes(m))]);
  }, [providerModels, providerBlocked, saveModels, saveBlocked]);

  return (
    <>
      <SectionHeader
        title="模型 API"
        desc={`配置大模型供应商的 API Key。支持市面主流供应商，兼容 OpenAI 协议的自建端点。已启用 ${enabledCount} 个。`}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {LLM_PROVIDERS.map(p => {
          const cfg = providerCfg[p.id]!;
          const isOpen = expanded === p.id;
          const tr = testResults[p.id];
          const sm = saveMsg[p.id];
          const models = providerModels[p.id] ?? [];
          const blocked = providerBlocked[p.id] ?? [];
          const isTesting = testing[p.id];
          const isSaving = saving[p.id];
          const isLoadingModels = loadingModels[p.id];
          return (
            <div key={p.id} style={{
              background: "var(--sim-surface)", border: "1px solid " + (cfg.enabled ? "var(--sim-border-strong)" : "var(--sim-border)"),
              borderRadius: "var(--sim-r-lg)", overflow: "hidden",
              boxShadow: "var(--sim-shadow-card)",
            }}>
              {/* header row */}
              <div onClick={() => setExpanded(isOpen ? null : p.id)}
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", cursor: "pointer" }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 9, flexShrink: 0,
                  background: p.color, color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 700, fontFamily: "var(--sim-mono)",
                }}>{p.short.slice(0, 2)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                    <Tag kind="ghost" size="sm">{p.short}</Tag>
                    <Tag kind={p.region === "国内" ? "down" : p.region === "海外" ? "brand" : "neutral"} size="sm">{p.region}</Tag>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--sim-text-mute)", marginTop: 3, fontFamily: "var(--sim-mono)" }}>
                    {models.length > 0 ? `${models.length} 个模型 · ${models.slice(0, 3).join(" / ")}${models.length > 3 ? " ..." : ""}` : "未配置模型"}
                  </div>
                </div>
                {cfg.enabled && cfg.key && <StatusPill ok label="已配置" />}
                <ToggleSwitch on={cfg.enabled} onClick={(e) => {
                  e.stopPropagation();
                  const next = !cfg.enabled;
                  setCfg(p.id, { enabled: next });
                  simApi.saveLlmProvider(p.id, cfg.key.trim(), cfg.baseUrl.trim(), next).catch(() => {});
                }} />
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--sim-text-mute)" strokeWidth="2"
                  style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
                  <polyline points="6 9 12 15 18 9" /></svg>
              </div>

              {/* expanded body */}
              {isOpen && (
                <div style={{ padding: "4px 18px 18px", borderTop: "1px solid var(--sim-hairline)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
                    <Field label="API Key" hint={p.keyHint}>
                      <TextInput value={cfg.key} onChange={v => { setCfg(p.id, { key: v }); clearFeedback(p.id); }} type="password" placeholder={p.keyHint} />
                    </Field>
                    <Field label="Base URL" hint="可改为代理 / 自建网关">
                      <TextInput value={cfg.baseUrl} onChange={v => { setCfg(p.id, { baseUrl: v }); clearFeedback(p.id); }} />
                    </Field>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--sim-text)" }}>可用模型</span>
                      {cfg.key.trim() && (
                        <button onClick={() => fetchModels(p.id)} disabled={isLoadingModels} title="从 API 获取模型列表"
                          style={{
                            border: "none", background: "transparent", cursor: isLoadingModels ? "default" : "pointer",
                            padding: 2, display: "flex", alignItems: "center", justifyContent: "center",
                            color: "var(--sim-text-mute)", opacity: isLoadingModels ? 0.5 : 1,
                          }}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            style={{ animation: isLoadingModels ? "spin 0.8s linear infinite" : "none" }}>
                            <path d="M21.5 2v6h-6" /><path d="M21.34 13a10 10 0 1 1-2.26-7.72L21.5 8" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {models.length > 0 ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {models.map(m => (
                          <span key={m} style={{
                            fontFamily: "var(--sim-mono)", fontSize: 11.5,
                            padding: "4px 6px 4px 10px", background: "var(--sim-bg-soft)",
                            border: "1px solid var(--sim-border)", borderRadius: 6, color: "var(--sim-text-soft)",
                            display: "inline-flex", alignItems: "center", gap: 4,
                          }}>
                            {m}
                            <button onClick={() => removeModel(p.id, m)} style={{
                              border: "none", background: "transparent", cursor: "pointer", padding: 0,
                              color: "var(--sim-text-mute)", display: "flex", lineHeight: 1,
                            }} title="移除">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "var(--sim-text-mute)", padding: "8px 0" }}>
                        {cfg.key.trim() ? "测试调用时将自动获取，或手动添加" : "请先填写 API Key"}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <input
                        value={newModelInput} onChange={e => { setNewModelInput(e.target.value); setAddModelErr(""); }}
                        onKeyDown={e => { if (e.key === "Enter" && !addingModel) addModel(p.id); }}
                        placeholder="手动输入模型名称"
                        disabled={addingModel}
                        style={{ ...inputStyle, flex: 1, padding: "6px 10px", fontSize: 12 }}
                      />
                      <button onClick={() => addModel(p.id)} disabled={!newModelInput.trim() || addingModel} style={{
                        ...miniBtnStyle, padding: "6px 12px", opacity: newModelInput.trim() && !addingModel ? 1 : 0.5,
                      }}>{addingModel ? "验证中..." : "添加"}</button>
                    </div>
                    {addModelErr && (
                      <div style={{ fontSize: 11.5, color: "var(--sim-up)", marginTop: 4 }}>{addModelErr}</div>
                    )}
                    {blocked.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                          <span style={{ fontSize: 11.5, color: "var(--sim-text-mute)" }}>
                            已屏蔽 {blocked.length} 个模型（刷新列表时不再加回）
                          </span>
                          <button onClick={() => restoreAllModels(p.id)} style={{
                            border: "none", background: "transparent", cursor: "pointer", padding: 0,
                            fontSize: 11.5, color: "var(--sim-brand)", fontWeight: 500,
                          }}>全部恢复</button>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {blocked.map(m => (
                            <span key={m} style={{
                              fontFamily: "var(--sim-mono)", fontSize: 11.5,
                              padding: "4px 6px 4px 10px", background: "transparent",
                              border: "1px dashed var(--sim-border)", borderRadius: 6, color: "var(--sim-text-mute)",
                              display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "line-through",
                            }}>
                              {m}
                              <button onClick={() => restoreModel(p.id, m)} style={{
                                border: "none", background: "transparent", cursor: "pointer", padding: 0,
                                color: "var(--sim-text-mute)", display: "flex", lineHeight: 1,
                              }} title="恢复">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                                </svg>
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {tr && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8, marginTop: 14,
                      padding: "10px 14px", borderRadius: 8,
                      background: tr.ok ? "var(--sim-down-soft)" : "var(--sim-up-soft)",
                      border: "1px solid " + (tr.ok ? "#C7E3D4" : "#F5C7CE"),
                      fontSize: 12.5, color: tr.ok ? "var(--sim-down)" : "var(--sim-up)",
                      fontWeight: 500,
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {tr.ok
                          ? <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>
                          : <><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>}
                      </svg>
                      {tr.ok
                        ? `连接成功${tr.model ? `（${tr.model}）` : ""}，延迟 ${tr.latency}ms，Key 已保存${tr.removed ? `，已屏蔽 ${tr.removed} 个不可用模型` : ""}`
                        : `连接失败${tr.model ? (tr.tried && tr.tried > 1 ? `（依次尝试 ${tr.tried} 个模型，最后 ${tr.model}）` : `（${tr.model}）`) : ""}：${tr.error}`}
                    </div>
                  )}

                  {sm && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8, marginTop: tr ? 8 : 14,
                      padding: "10px 14px", borderRadius: 8,
                      background: sm.ok ? "var(--sim-down-soft)" : "var(--sim-up-soft)",
                      border: "1px solid " + (sm.ok ? "#C7E3D4" : "#F5C7CE"),
                      fontSize: 12.5, color: sm.ok ? "var(--sim-down)" : "var(--sim-up)",
                      fontWeight: 500,
                    }}>
                      {sm.text}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                    {isTesting ? (
                      // 悬停才显示红色「取消测试」（开始 5 秒内不出现）；固定 minWidth 防止文案切换时按钮宽度抖动导致 hover 闪烁
                      <span style={{ display: "inline-flex" }}
                        onMouseEnter={() => setHoverTest(p.id)}
                        onMouseLeave={() => setHoverTest(prev => (prev === p.id ? null : prev))}>
                        {(() => {
                          const showCancel = hoverTest === p.id && cancelReady[p.id];
                          return (
                            <Btn kind={showCancel ? "danger" : "ghost"} size="sm"
                              onClick={() => { if (cancelReady[p.id]) testAbort.current[p.id]?.abort(); }}
                              style={{ minWidth: 104, justifyContent: "center", opacity: showCancel ? 1 : 0.6 }}>
                              {showCancel ? "取消测试" : `测试中${testProgress[p.id] ? ` (${testProgress[p.id]})` : ""}...`}
                            </Btn>
                          );
                        })()}
                      </span>
                    ) : (
                      <Btn kind="ghost" size="sm" onClick={() => handleTest(p.id)} disabled={!cfg.key.trim()}>
                        测试调用
                      </Btn>
                    )}
                    <Btn kind="primary" size="sm" onClick={() => handleSave(p.id)} disabled={isSaving}>
                      {isSaving ? "保存中..." : "保存"}
                    </Btn>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ============================================================
// Agent 模型分配
// ============================================================
function AgentModelSection({ roleModel, setRoleModel, providerCfg, providerModels }: {
  roleModel: Record<string, RoleModelCfg>;
  setRoleModel: React.Dispatch<React.SetStateAction<Record<string, RoleModelCfg>>>;
  providerCfg: Record<string, ProviderCfg>;
  providerModels: Record<string, string[]>;
}) {
  const enabledProviders = LLM_PROVIDERS.filter(p => providerCfg[p.id]?.enabled && providerCfg[p.id]?.key);
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleSaveMsg, setRoleSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleRoleSave = useCallback(async () => {
    setRoleSaving(true); setRoleSaveMsg(null);
    try {
      await simApi.saveLlmRoles(roleModel);
      setRoleSaveMsg({ ok: true, text: "已保存" });
    } catch {
      setRoleSaveMsg({ ok: false, text: "保存失败" });
    } finally {
      setRoleSaving(false);
    }
  }, [roleModel]);

  if (enabledProviders.length === 0) {
    return (
      <>
        <SectionHeader
          title="Agent 模型分配"
          desc="为不同 Agent 角色指定使用的模型。可让强推理模型负责投研，低延迟模型负责决策，性价比模型负责总结。"
        />
        <Card>
          <div style={{ textAlign: "center", padding: "24px 0", color: "var(--sim-text-mute)", fontSize: 13 }}>
            <div style={{ marginBottom: 6 }}>尚未启用任何模型供应商</div>
            <div style={{ fontSize: 12 }}>请先在「模型 API」中配置并启用至少一个供应商</div>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <SectionHeader
        title="Agent 模型分配"
        desc="为不同 Agent 角色指定使用的模型。可让强推理模型负责投研，低延迟模型负责决策，性价比模型负责总结。"
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {AGENT_ROLES.map(role => {
          const rm = roleModel[role.id]!;
          const providerValid = enabledProviders.some(p => p.id === rm.provider);
          const effectiveProvider = providerValid ? rm.provider : enabledProviders[0]?.id ?? "";
          const models = providerModels[effectiveProvider] ?? [];
          const modelValid = models.includes(rm.model);
          const effectiveModel = modelValid ? rm.model : pickDefaultChatModel(models) ?? "";

          if (effectiveProvider !== rm.provider || effectiveModel !== rm.model) {
            setTimeout(() => setRoleModel(prev => ({ ...prev, [role.id]: { provider: effectiveProvider, model: effectiveModel } })), 0);
          }

          return (
            <Card key={role.id} padded={false} style={{ padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                  background: "var(--sim-bg-soft)", border: "1px solid var(--sim-border)",
                  display: "flex", alignItems: "center", justifyContent: "center", color: "var(--sim-brand)",
                }}>
                  <SetIcon name={role.icon} size={18} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{role.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--sim-text-mute)", marginTop: 2 }}>{role.desc}</div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <SelectBox
                    value={effectiveProvider}
                    onChange={v => {
                      const m = providerModels[v] ?? [];
                      setRoleModel(prev => ({ ...prev, [role.id]: { provider: v, model: pickDefaultChatModel(m) ?? "" } }));
                    }}
                    options={enabledProviders.map(p => ({ value: p.id, label: p.name }))}
                    width={150}
                  />
                  {models.length > 0 ? (
                    <SelectBox
                      value={effectiveModel}
                      onChange={v => setRoleModel(prev => ({ ...prev, [role.id]: { ...prev[role.id]!, model: v } }))}
                      options={models.map(m => ({ value: m, label: m }))}
                      width={200} mono
                    />
                  ) : (
                    <span style={{ fontSize: 11.5, color: "var(--sim-text-mute)", width: 200 }}>
                      该供应商暂无模型
                    </span>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
        {roleSaveMsg && (
          <span style={{
            fontSize: 12.5, fontWeight: 500,
            color: roleSaveMsg.ok ? "var(--sim-down)" : "var(--sim-up)",
          }}>
            {roleSaveMsg.text}
          </span>
        )}
        <Btn kind="primary" size="sm" onClick={handleRoleSave} disabled={roleSaving}>
          {roleSaving ? "保存中..." : "保存分配"}
        </Btn>
      </div>
    </>
  );
}

// ============================================================
// 交易与风控
// ============================================================
// 用户在各风格下保存过的风控参数历史：{ conservative: { "risk.maxPositionPct": 0.2, ... }, ... }
function parseStyleHistory(v: unknown): Record<string, Record<string, number>> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, Record<string, number>>;
  return {};
}

function riskValuesDiffer(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return true;
  return false;
}

function TradingSection({ config, setConfig }: { config: Record<string, unknown>; setConfig: React.Dispatch<React.SetStateAction<Record<string, unknown>>> }) {
  const toNum = (v: unknown, fallback: number) => { const n = Number(v); return isNaN(n) ? fallback : n; };
  const fmtPct = (v: number) => (v * 100).toFixed(1);
  const fmtPermil = (v: number) => (v * 1000).toFixed(2);

  const [commRate, setCommRate] = useState(() => fmtPermil(toNum(config["trading.commissionRate"], 0.00025)));
  const [stampRate, setStampRate] = useState(() => fmtPermil(toNum(config["trading.stampDutyRate"], 0.0005)));
  const [commMin, setCommMin] = useState(() => String(toNum(config["trading.commissionMin"], 5)));

  interface RiskRule { key: string; label: string; value: string; unit: string; enabled: boolean }
  const [rules, setRules] = useState<RiskRule[]>(() => [
    { key: "risk.maxPositionPct", label: "单票仓位上限", value: fmtPct(toNum(config["risk.maxPositionPct"], 0.3)), unit: "%", enabled: true },
    { key: "risk.maxSingleBuyPct", label: "单笔买入上限", value: fmtPct(toNum(config["risk.maxSingleBuyPct"], 0.15)), unit: "%", enabled: true },
    { key: "risk.minCashPct", label: "现金留存下限", value: fmtPct(toNum(config["risk.minCashPct"], 0.1)), unit: "%", enabled: true },
    { key: "risk.stopLossPct", label: "个股止损线", value: fmtPct(toNum(config["risk.stopLossPct"], -0.2)), unit: "%", enabled: true },
    { key: "risk.maxHoldings", label: "最大持仓数", value: String(toNum(config["risk.maxHoldings"], 10)), unit: "只", enabled: true },
  ]);

  const [style, setStyle] = useState(() => String(config["agent.tradingStyle"] ?? "balanced"));
  const [styleHint, setStyleHint] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<{ presetId: string; history: Record<string, number> } | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setCommRate(fmtPermil(toNum(config["trading.commissionRate"], 0.00025)));
    setStampRate(fmtPermil(toNum(config["trading.stampDutyRate"], 0.0005)));
    setCommMin(String(toNum(config["trading.commissionMin"], 5)));
    const s = config["agent.tradingStyle"];
    if (s !== undefined) setStyle(String(s));
    setRules(prev => prev.map(r => {
      const v = config[r.key];
      if (v === undefined) return r;
      return { ...r, value: r.unit === "只" ? String(toNum(v, 0)) : fmtPct(toNum(v, 0)) };
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const setRule = (idx: number, patch: Partial<RiskRule>) =>
    setRules(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));

  // disableMissing：历史记录里没有的参数（保存时被关闭的）按关闭还原
  const applyRiskValues = (values: Record<string, number>, disableMissing = false) => {
    setRules(prev => prev.map(r => {
      const v = values[r.key];
      if (v === undefined) return disableMissing ? { ...r, enabled: false } : r;
      return { ...r, enabled: true, value: r.unit === "只" ? String(v) : fmtPct(v) };
    }));
  };

  const selectStyle = (preset: typeof TRADING_STYLE_PRESETS[number]) => {
    setStyle(preset.id);
    setSaveMsg(null);
    applyRiskValues(preset.risk);
    const history = parseStyleHistory(config["risk.styleHistory"])[preset.id];
    if (history && riskValuesDiffer(history, preset.risk)) {
      setPendingChoice({ presetId: preset.id, history });
      setStyleHint(false);
    } else {
      setPendingChoice(null);
      setStyleHint(true);
    }
  };

  const handleSave = useCallback(async () => {
    setSaving(true); setSaveMsg(null); setPendingChoice(null);
    const riskValues: Record<string, number> = {};
    for (const r of rules) {
      if (!r.enabled) continue;
      riskValues[r.key] = r.unit === "只" ? parseInt(r.value) : parseFloat(r.value) / 100;
    }
    const entries: Record<string, unknown> = {
      "trading.commissionRate": parseFloat(commRate) / 1000,
      "trading.stampDutyRate": parseFloat(stampRate) / 1000,
      "trading.commissionMin": parseFloat(commMin),
      "agent.tradingStyle": style,
      "risk.styleHistory": { ...parseStyleHistory(config["risk.styleHistory"]), [style]: riskValues },
      ...riskValues,
    };
    try {
      await simApi.setConfig(entries);
      setConfig(prev => ({ ...prev, ...entries }));
      setSaveMsg({ ok: true, text: "已保存" });
    } catch {
      setSaveMsg({ ok: false, text: "保存失败" });
    } finally {
      setSaving(false);
    }
  }, [commRate, stampRate, commMin, rules, style, config, setConfig]);

  const disabledInputStyle: CSSProperties = {
    ...inputStyle, background: "var(--sim-bg-soft)", color: "var(--sim-text-mute)", cursor: "default",
  };

  return (
    <>
      <SectionHeader title="交易与风控" desc="模拟账户参数与 Agent 风控规则。决策时这些规则会被强制校验。" />
      <Card title="账户参数">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 8 }}>
          <Field label="初始资金 (¥)">
            <div style={{ position: "relative" }}>
              <input value="1,000,000" disabled style={{ ...disabledInputStyle, paddingRight: 30 }} />
              <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)" }}>
                <HelpTip text="创建账户时确定，如需修改请重置账户" />
              </span>
            </div>
          </Field>
          <Field label="最小交易单位">
            <div style={{ position: "relative" }}>
              <input value="100 股 (1 手)" disabled style={{ ...disabledInputStyle, fontFamily: "var(--sim-sans)", paddingRight: 30 }} />
              <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)" }}>
                <HelpTip text="A 股规则，最小买入单位为 1 手 = 100 股" />
              </span>
            </div>
          </Field>
          <Field label="手续费率 (‰)" hint="买卖双向">
            <TextInput value={commRate} onChange={v => { setCommRate(v); setSaveMsg(null); }} mono />
          </Field>
          <Field label="印花税 (‰)" hint="卖出单向">
            <TextInput value={stampRate} onChange={v => { setStampRate(v); setSaveMsg(null); }} mono />
          </Field>
          <Field label="最低佣金 (¥)" hint="单笔不足此值按此计">
            <TextInput value={commMin} onChange={v => { setCommMin(v); setSaveMsg(null); }} mono />
          </Field>
        </div>
      </Card>
      <Card title="交易风格" subtitle="决定 Agent 的交易策略与纪律；切换会预填推荐风控参数，可调整后保存">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 8 }}>
          {TRADING_STYLE_PRESETS.map(p => {
            const active = style === p.id;
            return (
              <button key={p.id} onClick={() => selectStyle(p)}
                style={{
                  textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                  padding: "14px 16px", borderRadius: 10,
                  border: active ? `1.5px solid ${p.colors.main}` : "1px solid var(--sim-border)",
                  background: active ? p.colors.active : p.colors.base,
                }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: p.colors.main }}>{p.name}</span>
                  {active && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: "#fff", background: p.colors.main,
                      padding: "2px 7px", borderRadius: 999, letterSpacing: "0.02em",
                    }}>当前</span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--sim-text-soft)", marginTop: 6, lineHeight: 1.5 }}>{p.tagline}</div>
                <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none" }}>
                  {p.points.map(pt => (
                    <li key={pt} style={{ fontSize: 11, color: "var(--sim-text-mute)", lineHeight: 1.7 }}>· {pt}</li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
        {styleHint && !pendingChoice && (
          <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--sim-text-soft)" }}>
            已按所选风格预填下方风控参数，可调整后点击保存生效。
          </div>
        )}
        {pendingChoice && (() => {
          const preset = TRADING_STYLE_PRESETS.find(p => p.id === pendingChoice.presetId);
          if (!preset) return null;
          const fmtRiskVal = (unit: string, v: number | undefined) =>
            v === undefined ? "关闭" : unit === "只" ? `${v} 只` : `${(v * 100).toFixed(1)}%`;
          return (
            <div style={{ marginTop: 12, border: `1px solid ${preset.colors.main}55`, borderRadius: 10, overflow: "hidden", background: "var(--sim-surface)" }}>
              <div style={{ padding: "10px 14px", fontSize: 12.5, color: "var(--sim-text-soft)", lineHeight: 1.6, borderBottom: "1px solid var(--sim-hairline)", background: preset.colors.base }}>
                你在「{preset.name}」风格下保存过自定义风控参数，与推荐值不同。表单当前为推荐值，请选择要使用的参数：
              </div>
              <div style={{ padding: "2px 14px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", fontSize: 12.5 }}>
                  <div style={{ padding: "8px 0", fontSize: 11, color: "var(--sim-text-mute)" }}>参数</div>
                  <div style={{ padding: "8px 0", fontSize: 11, color: "var(--sim-text-mute)" }}>上次保存</div>
                  <div style={{ padding: "8px 0", fontSize: 11, color: "var(--sim-text-mute)" }}>推荐值</div>
                  {rules.map(r => {
                    const hv = pendingChoice.history[r.key];
                    const pv = preset.risk[r.key];
                    const differs = hv !== pv;
                    return (
                      <Fragment key={r.key}>
                        <div style={{ padding: "8px 0", borderTop: "1px solid var(--sim-hairline)" }}>{r.label}</div>
                        <div style={{
                          padding: "8px 0", borderTop: "1px solid var(--sim-hairline)", fontFamily: "var(--sim-mono)",
                          fontWeight: differs ? 600 : 400, color: differs ? preset.colors.main : "var(--sim-text)",
                        }}>{fmtRiskVal(r.unit, hv)}</div>
                        <div style={{ padding: "8px 0", borderTop: "1px solid var(--sim-hairline)", fontFamily: "var(--sim-mono)", color: "var(--sim-text-soft)" }}>
                          {fmtRiskVal(r.unit, pv)}
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--sim-hairline)" }}>
                <Btn kind="primary" size="sm" onClick={() => { applyRiskValues(pendingChoice.history, true); setPendingChoice(null); setStyleHint(true); }}>
                  使用上次保存
                </Btn>
                <Btn kind="ghost" size="sm" onClick={() => { setPendingChoice(null); setStyleHint(true); }}>
                  使用推荐值
                </Btn>
              </div>
            </div>
          );
        })()}
      </Card>
      <Card title="风控规则">
        <div style={{ display: "flex", flexDirection: "column", gap: 0, marginTop: 4 }}>
          {rules.map((r, i) => (
            <div key={r.key} style={{
              display: "flex", alignItems: "center", gap: 14, padding: "12px 0",
              borderBottom: i < rules.length - 1 ? "1px solid var(--sim-hairline)" : "none",
            }}>
              <ToggleSwitch on={r.enabled} onClick={() => { setRule(i, { enabled: !r.enabled }); setSaveMsg(null); }} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: r.enabled ? "var(--sim-text)" : "var(--sim-text-mute)" }}>{r.label}</span>
              <div style={{ width: 150 }}>
                <TextInput
                  value={r.value}
                  onChange={v => { setRule(i, { value: v }); setSaveMsg(null); }}
                  suffix={<span style={{ fontSize: 12, color: "var(--sim-text-mute)", fontFamily: "var(--sim-mono)" }}>{r.unit}</span>}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
        {saveMsg && (
          <span style={{ fontSize: 12.5, fontWeight: 500, color: saveMsg.ok ? "var(--sim-down)" : "var(--sim-up)" }}>
            {saveMsg.text}
          </span>
        )}
        <Btn kind="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "保存中..." : "保存"}
        </Btn>
      </div>
    </>
  );
}

// ============================================================
// 定时任务
// ============================================================
function SchedulerSection({ config, setConfig, schedulerStatus, onSchedulerChange }: {
  config: Record<string, unknown>;
  setConfig: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  schedulerStatus?: { running: boolean; lastRunAt: string | null; nextRunAt: string | null };
  onSchedulerChange?: () => void;
}) {
  const [reportFreq, setReportFreq] = useState(() => String(config["scheduler.reportFrequency"] ?? "manual"));
  const [reportScope, setReportScope] = useState(() => String(config["scheduler.reportScope"] ?? "positions"));
  const [reportTime, setReportTime] = useState(() => String(config["scheduler.reportTime"] ?? "08:30"));
  const [decisionEnabled, setDecisionEnabled] = useState(() => schedulerStatus?.running ?? config["scheduler.decisionEnabled"] !== false);
  const [decisionInterval, setDecisionInterval] = useState(() => String(config["scheduler.decisionInterval"] ?? "30"));
  const [decisionTradingOnly, setDecisionTradingOnly] = useState(() => config["scheduler.decisionTradingOnly"] !== false);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setReportFreq(String(config["scheduler.reportFrequency"] ?? "manual"));
    setReportScope(String(config["scheduler.reportScope"] ?? "positions"));
    setReportTime(String(config["scheduler.reportTime"] ?? "08:30"));
    setDecisionInterval(String(config["scheduler.decisionInterval"] ?? "30"));
    setDecisionTradingOnly(config["scheduler.decisionTradingOnly"] !== false);
  }, [config]);

  useEffect(() => {
    if (schedulerStatus) setDecisionEnabled(schedulerStatus.running);
  }, [schedulerStatus]);

  const handleSave = useCallback(async () => {
    setSaving(true); setSaveMsg(null);
    const entries: Record<string, unknown> = {
      "scheduler.reportFrequency": reportFreq,
      "scheduler.reportScope": reportScope,
      "scheduler.reportTime": reportTime,
      "scheduler.decisionEnabled": decisionEnabled,
      "scheduler.decisionInterval": parseInt(decisionInterval) || 30,
      "scheduler.decisionTradingOnly": decisionTradingOnly,
    };
    try {
      await simApi.setConfig(entries);
      setConfig(prev => ({ ...prev, ...entries }));
      if (decisionEnabled) {
        await simApi.startScheduler();
      } else {
        await simApi.stopScheduler();
      }
      onSchedulerChange?.();
      setSaveMsg({ ok: true, text: "已保存" });
    } catch {
      setSaveMsg({ ok: false, text: "保存失败" });
    } finally {
      setSaving(false);
    }
  }, [reportFreq, reportScope, reportTime, decisionEnabled, decisionInterval, decisionTradingOnly, setConfig, onSchedulerChange]);

  const fmtTime = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const showTime = reportFreq !== "manual";

  return (
    <>
      <SectionHeader title="定时任务" desc="配置投研报告生成和 Agent 自动决策的执行策略。" />
      <Card title="投研报告生成" subtitle="自动为关注标的生成或刷新投研报告">
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
            <Field label="自动生成频率">
              <SegRadio value={reportFreq} onChange={v => { setReportFreq(v); setSaveMsg(null); }} options={[
                { value: "daily", label: "每天" },
                { value: "tradingDay", label: "交易日" },
                { value: "manual", label: "仅手动" },
              ]} />
            </Field>
            {showTime && (
              <Field label="定时执行">
                <input
                  type="time" value={reportTime}
                  onChange={e => { setReportTime(e.target.value); setSaveMsg(null); }}
                  style={{ ...inputStyle, width: 150, fontFamily: "var(--sim-mono)" }}
                />
              </Field>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 24 }}>
            <Field label="覆盖范围">
              <SegRadio value={reportScope} onChange={v => { setReportScope(v); setSaveMsg(null); }} options={[
                { value: "positions", label: "持仓股" },
                { value: "watchlist", label: "所有自选股" },
              ]} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Agent 决策" subtitle="定时触发 Agent 分析持仓与自选股并执行交易决策">
        <div style={{ display: "flex", flexDirection: "column", gap: 0, marginTop: 4 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 14, padding: "12px 0",
            borderBottom: "1px solid var(--sim-hairline)",
          }}>
            <ToggleSwitch on={decisionEnabled} onClick={() => { setDecisionEnabled(v => !v); setSaveMsg(null); }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>启用定时决策</div>
              <div style={{ fontSize: 11.5, color: "var(--sim-text-mute)", marginTop: 2 }}>开启后 Agent 将按设定间隔自动执行交易决策</div>
            </div>
            {schedulerStatus && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                background: schedulerStatus.running ? "var(--sim-down-soft)" : "var(--sim-bg-soft)",
                color: schedulerStatus.running ? "var(--sim-down)" : "var(--sim-text-mute)",
                border: "1px solid " + (schedulerStatus.running ? "#C7E3D4" : "var(--sim-border)"),
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: schedulerStatus.running ? "var(--sim-down)" : "var(--sim-text-mute)" }} />
                {schedulerStatus.running ? "运行中" : "已停止"}
              </span>
            )}
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 14, padding: "12px 0",
            borderBottom: "1px solid var(--sim-hairline)",
            opacity: decisionEnabled ? 1 : 0.5, pointerEvents: decisionEnabled ? "auto" : "none",
          }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>执行间隔</span>
            <div style={{ width: 120 }}>
              <TextInput
                value={decisionInterval}
                onChange={v => { setDecisionInterval(v); setSaveMsg(null); }}
                suffix={<span style={{ fontSize: 12, color: "var(--sim-text-mute)" }}>分钟</span>}
              />
            </div>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 14, padding: "12px 0",
            borderBottom: "1px solid var(--sim-hairline)",
            opacity: decisionEnabled ? 1 : 0.5, pointerEvents: decisionEnabled ? "auto" : "none",
          }}>
            <ToggleSwitch on={decisionTradingOnly} onClick={() => { setDecisionTradingOnly(v => !v); setSaveMsg(null); }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>仅交易时段执行</div>
              <div style={{ fontSize: 11.5, color: "var(--sim-text-mute)", marginTop: 2 }}>非交易时间跳过决策周期</div>
            </div>
          </div>

          {schedulerStatus && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "12px 0" }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--sim-text-mute)" }}>上次执行</div>
                <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2, fontFamily: "var(--sim-mono)" }}>{fmtTime(schedulerStatus.lastRunAt)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--sim-text-mute)" }}>下次执行</div>
                <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2, fontFamily: "var(--sim-mono)" }}>{fmtTime(schedulerStatus.nextRunAt)}</div>
              </div>
            </div>
          )}
        </div>
      </Card>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
        {saveMsg && (
          <span style={{ fontSize: 12.5, fontWeight: 500, color: saveMsg.ok ? "var(--sim-down)" : "var(--sim-up)" }}>
            {saveMsg.text}
          </span>
        )}
        <Btn kind="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "保存中..." : "保存"}
        </Btn>
      </div>
    </>
  );
}

// ============================================================
// 确认弹窗
// ============================================================
function ConfirmDialog({ open, title, desc, confirmLabel, loading, onConfirm, onCancel }: {
  open: boolean; title: string; desc: string; confirmLabel: string;
  loading?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(20,17,13,0.35)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 420, background: "var(--sim-surface)",
        border: "1px solid var(--sim-border)", borderRadius: 14,
        boxShadow: "0 20px 60px rgba(20,17,13,0.18), 0 4px 16px rgba(20,17,13,0.08)",
        overflow: "hidden",
        animation: "confirmFadeIn 0.15s ease-out",
      }}>
        <div style={{ padding: "24px 24px 0" }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: "var(--sim-up-soft)", border: "1px solid #F5C7CE",
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 16,
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--sim-up)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--sim-text)", letterSpacing: "-0.01em" }}>{title}</div>
          <div style={{ fontSize: 13, color: "var(--sim-text-soft)", lineHeight: 1.6, marginTop: 8 }}>{desc}</div>
        </div>
        <div style={{
          display: "flex", gap: 10, justifyContent: "flex-end",
          padding: "20px 24px", marginTop: 8,
          borderTop: "1px solid var(--sim-hairline)",
          background: "var(--sim-bg-soft)",
        }}>
          <Btn kind="ghost" size="md" onClick={onCancel} disabled={loading}>取消</Btn>
          <Btn kind="danger" size="md" onClick={onConfirm} disabled={loading}>
            {loading ? "处理中..." : confirmLabel}
          </Btn>
        </div>
      </div>
      <style>{`@keyframes confirmFadeIn { from { opacity: 0; transform: scale(0.95) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>
    </div>
  );
}

// ============================================================
// 账户
// ============================================================
function AccountSection() {
  const [loading, setLoading] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<"reset" | "clear" | null>(null);
  const [resultMsg, setResultMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [resetBalance, setResetBalance] = useState("1000000");

  const [accountInfo, setAccountInfo] = useState<{
    id: number; name: string; initialBalance: number; createdAt: string;
    positionCount: number; orderCount: number;
  } | null>(null);

  const loadAccount = useCallback(() => {
    simApi.getAccount().then(a => setAccountInfo(a as typeof accountInfo)).catch(() => {});
  }, []);

  useEffect(() => { loadAccount(); }, [loadAccount]);

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  };

  const daysSince = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    return Math.max(1, Math.floor(diff / 86400000));
  };

  const resetBalanceValid = (() => {
    const n = parseFloat(resetBalance);
    return !isNaN(n) && n >= 10000 && n <= 100000000;
  })();

  const doConfirm = useCallback(async () => {
    if (confirmTarget === "reset" && !resetBalanceValid) return;
    setLoading(true);
    try {
      if (confirmTarget === "reset") {
        await simApi.resetAccount(parseFloat(resetBalance));
        setResultMsg({ ok: true, text: "账户已重置，所有数据已清空" });
      } else {
        await simApi.clearDecisions();
        setResultMsg({ ok: true, text: "决策历史已清空" });
      }
      loadAccount();
    } catch {
      setResultMsg({ ok: false, text: confirmTarget === "reset" ? "重置失败" : "清空失败" });
    } finally {
      setLoading(false);
      setConfirmTarget(null);
    }
  }, [confirmTarget, loadAccount, resetBalance]);

  return (
    <>
      <SectionHeader title="账户" desc="模拟交易账户管理。" />
      <Card title="模拟账户">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 8 }}>
          <InfoStat label="账户 ID" value={accountInfo ? `SIM-${String(accountInfo.id).padStart(4, "0")}` : "—"} />
          <InfoStat label="开始日期" value={accountInfo ? fmtDate(accountInfo.createdAt) : "—"} />
          <InfoStat label="运行天数" value={accountInfo ? `${daysSince(accountInfo.createdAt)} 天` : "—"} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 12 }}>
          <InfoStat label="初始资金" value={accountInfo ? `¥${accountInfo.initialBalance.toLocaleString()}` : "—"} />
          <InfoStat label="持仓数" value={accountInfo ? String(accountInfo.positionCount) : "—"} />
          <InfoStat label="累计订单" value={accountInfo ? String(accountInfo.orderCount) : "—"} />
        </div>
      </Card>

      {resultMsg && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 16px", borderRadius: 8,
          background: resultMsg.ok ? "var(--sim-down-soft)" : "var(--sim-up-soft)",
          border: "1px solid " + (resultMsg.ok ? "#C7E3D4" : "#F5C7CE"),
          fontSize: 13, color: resultMsg.ok ? "var(--sim-down)" : "var(--sim-up)",
          fontWeight: 500,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {resultMsg.ok
              ? <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>
              : <><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>}
          </svg>
          {resultMsg.text}
          <div style={{ flex: 1 }} />
          <button onClick={() => setResultMsg(null)} style={{
            border: "none", background: "transparent", cursor: "pointer", color: "inherit", padding: 2,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      )}

      <Card title="危险操作" subtitle="以下操作不可撤销">
        <div style={{ display: "flex", flexDirection: "column", gap: 0, marginTop: 4 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 14, padding: "14px 0",
            borderBottom: "1px solid var(--sim-hairline)",
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>重置模拟账户</div>
              <div style={{ fontSize: 11.5, color: "var(--sim-text-mute)", marginTop: 2 }}>清空持仓、交易记录与决策历史，资金恢复初始值</div>
            </div>
            <Btn kind="danger" size="sm" onClick={() => setConfirmTarget("reset")}>重置账户</Btn>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 14, padding: "14px 0",
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>清空决策历史</div>
              <div style={{ fontSize: 11.5, color: "var(--sim-text-mute)", marginTop: 2 }}>删除所有 Agent 决策留痕（行情与持仓保留）</div>
            </div>
            <Btn kind="danger" size="sm" onClick={() => setConfirmTarget("clear")}>清空</Btn>
          </div>
        </div>
      </Card>

      {confirmTarget === "clear" && (
        <ConfirmDialog
          open title="确认清空决策历史？"
          desc="此操作将删除所有 Agent 决策留痕，行情与持仓数据将保留。此操作不可撤销。"
          confirmLabel="确认清空" loading={loading}
          onConfirm={doConfirm}
          onCancel={() => { if (!loading) setConfirmTarget(null); }}
        />
      )}
      {confirmTarget === "reset" && (
        <div onClick={() => { if (!loading) setConfirmTarget(null); }} style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(20,17,13,0.35)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: 420, background: "var(--sim-surface)",
            border: "1px solid var(--sim-border)", borderRadius: 14,
            boxShadow: "0 20px 60px rgba(20,17,13,0.18), 0 4px 16px rgba(20,17,13,0.08)",
            overflow: "hidden", animation: "confirmFadeIn 0.15s ease-out",
          }}>
            <div style={{ padding: "24px 24px 0" }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: "var(--sim-up-soft)", border: "1px solid #F5C7CE",
                display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: 16,
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--sim-up)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--sim-text)" }}>确认重置模拟账户？</div>
              <div style={{ fontSize: 13, color: "var(--sim-text-soft)", lineHeight: 1.6, marginTop: 8 }}>
                此操作将清空所有持仓、交易记录与决策历史。账户将以新的初始资金重新开始，此操作不可撤销。
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--sim-text)", marginBottom: 6 }}>初始资金 (¥)</div>
                <input
                  type="text" value={resetBalance}
                  onChange={e => setResetBalance(e.target.value)}
                  style={{ ...inputStyle, fontFamily: "var(--sim-mono)", width: "100%", borderColor: resetBalance && !resetBalanceValid ? "var(--sim-up)" : undefined }}
                />
                {resetBalance && !resetBalanceValid && (
                  <div style={{ fontSize: 11.5, color: "var(--sim-up)", marginTop: 4 }}>请输入 10,000 ~ 100,000,000 之间的数字</div>
                )}
              </div>
            </div>
            <div style={{
              display: "flex", gap: 10, justifyContent: "flex-end",
              padding: "20px 24px", marginTop: 8,
              borderTop: "1px solid var(--sim-hairline)", background: "var(--sim-bg-soft)",
            }}>
              <Btn kind="ghost" size="md" onClick={() => { if (!loading) setConfirmTarget(null); }} disabled={loading}>取消</Btn>
              <Btn kind="danger" size="md" onClick={doConfirm} disabled={loading || !resetBalanceValid}>
                {loading ? "处理中..." : "确认重置"}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
