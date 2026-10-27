export function BertaMark({ size = 42, active = true }: { size?: number; active?: boolean }) {
  return (
    <span
      className={`berta-mark ${active ? "is-active" : ""}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="berta-mark__ring" />
      <span className="berta-mark__sweep" />
      <span className="berta-mark__core">B</span>
    </span>
  );
}
