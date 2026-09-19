# 🧟‍♂️ QA Testing Playbook: Project Zomboid Dedicated Server

> **Objective**: Highway road trip vehicle sync, shotgun horde combat, 1-click Steam Workshop mods, and safe JVM heap.

👉 **[🚀 Launch Test Issue in GitLab (1-Click Pre-filled)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-EN%5D+%F0%9F%A7%9F%E2%80%8D%E2%99%82%EF%B8%8F+Project+Zomboid+Dedicated+Server&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Azomboid&issue%5Bdescription%5D=%23%23+%F0%9F%A7%9F%E2%80%8D%E2%99%82%EF%B8%8F+QA+Certification%3A+Project+Zomboid+Dedicated+Server%0A%0A%3E+%F0%9F%93%96+**Full+step-by-step+testing+guide**%3A+See+the+%5BProject+Zomboid+Dedicated+Server+Testing+Playbook%5D%28docs%2Fqa%2Fplaybooks%2Fen%2F09_project_zomboid.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Part+1%3A+Gamer+Tests+%28QA+Tester%29%0A*Check+off+the+boxes+as+you+complete+your+gameplay+session%3A*%0A%0A-+%5B+%5D+**Step+1%3A+Deploy+Server+%26+Boot**+%28Pass+rule%3A+%60Status+turns+green+%28%22Online%22%29+and+displays+ports+16261+and+16262.%60%29%0A-+%5B+%5D+**Step+2%3A+1-Click+Steam+Workshop+Mod+Install**+%28Pass+rule%3A+%60Panel+confirms+install+and+startup+log+verifies+SteamCMD+downloading+mod+files.%60%29%0A-+%5B+%5D+**Step+3%3A+Two-Player+Co-op+Join**+%28Pass+rule%3A+%60Both+spawn+in+starting+house%2C+see+each+other+move%2C+and+local+chat+functions.%60%29%0A-+%5B+%5D+**Step+4%3A+Highway+70+MPH+Road+Trip+%28Vehicle+Desync%29**+%28Pass+rule%3A+%60Passenger+remains+firmly+seated%3B+road+tiles+render+ahead+without+void+holes.%60%29%0A-+%5B+%5D+**Step+5%3A+Shotgun+Horde+Combat+%26+Hitreg**+%28Pass+rule%3A+%60Melee+swings+knock+zombies+back+instantly%3B+zero+ghost+bites+from+distance.%60%29%0A%0A%3E+%F0%9F%92%AC+**Finished+gamer+testing%3F**+Leave+a+comment+tagging+the+developers%3A++%0A%3E+%60%40devs+Finished+gameplay+tests+successfully.+Ready+for+tech+review.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Part+2%3A+Technical+Engine+Tests+%28Developers%29%0A*Terminal+commands+for+development+team%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Safe+JVM+Headspace+Calculation**+%28%60docker+inspect+%3Cpz-container%3E+%7C+grep+MAX_RAM%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Dual+UDP+Port+Routing+%2816261+%26+16262%29**+%28%60docker+port+%3Cpz-container%3E%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Abrupt+Disconnect+%26+Reconnect+Recovery**+%28%60tc+qdisc+add+dev+docker0+root+netem+loss+10%25%60%29%0A-+%5B+%5D+**TC-DEV-4%3A+Clean+Teardown+%26+Volume+Purge**+%28%60docker+ps+-a+%7C+grep+zomboid%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Azomboid%22%0A)**

--- 

## 🎮 PART 1: Gamer & Gameplay Tests (For QA Tester)

*Straightforward instructions to play and stress-test the server like a real customer.*

### Step 1: Deploy Server & Boot 🎮
- **What to do**: Create Project Zomboid server in panel with at least 6GB RAM. Click Start.
- ✅ **PASSED IF**: Status turns green ("Online") and displays ports 16261 and 16262.
- ❌ **FAILED IF**: Hangs on startup or Java memory error.

### Step 2: 1-Click Steam Workshop Mod Install 🎮
- **What to do**: In Mods tab, enter Workshop ID: 2688809268 and Mod Name: CommonSense. Click Install and reboot.
- ✅ **PASSED IF**: Panel confirms install and startup log verifies SteamCMD downloading mod files.
- ❌ **FAILED IF**: Error popup or server.ini corrupts.

### Step 3: Two-Player Co-op Join 🎮
- **What to do**: Launch Project Zomboid on Steam, join by IP:16261 with a friend.
- ✅ **PASSED IF**: Both spawn in starting house, see each other move, and local chat functions.
- ❌ **FAILED IF**: Server not responding or black loading screen.

### Step 4: Highway 70 MPH Road Trip (Vehicle Desync) 🎮
- **What to do**: Board a van (driver + passenger) and accelerate full throttle down highway for 3 minutes.
- ✅ **PASSED IF**: Passenger remains firmly seated; road tiles render ahead without void holes.
- ❌ **FAILED IF**: Passenger rubberbands onto asphalt or car falls through map.

### Step 5: Shotgun Horde Combat & Hitreg 🎮
- **What to do**: Fire 5 shotgun blasts in town center to draw 100+ zombies. Fight in melee with bats.
- ✅ **PASSED IF**: Melee swings knock zombies back instantly; zero ghost bites from distance.
- ❌ **FAILED IF**: Zombies glide without walking animations or bite through walls.

--- 

## ⚙️ PART 2: Technical Engine Tests (For Developers)

*Terminal commands and Docker inspection verified by developers in 3 minutes.*

### Tech Check 1: Safe JVM Headspace Calculation ⚙️
- **Command / Action**: `docker inspect <pz-container> | grep MAX_RAM`
- **Pass Criteria**: buildProjectZomboidRuntime reserves 1.5GB (1536MB) for OS and Metaspace, avoiding OOM kill code 137.

### Tech Check 2: Dual UDP Port Routing (16261 & 16262) ⚙️
- **Command / Action**: `docker port <pz-container>`
- **Pass Criteria**: Port 16261 (handshake) and 16262 (direct data) route cleanly through OxideProxy.

### Tech Check 3: Abrupt Disconnect & Reconnect Recovery ⚙️
- **Command / Action**: `tc qdisc add dev docker0 root netem loss 10%`
- **Pass Criteria**: Server tolerates packet bursts, avoids duplicating player inventory on reconnect, and cleans zombie entity.

### Tech Check 4: Clean Teardown & Volume Purge ⚙️
- **Command / Action**: `docker ps -a | grep zomboid`
- **Pass Criteria**: Deleting server purges Docker container, unlinks rootless volume, and leaves zero zombie processes.

