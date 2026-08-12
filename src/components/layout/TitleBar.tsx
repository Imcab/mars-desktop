export default function TitleBar() {
  return (
    <div
      data-tauri-drag-region
      style={{
        background: "var(--bg-dark)", height: 32,
        display: "flex", alignItems: "center",
        padding: "0 0 0 14px", flexShrink: 0, userSelect: "none",
      }}
    >
      <span
        data-tauri-drag-region
        style={{ color: "var(--text-light)", fontSize: 11, letterSpacing: 0.5, flex: 1 }}
      >
        Modular Architecture for Robot Systems
      </span>
    </div>
  )
}