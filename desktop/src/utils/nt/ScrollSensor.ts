// Adaptado de AdvantageScope ScrollSensor.ts (Littleton Robotics, BSD).
// Sin cambios de lógica: normaliza scroll/trackpad/drag a deltas (dx, dy)
// usando el truco de un contenedor scrolleable gigante recentrado en cada
// reset, para que el gesto se sienta igual en trackpad, mouse wheel y drag.
export default class ScrollSensor {
  private SIZE_PX = 1000000
  private RESET_MS = 1000

  private container: HTMLElement
  private lastScrollUpdate = 0
  private resetNext = false
  private lastScrollLeft = 0
  private lastScrollTop = 0

  private panActive = false
  private panLastCursorX = 0

  constructor(container: HTMLElement, callback: (dx: number, dy: number) => void, enableMouseControls = true) {
    this.container = container
    this.resetNext = true

    this.container.addEventListener("scroll", () => this.update(callback))

    if (enableMouseControls) {
      container.addEventListener("mousedown", (event) => {
        if (event.shiftKey) return
        this.panActive = true
        this.panLastCursorX = event.clientX - container.getBoundingClientRect().x
      })
      container.addEventListener("mouseleave", () => { this.panActive = false })
      container.addEventListener("mouseup", () => { this.panActive = false })
      container.addEventListener("mousemove", (event) => {
        if (this.panActive) {
          const cursorX = event.clientX - container.getBoundingClientRect().x
          callback(this.panLastCursorX - cursorX, 0)
          this.panLastCursorX = cursorX
        }
      })
    }
  }

  /** Llamar en cada frame para disparar resets si hace falta. */
  periodic() {
    const now = Date.now()
    if (this.resetNext || now - this.lastScrollUpdate > this.RESET_MS) {
      this.resetNext = false
      this.reset()
    }
  }

  private update(callback: (dx: number, dy: number) => void) {
    this.lastScrollUpdate = Date.now()
    if (this.resetNext) { this.resetNext = false; this.reset() }
    if (this.container.offsetWidth === 0 && this.container.offsetHeight === 0) {
      this.resetNext = true
      return
    }
    const dx = this.container.scrollLeft - this.lastScrollLeft
    const dy = this.container.scrollTop - this.lastScrollTop
    this.lastScrollLeft = this.container.scrollLeft
    this.lastScrollTop = this.container.scrollTop
    callback(dx, dy)
  }

  private reset() {
    const middle = this.SIZE_PX / 2
    this.container.scrollLeft = middle
    this.container.scrollTop = middle
    this.lastScrollLeft = middle
    this.lastScrollTop = middle
  }
}