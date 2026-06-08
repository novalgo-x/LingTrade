import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { kbApi } from "../api";
import { Card } from "../components/Card";
import { Tag } from "../components/Tag";
import { Btn } from "../components/Btn";
import { Tabs } from "../components/Tabs";
import type { KbFile, KbFileDetail, KbStats } from "../types";

const SOURCES = ["券商研报", "上市公司年报", "行业跟踪", "行业白皮书", "调研纪要", "财报会议", "宏观数据", "课程笔记", "经典材料", "自研笔记"];

export function KnowledgePage({ onNavigate }: { onNavigate?: (page: string) => void } = {}) {
  const [files, setFiles] = useState<KbFile[]>([]);
  const [stats, setStats] = useState<KbStats>({ total: 0, processing: 0, expiringSoon: 0, referenced: 0 });
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<KbFileDetail | null>(null);
  const [filter, setFilter] = useState("all");
  const [source, setSource] = useState("all");
  const [sort, setSort] = useState("recent");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [f, s] = await Promise.all([kbApi.getFiles().catch(() => []), kbApi.getStats().catch(() => stats)]);
    setFiles(f);
    setStats(s);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const hasActive = files.some(f => f.status === "processing" || f.status === "queued");
    if (!hasActive) return;
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [files, refresh]);

  useEffect(() => {
    if (selected == null) { setDetail(null); return; }
    kbApi.getFile(selected).then(setDetail).catch(() => setDetail(null));
  }, [selected]);

  const handleUpload = useCallback(async (fileList: FileList) => {
    for (const file of Array.from(fileList)) {
      await kbApi.upload(file).catch(console.error);
    }
    refresh();
  }, [refresh]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files);
  }, [handleUpload]);

  const handleDelete = useCallback(async (id: number) => {
    await kbApi.deleteFile(id);
    setSelected(null);
    refresh();
  }, [refresh]);

  const handleReprocess = useCallback(async (id: number) => {
    await kbApi.reprocess(id).catch(console.error);
    setSelected(null);
    refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    let r = files.slice();
    if (filter === "expiring") r = r.filter(f => f.daysLeft <= 7);
    if (filter === "referenced") r = r.filter(f => f.refs > 0 && f.status === "ready");
    if (filter === "unread") r = r.filter(f => f.refs === 0 && f.status === "ready");
    if (filter === "processing") r = r.filter(f => f.status === "processing" || f.status === "queued");
    if (source !== "all") r = r.filter(f => f.source === source);
    if (sort === "recent") r.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    if (sort === "expiring") r.sort((a, b) => a.daysLeft - b.daysLeft);
    return r;
  }, [files, filter, source, sort]);

  const processingFiles = files.filter(f => f.status === "processing" || f.status === "queued")
    .sort((a, b) => a.status === "processing" && b.status !== "processing" ? -1 : a.status !== "processing" && b.status === "processing" ? 1 : 0);
  const readyFiles = filtered.filter(f => f.status === "ready" || f.status === "failed");

  const sourceStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of files) if (f.source) map.set(f.source, (map.get(f.source) ?? 0) + 1);
    return SOURCES.map(s => ({ v: s, l: s, count: map.get(s) ?? 0 })).filter(s => s.count > 0);
  }, [files]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input ref={fileInputRef} type="file" accept=".txt,.md,.doc,.docx,.pdf" multiple style={{ display: "none" }}
        onChange={e => { if (e.target.files) { handleUpload(e.target.files); e.target.value = ""; } }} />

      {/* Info banner */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "12px 18px",
        background: "var(--sim-accent-soft, #FEEDD8)", border: "1px solid #F2CFA8", borderRadius: 10,
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--sim-accent)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <div style={{ flex: 1, fontSize: 12.5, color: "var(--sim-text)", lineHeight: 1.5 }}>
          <strong style={{ fontWeight: 600 }}>知识库为投研报告提供决策依据</strong>
          <span style={{ color: "var(--sim-text-soft)" }}>
            　·　上传的研报 / 课程 / 笔记 / 年报会被 Agent 自动解析，生成投研报告时优先引用。
            <span style={{ color: "var(--sim-accent)", fontWeight: 600 }}>系统保留近 30 天上传内容</span>，超期自动清理。
          </span>
        </div>
      </div>

      {/* Upload hero + Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            background: dragOver ? "var(--sim-accent-soft, #FEEDD8)" : "var(--sim-surface)",
            border: dragOver ? "2px dashed var(--sim-accent)" : "2px dashed var(--sim-border-strong)",
            borderRadius: 14, padding: "32px 28px",
            display: "flex", alignItems: "center", gap: 24,
            transition: "all 0.15s ease", cursor: "pointer",
          }}>
          <div style={{
            width: 64, height: 64, borderRadius: 14,
            background: "var(--sim-brand)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
              拖入文件 · 或 <span style={{ color: "var(--sim-brand)", textDecoration: "underline", textUnderlineOffset: 3 }}>点击浏览本地</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--sim-text-mute)", lineHeight: 1.5 }}>
              支持 PDF / DOC / DOCX / TXT / MD · 单文件 ≤ 50 MB · 上传后 Agent 自动解析约 30s-3min
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {["PDF", "DOC", "DOCX", "TXT", "MD"].map(ext => (
                <span key={ext} style={{
                  fontFamily: "var(--sim-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
                  padding: "2px 7px", background: "var(--sim-bg-soft)",
                  border: "1px solid var(--sim-border)", borderRadius: 4, color: "var(--sim-text-soft)",
                }}>{ext}</span>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <Btn kind="primary" size="md" onClick={() => fileInputRef.current?.click()}
              icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}
            >选择文件</Btn>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <KbStatCard label="知识库文件" value={stats.total} sub="总数 · 30 天滚动" cls="brand" />
          <KbStatCard label="被研报引用" value={stats.referenced} sub="已参与投研分析" cls="up" />
          <KbStatCard label="即将过期" value={stats.expiringSoon} sub="≤ 7 天" cls="warn" />
          <KbStatCard label="解析中" value={stats.processing} sub="Agent 处理队列" cls="info" />
        </div>
      </div>

      {/* Processing queue */}
      {processingFiles.length > 0 && (
        <Card title="正在处理" subtitle={`${processingFiles.length} 个文件正在解析 · Agent 正在生成总结、提取关键观点`}
          action={<Tag kind="accent" size="sm">实时</Tag>}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 0, marginTop: 4 }}>
            {processingFiles.map((f, i) => (
              <ProcessingRow key={f.id} file={f} last={i === processingFiles.length - 1} queuePos={i} />
            ))}
          </div>
        </Card>
      )}

      {/* Main: filters + grid */}
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16, alignItems: "flex-start" }}>
        <Card padded={false} style={{ position: "sticky", top: 80 }}>
          <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--sim-hairline)" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--sim-text)" }}>筛选</div>
          </div>
          <div style={{ padding: "10px 8px 14px" }}>
            <FilterGroup label="状态" value={filter} onChange={setFilter} options={[
              { v: "all", l: "全部", count: files.length },
              { v: "referenced", l: "被引用", count: files.filter(f => f.refs > 0 && f.status === "ready").length },
              { v: "unread", l: "尚未引用", count: files.filter(f => f.refs === 0 && f.status === "ready").length },
              { v: "expiring", l: "即将过期", count: files.filter(f => f.daysLeft <= 7).length, cls: "warn" },
              { v: "processing", l: "处理中", count: processingFiles.length },
            ]} />
            <div style={{ height: 1, background: "var(--sim-hairline)", margin: "8px 8px" }} />
            <FilterGroup label="来源" value={source} onChange={setSource} options={[
              { v: "all", l: "全部", count: files.length },
              ...sourceStats,
            ]} />
          </div>
        </Card>

        <Card padded={false}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--sim-hairline)" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{readyFiles.length} 个文件</div>
              <div style={{ fontSize: 11.5, color: "var(--sim-text-mute)", marginTop: 2 }}>点击文件查看 Agent 总结 · 关键观点</div>
            </div>
            <Tabs value={sort} onChange={setSort} size="sm" tabs={[
              { value: "recent", label: "最新上传" },
              { value: "expiring", label: "即将过期" },
            ]} />
          </div>

          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: 12, padding: 14,
          }}>
            {readyFiles.map(f => (
              <FileCard key={f.id} file={f} onSelect={() => setSelected(f.id)} active={f.id === selected} />
            ))}
          </div>

          {readyFiles.length === 0 && (
            <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--sim-text-mute)" }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--sim-text-soft)", marginBottom: 6 }}>
                {files.length === 0 ? "知识库为空" : "该筛选下没有文件"}
              </div>
              <div style={{ fontSize: 12 }}>
                {files.length === 0 ? "上传研报 / 笔记 / 年报，Agent 会自动解析并生成总结" : "试试调整筛选条件，或上传新文件"}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Detail drawer */}
      {detail && <FileDrawer file={detail} onClose={() => setSelected(null)} onDelete={() => handleDelete(detail.id)} onReprocess={() => handleReprocess(detail.id)} onJumpReport={onNavigate ? (reportId: number) => onNavigate(`research:${reportId}`) : undefined} />}
    </div>
  );
}

