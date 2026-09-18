# ⛏️ QA Testing Playbook: Minecraft (Paper, Fabric, Forge, Vanilla)

> **Objective**: Spectator chunk loading, 20.0 TPS verification, dynamic OpenJDK versioning, and 1-click Spiget plugins.

👉 **[🚀 Launch Test Issue in GitLab (1-Click Pre-filled)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-EN%5D+%E2%9B%8F%EF%B8%8F+Minecraft+%28Paper%2C+Fabric%2C+Forge%2C+Vanilla%29&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Aminecraft&issue%5Bdescription%5D=%23%23+%E2%9B%8F%EF%B8%8F+QA+Certification%3A+Minecraft+%28Paper%2C+Fabric%2C+Forge%2C+Vanilla%29%0A%0A%3E+%F0%9F%93%96+**Full+step-by-step+testing+guide**%3A+See+the+%5BMinecraft+%28Paper%2C+Fabric%2C+Forge%2C+Vanilla%29+Testing+Playbook%5D%28docs%2Fqa%2Fplaybooks%2Fen%2F02_minecraft.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Part+1%3A+Gamer+Tests+%28QA+Tester%29%0A*Check+off+the+boxes+as+you+complete+your+gameplay+session%3A*%0A%0A-+%5B+%5D+**Step+1%3A+Deploy+Server+%26+Choose+Version**+%28Pass+rule%3A+%60Server+turns+on%2C+auto-accepts+EULA%2C+and+binds+to+port+25565.%60%29%0A-+%5B+%5D+**Step+2%3A+1-Click+Plugin+Installation**+%28Pass+rule%3A+%60.jar+appears+in+%2Fplugins%2F+folder+and+plugin+commands+work+in-game.%60%29%0A-+%5B+%5D+**Step+3%3A+Join+Server+from+Client**+%28Pass+rule%3A+%60Immediate+connection%2C+low+ping%2C+no+auth+errors.%60%29%0A-+%5B+%5D+**Step+4%3A+High-Speed+Spectator+Flight+%28Chunk+Stress%29**+%28Pass+rule%3A+%60Chunks+stream+ahead+smoothly%3B+running+%2Ftps+confirms+stability+between+19.8+-+20.0.%60%29%0A-+%5B+%5D+**Step+5%3A+Ghost+Block+Desync+Test**+%28Pass+rule%3A+%60Blocks+break+smoothly+and+drop+items%3B+no+blocks+reappear+magically+%28no+ghost+blocks%29.%60%29%0A-+%5B+%5D+**Step+6%3A+Visual+server.properties+Editor**+%28Pass+rule%3A+%60Values+persist+to+server.properties+on+disk+and+apply+upon+reboot.%60%29%0A%0A%3E+%F0%9F%92%AC+**Finished+gamer+testing%3F**+Leave+a+comment+tagging+the+developers%3A++%0A%3E+%60%40devs+Finished+gameplay+tests+successfully.+Ready+for+tech+review.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Part+2%3A+Technical+Engine+Tests+%28Developers%29%0A*Terminal+commands+for+development+team%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Dynamic+OpenJDK+Tag+Resolution**+%28%60docker+inspect+%3Cmc-container%3E+%7C+grep+-i+%22image%22%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+JVM+Memory+Headroom+Formula**+%28%60docker+exec+-it+%3Cmc-container%3E+env+%7C+grep+-E+%22%28MEMORY%7CJVM%29%22%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+World+Identity+Lock+Integrity**+%28%60cat+%3CdataPath%3E%2F.ragenodes-minecraft-identity.json%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Aminecraft%22%0A)**

--- 

## 🎮 PART 1: Gamer & Gameplay Tests (For QA Tester)

*Straightforward instructions to play and stress-test the server like a real customer.*

### Step 1: Deploy Server & Choose Version 🎮
- **What to do**: Deploy Minecraft Paper or Purpur on version 1.21.4. Click Start.
- ✅ **PASSED IF**: Server turns on, auto-accepts EULA, and binds to port 25565.
- ❌ **FAILED IF**: EULA error or container exits with code 137.

### Step 2: 1-Click Plugin Installation 🎮
- **What to do**: Go to Plugins tab, search "EssentialsX", click Install, and restart server.
- ✅ **PASSED IF**: .jar appears in /plugins/ folder and plugin commands work in-game.
- ❌ **FAILED IF**: Plugin fails to download or crashes server startup.

### Step 3: Join Server from Client 🎮
- **What to do**: Open Minecraft Java, go to Multiplayer, enter IP:Port, and connect.
- ✅ **PASSED IF**: Immediate connection, low ping, no auth errors.
- ❌ **FAILED IF**: Connection Refused or Outdated Server error.

### Step 4: High-Speed Spectator Flight (Chunk Stress) 🎮
- **What to do**: Switch to spectator mode (/gamemode spectator) and fly across ungenerated terrain for 3 minutes.
- ✅ **PASSED IF**: Chunks stream ahead smoothly; running /tps confirms stability between 19.8 - 20.0.
- ❌ **FAILED IF**: TPS drops below 15, chunks fail to render, or client rubberbands.

### Step 5: Ghost Block Desync Test 🎮
- **What to do**: Rapidly mine a tunnel of 30 stone blocks with an efficiency diamond pickaxe.
- ✅ **PASSED IF**: Blocks break smoothly and drop items; no blocks reappear magically (no ghost blocks).
- ❌ **FAILED IF**: Broken blocks flash and reappear, trapping the player.

### Step 6: Visual server.properties Editor 🎮
- **What to do**: In panel, open Minecraft Config, change difficulty to Hard, and set view-distance to 10. Click Save.
- ✅ **PASSED IF**: Values persist to server.properties on disk and apply upon reboot.
- ❌ **FAILED IF**: Settings revert to default or file corrupts.

--- 

## ⚙️ PART 2: Technical Engine Tests (For Developers)

*Terminal commands and Docker inspection verified by developers in 3 minutes.*

### Tech Check 1: Dynamic OpenJDK Tag Resolution ⚙️
- **Command / Action**: `docker inspect <mc-container> | grep -i "image"`
- **Pass Criteria**: Versions 1.8/1.12 load Java 11; 1.18/1.20 load Java 17; 1.21+ load Java 21/25 automatically.

### Tech Check 2: JVM Memory Headroom Formula ⚙️
- **Command / Action**: `docker exec -it <mc-container> env | grep -E "(MEMORY|JVM)"`
- **Pass Criteria**: calculateMinecraftJvmMemoryMb reserves 25% and at least 768MB native headspace for Netty and Cgroups.

### Tech Check 3: World Identity Lock Integrity ⚙️
- **Command / Action**: `cat <dataPath>/.ragenodes-minecraft-identity.json`
- **Pass Criteria**: Identity file locks edition and version to prevent accidental world corruption across restarts.

