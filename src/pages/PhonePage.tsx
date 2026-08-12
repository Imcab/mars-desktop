import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { QRCodeSVG } from "qrcode.react"

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
      <div style={{ 
        width: 280, 
        background: "var(--bg-panel)", 
        borderRight: "1px solid var(--border-main)",
        display: "flex", 
        flexDirection: "column",
        flexShrink: 0,
        zIndex: 10
      }}>
        {/* Encabezado del Sidebar */}
        <div style={{ padding: "24px 20px", borderBottom: "1px solid var(--border-light)" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Mobile Connection
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)" }}>
            Phone Telemetry
          </div>
          <div style={{ fontSize: 11, color: "var(--text-light)", marginTop: 6, lineHeight: 1.4 }}>
            Alloy Dashboard<br/>
            Local Network Broadcast
          </div>
        </div>

        {/* Controles de Conexión */}
        <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 20, overflowY: "auto" }}>
          
          <div>
            <label style={labelStyle}>SESSION CONTROLS</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button 
                onClick={handleLaunch}
                disabled={isActive || isScanning}
                style={{
                  ...actionButtonStyle,
                  background: isActive ? "var(--bg-input)" : "var(--bg-menubar)",
                  color: isActive ? "var(--text-muted)" : "#fff",
                  border: isActive ? "1px solid var(--border-main)" : "1px solid rgba(0,0,0,0.2)",
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
                  border: !isActive ? "1px solid var(--border-main)" : "1px solid rgba(0,0,0,0.2)",
                  cursor: !isActive ? "not-allowed" : "pointer",
                }}
              >
                END SESSION
              </button>
            </div>
          </div>

          <div style={{ height: 1, background: "var(--border-light)", margin: "4px 0" }} />

          <div>
            <label style={labelStyle}>NETWORK UTILITIES</label>
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

          {/* STATUS INDICATOR MINI */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto", paddingTop: 20 }}>
            <div style={{ 
              width: 8, height: 8,
              background: isActive ? (isScanning ? "var(--mars-red)" : "var(--module-enabled)") : "var(--text-muted)"
            }} />
            <div style={{ fontSize: 11, color: isActive ? "var(--text-primary)" : "var(--text-muted)", fontWeight: isActive ? 600 : 400 }}>
              {isActive ? (isScanning ? "Detecting IP..." : "Broadcasting active") : "Telemetry offline"}
            </div>
          </div>

        </div>
      </div>

      {/* PANTALLA PRINCIPAL (Datos) */}
      <div style={{ flex: 1, padding: "40px", overflowY: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
        
        <div style={{ width: "100%", maxWidth: 640 }}>
          
          {/* ENCABEZADO MINIMALISTA INTERNO */}
          <div style={{ marginBottom: 40 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
              Mobile Connection
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)" }}>
              Alloy Dashboard QR
            </div>
            <div style={{ fontSize: 11, color: "var(--text-light)", marginTop: 2 }}>
              Scan the code below to cast telemetry to your mobile device
            </div>
          </div>

          {/* TARJETA DEL QR */}
          <div style={{ 
            background: "var(--bg-panel)", 
            border: "1px solid var(--border-main)", 
            borderRadius: 4, 
            padding: "40px", 
            display: "flex", 
            flexDirection: "column", 
            alignItems: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
          }}>
            
            <div style={{ 
              padding: "20px", 
              background: "var(--bg-input)", 
              border: "1px solid var(--border-light)", 
              borderRadius: 4,
              marginBottom: 24,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              minHeight: 240,
              minWidth: 240,
              boxShadow: "inset 0 2px 4px rgba(0,0,0,0.1)"
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
                  size={200}
                  level="M"
                  fgColor="var(--text-primary)"
                  bgColor="transparent"
                />
              )}
            </div>

            {/* CONTROLES DE RED (Línea de URL) */}
            <div style={{ width: "100%", maxWidth: 300, textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>
                BROADCAST URL
              </div>
              <div style={{ 
                padding: "10px 12px", 
                fontSize: 13, 
                fontFamily: "monospace",
                color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                background: "var(--bg-page)", 
                border: "1px solid var(--border-main)", 
                borderRadius: 3,
              }}>
                {isActive ? (isScanning ? "..." : fullUrl) : "—"}
              </div>
            </div>

          </div>

        </div>
      </div>

    </div>
  )
}

// Estilos reutilizables para el Sidebar
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  color: "var(--text-muted)",
  letterSpacing: 0.5,
  textTransform: "uppercase",
  marginBottom: 10,
  fontWeight: 600
}

const actionButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "10px 16px",
  fontSize: 11,
  fontWeight: 700,
  borderRadius: 4,
  letterSpacing: 0.5,
  transition: "all 0.2s"
}