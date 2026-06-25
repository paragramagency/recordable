---
voiceover:
  provider: elevenlabs
  voiceId: 21m00Tcm4TlvDq8ikWAM
  modelId: eleven_multilingual_v2
viewport: { width: 1920, height: 1080 }
cursor: true
---

```ts
visit("https://app.lumen.edu/demo")
click("text:New evaluation")
type("#title", "Year 9 Persuasive Writing")
select("#rubric", "aqa-gcse-english")
hover("text:Upload")
click("text:Upload class set")
waitFor("text:Scoring complete", {state:"visible", timeout:20000})
scroll("#results")
zoom(1.5, {origin:"#rationale", duration:800})
wait(2000)
resetZoom()
```
