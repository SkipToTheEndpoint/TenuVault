import { app, Menu, nativeImage, Tray } from "electron"
import trayIcon from "../../resources/tray.png?asset"
import trayTemplate from "../../resources/trayTemplate.png?asset"

export interface TrayActions {
  open: () => void
  backUpAll: () => void
  nextBackup: () => string | null
  quit: () => void
}

/** System tray (Windows) or menu bar (macOS) icon that keeps scheduled backups running. */
export class AppTray {
  private tray: Tray | null = null
  /** False when the icon image could not be loaded (for example a packaging mistake). */
  iconLoaded = false

  constructor(private readonly actions: TrayActions) {}

  create(): void {
    if (this.tray) return
    const image = nativeImage.createFromPath(process.platform === "darwin" ? trayTemplate : trayIcon)
    this.iconLoaded = !image.isEmpty()
    if (process.platform === "darwin") image.setTemplateImage(true)
    this.tray = new Tray(image)
    this.tray.setToolTip("TenuVault")
    this.tray.on("click", () => this.actions.open())
    this.refresh()
  }

  /** Rebuilds the menu, for example when schedules change. */
  refresh(): void {
    if (!this.tray) return
    const next = this.actions.nextBackup()
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open TenuVault", click: () => this.actions.open() },
        { label: "Back up all tenants now", click: () => this.actions.backUpAll() },
        { type: "separator" },
        { label: next ? `Next backup: ${next}` : "No scheduled backups", enabled: false },
        { type: "separator" },
        { label: `Quit ${app.getName()}`, click: () => this.actions.quit() },
      ]),
    )
  }
}
