## 🔫 QA Certification: Counter-Strike 2 (Source 2)

> 📖 **Full step-by-step testing guide**: See the [Counter-Strike 2 (Source 2) Testing Playbook](docs/qa/playbooks/en/05_cs2.md).

### 🎮 Part 1: Gamer Tests (QA Tester)
*Check off the boxes as you complete your gameplay session:*

- [ ] **Step 1: Deploy Server & Inject GSLT Token** (Pass rule: `Starts up and binds port 27015 TCP/UDP.`)
- [ ] **Step 2: Connect via Developer Console** (Pass rule: `Loads map (de_dust2/de_mirage) and prompts team selection (CT/T).`)
- [ ] **Step 3: Volumetric Smoke & Grenade Sync** (Pass rule: `Volumetric smoke plume renders identical geometry and dissipates simultaneously on both clients.`)
- [ ] **Step 4: Competitive Matchpad Console** (Pass rule: `Match immediately resets in-game or loads designated competitive map.`)

> 💬 **Finished gamer testing?** Leave a comment tagging the developers:  
> `@devs Finished gameplay tests successfully. Ready for tech review.`

### ⚙️ Part 2: Technical Engine Tests (Developers)
*Terminal commands for development team:*

- [ ] **TC-DEV-1: Rootless Ownership Normalization Helper** (`docker inspect <cs2-container>`)
- [ ] **TC-DEV-2: Sub-Tick Packet Rate & Socket 27015** (`docker logs <cs2-container> | grep -i "tick"`)
- [ ] **TC-DEV-3: server.cfg Visual Persistence** (`cat <dataPath>/game/csgo/cfg/server.cfg`)

/label ~"qa::in-progress" ~"game::cs2"
