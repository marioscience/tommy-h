## 🤖 QA Certification: Discord Bot (Node.js & Python Dual Runtime)

> 📖 **Full step-by-step testing guide**: See the [Discord Bot (Node.js & Python Dual Runtime) Testing Playbook](docs/qa/playbooks/en/10_discord_bot.md).

### 🎮 Part 1: Gamer Tests (QA Tester)
*Check off the boxes as you complete your gameplay session:*

- [ ] **Step 1: Upload Bot Scripts** (Pass rule: `Files upload cleanly into the root container directory.`)
- [ ] **Step 2: 1-Click Auto Dependency Install** (Pass rule: `Console executes npm install or pip install -r requirements.txt successfully.`)
- [ ] **Step 3: Start Bot & Verify Live in Discord** (Pass rule: `Bot icon flips to green ("Online") in your Discord guild and responds to slash commands.`)

> 💬 **Finished gamer testing?** Leave a comment tagging the developers:  
> `@devs Finished gameplay tests successfully. Ready for tech review.`

### ⚙️ Part 2: Technical Engine Tests (Developers)
*Terminal commands for development team:*

- [ ] **TC-DEV-1: Process Supervisor Crash Recovery** (`docker exec -it <bot-container> kill -9 1`)
- [ ] **TC-DEV-2: Token Masking & Environment Security** (`docker logs <bot-container>`)

/label ~"qa::in-progress" ~"game::discordbot"
