# 🤖 QA Testing Playbook: Discord Bot (Node.js & Python Dual Runtime)

> **Objective**: Auto dependency installer (npm/pip), token masking, and process supervisor crash recovery.

👉 **[🚀 Launch Test Issue in GitLab (1-Click Pre-filled)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-EN%5D+%F0%9F%A4%96+Discord+Bot+%28Node.js+%26+Python+Dual+Runtime%29&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Adiscordbot&issue%5Bdescription%5D=%23%23+%F0%9F%A4%96+QA+Certification%3A+Discord+Bot+%28Node.js+%26+Python+Dual+Runtime%29%0A%0A%3E+%F0%9F%93%96+**Full+step-by-step+testing+guide**%3A+See+the+%5BDiscord+Bot+%28Node.js+%26+Python+Dual+Runtime%29+Testing+Playbook%5D%28docs%2Fqa%2Fplaybooks%2Fen%2F10_discord_bot.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Part+1%3A+Gamer+Tests+%28QA+Tester%29%0A*Check+off+the+boxes+as+you+complete+your+gameplay+session%3A*%0A%0A-+%5B+%5D+**Step+1%3A+Upload+Bot+Scripts**+%28Pass+rule%3A+%60Files+upload+cleanly+into+the+root+container+directory.%60%29%0A-+%5B+%5D+**Step+2%3A+1-Click+Auto+Dependency+Install**+%28Pass+rule%3A+%60Console+executes+npm+install+or+pip+install+-r+requirements.txt+successfully.%60%29%0A-+%5B+%5D+**Step+3%3A+Start+Bot+%26+Verify+Live+in+Discord**+%28Pass+rule%3A+%60Bot+icon+flips+to+green+%28%22Online%22%29+in+your+Discord+guild+and+responds+to+slash+commands.%60%29%0A%0A%3E+%F0%9F%92%AC+**Finished+gamer+testing%3F**+Leave+a+comment+tagging+the+developers%3A++%0A%3E+%60%40devs+Finished+gameplay+tests+successfully.+Ready+for+tech+review.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Part+2%3A+Technical+Engine+Tests+%28Developers%29%0A*Terminal+commands+for+development+team%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Process+Supervisor+Crash+Recovery**+%28%60docker+exec+-it+%3Cbot-container%3E+kill+-9+1%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Token+Masking+%26+Environment+Security**+%28%60docker+logs+%3Cbot-container%3E%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Adiscordbot%22%0A)**

--- 

## 🎮 PART 1: Gamer & Gameplay Tests (For QA Tester)

*Straightforward instructions to play and stress-test the server like a real customer.*

### Step 1: Upload Bot Scripts 🎮
- **What to do**: Open File Manager and upload your index.js (or main.py) along with package.json (or requirements.txt).
- ✅ **PASSED IF**: Files upload cleanly into the root container directory.
- ❌ **FAILED IF**: Upload error or corrupted files.

### Step 2: 1-Click Auto Dependency Install 🎮
- **What to do**: Click "Auto-Install Dependencies" in panel, choosing npm or pip.
- ✅ **PASSED IF**: Console executes npm install or pip install -r requirements.txt successfully.
- ❌ **FAILED IF**: Command error or dependency installation failure.

### Step 3: Start Bot & Verify Live in Discord 🎮
- **What to do**: Set DISCORD_TOKEN in environment variables and click Start.
- ✅ **PASSED IF**: Bot icon flips to green ("Online") in your Discord guild and responds to slash commands.
- ❌ **FAILED IF**: Invalid token error or bot stays offline.

--- 

## ⚙️ PART 2: Technical Engine Tests (For Developers)

*Terminal commands and Docker inspection verified by developers in 3 minutes.*

### Tech Check 1: Process Supervisor Crash Recovery ⚙️
- **Command / Action**: `docker exec -it <bot-container> kill -9 1`
- **Pass Criteria**: Docker restart policy (on-failure) revives the bot container in under 5 seconds.

### Tech Check 2: Token Masking & Environment Security ⚙️
- **Command / Action**: `docker logs <bot-container>`
- **Pass Criteria**: Discord bot secrets do not leak into unauthenticated logs or error dumps.

