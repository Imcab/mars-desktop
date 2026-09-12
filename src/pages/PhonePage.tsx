import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { QRCodeSVG } from "qrcode.react"
import PageHeader from "../components/layout/PageHeader"
import PanelHeader from "../components/layout/PanelHeader"
import Panel from "../components/common/Panel"

export default function PhonePage() {
  const [ipAddress, setIpAddress] = useState<string>("127.0.0.1")
  const [isScanning, setIsScanning] = useState<boolean>(false)
  const [isActive, setIsActive] = useState<boolean>(false)
  const port = 5800

  const fetchNetworkInfo = async () => {
    setIsScanning(true)
    try {
      const ip = await invoke<string>("get_local_ip")
      setIpAddress(ip)
    } catch (error) {
      console.error("Error fetching IP:", error)
      setIpAddress("127.0.0.1")
    } finally {
      setIsScanning(false)
    }
  }

  const handleLaunch = () => {
    setIsActive(true)
    fetchNetworkInfo()
  }

  const handleEnd = () => {
    setIsActive(false)
  }

  const fullUrl = `http://${ipAddress}:${port}`

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: "var(--bg-page)", overflow: "hidden" }}>

      {/* SIDEBAR (Herramientas de Red) */}
      <div style={{ width: 280, background: "var(--bg-panel)", borderRight: "1px solid var(--border-main)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <PageHeader
          eyebrow="Mobile Connection"
          title="Phone Telemetry"
          subtitle={<>Alloy Dashboard<br />Local Network Broadcast</>}
        />

        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", flex: 1 }}>

          <Panel title="Session Controls" icon="ti-player-play">
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8 }}>
              <button
                onClick={handleLaunch}
                disabled={isActive || isScanning}
                style={{
                  ...actionButtonStyle,
                  background: isActive ? "var(--bg-input)" : "var(--mars-accent)",
                  color: isActive ? "var(--text-muted)" : "#fff",
                  border: isActive ? "1px solid var(--border-main)" : "1px solid var(--mars-accent)",
                  cursor: isActive ? "not-allowed" : "pointer",
                }}
              >
                LAUNCH TELEMETRY
              </button>

              <button
                onClick={handleEnd}
                disabled={!isActive}
                style={{
                  ...actionButtonStyle,
                  background: !isActive ? "var(--bg-input)" : "var(--module-disabled)",
                  color: !isActive ? "var(--text-muted)" : "#fff",
                  border: !isActive ? "1px solid var(--border-main)" : "1px solid var(--module-disabled)",
                  cursor: !isActive ? "not-allowed" : "pointer",
                }}
              >
                END SESSION
              </button>
            </div>
          </Panel>

          <Panel title="Network Utilities" icon="ti-network">
            <div style={{ padding: 8 }}>
              <button
                onClick={fetchNetworkInfo}
                disabled={!isActive || isScanning}
                style={{
                  ...actionButtonStyle,
                  background: (!isActive || isScanning) ? "var(--bg-input)" : "var(--bg-panel)",
                  color: (!isActive || isScanning) ? "var(--text-muted)" : "var(--text-primary)",
                  border: "1px solid var(--border-main)",
                  cursor: (!isActive || isScanning) ? "not-allowed" : "pointer",
                }}
              >
                <i className="ti ti-reload" style={{ fontSize: 16, color: (!isActive || isScanning) ? "var(--text-muted)" : "var(--text-secondary)" }} />
                REFRESH IP ADDRESS
              </button>
            </div>
          </Panel>

          {/* STATUS INDICATOR MINI */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto" }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: isActive ? (isScanning ? "var(--mars-red)" : "var(--module-enabled)") : "var(--text-muted)"
            }} />
            <span style={{ fontSize: 11, color: isActive ? "var(--text-primary)" : "var(--text-muted)", fontWeight: isActive ? 600 : 400 }}>
              {isActive ? (isScanning ? "Detecting IP..." : "Broadcasting active") : "Telemetry offline"}
            </span>
          </div>

        </div>
      </div>

      {/* PANTALLA PRINCIPAL (Datos) */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <PanelHeader title="Alloy Dashboard QR" meta="Scan the code below to cast telemetry to your mobile device" />

        <div style={{ flex: 1, padding: "32px", overflowY: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
          <div style={{ width: "100%", maxWidth: 420 }}>
            <Panel title="Broadcast" icon="ti-qrcode">
              <div style={{ padding: 24, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{
                  padding: 20, background: "var(--bg-input)", border: "1px solid var(--border-main)", borderRadius: 3,
                  marginBottom: 20, display: "flex", justifyContent: "center", alignItems: "center", minHeight: 220, minWidth: 220,
                }}>
                  {!isActive ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                      <i className="ti ti-qrcode-off" style={{ fontSize: 32, color: "var(--text-muted)", opacity: 0.5 }} />
                      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Session is offline.</span>
                    </div>
                  ) : isScanning ? (
                    <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Scanning network interfaces...</div>
                  ) : (
                    <QRCodeSVG
                      value={fullUrl}
                      size={190}
                      level="M"
                      fgColor="var(--text-primary)"
                      bgColor="transparent"
                    />
                  )}
                </div>

                <div style={{ width: "100%" }}>
                  <PropertyBroadcastUrl value={isActive ? (isScanning ? "..." : fullUrl) : "—"} active={isActive} />
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </div>

    </div>
  )
}

function PropertyBroadcastUrl({ value, active }: { value: string, active: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", border: "1px solid var(--border-light)", borderRadius: 2 }}>
      <div style={{ padding: "6px 10px", fontSize: 10, color: "var(--text-muted)", borderRight: "1px solid var(--border-light)", flexShrink: 0 }}>
        URL
      </div>
      <div style={{ padding: "6px 10px", fontSize: 12, fontFamily: "monospace", color: active ? "var(--text-primary)" : "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  )
}

const actionButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "8px 16px",
  fontSize: 11,
  fontWeight: 700,
  borderRadius: 3,
  letterSpacing: 0.5,
  width: "100%",
}
