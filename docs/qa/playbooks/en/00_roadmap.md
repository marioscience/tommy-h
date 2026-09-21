# 🚀 QA Testing Playbook: Platform Roadmap & Feature Testing Readiness

> **Objective**: Testing and validation playbook for upcoming RageNodes Ultimate core features.

👉 **[🚀 Launch Test Issue in GitLab (1-Click Pre-filled)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-EN%5D+%F0%9F%9A%80+Platform+Roadmap+%26+Feature+Testing+Readiness&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Aroadmap&issue%5Bdescription%5D=%23%23+%F0%9F%9A%80+QA+Certification%3A+Platform+Roadmap+%26+Feature+Testing+Readiness%0A%0A%3E+%F0%9F%93%96+**Full+step-by-step+testing+guide**%3A+See+the+%5BPlatform+Roadmap+%26+Feature+Testing+Readiness+Testing+Playbook%5D%28docs%2Fqa%2Fplaybooks%2Fen%2F00_roadmap.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Part+1%3A+Gamer+Tests+%28QA+Tester%29%0A*Check+off+the+boxes+as+you+complete+your+gameplay+session%3A*%0A%0A-+%5B+%5D+**Step+1%3A+Verify+Instant+Deployment+in+Web+Panel**+%28Pass+rule%3A+%60Server+creates%2C+shows+%22Online%22+in+under+2+minutes%2C+and+displays+its+public+IP.%60%29%0A-+%5B+%5D+**Step+2%3A+Test+Monaco+Code+Editor**+%28Pass+rule%3A+%60Editor+highlights+syntax+and+saves+cleanly+without+refreshing+the+browser.%60%29%0A-+%5B+%5D+**Step+3%3A+Test+Marketplace+Vault+Protection**+%28Pass+rule%3A+%60System+denies+action+with+%22Vault+Protection%3A+Protected+source+file%22.%60%29%0A%0A%3E+%F0%9F%92%AC+**Finished+gamer+testing%3F**+Leave+a+comment+tagging+the+developers%3A++%0A%3E+%60%40devs+Finished+gameplay+tests+successfully.+Ready+for+tech+review.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Part+2%3A+Technical+Engine+Tests+%28Developers%29%0A*Terminal+commands+for+development+team%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+DDoS+Mitigation+with+OxideProxy+eBPF%2FXDP**+%28%60docker+logs+ragenodes_oxideproxy+%7C+grep+-i+%22ebpf%22%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Rank-Based+Backup+Priority+Queue**+%28%60docker+exec+-it+ragenodes_backend+node+-e+%22import%28%27.%2Fsrc%2Fservices%2FbackupQueue.js%27%29.then%28m+%3D%3E+console.log%28m.backupQueue%29%29%22%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Multi-Node+Hot+Migration**+%28%60curl+-s+http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fadmin%2Fnodes+-H+%22Authorization%3A+Bearer+%24TOKEN%22%60%29%0A-+%5B+%5D+**TC-DEV-4%3A+SSE+LogHub+Streaming+%26+15s+Heartbeat**+%28%60curl+-N+-H+%22Accept%3A+text%2Fevent-stream%22+http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fservers%2F1%2Flogs%2Fstream+-H+%22Authorization%3A+Bearer+%24TOKEN%22%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Aroadmap%22%0A)**

--- 

## 🎮 PART 1: Gamer & Gameplay Tests (For QA Tester)

*Straightforward instructions to play and stress-test the server like a real customer.*

### Step 1: Verify Instant Deployment in Web Panel 🎮
- **What to do**: Create any server from the web UI and verify the progress bar advances smoothly.
- ✅ **PASSED IF**: Server creates, shows "Online" in under 2 minutes, and displays its public IP.
- ❌ **FAILED IF**: Progress bar gets stuck, returns HTTP 500, or fails to assign a public port.

### Step 2: Test Monaco Code Editor 🎮
- **What to do**: Open File Manager, edit a config file (.cfg, .properties, .ini), change a value, and click Save.
- ✅ **PASSED IF**: Editor highlights syntax and saves cleanly without refreshing the browser.
- ❌ **FAILED IF**: Blank screen, save error, or corrupted file formatting.

### Step 3: Test Marketplace Vault Protection 🎮
- **What to do**: Attempt to edit or download scripts located in [market] folders.
- ✅ **PASSED IF**: System denies action with "Vault Protection: Protected source file".
- ❌ **FAILED IF**: Allows modifying or leaking protected marketplace code.

--- 

## ⚙️ PART 2: Technical Engine Tests (For Developers)

*Terminal commands and Docker inspection verified by developers in 3 minutes.*

### Tech Check 1: DDoS Mitigation with OxideProxy eBPF/XDP ⚙️
- **Command / Action**: `docker logs ragenodes_oxideproxy | grep -i "ebpf"`
- **Pass Criteria**: Aya Rust eBPF/XDP engine binds network filter in nanoseconds at the NIC level without GC pauses.

### Tech Check 2: Rank-Based Backup Priority Queue ⚙️
- **Command / Action**: `docker exec -it ragenodes_backend node -e "import('./src/services/backupQueue.js').then(m => console.log(m.backupQueue))"`
- **Pass Criteria**: Elite tier backup jobs preempt Hobby tier jobs in the async worker queue.

### Tech Check 3: Multi-Node Hot Migration ⚙️
- **Command / Action**: `curl -s http://localhost:3000/api/admin/nodes -H "Authorization: Bearer $TOKEN"`
- **Pass Criteria**: Backend lists remote daemon nodes and places instances according to lowest resource saturation.

### Tech Check 4: SSE LogHub Streaming & 15s Heartbeat ⚙️
- **Command / Action**: `curl -N -H "Accept: text/event-stream" http://localhost:3000/api/servers/1/logs/stream -H "Authorization: Bearer $TOKEN"`
- **Pass Criteria**: SSE stream emits periodic ": heartbeat <timestamp>" every 15 seconds to prevent NAT timeout.

### Tech Check 5: CI Pipeline Workflow Rules & Merge Request Gates ⚙️
- **Command / Action**: Push a commit to a feature branch without an MR, then open an MR to `dev`, then merge it.
- **Pass Criteria**: Pipeline does NOT run on the rogue push. Pipeline RUNS when MR is opened. Pipeline RUNS on merge to `dev`. `dev`, `staging`, and `main` are protected. Local tests pass via `npm run test:local`.
