export function fmtMoney(n: number | null | undefined, dp = 2): string {
  if (n == null || isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return sign + "¥" + abs.toLocaleString("zh-CN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtNum(n: number | null | undefined, dp = 2): string {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("zh-CN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtPct(n: number | null | undefined, dp = 2): string {
  if (n == null || isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return sign + (n * 100).toFixed(dp) + "%";
}

export function fmtPctRaw(n: number | null | undefined, dp = 2): string {
  if (n == null || isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(dp) + "%";
}

export function fmtSigned(n: number | null | undefined, dp = 2): string {
  if (n == null || isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return sign + n.toLocaleString("zh-CN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtShares(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  if (n >= 10000) return (n / 10000).toFixed(2) + "万";
  return n.toLocaleString("zh-CN");
}

export function fmtDir(n: number | null | undefined): "up" | "down" | "flat" {
  if (n == null || isNaN(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  const utc8 = new Date(d.getTime() + 8 * 3600000);
  return `${utc8.getUTCFullYear()}-${pad(utc8.getUTCMonth() + 1)}-${pad(utc8.getUTCDate())} ${pad(utc8.getUTCHours())}:${pad(utc8.getUTCMinutes())}:${pad(utc8.getUTCSeconds())}`;
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  const utc8 = new Date(d.getTime() + 8 * 3600000);
  return `${utc8.getUTCFullYear()}-${pad(utc8.getUTCMonth() + 1)}-${pad(utc8.getUTCDate())}`;
}

export function dirColor(dir: "up" | "down" | "flat"): string {
  switch (dir) {
    case "up": return "var(--sim-up)";
    case "down": return "var(--sim-down)";
    default: return "var(--sim-text-mute)";
  }
}

export function dirBg(dir: "up" | "down" | "flat"): string {
  switch (dir) {
    case "up": return "var(--sim-up-soft)";
    case "down": return "var(--sim-down-soft)";
    default: return "var(--sim-bg-soft)";
  }
}
