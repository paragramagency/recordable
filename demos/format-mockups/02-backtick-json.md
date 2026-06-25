---
voiceover:
  provider: elevenlabs
  voiceId: 21m00Tcm4TlvDq8ikWAM
  modelId: eleven_multilingual_v2
viewport: { width: 1920, height: 1080 }
cursor: true
---

Welcome to Lumen — the tool that turns weeks of manual marking into minutes. `{"action":"visit","url":"https://app.lumen.edu/demo"}`

Let's create your first evaluation `{"action":"click","target":"text:New evaluation"}` and call it Year 9 Persuasive Writing. `{"action":"type","target":"#title","text":"Year 9 Persuasive Writing"}`

Now choose what to mark against `{"action":"select","target":"#rubric","values":["aqa-gcse-english"]}` — the AQA GCSE English descriptors.

Upload a class set `{"action":"hover","target":"text:Upload"}` `{"action":"click","target":"text:Upload class set"}` and Lumen reads every script, scoring against each criterion. `{"action":"waitFor","target":"text:Scoring complete","state":"visible","timeout":20000}`

Here are the results. `{"action":"scroll","target":"#results"}` Every grade comes with a rationale you can audit, `{"action":"zoom","level":1.5,"origin":"#rationale","duration":800}` so nothing is a black box. `{"action":"wait","ms":2000}`

From cold open to graded class set in under two minutes. `{"action":"resetZoom"}`
