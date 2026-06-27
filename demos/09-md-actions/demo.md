---
viewport: { width: 1280, height: 800 }
---

```js
pause()
visit("../site/new.html")
resume()

zoom(1.4, { origin: "#recipient" })
type("#recipient", "Priya Anand")
wait(400)
type("#address", "48 Marlow Road")
wait(400)
select("#service", "express")
wait(400)

click("text:Generate label", { waitForNav: true })
waitFor("text:Label ready", { state: "visible", timeout: 20000 })
wait(1200)
resetZoom()
wait(800)
```
