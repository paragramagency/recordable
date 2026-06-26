---
voiceover:
  provider: elevenlabs
  voiceId: EXAVITQu4vr4xnSDxMaL # Sarah — a default voice usable on the free plan
  modelId: eleven_multilingual_v2
---

```
pause()
visit("./index.html")
resume()
```

Welcome to Lumen — the tool that turns weeks of manual marking into minutes. 

`click("text:New evaluation")` Let's create your first evaluation `type("#title", "Year 9 Persuasive Writing")` and call it Year 9 Persuasive Writing.

Now choose what to mark agains, in this case the `select("#rubric", "aqa-gcse-english")` AQA GCSE English descriptors.

Upload a class set `hover("#upload")` `wait(300)` `click("text:Upload class set")` and Lumen reads every script, scoring against each criterion.

```
waitFor("text:Scoring complete", { state: "visible", timeout: 20000 })
```

`scroll("#results")` `zoom(1.5, { origin: "#rationale", duration: 800 })` Here are the results.  Every grade comes with a rationale you can audit, so nothing is a black box.

```
wait(2000)
```

`resetZoom()` From cold open to graded class set in under two minutes.
