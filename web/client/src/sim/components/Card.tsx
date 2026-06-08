import type { CSSProperties, ReactNode } from "react";

interface CardProps {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  padded?: boolean;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}

export function Card({ title, subtitle, action, padded = true, children, style, className }: CardProps) {
  return (
    <div
      className={`sim-card ${className ?? ""}`}
      style={{
        background: "var(--sim-surface)",
        border: "1px solid var(--sim-border)",
        borderRadius: "var(--sim-r-lg)",
        boxShadow: "var(--sim-shadow-card)",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {(title || action) && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px",
          borderBottom: subtitle ? "none" : "1px solid var(--sim-hairline)",
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.01em", color: "var(--sim-text)" }}>{title}</div>
            {subtitle && <div style={{ fontSize: 11.5, color: "var(--sim-text-mute)", marginTop: 2 }}>{subtitle}</div>}
          </div>
          {action}
        </div>
      )}
      <div style={{ padding: padded ? "4px 18px 18px" : 0, flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}
