import { invoke } from "@tauri-apps/api/core"
import { useState, useEffect } from "react"

export interface MarsSettings {
  team_number: string
  workspace_path: string
  tools_path: string
  auto_save_deploy: boolean
}

export const defaultSettings: MarsSettings = {
  team_number: "",
  workspace_path: "",
  tools_path: "",
  auto_save_deploy: true,
}

export function useMarsSettings() {
  const [settings, setSettings] = useState<MarsSettings>(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    invoke<MarsSettings>("read_mars_settings")
      .then(s => { setSettings(s); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [])

  const save = async (updated: MarsSettings) => {
    await invoke("write_mars_settings", { settings: updated })
    setSettings(updated)
  }

  return { settings, setSettings, save, loading, error }
}