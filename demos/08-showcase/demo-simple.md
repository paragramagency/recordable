---
viewport: { width: 1280, height: 800 }
typingSpeed: 16
voiceover:
  provider: elevenlabs
  voiceId: EXAVITQu4vr4xnSDxMaL # Sarah
  modelId: eleven_multilingual_v2
---

```
pause()
visit("../site/signin.html")
resume()
```

`insert("intro.mp4", { fadeOut: 500 })` Welcome to Dispatch — today I'll show you how to take an order from new shipment to fully tracked, in under a minute. `type("#email", "maya@northwindgoods.com")` First we sign in with our work account — the address our admin set up `type("#password", "parcels2026")` `click("#signInBtn", { waitForNav: true })` — then our password —  and we're straight into the shipments dashboard. 

`click("text:New shipment", { waitForNav: true })` From here we open a new shipment, `type("#recipient", "Priya Anand")` enter the recipient, `type("#address", "48 Marlow Road")` their address, and choose a service — `select("#service", "express")` Express, in this case. `click("text:Generate label", { waitForNav: true })` Dispatch generates the label and assigns a tracking number.

```
waitFor("text:Label ready", { state: "visible", timeout: 20000 })
```

`zoom(1.3, { origin: "#label", duration: 400 })` There's the label, ready to print. `resetZoom()` We mark it as shipped `click("text:Mark as shipped", { waitForNav: true })` and the parcel moves into tracking.

```
waitFor("text:Out for delivery", { state: "visible", timeout: 20000 })
```

Every stage updates here — `zoom(2, { origin: "#label-created", duration: 400 })` from label created,  `zoom(2, { origin: "#picked-up", duration: 400 })`to picked up, `zoom(2, { origin: "#out-for-delivery", duration: 400 })` to out for delivery. `resetZoom()` Nothing gets lost between the warehouse and the doorstep.

And that's a parcel out the door and fully tracked, in under a minute.

```
wait(1200)
insert("outro.mp4", { fadeIn: 500 })
```
