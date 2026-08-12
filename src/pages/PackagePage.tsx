import { useState, useEffect, useMemo, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"

interface Props {
  projectName: string | null
  projectPath: string | null
}

interface MarsFeature {
  featureId: string
  name: string
  description?: string
  version: string
  author?: string
}

type CombinedFeature = MarsFeature & { isInstalled: boolean; installedVersion?: string }

const REGISTRY_URL = "https://raw.githubusercontent.com/STZ-Robotics/Mars-marketplace/main/registry.json"

export default function PackagePage({ projectName, projectPath }: Props) {
  const [marketplaceData, setMarketplaceData] = useState<MarsFeature[]>([])
  const [installedData, setInstalledData] = useState<MarsFeature[]>([])
  const [loading, setLoading] = useState(true)
  const [registryError, setRegistryError] = useState<string | null>(null)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)

  const [isInstalling, setIsInstalling] = useState(false)
  const [installStatus, setInstallStatus] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState("")
  const [directUrl, setDirectUrl] = useState("")

  const loadPackages = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    setRegistryError(null)

    try {
      const localPackages: MarsFeature[] = await invoke("get_installed_packages", { projectPath })
      setInstalledData(localPackages)
    } catch (e) {
      console.error("Error reading local packages:", e)
    }

    try {
      const registryRes = await fetch(REGISTRY_URL)
      if (!registryRes.ok) throw new Error(`Registry responded with ${registryRes.status}`)
      const registryJson = await registryRes.json()
      const featureUrls: string[] = registryJson.verifiedFeatures || []

      const fetchedFeatures: MarsFeature[] = []
      const failedUrls: string[] = []
      for (const url of featureUrls) {
        try {
          const featRes = await fetch(url)
          if (featRes.ok) fetchedFeatures.push(await featRes.json())
          else failedUrls.push(url)
        } catch (e) {
          failedUrls.push(url)
        }
      }
      setMarketplaceData(fetchedFeatures)
      if (failedUrls.length > 0) {
        setRegistryError(`${failedUrls.length} of ${featureUrls.length} marketplace entries failed to load.`)
      }
      setLastSynced(new Date())
    } catch (error) {
      console.error("Error loading marketplace registry:", error)
      setRegistryError("Could not reach the MARS marketplace registry. Showing locally installed packages only.")
      setMarketplaceData([])
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => { loadPackages() }, [loadPackages])

  const handleInstall = async (featureJsonData: string | object) => {
    if (!projectPath) return
    setIsInstalling(true)
    setInstallStatus("Downloading and compiling Gradle... This may take a moment.")

    try {
      const jsonStr = typeof featureJsonData === "string" ? featureJsonData : JSON.stringify(featureJsonData)
      const result = await invoke<string>("install_package_from_json", { projectPath, featureData: jsonStr })
      setInstallStatus(`SUCCESS: ${result}`)
      setDirectUrl("")
      await loadPackages()
    } catch (err) {
      setInstallStatus(`ERROR: ${err}`)
    } finally {
      setIsInstalling(false)
      setTimeout(() => setInstallStatus(null), 5000)
    }
  }

  const handleDirectInstall = async () => {
    if (!directUrl.trim()) return
    setIsInstalling(true)
    setInstallStatus("Fetching JSON from URL...")
    try {
      const res = await fetch(directUrl)
      if (!res.ok) throw new Error("Invalid URL or network error")
      const json = await res.json()
      await handleInstall(json)
    } catch (err) {
      setInstallStatus("ERROR: Could not fetch feature from URL")
      setIsInstalling(false)
    }
  }

  // Combinación: local + marketplace, sin duplicados
  const combined = useMemo(() => {
    const map = new Map<string, CombinedFeature>()
    marketplaceData.forEach(p => map.set(p.featureId, { ...p, isInstalled: false }))
    installedData.forEach(p => {
      if (map.has(p.featureId)) {
        const existing = map.get(p.featureId)!
        existing.isInstalled = true
        existing.installedVersion = p.version
      } else {
        map.set(p.featureId, { ...p, isInstalled: true, installedVersion: p.version })
      }
    })
    return Array.from(map.values())
  }, [marketplaceData, installedData])

  const filtered = useMemo(() => {
    if (searchQuery.trim() === "") return combined
    const q = searchQuery.toLowerCase()
    return combined.filter(p => p.name.toLowerCase().includes(q) || p.featureId.toLowerCase().includes(q))
  }, [combined, searchQuery])

  const installedList = filtered.filter(p => p.isInstalled)
  const availableList = filtered.filter(p => !p.isInstalled)

  if (!projectName) {
    return <PageShell><p style={{ color: "var(--text-muted)", fontSize: 13 }}>No active project selected.</p></PageShell>
  }

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: "var(--bg-page)", overflow: "hidden" }}>

      {/* SIDEBAR */}
      <div style={{ width: 300, background: "var(--bg-panel)", borderRight: "1px solid var(--border-main)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "24px 20px", borderBottom: "1px solid var(--border-light)", background: "var(--bg-panel)" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Package Manager
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>
            MARS Packages
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4, lineHeight: 1.4 }}>
            Project: <span style={{ color: "var(--mars-accent, var(--mars-red))", fontWeight: 600 }}>{projectName.toUpperCase()}</span><br />
            Dependency registry
          </div>
        </div>

        <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 20, overflowY: "auto" }}>

          <div>
            <label style={labelStyle}>SEARCH PACKAGES</label>
            <div style={{ position: "relative" }}>
              <i className="ti ti-search" style={{ position: "absolute", left: 10, top: 8, color: "var(--text-muted)", fontSize: 14 }} />
              <input
                type="text"
                placeholder="e.g. Limelight..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ ...inputStyle, paddingLeft: 32 }}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>REGISTRY STATUS</label>
            <div style={{ background: "var(--bg-input)", border: "1px solid var(--border-main)", borderRadius: 4, padding: "12px", display: "flex", flexDirection: "column", gap: 8 }}>
              <StatRow label="Installed" value={installedData.length} color="var(--status-success)" />
              <StatRow label="Available" value={marketplaceData.length} />
              <StatRow label="Last synced" value={lastSynced ? lastSynced.toLocaleTimeString() : "—"} />
            </div>
            <button
              onClick={loadPackages}
              disabled={loading}
              style={{
                marginTop: 8, width: "100%", padding: "7px 0", background: "var(--bg-input)",
                border: "1px solid var(--border-main)", borderRadius: 3, color: "var(--text-primary)",
                fontSize: 11, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6
              }}
            >
              <i className={`ti ti-refresh ${loading ? "mars-spin" : ""}`} />
              REFRESH REGISTRY
            </button>
          </div>

          <div style={{ height: 1, background: "var(--border-light)", margin: "4px 0" }} />

          <div>
            <label style={labelStyle}>MANUAL INSTALL</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                type="text"
                placeholder="Paste JSON Feature URL..."
                value={directUrl}
                onChange={(e) => setDirectUrl(e.target.value)}
                style={inputStyle}
                disabled={isInstalling}
              />
              <button
                onClick={handleDirectInstall}
                disabled={isInstalling || !directUrl.trim()}
                style={{
                  padding: "8px 12px", background: isInstalling || !directUrl.trim() ? "var(--bg-input)" : "var(--status-success)",
                  color: isInstalling || !directUrl.trim() ? "var(--text-muted)" : "#fff",
                  border: isInstalling || !directUrl.trim() ? "1px solid var(--border-main)" : "1px solid rgba(0,0,0,0.2)",
                  borderRadius: 3, fontSize: 11, fontWeight: 700, cursor: isInstalling || !directUrl.trim() ? "not-allowed" : "pointer"
                }}
              >
                <i className="ti ti-download" style={{ marginRight: 6 }} />
                INSTALL FROM URL
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        <div style={{ height: 48, background: "var(--bg-menubar)", borderBottom: "1px solid var(--border-main)", display: "flex", alignItems: "center", padding: "0 24px", gap: 16, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Verified Packages</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
            {installedList.length} installed · {availableList.length} available
          </span>
          {isInstalling && (
            <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--status-sim)", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <i className="ti ti-loader mars-spin" />
              BUILDING GRADLE...
            </div>
          )}
        </div>

        <div style={{ flex: 1, padding: "24px 24px 40px", overflowY: "auto" }}>
          <div style={{ width: "100%", maxWidth: 950, margin: "0 auto" }}>

            {installStatus && (
              <div style={{
                marginBottom: 20, padding: "12px 16px", borderRadius: 4, fontSize: 12, fontWeight: 500,
                background: installStatus.includes("ERROR") ? "rgba(214, 92, 92, 0.1)" : "var(--bg-input)",
                border: `1px solid ${installStatus.includes("ERROR") ? "var(--status-error)" : "var(--border-main)"}`,
                color: installStatus.includes("ERROR") ? "var(--status-error)" : "var(--status-sim)"
              }}>
                {installStatus}
              </div>
            )}

            {registryError && (
              <div style={{
                marginBottom: 20, padding: "12px 16px", borderRadius: 4, fontSize: 12, fontWeight: 500,
                background: "rgba(214, 92, 92, 0.08)", border: "1px solid var(--status-error)", color: "var(--status-error)",
                display: "flex", alignItems: "center", gap: 8
              }}>
                <i className="ti ti-alert-triangle" />
                {registryError}
              </div>
            )}

            {loading && combined.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px", color: "var(--text-muted)", fontSize: 13 }}>
                Connecting to MARS Registry...
              </div>
            ) : (
              <>
                <PackageSection
                  title="INSTALLED"
                  count={installedList.length}
                  emptyText="No packages installed in this project yet."
                  packages={installedList}
                  isInstalling={isInstalling}
                  onInstall={handleInstall}
                />
                <PackageSection
                  title="AVAILABLE"
                  count={availableList.length}
                  emptyText={searchQuery ? "No packages match your search." : "No marketplace packages available."}
                  packages={availableList}
                  isInstalling={isInstalling}
                  onInstall={handleInstall}
                />
              </>
            )}

          </div>
        </div>
      </div>

      {/* Keyframe local para el ícono de refresh/loading, sin depender de CSS global */}
      <style>{`
        @keyframes mars-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .mars-spin { display: inline-block; animation: mars-spin 1s linear infinite; }
      `}</style>
    </div>
  )
}

