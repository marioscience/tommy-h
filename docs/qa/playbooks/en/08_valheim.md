# 🪓 QA Testing Playbook: Valheim Dedicated Server

> **Objective**: Crossplay PC/Console support, voxel terrain deformation sync, and 3-player storm sailing physics.

👉 **[🚀 Launch Test Issue in GitLab (1-Click Pre-filled)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-EN%5D+%F0%9F%AA%93+Valheim+Dedicated+Server&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Avalheim&issue%5Bdescription%5D=%23%23+%F0%9F%AA%93+QA+Certification%3A+Valheim+Dedicated+Server%0A%0A%3E+%F0%9F%93%96+**Full+step-by-step+testing+guide**%3A+See+the+%5BValheim+Dedicated+Server+Testing+Playbook%5D%28docs%2Fqa%2Fplaybooks%2Fen%2F08_valheim.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Part+1%3A+Gamer+Tests+%28QA+Tester%29%0A*Check+off+the+boxes+as+you+complete+your+gameplay+session%3A*%0A%0A-+%5B+%5D+**Step+1%3A+Deploy+Valheim+Server+with+Valid+Password**+%28Pass+rule%3A+%60Boots+online+and+initializes+viking+world+on+UDP+port+2456.%60%29%0A-+%5B+%5D+**Step+2%3A+Join+from+PC+and+Console+%28Crossplay%29**+%28Pass+rule%3A+%60Both+players+spawn+at+the+sacrificial+stones.%60%29%0A-+%5B+%5D+**Step+3%3A+Massive+Terrain+Deformation+Sync**+%28Pass+rule%3A+%60Voxel+terrain+mesh+deformation+syncs+in+real+time+without+visual+glitching.%60%29%0A-+%5B+%5D+**Step+4%3A+Stormy+Ocean+Longship+Sailing**+%28Pass+rule%3A+%60Boat+displacement+and+water+physics+sync+smoothly%3B+passengers+remain+firmly+on+board.%60%29%0A%0A%3E+%F0%9F%92%AC+**Finished+gamer+testing%3F**+Leave+a+comment+tagging+the+developers%3A++%0A%3E+%60%40devs+Finished+gameplay+tests+successfully.+Ready+for+tech+review.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Part+2%3A+Technical+Engine+Tests+%28Developers%29%0A*Terminal+commands+for+development+team%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+-crossplay+Startup+Flag+Verification**+%28%60docker+inspect+%3Cvalheim-container%3E+%7C+grep+-i+%22crossplay%22%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+UDP+Port+Triplet+Forwarding**+%28%60docker+port+%3Cvalheim-container%3E%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Access+List+Persistence+%28adminlist+%2F+bannedlist%29**+%28%60cat+%3CdataPath%3E%2Fadminlist.txt%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Avalheim%22%0A)**

--- 

## 🎮 PART 1: Gamer & Gameplay Tests (For QA Tester)

*Straightforward instructions to play and stress-test the server like a real customer.*

### Step 1: Deploy Valheim Server with Valid Password 🎮
- **What to do**: Deploy server with minimum 5-character password and click Start.
- ✅ **PASSED IF**: Boots online and initializes viking world on UDP port 2456.
- ❌ **FAILED IF**: Refuses startup if password is empty or under 5 characters.

### Step 2: Join from PC and Console (Crossplay) 🎮
- **What to do**: Connect one PC player and one console player via server code or direct IP.
- ✅ **PASSED IF**: Both players spawn at the sacrificial stones.
- ❌ **FAILED IF**: Incompatible version or crossplay handshake failure.

### Step 3: Massive Terrain Deformation Sync 🎮
- **What to do**: Dig a deep moat with a pickaxe and level ground with a hoe with 2 players watching.
- ✅ **PASSED IF**: Voxel terrain mesh deformation syncs in real time without visual glitching.
- ❌ **FAILED IF**: One player sees a trench while the other sees flat solid ground.

### Step 4: Stormy Ocean Longship Sailing 🎮
- **What to do**: Build a Longship, board 3 players, and sail through rough ocean waves.
- ✅ **PASSED IF**: Boat displacement and water physics sync smoothly; passengers remain firmly on board.
- ❌ **FAILED IF**: Passengers get flung into open water due to position jitter.

--- 

## ⚙️ PART 2: Technical Engine Tests (For Developers)

*Terminal commands and Docker inspection verified by developers in 3 minutes.*

### Tech Check 1: -crossplay Startup Flag Verification ⚙️
- **Command / Action**: `docker inspect <valheim-container> | grep -i "crossplay"`
- **Pass Criteria**: Container initiates with -crossplay flag, activating PlayFab and Steam relay connectivity.

### Tech Check 2: UDP Port Triplet Forwarding ⚙️
- **Command / Action**: `docker port <valheim-container>`
- **Pass Criteria**: OxideProxy maps the 3 consecutive UDP ports: 2456, 2457, and 2458.

### Tech Check 3: Access List Persistence (adminlist / bannedlist) ⚙️
- **Command / Action**: `cat <dataPath>/adminlist.txt`
- **Pass Criteria**: Admin SteamIDs added via web UI write reliably to adminlist.txt and bannedlist.txt.

