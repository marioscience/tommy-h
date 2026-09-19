## 🥚 QA Certification: Palworld Dedicated Server

> 📖 **Full step-by-step testing guide**: See the [Palworld Dedicated Server Testing Playbook](docs/qa/playbooks/en/04_palworld.md).

### 🎮 Part 1: Gamer Tests (QA Tester)
*Check off the boxes as you complete your gameplay session:*

- [ ] **Step 1: Deploy Palworld Server** (Pass rule: `Turns green and binds UDP port 8211.`)
- [ ] **Step 2: Join via Direct IP in Game** (Pass rule: `Character creation loads and player spawns on the island.`)
- [ ] **Step 3: Pal Capture & Co-op Combat Sync** (Pass rule: `Capture percentage rolls in sync for all players; captured Pal responds to companion AI commands.`)
- [ ] **Step 4: Base Automation & Chunk Retention** (Pass rule: `Upon return, Pals are still actively working and resources accumulated in storage.`)
- [ ] **Step 5: Guild Inspector in Panel** (Pass rule: `Displays active guild names, roster members, and base coordinates accurately.`)

> 💬 **Finished gamer testing?** Leave a comment tagging the developers:  
> `@devs Finished gameplay tests successfully. Ready for tech review.`

### ⚙️ Part 2: Technical Engine Tests (Developers)
*Terminal commands for development team:*

- [ ] **TC-DEV-1: Rootless UID 1000:1000 Permissions** (`ls -ld <dataPath>`)
- [ ] **TC-DEV-2: Unreal Engine 4-Hour Memory Soak Test** (`docker stats <palworld-container> --no-stream`)
- [ ] **TC-DEV-3: RCON Broadcast & Admin Commands** (`curl -X POST http://localhost:3000/api/rcon/<id>/command -d '{"command":"Broadcast Hello"}' -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN"`)

/label ~"qa::in-progress" ~"game::palworld"