function PackageSection({ title, count, emptyText, packages, isInstalling, onInstall }: {
  title: string
  count: number
  emptyText: string
  packages: CombinedFeature[]
  isInstalling: boolean
  onInstall: (pkg: CombinedFeature) => void
}) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 1 }}>{title}</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--bg-input)", border: "1px solid var(--border-main)", padding: "1px 6px", borderRadius: 3 }}>{count}</span>
        <div style={{ flex: 1, height: 1, background: "var(--border-light)" }} />
      </div>

      {packages.length === 0 ? (
        <div style={{ textAlign: "center", padding: "28px 20px", color: "var(--text-muted)", fontSize: 12, border: "1px dashed var(--border-main)", borderRadius: 4 }}>
          {emptyText}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {packages.map(pkg => (
            <div key={pkg.featureId} style={{
              background: "var(--bg-panel)", border: "1px solid var(--border-main)",
              borderTop: `3px solid ${pkg.isInstalled ? "var(--status-success)" : "var(--mars-accent, var(--mars-red))"}`,
              borderRadius: 4, display: "flex", flexDirection: "column", overflow: "hidden"
            }}>
              <div style={{ padding: "16px", flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{pkg.name}</div>
                  <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", background: "var(--bg-page)", padding: "2px 6px", borderRadius: 3 }}>
                    v{pkg.version}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 12 }}>
                  {pkg.description || "No description provided."}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  By: {pkg.author || "Unknown"}
                </div>
              </div>

              <div style={{ background: "var(--bg-input)", padding: "12px 16px", borderTop: "1px solid var(--border-light)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>{pkg.featureId}</div>

                {pkg.isInstalled ? (
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--status-success)", display: "flex", alignItems: "center", gap: 4 }}>
                    <i className="ti ti-check" />
                    INSTALLED {pkg.installedVersion && `(v${pkg.installedVersion})`}
                  </div>
                ) : (
                  <button
                    onClick={() => onInstall(pkg)}
                    disabled={isInstalling}
                    style={{
                      padding: "6px 14px", background: "var(--mars-accent, var(--mars-red))", border: "none",
                      color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 3, cursor: isInstalling ? "not-allowed" : "pointer"
                    }}
                  >
                    INSTALL
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", background: "var(--bg-page)" }}>{children}</div>
}

function StatRow({ label, value, color }: { label: string, value: string | number, color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 11, color: "var(--text-light)" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: color ?? "var(--text-primary)" }}>{value}</span>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 10, color: "rgba(255,255,255,0.55)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8, fontWeight: 600
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-main)", padding: "8px 12px", borderRadius: 3, fontSize: 12, outline: "none", boxSizing: "border-box"
}