// ── Sub-components ──

function KbStatCard({ label, value, sub, cls }: { label: string; value: number; sub: string; cls: "brand" | "up" | "warn" | "info" }) {
  const palette: Record<string, { bg: string; fg: string; subFg: string; border?: string }> = {
    brand: { bg: "var(--sim-brand)", fg: "#fff", subFg: "rgba(255,255,255,0.7)" },
    up: { bg: "var(--sim-surface)", fg: "var(--sim-down)", subFg: "var(--sim-text-mute)", border: "1px solid var(--sim-border)" },
    warn: { bg: "#FFF6E0", fg: "#9A6700", subFg: "#9A6700", border: "1px solid #F0DDA1" },
    info: { bg: "var(--sim-surface)", fg: "var(--sim-brand)", subFg: "var(--sim-text-mute)", border: "1px solid var(--sim-border)" },
  };
  const p = palette[cls]!;
  return (
    <div style={{
      padding: "14px 16px", background: p.bg, color: p.fg,
      border: p.border, borderRadius: 10,
      boxShadow: cls === "brand" ? "none" : "var(--sim-shadow-card, 0 1px 3px rgba(20,17,13,0.06))",
      display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 84,
    }}>
      <div style={{ fontSize: 10.5, letterSpacing: "0.04em", textTransform: "uppercase", color: cls === "brand" ? "rgba(255,255,255,0.7)" : "var(--sim-text-mute)" }}>{label}</div>
      <div style={{ fontFamily: "var(--sim-mono)", fontSize: 26, fontWeight: 600, lineHeight: 1, marginTop: 8 }}>{value}</div>
      <div style={{ fontSize: 11, color: p.subFg, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function FilterGroup({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ v: string; l: string; count: number; cls?: string }>;
}) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--sim-text-mute)", letterSpacing: "0.06em", textTransform: "uppercase", padding: "6px 10px 4px" }}>{label}</div>
      {options.map(o => {
        const active = o.v === value;
        return (
          <button key={o.v} onClick={() => onChange(o.v)} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            width: "100%", border: "none", padding: "6px 10px", borderRadius: 6,
            background: active ? "var(--sim-bg-soft)" : "transparent",
            color: active ? "var(--sim-text)" : "var(--sim-text-soft)",
            fontSize: 12.5, fontWeight: active ? 600 : 500, cursor: "pointer", textAlign: "left", fontFamily: "inherit",
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {o.cls === "warn" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#9A6700" }} />}
              {o.l}
            </span>
            <span style={{ fontFamily: "var(--sim-mono)", fontSize: 11, color: "var(--sim-text-mute)" }}>{o.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function ProcessingRow({ file, last, queuePos }: { file: KbFile; last: boolean; queuePos: number }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "32px 1fr 220px 120px",
      gap: 14, alignItems: "center", padding: "12px 0",
      borderBottom: last ? "none" : "1px solid var(--sim-hairline)",
    }}>
      <FileTypeIcon type={file.fileType} size={32} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.originalName}</div>
        <div style={{ fontSize: 11.5, color: "var(--sim-text-mute)", marginTop: 3, fontFamily: "var(--sim-mono)" }}>
          {fmtSize(file.fileSize)} · {fmtTime(file.uploadedAt)}
        </div>
      </div>
      <div>
        {file.status === "processing" ? (
          <div>
            <div style={{ fontSize: 11, color: "var(--sim-text-soft)", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
              <span>{file.progressStep || "处理中"}</span>
              <span style={{ fontFamily: "var(--sim-mono)", fontWeight: 600, color: "var(--sim-accent)" }}>{file.progress}%</span>
            </div>
            <div style={{ height: 4, background: "var(--sim-bg-soft)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${file.progress}%`, height: "100%", background: "var(--sim-accent)", borderRadius: 999, transition: "width 0.3s" }} />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--sim-text-mute)" }}>
            <span style={{ width: 8, height: 8, background: "var(--sim-text-faint)", borderRadius: "50%" }} />
            排队中{queuePos > 0 ? ` · 前面有 ${queuePos} 个任务` : ""}
          </div>
        )}
      </div>
      <div style={{ textAlign: "right" }}>
        <Tag kind={file.status === "processing" ? "accent" : "ghost"} size="sm">
          {file.status === "processing" ? "Agent 解析中" : "等待中"}
        </Tag>
      </div>
    </div>
  );
}

const FILE_TYPE_META: Record<string, { bg: string; fg: string; label: string }> = {
  pdf: { bg: "#FEEBEC", fg: "#B91C2C", label: "PDF" },
  doc: { bg: "#E6EEFB", fg: "#1B4F8C", label: "DOC" },
  docx: { bg: "#E6EEFB", fg: "#1B4F8C", label: "DOC" },
  txt: { bg: "#F2F0EB", fg: "#5A554D", label: "TXT" },
  md: { bg: "#E8F4EC", fg: "#1F8A5B", label: "MD" },
};

function FileTypeIcon({ type, size = 36 }: { type: string; size?: number }) {
  const meta = FILE_TYPE_META[type] ?? { bg: "var(--sim-bg-soft)", fg: "var(--sim-text-soft)", label: type.toUpperCase() };
  return (
    <div style={{
      width: size, height: size, background: meta.bg, color: meta.fg,
      borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--sim-mono)", fontSize: size < 32 ? 9 : 10, fontWeight: 700,
      letterSpacing: "0.04em", flexShrink: 0,
    }}>{meta.label}</div>
  );
}

function FileCard({ file, onSelect, active }: { file: KbFile; onSelect: () => void; active: boolean }) {
  const expiringSoon = file.daysLeft <= 7;
  const expiringCritical = file.daysLeft <= 3;
  return (
    <div onClick={onSelect} style={{
      padding: "14px 16px",
      background: active ? "var(--sim-bg-soft)" : "var(--sim-surface)",
      border: `1px solid ${active ? "var(--sim-brand)" : "var(--sim-border)"}`,
      borderRadius: 10, cursor: "pointer", transition: "all 0.12s ease",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <FileTypeIcon type={file.fileType} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 500, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          } as React.CSSProperties}>{file.originalName}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--sim-text-mute)", marginTop: 4, fontFamily: "var(--sim-mono)" }}>
            <span>{fmtSize(file.fileSize)}</span>
            {file.pageCount && <><span>·</span><span>{file.pageCount} 页</span></>}
          </div>
        </div>
      </div>

      {file.summary && (
        <div style={{
          fontSize: 12, color: "var(--sim-text-soft)", lineHeight: 1.55,
          display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
          overflow: "hidden", minHeight: 56,
        } as React.CSSProperties}>{file.summary}</div>
      )}

      {(file.source || file.tags.length > 0) && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", minHeight: 22 }}>
          {file.source && <Tag kind="brand" size="sm">{file.source}</Tag>}
          {file.tags.slice(0, 2).map((t, i) => <Tag key={i} kind="ghost" size="sm">{t}</Tag>)}
          {file.tags.length > 2 && <Tag kind="ghost" size="sm">+{file.tags.length - 2}</Tag>}
        </div>
      )}

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingTop: 10, borderTop: "1px solid var(--sim-hairline)", fontSize: 11,
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={file.refs > 0 ? "var(--sim-brand)" : "var(--sim-text-faint)"} strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span style={{ fontFamily: "var(--sim-mono)", color: file.refs > 0 ? "var(--sim-brand)" : "var(--sim-text-mute)", fontWeight: 600 }}>{file.refs}</span>
          <span style={{ color: "var(--sim-text-mute)" }}>份研报引用</span>
        </span>
        <span style={{
          display: "flex", alignItems: "center", gap: 4,
          color: expiringCritical ? "var(--sim-up)" : expiringSoon ? "#9A6700" : "var(--sim-text-mute)",
          fontFamily: "var(--sim-mono)", fontWeight: expiringSoon ? 600 : 500,
        }}>
          {expiringSoon && <span style={{ width: 6, height: 6, borderRadius: "50%", background: expiringCritical ? "var(--sim-up)" : "#9A6700" }} />}
          {file.daysLeft}天后清理
        </span>
      </div>
    </div>
  );
}

function FileDrawer({ file, onClose, onDelete, onReprocess, onJumpReport }: { file: KbFileDetail; onClose: () => void; onDelete: () => void; onReprocess: () => void; onJumpReport?: (reportId: number) => void }) {
  const insight = file.insight;
  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(20,17,13,0.32)",
        zIndex: 200, animation: "simFadeIn 0.15s ease",
      }} />
      <style>{`@keyframes simFadeIn{from{opacity:0}to{opacity:1}}@keyframes simSlideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 560,
        background: "var(--sim-surface)", zIndex: 201,
        animation: "simSlideIn 0.18s ease-out",
        display: "flex", flexDirection: "column",
        boxShadow: "-12px 0 32px rgba(20,17,13,0.16)",
      }}>
        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--sim-hairline)", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <FileTypeIcon type={file.fileType} size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>{file.originalName}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, fontSize: 11.5, color: "var(--sim-text-mute)", fontFamily: "var(--sim-mono)" }}>
              <span>{fmtSize(file.fileSize)}</span>
              {file.pageCount && <><span>·</span><span>{file.pageCount} 页</span></>}
              <span>·</span>
              <span>{fmtTime(file.uploadedAt)}</span>
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 30, height: 30, borderRadius: 8,
            background: "var(--sim-bg-soft)", border: "1px solid var(--sim-border)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "var(--sim-text-soft)", flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {/* Tags */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
            {file.source && <Tag kind="brand">{file.source}</Tag>}
            {file.tags.map((t, i) => <Tag key={i} kind="ghost">{t}</Tag>)}
          </div>

          {/* Lifecycle */}
          <DrawerSection title="生命周期">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <DrawerStat label="上传时间" value={fmtTime(file.uploadedAt).split(" ")[0] ?? ""} sub={fmtTime(file.uploadedAt).split(" ")[1] ?? ""} />
              <DrawerStat label="剩余保留" value={`${file.daysLeft} 天`}
                cls={file.daysLeft <= 3 ? "critical" : file.daysLeft <= 7 ? "warn" : "flat"}
                sub={file.daysLeft <= 7 ? "即将过期" : "正常"} />
            </div>
          </DrawerSection>

          {/* Status for failed/processing */}
          {file.status === "failed" && (
            <DrawerSection title="处理状态">
              <div style={{ padding: "14px 16px", background: "var(--sim-up-soft, #FCE8EC)", border: "1px solid var(--sim-up)", borderRadius: 8, fontSize: 13, color: "var(--sim-up)" }}>
                处理失败：{file.errorMessage ?? "未知错误"}
              </div>
            </DrawerSection>
          )}

          {file.status === "processing" && (
            <DrawerSection title="处理状态">
              <div style={{ padding: "14px 16px", background: "var(--sim-bg-soft)", borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: "var(--sim-text-soft)", marginBottom: 6 }}>{file.progressStep || "处理中..."}</div>
                <div style={{ height: 4, background: "var(--sim-border)", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${file.progress}%`, height: "100%", background: "var(--sim-accent)", borderRadius: 999, transition: "width 0.3s" }} />
                </div>
              </div>
            </DrawerSection>
          )}

          {/* Agent summary */}
          {insight?.summary && (
            <DrawerSection title="Agent 自动总结" badge="AI">
              <div style={{
                fontSize: 13, color: "var(--sim-text-soft)", lineHeight: 1.7,
                padding: "14px 16px", background: "var(--sim-bg-soft)", borderRadius: 8,
                border: "1px solid var(--sim-border)",
              }}>{insight.summary}</div>
            </DrawerSection>
          )}

          {/* Key points */}
          {insight && insight.keyPoints.length > 0 && (
            <DrawerSection title="关键观点">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {insight.keyPoints.map((p, i) => (
                  <div key={i} style={{
                    display: "flex", gap: 10, alignItems: "flex-start",
                    padding: "10px 12px", background: "var(--sim-surface-2, #FBFBF9)",
                    border: "1px solid var(--sim-hairline)", borderRadius: 8,
                  }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: 4,
                      background: "var(--sim-brand)", color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1,
                      fontFamily: "var(--sim-mono)",
                    }}>{i + 1}</span>
                    <span style={{ fontSize: 12.5, color: "var(--sim-text)", lineHeight: 1.6 }}>{p}</span>
                  </div>
                ))}
              </div>
            </DrawerSection>
          )}

          {/* Market outlook */}
          {insight?.marketOutlook && insight.marketOutlook !== "文档内容待分析。" && (
            <DrawerSection title="市场观点">
              <div style={{ fontSize: 13, color: "var(--sim-text-soft)", lineHeight: 1.7, padding: "14px 16px", background: "var(--sim-bg-soft)", borderRadius: 8, border: "1px solid var(--sim-border)" }}>
                {insight.marketOutlook}
              </div>
            </DrawerSection>
          )}

          {/* Sector views */}
          {insight && insight.sectorViews.length > 0 && (
            <DrawerSection title="行业观点">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {insight.sectorViews.map((s, i) => (
                  <div key={i} style={{ padding: "8px 12px", background: "var(--sim-surface-2, #FBFBF9)", border: "1px solid var(--sim-hairline)", borderRadius: 8, fontSize: 12.5, color: "var(--sim-text)", lineHeight: 1.6 }}>
                    {s}
                  </div>
                ))}
              </div>
            </DrawerSection>
          )}

          {/* Stock mentions */}
          {insight && insight.stockMentions.length > 0 && (
            <DrawerSection title="个股提及">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {insight.stockMentions.map((s, i) => (
                  <div key={i} style={{ padding: "8px 12px", background: "var(--sim-surface-2, #FBFBF9)", border: "1px solid var(--sim-hairline)", borderRadius: 8, fontSize: 12.5, color: "var(--sim-text)", lineHeight: 1.6 }}>
                    {s}
                  </div>
                ))}
              </div>
            </DrawerSection>
          )}

          {/* Risk factors */}
          {insight && insight.riskFactors.length > 0 && (
            <DrawerSection title="风险因素">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {insight.riskFactors.map((r, i) => (
                  <div key={i} style={{ padding: "8px 12px", background: "#FFF6E0", border: "1px solid #F0DDA1", borderRadius: 8, fontSize: 12.5, color: "#9A6700", lineHeight: 1.6 }}>
                    {r}
                  </div>
                ))}
              </div>
            </DrawerSection>
          )}

          {/* References */}
          <DrawerSection title="被引用情况"
            badge={file.refs > 0 ? `${file.refs} 份研报` : "尚未引用"}
          >
            {file.refs > 0 && file.refList ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {file.refList.map(ref => (
                  <div key={ref.reportId}
                    onClick={() => onJumpReport?.(ref.reportId)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 12px", border: "1px solid var(--sim-border)",
                      borderRadius: 8, cursor: onJumpReport ? "pointer" : "default", background: "var(--sim-surface)",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => { if (onJumpReport) e.currentTarget.style.background = "var(--sim-bg-soft)"; }}
                    onMouseLeave={e => { if (onJumpReport) e.currentTarget.style.background = "var(--sim-surface)"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--sim-brand)" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      <span style={{ fontFamily: "var(--sim-mono)", fontSize: 12.5, fontWeight: 600, color: "var(--sim-brand)" }}>{ref.stockName}</span>
                      <span style={{ fontSize: 11, color: "var(--sim-text-mute)" }}>{fmtTime(ref.createdAt)}</span>
                    </div>
                    <span style={{ fontSize: 11.5, color: "var(--sim-text-mute)" }}>查看研报 →</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{
                padding: "14px 16px", fontSize: 12.5, color: "var(--sim-text-mute)",
                background: "var(--sim-surface-2, #FBFBF9)", borderRadius: 8, border: "1px dashed var(--sim-border)",
                textAlign: "center", lineHeight: 1.6,
              }}>
                此文件尚未被任何研报引用<br />
                <span style={{ fontSize: 11, color: "var(--sim-text-faint, #C5C3BE)" }}>Agent 会在生成相关标的研报时优先匹配</span>
              </div>
            )}
          </DrawerSection>
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid var(--sim-hairline)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn kind="ghost" size="md" onClick={() => window.open(`/api/kb/files/${file.id}/download`)}
            icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>}
          >下载原文</Btn>
          <Btn kind="ghost" size="md" onClick={onReprocess}>重新解析</Btn>
          <Btn kind="danger" size="md" onClick={onDelete}>删除</Btn>
        </div>
      </div>
    </>
  );
}

function DrawerSection({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--sim-text-mute)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{title}</span>
        {badge && <Tag kind="brand" size="sm">{badge}</Tag>}
      </div>
      {children}
    </div>
  );
}

function DrawerStat({ label, value, sub, cls }: { label: string; value: string; sub: string; cls?: string }) {
  const color = cls === "critical" ? "var(--sim-up)" : cls === "warn" ? "#9A6700" : "var(--sim-text)";
  return (
    <div style={{ padding: "10px 12px", background: "var(--sim-surface-2, #FBFBF9)", border: "1px solid var(--sim-hairline)", borderRadius: 8 }}>
      <div style={{ fontSize: 10.5, color: "var(--sim-text-mute)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontFamily: "var(--sim-mono)", fontSize: 16, fontWeight: 600, color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--sim-text-mute)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Helpers ──

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}
