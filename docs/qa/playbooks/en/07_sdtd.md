# 🧟 QA Testing Playbook: 7 Days to Die (The Fun Pimps)

> **Objective**: Voxel structural collapse, 64-zombie Blood Moon horde, binary integrity checks, and Telnet isolation.

👉 **[🚀 Launch Test Issue in GitLab (1-Click Pre-filled)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-EN%5D+%F0%9F%A7%9F+7+Days+to+Die+%28The+Fun+Pimps%29&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Asdtd&issue%5Bdescription%5D=%23%23+%F0%9F%A7%9F+QA+Certification%3A+7+Days+to+Die+%28The+Fun+Pimps%29%0A%0A%3E+%F0%9F%93%96+**Full+step-by-step+testing+guide**%3A+See+the+%5B7+Days+to+Die+%28The+Fun+Pimps%29+Testing+Playbook%5D%28docs%2Fqa%2Fplaybooks%2Fen%2F07_sdtd.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Part+1%3A+Gamer+Tests+%28QA+Tester%29%0A*Check+off+the+boxes+as+you+complete+your+gameplay+session%3A*%0A%0A-+%5B+%5D+**Step+1%3A+Deploy+7+Days+to+Die+Server**+%28Pass+rule%3A+%60Turns+online+and+exposes+UDP+26900+and+TCP+26902+ports.%60%29%0A-+%5B+%5D+**Step+2%3A+Join+Game+with+Easy+Anti-Cheat+%28EAC%29**+%28Pass+rule%3A+%60EAC+handshake+passes+and+player+enters+the+voxel+world.%60%29%0A-+%5B+%5D+**Step+3%3A+Structural+Integrity+%26+Voxel+Collapse**+%28Pass+rule%3A+%60Upper+floors+collapse+into+physical+rubble+in+exact+sync+across+clients.%60%29%0A-+%5B+%5D+**Step+4%3A+Blood+Moon+64-Zombie+Horde+Night**+%28Pass+rule%3A+%60Zombies+pathfind+dynamically+toward+defenses+without+freezing+server+tickrate.%60%29%0A%0A%3E+%F0%9F%92%AC+**Finished+gamer+testing%3F**+Leave+a+comment+tagging+the+developers%3A++%0A%3E+%60%40devs+Finished+gameplay+tests+successfully.+Ready+for+tech+review.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Part+2%3A+Technical+Engine+Tests+%28Developers%29%0A*Terminal+commands+for+development+team%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Binary+Installation+Integrity+Verification**+%28%60docker+exec+-it+%3Csdtd-container%3E+bash+-c+%22test+-x+%2F7dtd%2F7DaysToDieServer.x86_64+%26%26+echo+OK%22%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Administrative+Telnet+Port+Security**+%28%60docker+port+%3Csdtd-container%3E+%7C+grep+26902%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+serverconfig.xml+Formatting+%26+Persistence**+%28%60cat+%3CdataPath%3E%2Fserverconfig.xml%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Asdtd%22%0A)**

--- 

## 🎮 PART 1: Gamer & Gameplay Tests (For QA Tester)

*Straightforward instructions to play and stress-test the server like a real customer.*

### Step 1: Deploy 7 Days to Die Server 🎮
- **What to do**: Deploy server in panel with at least 6GB RAM plan. Click Start.
- ✅ **PASSED IF**: Turns online and exposes UDP 26900 and TCP 26902 ports.
- ❌ **FAILED IF**: Installation file integrity check fails.

### Step 2: Join Game with Easy Anti-Cheat (EAC) 🎮
- **What to do**: Launch 7 Days to Die with EAC enabled and connect via direct IP.
- ✅ **PASSED IF**: EAC handshake passes and player enters the voxel world.
- ❌ **FAILED IF**: EAC Disconnected or integrity kick.

### Step 3: Structural Integrity & Voxel Collapse 🎮
- **What to do**: Destroy the bottom support pillars of a two-story building using pickaxes or explosives.
- ✅ **PASSED IF**: Upper floors collapse into physical rubble in exact sync across clients.
- ❌ **FAILED IF**: Blocks float in mid-air violating voxel physics.

### Step 4: Blood Moon 64-Zombie Horde Night 🎮
- **What to do**: Trigger Day 7 Blood Moon with 64 concurrent feral zombies.
- ✅ **PASSED IF**: Zombies pathfind dynamically toward defenses without freezing server tickrate.
- ❌ **FAILED IF**: Ping spikes over 1,000ms or server crashes.

--- 

## ⚙️ PART 2: Technical Engine Tests (For Developers)

*Terminal commands and Docker inspection verified by developers in 3 minutes.*

### Tech Check 1: Binary Installation Integrity Verification ⚙️
- **Command / Action**: `docker exec -it <sdtd-container> bash -c "test -x /7dtd/7DaysToDieServer.x86_64 && echo OK"`
- **Pass Criteria**: buildSDTDInstallationCheck validates 7DaysToDieServer.x86_64, UnityPlayer.so, and globalgamemanagers.

### Tech Check 2: Administrative Telnet Port Security ⚙️
- **Command / Action**: `docker port <sdtd-container> | grep 26902`
- **Pass Criteria**: Telnet port 26902 is secured by deriveServicePassword and restricted.

### Tech Check 3: serverconfig.xml Formatting & Persistence ⚙️
- **Command / Action**: `cat <dataPath>/serverconfig.xml`
- **Pass Criteria**: XML parser preserves structure and validates custom options edited from dashboard.

