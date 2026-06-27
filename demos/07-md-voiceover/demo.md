---
voiceover:
  provider: elevenlabs
  voiceId: EXAVITQu4vr4xnSDxMaL # Sarah
  modelId: eleven_multilingual_v2
---

```js
pause()
visit("../site/new.html")
resume()
```

Welcome to Dispatch — create a shipment and print a label in seconds.

`type("#recipient", "Priya Anand")` Start with who it's going to, `type("#address", "48 Marlow Road")` and where.

Now pick a service — `select("#service", "express")` Express, in this case — then `click("text:Generate label", { waitForNav: true })` generate the label.

```js
waitFor("text:Label ready", { state: "visible", timeout: 20000 })
```

`zoom(1.4, { origin: "#label", duration: 800 })` And there it is — a label with a tracking number, ready to print and ship.

```js
wait(2000)
```

`resetZoom()` From empty form to ready-to-ship in well under a minute.
