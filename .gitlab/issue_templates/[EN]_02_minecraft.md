## ⛏️ QA Certification: Minecraft (Paper, Fabric, Forge, Vanilla)

> 📖 **Full step-by-step testing guide**: See the [Minecraft (Paper, Fabric, Forge, Vanilla) Testing Playbook](docs/qa/playbooks/en/02_minecraft.md).

### 🎮 Part 1: Gamer Tests (QA Tester)
*Check off the boxes as you complete your gameplay session:*

- [ ] **Step 1: Deploy Server & Choose Version** (Pass rule: `Server turns on, auto-accepts EULA, and binds to port 25565.`)
- [ ] **Step 2: 1-Click Plugin Installation** (Pass rule: `.jar appears in /plugins/ folder and plugin commands work in-game.`)
- [ ] **Step 3: Join Server from Client** (Pass rule: `Immediate connection, low ping, no auth errors.`)
- [ ] **Step 4: High-Speed Spectator Flight (Chunk Stress)** (Pass rule: `Chunks stream ahead smoothly; running /tps confirms stability between 19.8 - 20.0.`)
- [ ] **Step 5: Ghost Block Desync Test** (Pass rule: `Blocks break smoothly and drop items; no blocks reappear magically (no ghost blocks).`)
- [ ] **Step 6: Visual server.properties Editor** (Pass rule: `Values persist to server.properties on disk and apply upon reboot.`)

> 💬 **Finished gamer testing?** Leave a comment tagging the developers:  
> `@devs Finished gameplay tests successfully. Ready for tech review.`

### ⚙️ Part 2: Technical Engine Tests (Developers)
*Terminal commands for development team:*

- [ ] **TC-DEV-1: Dynamic OpenJDK Tag Resolution** (`docker inspect <mc-container> | grep -i "image"`)
- [ ] **TC-DEV-2: JVM Memory Headroom Formula** (`docker exec -it <mc-container> env | grep -E "(MEMORY|JVM)"`)
- [ ] **TC-DEV-3: World Identity Lock Integrity** (`cat <dataPath>/.ragenodes-minecraft-identity.json`)

/label ~"qa::in-progress" ~"game::minecraft"
