# 🚗 QA Testing Playbook: FiveM (GTA V RP FXServer)

> **Objective**: High-speed vehicle sync across Los Santos, txAdmin reverse proxy, MariaDB isolation, and Blender WebTop 3D.

👉 **[🚀 Launch Test Issue in GitLab (1-Click Pre-filled)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-EN%5D+%F0%9F%9A%97+FiveM+%28GTA+V+RP+FXServer%29&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Afivem&issue%5Bdescription%5D=%23%23+%F0%9F%9A%97+QA+Certification%3A+FiveM+%28GTA+V+RP+FXServer%29%0A%0A%3E+%F0%9F%93%96+**Full+step-by-step+testing+guide**%3A+See+the+%5BFiveM+%28GTA+V+RP+FXServer%29+Testing+Playbook%5D%28docs%2Fqa%2Fplaybooks%2Fen%2F01_fivem.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Part+1%3A+Gamer+Tests+%28QA+Tester%29%0A*Check+off+the+boxes+as+you+complete+your+gameplay+session%3A*%0A%0A-+%5B+%5D+**Step+1%3A+Deploy+%26+Boot+FiveM+Server**+%28Pass+rule%3A+%60Status+flips+to+%22Online%22%2C+displays+public+game+IP+and+txAdmin+access.%60%29%0A-+%5B+%5D+**Step+2%3A+Open+txAdmin+Web+Interface**+%28Pass+rule%3A+%60txAdmin+loads+over+HTTPS+without+security+warnings+and+allows+admin+login.%60%29%0A-+%5B+%5D+**Step+3%3A+In-Game+Connection+%26+Spawn**+%28Pass+rule%3A+%60Both+players+load+into+Los+Santos%2C+see+each+other+move%2C+and+proximity+voice+chat+works.%60%29%0A-+%5B+%5D+**Step+4%3A+High-Speed+200+km%2Fh+Highway+Test**+%28Pass+rule%3A+%60Passenger+remains+smoothly+seated+inside+car%3B+road+and+buildings+stream+without+pop-in.%60%29%0A-+%5B+%5D+**Step+5%3A+Test+Blender+WebTop+3D+Editor**+%28Pass+rule%3A+%60Blender+3D+interface+loads+in+browser%2C+ready+to+edit+.ydr%2F.yft+vehicle+models.%60%29%0A%0A%3E+%F0%9F%92%AC+**Finished+gamer+testing%3F**+Leave+a+comment+tagging+the+developers%3A++%0A%3E+%60%40devs+Finished+gameplay+tests+successfully.+Ready+for+tech+review.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Part+2%3A+Technical+Engine+Tests+%28Developers%29%0A*Terminal+commands+for+development+team%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Port+Offsets+%26+OxideProxy+L4+Routing**+%28%60docker+port+%3Cfivem-container%3E%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+MariaDB+Privilege+Isolation**+%28%60docker+exec+-it+ragenodes_mariadb+mysql+-u+root+-p+-e+%22SHOW+GRANTS+FOR+%27%3Cdb_user%3E%27%40%27%25%27%3B%22%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Blender+WebTop+Heartbeat+Auto-Shutdown**+%28%60docker+ps+%7C+grep+blender%60%29%0A-+%5B+%5D+**TC-DEV-4%3A+Authoritative+Hitreg+under+Simulated+Latency**+%28%60tc+qdisc+add+dev+docker0+root+netem+delay+120ms%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Afivem%22%0A)**

--- 

## 🎮 PART 1: Gamer & Gameplay Tests (For QA Tester)

*Straightforward instructions to play and stress-test the server like a real customer.*

### Step 1: Deploy & Boot FiveM Server 🎮
- **What to do**: Create FiveM server in panel with a valid Cfx.re Keymaster license key and click Start.
- ✅ **PASSED IF**: Status flips to "Online", displays public game IP and txAdmin access.
- ❌ **FAILED IF**: Stuck on starting or throws database connection error.

### Step 2: Open txAdmin Web Interface 🎮
- **What to do**: Click "Open txAdmin" button in the RageNodes dashboard.
- ✅ **PASSED IF**: txAdmin loads over HTTPS without security warnings and allows admin login.
- ❌ **FAILED IF**: 502 Bad Gateway or blank page.

### Step 3: In-Game Connection & Spawn 🎮
- **What to do**: Launch FiveM on PC, press F8, type: connect <IP:Port>. Join with a second player.
- ✅ **PASSED IF**: Both players load into Los Santos, see each other move, and proximity voice chat works.
- ❌ **FAILED IF**: Connection timed out or stuck on infinite loading screen.

### Step 4: High-Speed 200 km/h Highway Test 🎮
- **What to do**: Spawn a supercar. Drive at full speed down the highway for 3 minutes with a passenger.
- ✅ **PASSED IF**: Passenger remains smoothly seated inside car; road and buildings stream without pop-in.
- ❌ **FAILED IF**: Car falls through map or passenger gets rubberbanded onto the road.

### Step 5: Test Blender WebTop 3D Editor 🎮
- **What to do**: Go to Blender tab in panel and click "Start Blender". Open the browser session.
- ✅ **PASSED IF**: Blender 3D interface loads in browser, ready to edit .ydr/.yft vehicle models.
- ❌ **FAILED IF**: VNC connection fails or port is refused.

--- 

## ⚙️ PART 2: Technical Engine Tests (For Developers)

*Terminal commands and Docker inspection verified by developers in 3 minutes.*

### Tech Check 1: Port Offsets & OxideProxy L4 Routing ⚙️
- **Command / Action**: `docker port <fivem-container>`
- **Pass Criteria**: Port 30120 TCP/UDP maps via OxideProxy with backend offset 30000, preventing collision with txAdmin on 40120.

### Tech Check 2: MariaDB Privilege Isolation ⚙️
- **Command / Action**: `docker exec -it ragenodes_mariadb mysql -u root -p -e "SHOW GRANTS FOR '<db_user>'@'%';"`
- **Pass Criteria**: Database user only possesses grants on its dedicated database and cannot see other tenant databases.

### Tech Check 3: Blender WebTop Heartbeat Auto-Shutdown ⚙️
- **Command / Action**: `docker ps | grep blender`
- **Pass Criteria**: When browser tab closes, Blender container terminates after heartbeat expiration to free host GPU/RAM.

### Tech Check 4: Authoritative Hitreg under Simulated Latency ⚙️
- **Command / Action**: `tc qdisc add dev docker0 root netem delay 120ms`
- **Pass Criteria**: Server authoritatively validates bullet damage between sprinting players without client desync.

