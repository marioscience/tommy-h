# 🦖 QA Testing Playbook: ARK: Survival Ascended / Evolved

> **Objective**: Proton/Wine Linux capabilities, dino mounting, Cross-ARK shared clusters, and forced updates.

👉 **[🚀 Launch Test Issue in GitLab (1-Click Pre-filled)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-EN%5D+%F0%9F%A6%96+ARK%3A+Survival+Ascended+%2F+Evolved&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Aark&issue%5Bdescription%5D=%23%23+%F0%9F%A6%96+QA+Certification%3A+ARK%3A+Survival+Ascended+%2F+Evolved%0A%0A%3E+%F0%9F%93%96+**Full+step-by-step+testing+guide**%3A+See+the+%5BARK%3A+Survival+Ascended+%2F+Evolved+Testing+Playbook%5D%28docs%2Fqa%2Fplaybooks%2Fen%2F06_ark.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Part+1%3A+Gamer+Tests+%28QA+Tester%29%0A*Check+off+the+boxes+as+you+complete+your+gameplay+session%3A*%0A%0A-+%5B+%5D+**Step+1%3A+Deploy+ARK+Server**+%28Pass+rule%3A+%60Boots+cleanly+and+initializes+TheIsland_WP.%60%29%0A-+%5B+%5D+**Step+2%3A+Join+Server+from+In-Game+Browser**+%28Pass+rule%3A+%60Loads+map+data+and+prompts+survivor+spawn+screen+on+beach.%60%29%0A-+%5B+%5D+**Step+3%3A+Ride+Dinosaur+%26+Tree+Collision+Sync**+%28Pass+rule%3A+%60Creature+moves+smoothly%3B+foliage+destructions+replicate+in+sync+across+players.%60%29%0A-+%5B+%5D+**Step+4%3A+Obelisk+Clustered+Transfer+Test**+%28Pass+rule%3A+%60Creature+transfers+with+stats%2C+level%2C+and+inventory+intact.%60%29%0A-+%5B+%5D+**Step+5%3A+Force+Engine+Version+Update**+%28Pass+rule%3A+%60Server+purges+manifest+and+SteamCMD+re-validates+engine+files+upon+restart.%60%29%0A%0A%3E+%F0%9F%92%AC+**Finished+gamer+testing%3F**+Leave+a+comment+tagging+the+developers%3A++%0A%3E+%60%40devs+Finished+gameplay+tests+successfully.+Ready+for+tech+review.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Part+2%3A+Technical+Engine+Tests+%28Developers%29%0A*Terminal+commands+for+development+team%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Proton%2FWine+Elevated+Capabilities**+%28%60docker+inspect+%3Cark-container%3E+%7C+grep+-A+10+%22CapAdd%22%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Cross-ARK+Cluster+Shared+Volume+Mount**+%28%60docker+inspect+%3Cark-container%3E+%7C+grep+-i+%22cluster%22%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Atomic+Removal+of+appmanifest_2430930.acf**+%28%60ls+-la+%3CdataPath%3E%2Fsteamapps%2F%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Aark%22%0A)**

--- 

## 🎮 PART 1: Gamer & Gameplay Tests (For QA Tester)

*Straightforward instructions to play and stress-test the server like a real customer.*

### Step 1: Deploy ARK Server 🎮
- **What to do**: Deploy ARK in panel with at least 12GB RAM plan. Click Start.
- ✅ **PASSED IF**: Boots cleanly and initializes TheIsland_WP.
- ❌ **FAILED IF**: OOM failure or Wine prefix abort.

### Step 2: Join Server from In-Game Browser 🎮
- **What to do**: Open ARK, navigate to Unofficial Sessions, and join by IP.
- ✅ **PASSED IF**: Loads map data and prompts survivor spawn screen on beach.
- ❌ **FAILED IF**: Session not found or infinite loading screen.

### Step 3: Ride Dinosaur & Tree Collision Sync 🎮
- **What to do**: Tame a large creature (Rex/Trike), ride it across terrain knocking down trees and rocks.
- ✅ **PASSED IF**: Creature moves smoothly; foliage destructions replicate in sync across players.
- ❌ **FAILED IF**: Severe rubberbanding when colliding with fallen trees.

### Step 4: Obelisk Clustered Transfer Test 🎮
- **What to do**: Configure clusterId in panel. Upload creature to an Obelisk; download on a second clustered server.
- ✅ **PASSED IF**: Creature transfers with stats, level, and inventory intact.
- ❌ **FAILED IF**: Creature is deleted or character gets stuck.

### Step 5: Force Engine Version Update 🎮
- **What to do**: Click "Force ARK Update" button in panel.
- ✅ **PASSED IF**: Server purges manifest and SteamCMD re-validates engine files upon restart.
- ❌ **FAILED IF**: Server fails to start or update fails.

--- 

## ⚙️ PART 2: Technical Engine Tests (For Developers)

*Terminal commands and Docker inspection verified by developers in 3 minutes.*

### Tech Check 1: Proton/Wine Elevated Capabilities ⚙️
- **Command / Action**: `docker inspect <ark-container> | grep -A 10 "CapAdd"`
- **Pass Criteria**: Container contains CHOWN, SETUID, SETGID, KILL, DAC_OVERRIDE, and 1GB ShmSize for Proton emulation.

### Tech Check 2: Cross-ARK Cluster Shared Volume Mount ⚙️
- **Command / Action**: `docker inspect <ark-container> | grep -i "cluster"`
- **Pass Criteria**: Shared cluster directory mounts into /home/steam/Steam/steamapps/cluster across clustered instances.

### Tech Check 3: Atomic Removal of appmanifest_2430930.acf ⚙️
- **Command / Action**: `ls -la <dataPath>/steamapps/`
- **Pass Criteria**: forceUpdateARK endpoint safely removes manifest file, triggering clean SteamCMD re-download.

