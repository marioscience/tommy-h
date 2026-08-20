<div align="center">
  <img src="frontend/public/assets/icon.png" alt="RageNodes Logo" width="150" />
  <h1>🎮 RageNodes Ultimate</h1>
  <p><strong>The Most Advanced, Self-Hosted Web Panel for Game Servers & Discord Bots</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" />
    <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
    <img src="https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux" />
  </p>
</div>

<br/>

## 🚀 Overview
**RageNodes Ultimate** is an all-in-one, ultra-fast hosting control panel designed to deploy and manage isolated containers with a single click. Built with a beautiful modern glassmorphism UI, a robust Node.js backend, and a blazing-fast Rust reverse proxy.

Whether you're running a massive FiveM roleplay community or a private Rust server, RageNodes gives you complete control over your hardware without the monthly fees of commercial panels.

## 🌟 Key Features
- **🕹️ 1-Click Game Servers:** Deploy and manage FiveM, Rust, Minecraft, Palworld, 7 Days to Die, Ark: Survival Ascended, Project Zomboid, and more.
- **🤖 Discord Bot Hosting:** Secure, isolated containers for Node.js and Python Discord bots.
- **⚡ OxideProxy (Rust):** Custom, hyper-optimized Layer 4/Layer 7 reverse proxy written in Rust to handle high-traffic game networking, DDoS mitigation, and SSL termination.
- **🐳 Docker-Native:** Every server runs inside strict, secure, resource-limited Docker containers.
- **📊 Live Analytics:** Real-time CPU, RAM, and Disk usage monitoring for all running instances.
- **🎨 Premium UI:** Fully responsive, modern, dark-themed dashboard with fluid micro-animations.

## 🛠️ Technology Stack
* **Frontend:** Vanilla JS, HTML5, Modern CSS (Glassmorphism, Animations)
* **Backend:** Node.js, Express, SQLite/PostgreSQL
* **Networking/Proxy:** Rust (`oxideproxy`), eBPF
* **Containerization:** Docker, Docker Compose
* **OS Support:** Debian / Ubuntu / Proxmox LXC

## 🖥️ Supported Game Servers
| Game | Engine | Status |
|---|---|---|
| **FiveM** (GTA V) | FXServer | ✅ Fully Supported |
| **Rust** | Unity | ✅ Fully Supported |
| **Minecraft** | Java/Bedrock | ✅ Fully Supported |
| **Palworld** | Unreal | ✅ Fully Supported |
| **7 Days to Die** | Unity | ✅ Fully Supported |
| **Ark: Survival Evolved/Ascended** | Unreal | ✅ Fully Supported |
| **Project Zomboid** | Java | ✅ Fully Supported |

## ⚙️ Installation & Usage
*(Detailed installation guide coming soon...)*

1. Clone the repository to your Linux server:
   ```bash
   git clone https://github.com/Noko34/ragenodes-ultimate.git
   cd ragenodes-ultimate
   ```
2. Install dependencies:
   ```bash
   cd backend && npm install
   ```
3. Start the core panel services using Docker Compose:
   ```bash
   docker-compose up -d
   ```
4. Access the web dashboard at `http://YOUR_SERVER_IP:3000`

## 🛡️ Security & Performance
RageNodes Ultimate uses strict container isolation (`cgroups`) to ensure no single game server can hog system resources or compromise the host machine. The integrated **OxideProxy** ensures that game traffic is routed efficiently with minimal latency while protecting against common volumetric attacks.

## 📜 License
This project is for private/personal use. Please ensure you comply with the respective EULAs and TOS of the game servers (FiveM, SteamCMD, etc.) you intend to host.
