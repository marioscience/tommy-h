# ☢️ QA Testing Playbook: Rust Dedicated Server

> **Objective**: AK-47 combatlog ballistics, uMod hot-reload, wipe tool verification, and 3-port proxy routing.

👉 **[🚀 Launch Test Issue in GitLab (1-Click Pre-filled)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-EN%5D+%E2%98%A2%EF%B8%8F+Rust+Dedicated+Server&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Arust&issue%5Bdescription%5D=%23%23+%E2%98%A2%EF%B8%8F+QA+Certification%3A+Rust+Dedicated+Server%0A%0A%3E+%F0%9F%93%96+**Full+step-by-step+testing+guide**%3A+See+the+%5BRust+Dedicated+Server+Testing+Playbook%5D%28docs%2Fqa%2Fplaybooks%2Fen%2F03_rust.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Part+1%3A+Gamer+Tests+%28QA+Tester%29%0A*Check+off+the+boxes+as+you+complete+your+gameplay+session%3A*%0A%0A-+%5B+%5D+**Step+1%3A+Deploy+Rust+Server+%26+Start**+%28Pass+rule%3A+%60Server+turns+green+and+console+indicates+procedural+map+generation.%60%29%0A-+%5B+%5D+**Step+2%3A+Connect+via+In-Game+F1+Console**+%28Pass+rule%3A+%60Loads+procedural+map+and+spawns+player+on+the+beach.%60%29%0A-+%5B+%5D+**Step+3%3A+AK-47+Ballistics+%26+Combatlog+Hitreg**+%28Pass+rule%3A+%60Crisp+hitmarker+audio+plays%3B+typing+combatlog+in+F1+console+confirms+valid+server-authoritative+hits.%60%29%0A-+%5B+%5D+**Step+4%3A+1-Click+uMod+Plugin+Install+%26+Hot+Reload**+%28Pass+rule%3A+%60.cs+file+downloads+to+%2Foxide%2Fplugins+and+Oxide+C%23+compiler+hot-reloads+it+without+rebooting.%60%29%0A-+%5B+%5D+**Step+5%3A+Test+Map+Wipe+Tool**+%28Pass+rule%3A+%60Server+unlinks+.map+and+.sav+files+but+preserves+player+blueprints.%60%29%0A%0A%3E+%F0%9F%92%AC+**Finished+gamer+testing%3F**+Leave+a+comment+tagging+the+developers%3A++%0A%3E+%60%40devs+Finished+gameplay+tests+successfully.+Ready+for+tech+review.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Part+2%3A+Technical+Engine+Tests+%28Developers%29%0A*Terminal+commands+for+development+team%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+L4+Multi-Port+Proxy+Triplet**+%28%60docker+port+%3Crust-container%3E%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Server+FPS+%26+Garbage+Collection+Pauses**+%28%60docker+exec+-it+%3Crust-container%3E+rcon+%22serverinfo%22%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Live+Killfeed+%26+Chat+API+Feed**+%28%60curl+-s+http%3A%2F%2Flocalhost%3A3000%2Fapi%2Frcon%2F%3Cid%3E%2Fkillfeed+-H+%22Authorization%3A+Bearer+%24TOKEN%22%60%29%0A-+%5B+%5D+**TC-DEV-4%3A+Server+Identity+Isolation**+%28%60ls+-la+%3CdataPath%3E%2Fserver%2Fragenodes%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Arust%22%0A)**

--- 

## 🎮 PART 1: Gamer & Gameplay Tests (For QA Tester)

*Straightforward instructions to play and stress-test the server like a real customer.*

### Step 1: Deploy Rust Server & Start 🎮
- **What to do**: Deploy Rust server with at least 6GB RAM plan. Click Start.
- ✅ **PASSED IF**: Server turns green and console indicates procedural map generation.
- ❌ **FAILED IF**: OOM failure or port 28015/28016 conflict.

### Step 2: Connect via In-Game F1 Console 🎮
- **What to do**: Open Rust on Steam. Press F1 and enter: client.connect <IP:28015>.
- ✅ **PASSED IF**: Loads procedural map and spawns player on the beach.
- ❌ **FAILED IF**: Connection Attempt Failed error.

### Step 3: AK-47 Ballistics & Combatlog Hitreg 🎮
- **What to do**: Have a friend sprint 50m away while firing an AK-47 at them.
- ✅ **PASSED IF**: Crisp hitmarker audio plays; typing combatlog in F1 console confirms valid server-authoritative hits.
- ❌ **FAILED IF**: Bullets pass through without damage or hitmarker has >500ms delay.

### Step 4: 1-Click uMod Plugin Install & Hot Reload 🎮
- **What to do**: Install uMod plugin (e.g. GatherManager) from panel.
- ✅ **PASSED IF**: .cs file downloads to /oxide/plugins and Oxide C# compiler hot-reloads it without rebooting.
- ❌ **FAILED IF**: C# compiler error or plugin fails to load.

### Step 5: Test Map Wipe Tool 🎮
- **What to do**: Click "Server Wipe" in panel and select "Map Only".
- ✅ **PASSED IF**: Server unlinks .map and .sav files but preserves player blueprints.
- ❌ **FAILED IF**: Fails to wipe world or wipes blueprints accidentally.

--- 

## ⚙️ PART 2: Technical Engine Tests (For Developers)

*Terminal commands and Docker inspection verified by developers in 3 minutes.*

### Tech Check 1: L4 Multi-Port Proxy Triplet ⚙️
- **Command / Action**: `docker port <rust-container>`
- **Pass Criteria**: OxideProxy binds Game (28015), RCON (28016), and Query (28017) UDP/TCP ports cleanly.

### Tech Check 2: Server FPS & Garbage Collection Pauses ⚙️
- **Command / Action**: `docker exec -it <rust-container> rcon "serverinfo"`
- **Pass Criteria**: Server maintains target tickrate (30-60 FPS) and GC pauses do not exceed 20ms.

### Tech Check 3: Live Killfeed & Chat API Feed ⚙️
- **Command / Action**: `curl -s http://localhost:3000/api/rcon/<id>/killfeed -H "Authorization: Bearer $TOKEN"`
- **Pass Criteria**: API parses live player kills and global chat from server stdout stream.

### Tech Check 4: Server Identity Isolation ⚙️
- **Command / Action**: `ls -la <dataPath>/server/ragenodes`
- **Pass Criteria**: All world data files reside strictly inside /server/ragenodes/ directory.

