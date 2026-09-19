# 🥚 QA Testing Playbook: Palworld Dedicated Server

> **Objective**: Pal capture sync, base worker retention, guild inspector, and Unreal Engine 4-hour memory soak test.

👉 **[🚀 Launch Test Issue in GitLab (1-Click Pre-filled)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-EN%5D+%F0%9F%A5%9A+Palworld+Dedicated+Server&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Apalworld&issue%5Bdescription%5D=%23%23+%F0%9F%A5%9A+QA+Certification%3A+Palworld+Dedicated+Server%0A%0A%3E+%F0%9F%93%96+**Full+step-by-step+testing+guide**%3A+See+the+%5BPalworld+Dedicated+Server+Testing+Playbook%5D%28docs%2Fqa%2Fplaybooks%2Fen%2F04_palworld.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Part+1%3A+Gamer+Tests+%28QA+Tester%29%0A*Check+off+the+boxes+as+you+complete+your+gameplay+session%3A*%0A%0A-+%5B+%5D+**Step+1%3A+Deploy+Palworld+Server**+%28Pass+rule%3A+%60Turns+green+and+binds+UDP+port+8211.%60%29%0A-+%5B+%5D+**Step+2%3A+Join+via+Direct+IP+in+Game**+%28Pass+rule%3A+%60Character+creation+loads+and+player+spawns+on+the+island.%60%29%0A-+%5B+%5D+**Step+3%3A+Pal+Capture+%26+Co-op+Combat+Sync**+%28Pass+rule%3A+%60Capture+percentage+rolls+in+sync+for+all+players%3B+captured+Pal+responds+to+companion+AI+commands.%60%29%0A-+%5B+%5D+**Step+4%3A+Base+Automation+%26+Chunk+Retention**+%28Pass+rule%3A+%60Upon+return%2C+Pals+are+still+actively+working+and+resources+accumulated+in+storage.%60%29%0A-+%5B+%5D+**Step+5%3A+Guild+Inspector+in+Panel**+%28Pass+rule%3A+%60Displays+active+guild+names%2C+roster+members%2C+and+base+coordinates+accurately.%60%29%0A%0A%3E+%F0%9F%92%AC+**Finished+gamer+testing%3F**+Leave+a+comment+tagging+the+developers%3A++%0A%3E+%60%40devs+Finished+gameplay+tests+successfully.+Ready+for+tech+review.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Part+2%3A+Technical+Engine+Tests+%28Developers%29%0A*Terminal+commands+for+development+team%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Rootless+UID+1000%3A1000+Permissions**+%28%60ls+-ld+%3CdataPath%3E%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Unreal+Engine+4-Hour+Memory+Soak+Test**+%28%60docker+stats+%3Cpalworld-container%3E+--no-stream%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+RCON+Broadcast+%26+Admin+Commands**+%28%60curl+-X+POST+http%3A%2F%2Flocalhost%3A3000%2Fapi%2Frcon%2F%3Cid%3E%2Fcommand+-d+%27%7B%22command%22%3A%22Broadcast+Hello%22%7D%27+-H+%22Content-Type%3A+application%2Fjson%22+-H+%22Authorization%3A+Bearer+%24TOKEN%22%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Apalworld%22%0A)**

--- 

## 🎮 PART 1: Gamer & Gameplay Tests (For QA Tester)

*Straightforward instructions to play and stress-test the server like a real customer.*

### Step 1: Deploy Palworld Server 🎮
- **What to do**: Create server in panel with at least 6GB RAM plan and click Start.
- ✅ **PASSED IF**: Turns green and binds UDP port 8211.
- ❌ **FAILED IF**: Startup failure or permission denied on /palworld volume.

### Step 2: Join via Direct IP in Game 🎮
- **What to do**: Open Palworld on Steam, select Multiplayer -> Direct Connection, enter IP:8211.
- ✅ **PASSED IF**: Character creation loads and player spawns on the island.
- ❌ **FAILED IF**: Server not found or black loading screen hangs.

### Step 3: Pal Capture & Co-op Combat Sync 🎮
- **What to do**: Throw Pal Spheres at wild Pals while a teammate attacks them.
- ✅ **PASSED IF**: Capture percentage rolls in sync for all players; captured Pal responds to companion AI commands.
- ❌ **FAILED IF**: Sphere phases through Pal or AI companion freezes.

### Step 4: Base Automation & Chunk Retention 🎮
- **What to do**: Build a base, assign 3 Pals to mining/logging. Travel 1km away and return 10 minutes later.
- ✅ **PASSED IF**: Upon return, Pals are still actively working and resources accumulated in storage.
- ❌ **FAILED IF**: Pals get stuck in T-pose or production state resets.

### Step 5: Guild Inspector in Panel 🎮
- **What to do**: Open Guilds tab in RageNodes dashboard.
- ✅ **PASSED IF**: Displays active guild names, roster members, and base coordinates accurately.
- ❌ **FAILED IF**: Empty response or 500 error.

--- 

## ⚙️ PART 2: Technical Engine Tests (For Developers)

*Terminal commands and Docker inspection verified by developers in 3 minutes.*

### Tech Check 1: Rootless UID 1000:1000 Permissions ⚙️
- **Command / Action**: `ls -ld <dataPath>`
- **Pass Criteria**: Volume belongs to UID 1000:1000, preventing permission denied errors during auto-save writes.

### Tech Check 2: Unreal Engine 4-Hour Memory Soak Test ⚙️
- **Command / Action**: `docker stats <palworld-container> --no-stream`
- **Pass Criteria**: Palworld server GC stabilizes memory consumption below cgroup kill threshold over 4 hours.

### Tech Check 3: RCON Broadcast & Admin Commands ⚙️
- **Command / Action**: `curl -X POST http://localhost:3000/api/rcon/<id>/command -d '{"command":"Broadcast Hello"}' -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN"`
- **Pass Criteria**: Broadcast text banner displays instantly across player viewports in-game.

