# ⚡ QA Testing Playbook: Adverse Network & Chaos Netcode Testing

> **Objective**: Latency injection (200ms), packet loss (5-20%), jitter, and socket crash recovery.

👉 **[🚀 Launch Test Issue in GitLab (1-Click Pre-filled)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-EN%5D+%E2%9A%A1+Adverse+Network+%26+Chaos+Netcode+Testing&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Achaos&issue%5Bdescription%5D=%23%23+%E2%9A%A1+QA+Certification%3A+Adverse+Network+%26+Chaos+Netcode+Testing%0A%0A%3E+%F0%9F%93%96+**Full+step-by-step+testing+guide**%3A+See+the+%5BAdverse+Network+%26+Chaos+Netcode+Testing+Testing+Playbook%5D%28docs%2Fqa%2Fplaybooks%2Fen%2F13_chaos_network.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Part+1%3A+Gamer+Tests+%28QA+Tester%29%0A*Check+off+the+boxes+as+you+complete+your+gameplay+session%3A*%0A%0A-+%5B+%5D+**Step+1%3A+Play+under+150ms+Latency+%28High+Ping%29**+%28Pass+rule%3A+%60Gameplay+remains+smooth%3B+client-side+prediction+masks+delay+without+rubberbanding.%60%29%0A-+%5B+%5D+**Step+2%3A+Rapid+Disconnect+%26+Reconnect+Recovery**+%28Pass+rule%3A+%60Player+reconnects+into+the+active+session+at+the+exact+same+location+with+inventory+intact.%60%29%0A%0A%3E+%F0%9F%92%AC+**Finished+gamer+testing%3F**+Leave+a+comment+tagging+the+developers%3A++%0A%3E+%60%40devs+Finished+gameplay+tests+successfully.+Ready+for+tech+review.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Part+2%3A+Technical+Engine+Tests+%28Developers%29%0A*Terminal+commands+for+development+team%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+200ms+Latency+Injection+with+tc-netem**+%28%60tc+qdisc+add+dev+docker0+root+netem+delay+200ms+20ms%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Packet+Loss+Injection+%285%25+%26+20%25+bursts%29**+%28%60tc+qdisc+change+dev+docker0+root+netem+loss+5%25%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Packet+Reordering+%28Jitter+%26+Out-of-Order%29**+%28%60tc+qdisc+change+dev+docker0+root+netem+delay+100ms+30ms+reorder+25%25%60%29%0A-+%5B+%5D+**TC-DEV-4%3A+Bandwidth+Throttling+to+64+kbps**+%28%60tc+qdisc+change+dev+docker0+root+tbf+rate+64kbit+burst+32kbit+latency+400ms%60%29%0A-+%5B+%5D+**TC-DEV-5%3A+Abrupt+Container+Termination+%28SIGKILL%29**+%28%60docker+kill+%3Ccontainer-name%3E%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Achaos%22%0A)**

--- 

## 🎮 PART 1: Gamer & Gameplay Tests (For QA Tester)

*Straightforward instructions to play and stress-test the server like a real customer.*

### Step 1: Play under 150ms Latency (High Ping) 🎮
- **What to do**: Connect to game server under simulated high latency (e.g. Clumsy set to 150ms).
- ✅ **PASSED IF**: Gameplay remains smooth; client-side prediction masks delay without rubberbanding.
- ❌ **FAILED IF**: Player freezes or gets disconnected by timeout.

### Step 2: Rapid Disconnect & Reconnect Recovery 🎮
- **What to do**: Disconnect network/Wi-Fi for 15 seconds, then plug back in.
- ✅ **PASSED IF**: Player reconnects into the active session at the exact same location with inventory intact.
- ❌ **FAILED IF**: Server spawns a duplicate zombie entity or resets progress.

--- 

## ⚙️ PART 2: Technical Engine Tests (For Developers)

*Terminal commands and Docker inspection verified by developers in 3 minutes.*

### Tech Check 1: 200ms Latency Injection with tc-netem ⚙️
- **Command / Action**: `tc qdisc add dev docker0 root netem delay 200ms 20ms`
- **Pass Criteria**: OxideProxy and game UDP sockets maintain sync without simulation stalls.

### Tech Check 2: Packet Loss Injection (5% & 20% bursts) ⚙️
- **Command / Action**: `tc qdisc change dev docker0 root netem loss 5%`
- **Pass Criteria**: Input replay reconciles state drift without server crash.

### Tech Check 3: Packet Reordering (Jitter & Out-of-Order) ⚙️
- **Command / Action**: `tc qdisc change dev docker0 root netem delay 100ms 30ms reorder 25%`
- **Pass Criteria**: Out-of-order UDP datagrams are reassembled without transport deadlock.

### Tech Check 4: Bandwidth Throttling to 64 kbps ⚙️
- **Command / Action**: `tc qdisc change dev docker0 root tbf rate 64kbit burst 32kbit latency 400ms`
- **Pass Criteria**: Distance relevancy culling drops non-essential entities while keeping player movement active.

### Tech Check 5: Abrupt Container Termination (SIGKILL) ⚙️
- **Command / Action**: `docker kill <container-name>`
- **Pass Criteria**: Docker restart policy revives container and LogHub reconnects SSE stream automatically.

