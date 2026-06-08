interface Tab {
  value: string;
  label: string;
}

interface TabsProps {
  tabs: Tab[];
  value: string;
  onChange: (value: string) => void;
  size?: "sm" | "md";
}

export function Tabs({ tabs, value, onChange, size = "md" }: TabsProps) {
  return (
    <div style={{ display: "inline-flex", gap: 2, padding: 2, background: "var(--sim-bg-soft)", borderRadius: 8, border: "1px solid var(--sim-border)" }}>
      {tabs.map(t => {
        const active = t.value === value;
        return (
          <button key={t.value} onClick={() => onChange(t.value)}
            style={{
              border: "none", background: active ? "var(--sim-surface)" : "transparent",
              color: active ? "var(--sim-text)" : "var(--sim-text-soft)",
              padding: size === "sm" ? "4px 10px" : "6px 14px",
              fontSize: size === "sm" ? 12 : 13, fontWeight: active ? 600 : 500,
              borderRadius: 6, cursor: "pointer",
              boxShadow: active ? "0 1px 2px rgba(20,17,13,0.05)" : "none",
            }}>{t.label}</button>
        );
      })}
    </div>
  );
}
