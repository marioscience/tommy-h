## ☢️ QA Certification: Rust Dedicated Server

> 📖 **Full step-by-step testing guide**: See the [Rust Dedicated Server Testing Playbook](docs/qa/playbooks/en/03_rust.md).

### 🎮 Part 1: Gamer Tests (QA Tester)
*Check off the boxes as you complete your gameplay session:*

- [ ] **Step 1: Deploy Rust Server & Start** (Pass rule: `Server turns green and console indicates procedural map generation.`)
- [ ] **Step 2: Connect via In-Game F1 Console** (Pass rule: `Loads procedural map and spawns player on the beach.`)
- [ ] **Step 3: AK-47 Ballistics & Combatlog Hitreg** (Pass rule: `Crisp hitmarker audio plays; typing combatlog in F1 console confirms valid server-authoritative hits.`)
- [ ] **Step 4: 1-Click uMod Plugin Install & Hot Reload** (Pass rule: `.cs file downloads to /oxide/plugins and Oxide C# compiler hot-reloads it without rebooting.`)
- [ ] **Step 5: Test Map Wipe Tool** (Pass rule: `Server unlinks .map and .sav files but preserves player blueprints.`)

> 💬 **Finished gamer testing?** Leave a comment tagging the developers:  
> `@devs Finished gameplay tests successfully. Ready for tech review.`

### ⚙️ Part 2: Technical Engine Tests (Developers)
*Terminal commands for development team:*

- [ ] **TC-DEV-1: L4 Multi-Port Proxy Triplet** (`docker port <rust-container>`)
- [ ] **TC-DEV-2: Server FPS & Garbage Collection Pauses** (`docker exec -it <rust-container> rcon "serverinfo"`)
- [ ] **TC-DEV-3: Live Killfeed & Chat API Feed** (`curl -s http://localhost:3000/api/rcon/<id>/killfeed -H "Authorization: Bearer $TOKEN"`)
- [ ] **TC-DEV-4: Server Identity Isolation** (`ls -la <dataPath>/server/ragenodes`)

/label ~"qa::in-progress" ~"game::rust"
