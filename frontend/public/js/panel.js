function toggleSidebar() {
            document.getElementById('sidebar').classList.toggle('open');
            document.getElementById('sidebar-overlay').classList.toggle('active');
        }

        function toggleProfileDropdown(e) {
            if (e) e.stopPropagation();
            document.getElementById('profile-dropdown').classList.toggle('active');
        }

        window.addEventListener('click', () => {
            document.getElementById('profile-dropdown')?.classList.remove('active');
        });

        function showToast(message, type = 'success') {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            const icon = type === 'success' ? 'fa-check-circle' : (type === 'danger' ? 'fa-triangle-exclamation' : 'fa-info-circle');
            toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
            container.appendChild(toast);
            setTimeout(() => { toast.remove(); }, 3400);
        }

        function openActionModal(htmlContent, customMaxWidth = '460px') {
            const card = document.querySelector('#action-modal .card');
            if (card) card.style.maxWidth = customMaxWidth;
            document.getElementById('modal-content-area').innerHTML = htmlContent;
            document.getElementById('action-modal').classList.remove('hidden');
        }

        function closeActionModal() {
            document.getElementById('action-modal').classList.add('hidden');
        }

        function closeModal(id) {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        }

        // 🚀 LÓGICA DEL MENÚ CONTEXTUAL FLOTANTE
        function closeFmMenu() {
            const existing = document.getElementById('fm-dynamic-menu');
            if (existing) existing.remove();
        }

        document.addEventListener('click', closeFmMenu);

        function openFmMenu(e, path, name, type) {
            e.stopPropagation();
            closeFmMenu();

            const menu = document.createElement('div');
            menu.id = 'fm-dynamic-menu';
            menu.className = 'fm-context-menu';

            let itemsHtml = '';

            if (type === 'dir') {
                itemsHtml += `<div class="fm-context-menu-item" ${rnBind("click", (event, element) => { fmDownloadFolder((path), event); closeFmMenu(); })}><i class="fa-solid fa-download" style="color:var(--success)"></i> Descargar Carpeta</div>`;
                itemsHtml += `<div class="fm-context-menu-item" ${rnBind("click", (event, element) => { fmMove((path), (name), event); closeFmMenu(); })}><i class="fa-solid fa-scissors" style="color:var(--warning)"></i> Mover Carpeta</div>`;
                itemsHtml += `<div class="fm-context-menu-item" ${rnBind("click", (event, element) => { fmRename((path), (name), event); closeFmMenu(); })}><i class="fa-solid fa-pen-to-square" style="color:var(--info)"></i> Renombrar Carpeta</div>`;
                itemsHtml += `<div class="fm-context-menu-item danger" ${rnBind("click", (event, element) => { fmDelete((path), event); closeFmMenu(); })}><i class="fa-solid fa-trash" style="color:var(--danger)"></i> Eliminar Carpeta</div>`;
            } else if (type === 'zip') {
                itemsHtml += `<div class="fm-context-menu-item" ${rnBind("click", (event, element) => { fmUnzip((path), event); closeFmMenu(); })}><i class="fa-solid fa-file-zipper" style="color:var(--success)"></i> Extraer ZIP</div>`;
                itemsHtml += `<div class="fm-context-menu-item" ${rnBind("click", (event, element) => { fmDownloadFileMenu((path), event); closeFmMenu(); })}><i class="fa-solid fa-download" style="color:var(--info)"></i> Descargar</div>`;
                itemsHtml += `<div class="fm-context-menu-item" ${rnBind("click", (event, element) => { fmMove((path), (name), event); closeFmMenu(); })}><i class="fa-solid fa-scissors" style="color:var(--warning)"></i> Mover Archivo</div>`;
                itemsHtml += `<div class="fm-context-menu-item" ${rnBind("click", (event, element) => { fmRename((path), (name), event); closeFmMenu(); })}><i class="fa-solid fa-pen-to-square" style="color:var(--info)"></i> Renombrar Archivo</div>`;
                itemsHtml += `<div class="fm-context-menu-item danger" ${rnBind("click", (event, element) => { fmDelete((path), event); closeFmMenu(); })}><i class="fa-solid fa-trash" style="color:var(--danger)"></i> Eliminar Archivo</div>`;
            } else {
                itemsHtml += `<div class="fm-context-menu-item" ${rnBind("click", (event, element) => { fmDownloadFileMenu((path), event); closeFmMenu(); })}><i class="fa-solid fa-download" style="color:var(--success)"></i> Descargar</div>`;
                itemsHtml += `<div class="fm-context-menu-item" ${rnBind("click", (event, element) => { fmMove((path), (name), event); closeFmMenu(); })}><i class="fa-solid fa-scissors" style="color:var(--warning)"></i> Mover Archivo</div>`;
                itemsHtml += `<div class="fm-context-menu-item" ${rnBind("click", (event, element) => { fmRename((path), (name), event); closeFmMenu(); })}><i class="fa-solid fa-pen-to-square" style="color:var(--info)"></i> Renombrar Archivo</div>`;
                itemsHtml += `<div class="fm-context-menu-item danger" ${rnBind("click", (event, element) => { fmDelete((path), event); closeFmMenu(); })}><i class="fa-solid fa-trash" style="color:var(--danger)"></i> Eliminar Archivo</div>`;
            }

            menu.innerHTML = itemsHtml;
            document.body.appendChild(menu);

            const rect = menu.getBoundingClientRect();
            let top = e.clientY;
            let left = e.clientX - rect.width;

            if (top + rect.height > window.innerHeight) {
                top -= rect.height;
            }

            menu.style.top = `${top}px`;
            menu.style.left = `${left}px`;
        }

        function fmDownloadFileMenu(path, e) {
            if (e) e.stopPropagation();
            window.open(`/api/files/download?serverId=${currentServerId}&path=${encodeURIComponent(path)}`, '_blank');
        }

        function openCreateModal(type) {
            const typeName = type === 'dir' ? 'Carpeta' : 'Archivo';
            const icon = type === 'dir' ? 'fa-folder-plus' : 'fa-file-circle-plus';

            const html = `
              <h3 style="margin-bottom: 20px; font-size: 1.2rem;"><i class="fa-solid ${icon}" style="color:var(--primary); margin-right:8px;"></i> Crear ${typeName}</h3>
              <div style="margin-bottom: 20px;">
                  <label class="form-label">Nombre del nuevo ${typeName.toLowerCase()}</label>
                  <input type="text" class="input" id="modal-input-name" placeholder="ejemplo${type === 'file' ? '.lua' : ''}" ${rnBind("keydown", (event, element) => { if(event.key === 'Enter') executeCreate((type)) })}>
              </div>
              <div style="display:flex; gap:12px;">
                  <button class="btn-ghost" style="flex:1;" ${rnBind("click", (event, element) => { closeActionModal() })}>Cancelar</button>
                  <button class="btn" style="flex:1;" ${rnBind("click", (event, element) => { executeCreate((type)) })}>Crear</button>
              </div>
          `;
            openActionModal(html);
            setTimeout(() => document.getElementById('modal-input-name').focus(), 100);
        }

        async function executeCreate(type) {
            const n = document.getElementById('modal-input-name').value.trim();
            if (!n) return showToast('El nombre no puede estar vacío', 'warning');

            try {
                const action = type === 'dir' ? 'mkdir' : 'createFile';
                await Nexus.api('/api/files/action', { method: 'POST', body: JSON.stringify({ serverId: currentServerId, path: currentFolderPath === '/' ? `/${n}` : `${currentFolderPath}/${n}`, action: action }) });
                showToast(`${type === 'dir' ? 'Carpeta' : 'Archivo'} creado`, 'success');
                loadFolder(currentFolderPath);
            } catch (e) {
                showToast('Error al crear. ' + (e.message || ''), 'danger');
            }
            closeActionModal();
        }

        function openUrlDownloadModal() {
            const html = `
              <h3 style="margin-bottom: 20px; font-size: 1.2rem;"><i class="fa-solid fa-cloud-arrow-down" style="color:var(--info); margin-right:8px;"></i> Importar desde URL</h3>
              <div style="margin-bottom: 15px;">
                  <label class="form-label">URL Directa (ej. .zip, .sql)</label>
                  <input type="url" class="input" id="modal-dl-url" placeholder="https://ejemplo.com/archivo.zip">
              </div>
              <div style="margin-bottom: 20px;">
                  <label class="form-label">Guardar como (Nombre del archivo)</label>
                  <input type="text" class="input" id="modal-dl-name" placeholder="archivo.zip">
              </div>
              <div style="display:flex; gap:12px;">
                  <button class="btn-ghost" style="flex:1;" ${rnBind("click", (event, element) => { closeActionModal() })}>Cancelar</button>
                  <button class="btn" style="flex:1; background:var(--info);" ${rnBind("click", (event, element) => { executeUrlDownload() })}><i class="fa-solid fa-download"></i> Importar</button>
              </div>
          `;
            openActionModal(html);
        }

        async function executeUrlDownload() {
            const u = document.getElementById('modal-dl-url').value.trim();
            const n = document.getElementById('modal-dl-name').value.trim();

            if (!u || !n) return showToast('Rellena todos los campos', 'warning');
            closeActionModal();

            try {
                const res = await fetch('/api/files/download-remote', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ serverId: currentServerId, path: currentFolderPath, url: u, fileName: n })
                });
                const data = await res.json();

                if (data.success) {
                    showToast(data.message || 'Descarga iniciada en segundo plano', 'info');
                } else {
                    throw new Error(data.error);
                }
            } catch (e) {
                showToast('Error al iniciar descarga', 'danger');
            }
        }

        function openPoolModal() {
            const modal = document.getElementById('pool-modal');
            if (modal) modal.classList.remove('hidden');
        }
        function closePoolModal() {
            const modal = document.getElementById('pool-modal');
            if (modal) modal.classList.add('hidden');
        }
        function selectServerFromPool(srvId) {
            window._selectedServerId = srvId;
            localStorage.setItem('nexus_selected_server_id', srvId);
            closePoolModal();
            loadServers();
        }

        function openDeployModal(savedName = '', savedGame = 'fivem') {
            const planConfig = { hobby: { ram: 4 }, standard: { ram: 8 }, premium: { ram: 16 }, elite: { ram: 32 }, platinum: { ram: 32 }, partner: { ram: 32 }, plan_platinum: { ram: 32 } };
            const uPlan = (user && user.plan) ? user.plan.toLowerCase() : 'hobby';
            const maxPlanRam = (planConfig[uPlan] || planConfig['hobby']).ram;
            const usedRam = (globalServersList || []).reduce((acc, s) => acc + (Number(s.allocated_ram_gb) || 0), 0);
            const remainingRam = Math.max(2, maxPlanRam - usedRam); // Minimum 2 just to render the slider properly

              const gamesList = [
                  { id: 'fivem', name: 'FiveM', desc: 'GTA V Roleplay', icon: 'fa-car', color: 'var(--primary)', bg: '/assets/bg_fivem.webp' },
                  { id: 'minecraft', name: 'Minecraft', desc: 'Java Edition', icon: 'fa-cube', color: '#4ade80', bg: '/assets/games/minecraft.webp' },
                  { id: 'rust', name: 'Rust', desc: 'Survival', icon: 'fa-radiation', color: '#fbbf24', bg: '/assets/games/steam_252490_header.webp' },
                  { id: 'palworld', name: 'Palworld', desc: 'Open World', icon: 'fa-paw', color: '#f472b6', bg: '/assets/games/steam_1623730_header.webp' },
                  { id: 'valheim', name: 'Valheim', desc: 'Viking Survival', icon: 'fa-helmet-safety', color: '#6366f1', bg: '/assets/games/steam_892970_header.webp' },
                  { id: 'zomboid', name: 'Zomboid', desc: 'Hardcore Survival', icon: 'fa-skull', color: '#22c55e', bg: '/assets/games/steam_108600_header.webp' },
                  { id: 'ark', name: 'ARK', desc: 'Unreal Engine 5', icon: 'fa-dragon', color: '#eab308', bg: '/assets/games/steam_2399830_header.webp' },
                  { id: 'sdtd', name: '7D2D', desc: 'Horde Survival', icon: 'fa-biohazard', color: '#ef4444', bg: '/assets/games/steam_251570_header.webp' },
                  { id: 'cs2', name: 'Counter-Strike 2', desc: 'eSports', icon: 'fa-crosshairs', color: '#facc15', bg: '/assets/games/steam_730_header.webp' },
                  { id: 'discordbot', name: 'Discord Bot', desc: 'Node.js / Python', icon: 'fa-robot', color: '#5865F2', bg: '' },
                  { id: 'wordpress', name: 'Página Web', desc: 'WordPress / HTML', icon: 'fa-globe', color: '#10b981', bg: '' },
                  { id: 'database', name: 'Base de Datos', desc: 'MySQL / MariaDB', icon: 'fa-database', color: '#f97316', bg: '' }
              ];

              const gamesHtml = gamesList.map(g => `
                <div id="game-opt-${g.id}" ${rnBind("click", (event, element) => { selectGame((g.id)) })} style="
                  position: relative; overflow: hidden; padding: 20px 10px; text-align: center;
                  cursor: pointer; background: #0a0a0a; border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                ">
                  <div class="game-bg-overlay" style="position: absolute; inset: 0; background: url('${g.bg}') center/cover no-repeat; opacity: 0.2; filter: saturate(0.5); transition: all 0.3s ease; pointer-events: none;"></div>
                  <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(10,10,10,0.95) 0%, rgba(10,10,10,0.2) 100%); pointer-events: none;"></div>

                  <div class="game-icon-box" style="position: relative; z-index: 1; width: 44px; height: 44px; border-radius: 10px; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; transition: all 0.3s ease;">
                      <i class="fa-solid ${g.icon}" style="font-size: 1.4rem; color: ${g.color}; text-shadow: 0 0 10px rgba(0,0,0,0.5);"></i>
                  </div>

                  <div style="position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                      <div style="font-weight: 900; color: white; font-size: 0.95rem; text-shadow: 0 0 12px rgba(0,0,0,1);">${g.name}</div>
                      <div class="muted" style="font-size: 0.65rem; text-shadow: 0 0 10px rgba(0,0,0,1); font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">${g.desc}</div>
                  </div>
                </div>
              `).join('');

            const html = `
              <div style="display: flex; gap: 30px; align-items: stretch; flex-wrap: wrap;">

                  <!-- Columna Izquierda: Selector de Juego -->
                  <div style="flex: 1.3; min-width: 300px;">
                      <h3 style="margin-bottom: 20px; font-size: 1.2rem; color: white; font-weight: 800;"><i class="fa-solid fa-server" style="color:var(--primary); margin-right:8px;"></i> Nuevo Servidor</h3>
                      <p class="muted" style="margin-bottom: 20px; font-size: 0.85rem;">Selecciona el tipo de juego para tu servidor:</p>

                      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;" id="game-selector">
                        ${gamesHtml}
                      </div>
                  </div>

                  <!-- Separador Vertical (Oculto en móviles por el flex-wrap) -->
                  <div style="width: 1px; background: rgba(255,255,255,0.05); margin: 0 5px;"></div>

                  <!-- Columna Derecha: Configuración -->
                  <div style="flex: 1; min-width: 250px; display: flex; flex-direction: column;">
                      <h3 style="margin-bottom: 20px; font-size: 1.2rem; color: white; font-weight: 800;"><i class="fa-solid fa-sliders" style="color:var(--info); margin-right:8px;"></i> Configuración</h3>
                      <p class="muted" style="margin-bottom: 20px; font-size: 0.85rem;">Ajusta los recursos y detalles.</p>

                      <div style="margin-bottom: 16px;">
                          <label class="form-label">Nombre del Servidor</label>
                          <input type="text" class="input" id="modal-deploy-name" placeholder="Mi Servidor" value="${savedName}">
                      </div>

                      <div style="margin-bottom: 20px; background: rgba(0,0,0,0.2); border: 1px solid var(--line); border-radius: 12px; padding: 16px;">
                          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                              <label class="form-label" style="margin:0; font-size: 0.85rem; color: var(--muted);"><i class="fa-solid fa-memory" style="color: #38bdf8; margin-right: 6px;"></i> RAM Asignada</label>
                              <span id="ram-slider-val" style="font-size: 1.1rem; font-weight: 800; color: #38bdf8; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); padding: 4px 12px; border-radius: 20px;">2 GB</span>
                          </div>
                          <input type="range" id="modal-deploy-ram" min="2" max="${remainingRam}" value="2" step="1" style="
                              width: 100%; accent-color: #38bdf8; cursor: pointer; height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;
                          " ${rnBind("input", (event, element) => { document.getElementById('ram-slider-val').innerText = element.value + ' GB' })}>
                          <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 0.7rem; color: var(--muted);">
                              <span>Mín. 2 GB (Recomendado)</span>
                              <span>Máx. Disponible: ${remainingRam} GB</span>
                          </div>
                      </div>

                      <div id="fivem-extra" style="margin-bottom: 16px;">
                          <label class="form-label">License Key de FiveM</label>
                          <input type="text" class="input" id="modal-deploy-lickey" placeholder="cfxk_xxxxx (opcional)">
                      </div>

                      <!-- Opciones extra para Minecraft (hidden by default) -->
                      <div id="minecraft-extra" style="display:none; margin-bottom: 16px;">
                          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
                              <div>
                                  <label class="form-label">Versión</label>
                                  <select class="input" id="modal-mc-version" style="margin-bottom:0;">
                                      <option value="LATEST">Latest (Rec.)</option>
                                      <option value="1.21.4">1.21.4</option>
                                      <option value="1.20.6">1.20.6</option>
                                      <option value="1.20.1">1.20.1</option>
                                  </select>
                              </div>
                              <div>
                                  <label class="form-label">Software</label>
                                  <select class="input" id="modal-mc-type" style="margin-bottom:0;">
                                      <option value="PAPER">Paper (Rec.)</option>
                                      <option value="PURPUR">Purpur</option>
                                      <option value="VANILLA">Vanilla</option>
                                  </select>
                              </div>
                          </div>
                      </div>

                      <div style="margin-top: auto; display:flex; gap:12px; padding-top: 20px;">
                          <button class="btn-ghost" style="flex:1; padding: 16px; border-radius: 12px; font-weight: 700; font-size: 0.95rem;" ${rnBind("click", (event, element) => { closeActionModal() })}>Cancelar</button>
                          <button class="btn-primary" style="flex:1; padding: 16px; border-radius: 12px; font-weight: 800; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 10px 25px rgba(56, 189, 248, 0.25);" ${rnBind("click", (event, element) => { executeDeploy() })}><i class="fa-solid fa-rocket" style="margin-right:8px;"></i> Desplegar</button>
                      </div>
                  </div>
              </div>
          `;
            openActionModal(html, '850px');
            window._selectedGame = savedGame;
            if (savedGame !== 'fivem') selectGame(savedGame);
        }

        function openMinecraftVersionModal(savedName = '') {
            const versions = ['1.21.4', '1.20.6', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.8'];
            const types = [
                { id: 'PAPER', name: 'Paper', desc: 'Optimizado (Recomendado)', icon: 'fa-leaf', color: '#4ade80' },
                { id: 'PURPUR', name: 'Purpur', desc: 'Alto Rendimiento', icon: 'fa-bolt', color: '#a855f7' },
                { id: 'FABRIC', name: 'Fabric', desc: 'Ligero para Mods', icon: 'fa-microchip', color: '#facc15' },
                { id: 'FORGE', name: 'Forge', desc: 'Mods Clásicos', icon: 'fa-hammer', color: '#fb923c' },
                { id: 'VANILLA', name: 'Vanilla', desc: 'Original de Mojang', icon: 'fa-cube', color: '#94a3b8' }
            ];

            const html = `
              <div style="text-align: center; margin-bottom: 15px;">
                  <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(74, 222, 128, 0.1); border: 1px solid rgba(74, 222, 128, 0.3); display: flex; align-items: center; justify-content: center; margin: 0 auto 10px; box-shadow: 0 0 20px rgba(74, 222, 128, 0.2);">
                      <i class="fa-solid fa-cube" style="font-size: 1.5rem; color: #4ade80; text-shadow: 0 0 10px rgba(74, 222, 128, 0.5);"></i>
                  </div>
                  <h3 style="font-size: 1.2rem; color: white; font-weight: 800; margin-bottom: 5px;">Configurar Minecraft</h3>
                  <p class="muted" style="font-size: 0.8rem; max-width: 80%; margin: 0 auto;">Personaliza la experiencia de juego y el núcleo del servidor.</p>
              </div>

              <div style="margin-bottom: 15px;">
                  <label class="form-label" style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin-bottom: 8px; display: block;"><i class="fa-solid fa-code-branch" style="margin-right: 6px;"></i> 1. Selecciona la Versión</label>
                  <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;" id="mc-version-grid">
                      ${versions.map(v => `
                          <div ${rnBind("click", (event, element) => { selectMcVersion((v)) })} id="mc-v-${v.replace(/\./g, '-')}" style="
                              padding: 8px 5px; border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; text-align: center;
                              cursor: pointer; background: rgba(0,0,0,0.3); font-size: 0.8rem; font-weight: 700;
                              transition: all 0.2s ease; color: var(--muted);
                          " ${rnBind("mouseover", (event, element) => { if(window._mcSelectedVersion !== (v)) element.style.borderColor='rgba(255,255,255,0.2)'; })} ${rnBind("mouseout", (event, element) => { if(window._mcSelectedVersion !== (v)) element.style.borderColor='rgba(255,255,255,0.05)'; })}>${v}</div>
                      `).join('')}
                  </div>
              </div>

              <div style="margin-bottom: 20px;">
                  <label class="form-label" style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin-bottom: 8px; display: block;"><i class="fa-solid fa-microchip" style="margin-right: 6px;"></i> 2. Tipo de Servidor</label>
                  <div style="display: grid; grid-template-columns: 1fr; gap: 8px;" id="mc-type-grid">
                      ${types.map(t => `
                          <div ${rnBind("click", (event, element) => { selectMcType((t.id)) })} id="mc-t-${t.id}" style="
                              display: flex; align-items: center; gap: 12px; padding: 10px 14px;
                              border: 1px solid rgba(255,255,255,0.05); border-radius: 10px; cursor: pointer;
                              background: rgba(0,0,0,0.2); transition: all 0.3s ease;
                          " ${rnBind("mouseover", (event, element) => { if(window._mcSelectedType !== (t.id)) { element.style.borderColor='rgba(255,255,255,0.2)'; element.style.background='rgba(255,255,255,0.02)'; } })} ${rnBind("mouseout", (event, element) => { if(window._mcSelectedType !== (t.id)) { element.style.borderColor='rgba(255,255,255,0.05)'; element.style.background='rgba(0,0,0,0.2)'; } })}>
                              <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; transition: all 0.3s ease;">
                                  <i class="fa-solid ${t.icon}" style="color: ${t.color}; font-size: 1rem; text-shadow: 0 0 10px ${t.color}40;"></i>
                              </div>
                              <div style="flex: 1;">
                                  <div style="font-weight: 800; color: white; font-size: 0.85rem; margin-bottom: 1px;">${t.name}</div>
                                  <div class="muted" style="font-size: 0.7rem;">${t.desc}</div>
                              </div>
                              <i class="fa-solid fa-circle-check check-icon" style="color: ${t.color}; font-size: 1.1rem; opacity: 0; transition: 0.3s; text-shadow: 0 0 10px ${t.color};"></i>
                          </div>
                      `).join('')}
                  </div>
              </div>

              <div style="display:flex; gap:10px; margin-top:5px;">
                  <button class="btn-ghost" style="flex:1; padding: 12px; border-radius: 10px; font-weight: 700; font-size: 0.9rem;" ${rnBind("click", (event, element) => { openDeployModal((savedName), 'minecraft') })}><i class="fa-solid fa-arrow-left" style="margin-right: 6px;"></i> Volver</button>
                  <button class="btn" style="flex:1; background: #4ade80; color: #064e3b; padding: 12px; border-radius: 10px; font-weight: 800; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 6px 20px rgba(74, 222, 128, 0.3);" ${rnBind("click", (event, element) => { confirmMcConfig((savedName)) })}>Confirmar <i class="fa-solid fa-check" style="margin-left: 6px;"></i></button>
              </div>
          `;

            openActionModal(html, '520px');

            // Initial selection
            window._mcSelectedVersion = window._mcSelectedVersion || '1.21.4';
            window._mcSelectedType = window._mcSelectedType || 'PAPER';

            selectMcVersion(window._mcSelectedVersion);
            selectMcType(window._mcSelectedType);
        }

        function selectMcVersion(v) {
            window._mcSelectedVersion = v;
            document.querySelectorAll('#mc-version-grid > div').forEach(el => {
                el.style.borderColor = 'rgba(255,255,255,0.05)';
                el.style.background = 'rgba(0,0,0,0.3)';
                el.style.color = 'var(--muted)';
                el.style.boxShadow = 'none';
            });
            const active = document.getElementById('mc-v-' + v.replace(/\./g, '-'));
            if (active) {
                active.style.borderColor = '#4ade80';
                active.style.background = 'rgba(74,222,128,0.1)';
                active.style.color = 'white';
                active.style.boxShadow = '0 0 15px rgba(74,222,128,0.2)';
            }
        }

        function selectMcType(t) {
            window._mcSelectedType = t;
            const colors = {
                PAPER: { hex: '#4ade80', rgb: '74, 222, 128' },
                PURPUR: { hex: '#a855f7', rgb: '168, 85, 247' },
                FABRIC: { hex: '#facc15', rgb: '250, 204, 21' },
                FORGE: { hex: '#fb923c', rgb: '251, 146, 60' },
                VANILLA: { hex: '#94a3b8', rgb: '148, 163, 184' }
            };

            document.querySelectorAll('#mc-type-grid > div').forEach(el => {
                el.style.borderColor = 'rgba(255,255,255,0.05)';
                el.style.background = 'rgba(0,0,0,0.2)';
                el.style.boxShadow = 'none';

                const iconBox = el.querySelector('div > div');
                if (iconBox) {
                    iconBox.style.background = 'rgba(255,255,255,0.03)';
                    iconBox.style.borderColor = 'rgba(255,255,255,0.05)';
                }

                const check = el.querySelector('.check-icon');
                if (check) check.style.opacity = '0';
            });

            const active = document.getElementById('mc-t-' + t);
            if (active) {
                const c = colors[t] || colors['PAPER'];
                active.style.borderColor = c.hex;
                active.style.background = `rgba(${c.rgb}, 0.05)`;
                active.style.boxShadow = `0 0 20px rgba(${c.rgb}, 0.15)`;

                const iconBox = active.querySelector('div > div');
                if (iconBox) {
                    iconBox.style.background = `rgba(${c.rgb}, 0.15)`;
                    iconBox.style.borderColor = c.hex;
                }

                const check = active.querySelector('.check-icon');
                if (check) check.style.opacity = '1';
            }
        }

        function confirmMcConfig(name) {
            openDeployModal(name, 'minecraft');
            showToast('Configuración de Minecraft aplicada', 'success');
        }

        function selectGame(game) {
            const plan = (user && user.plan) ? user.plan.toLowerCase() : 'hobby';
            const access = {
                hobby: ['minecraft', 'fivem'],
                standard: ['minecraft', 'fivem', 'rust', 'cs2', 'valheim', 'zomboid', 'sdtd'],
                premium: ['minecraft', 'fivem', 'rust', 'palworld', 'cs2', 'valheim', 'zomboid', 'ark', 'sdtd'],
                elite: ['minecraft', 'fivem', 'rust', 'palworld', 'cs2', 'valheim', 'zomboid', 'ark', 'sdtd'],
                platinum: ['minecraft', 'fivem', 'rust', 'palworld', 'cs2', 'valheim', 'zomboid', 'ark', 'sdtd'],
                plan_platinum: ['minecraft', 'fivem', 'rust', 'palworld', 'cs2', 'valheim', 'zomboid', 'ark', 'sdtd'],
                partner: ['minecraft', 'fivem', 'rust', 'palworld', 'cs2', 'valheim', 'zomboid', 'ark', 'sdtd'],
                ultimate: ['minecraft', 'fivem', 'rust', 'palworld', 'cs2', 'valheim', 'zomboid', 'ark', 'sdtd', 'wordpress', 'discordbot', 'database']
            };

            const isAllowed = (access[plan] || []).includes(game);
            if (!isAllowed) {
                showToast(`Tu plan ${plan.toUpperCase()} no incluye servidores de ${game.toUpperCase()}. ¡Mejora tu plan para desbloquearlo!`, 'warning');
                return;
            }

            if (game === 'minecraft' && window._selectedGame !== 'minecraft') {
                const currentName = document.getElementById('modal-deploy-name')?.value || '';
                openMinecraftVersionModal(currentName);
                return;
            }

            window._selectedGame = game;

            // Reset all
            ['fivem', 'minecraft', 'rust', 'palworld', 'cs2', 'valheim', 'zomboid', 'ark', 'sdtd', 'wordpress', 'discordbot', 'database'].forEach(g => {
                const el = document.getElementById('game-opt-' + g);
                if (!el) return;

                const allowed = (access[plan] || []).includes(g);
                el.style.border = '1px solid rgba(255,255,255,0.05)';
                el.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';
                el.style.opacity = allowed ? '1' : '0.4';

                const bgOverlay = el.querySelector('.game-bg-overlay');
                if (bgOverlay) {
                    bgOverlay.style.opacity = '0.2';
                    bgOverlay.style.filter = 'saturate(0.5)';
                }

                const iconBox = el.querySelector('.game-icon-box');
                if (iconBox) {
                    iconBox.style.background = 'rgba(255,255,255,0.05)';
                    iconBox.style.boxShadow = 'none';
                }

                const extra = document.getElementById(g + '-extra');
                if (extra) extra.style.display = 'none';
            });

            // Active style
            const active = document.getElementById('game-opt-' + game);

            const colors = {
                fivem: '#6366f1', minecraft: '#4ade80', rust: '#fbbf24',
                palworld: '#f472b6', cs2: '#facc15', valheim: '#6366f1',
                zomboid: '#22c55e', ark: '#eab308', sdtd: '#ef4444'
            };

            if (active) {
                active.style.border = `1px solid ${colors[game]}`;
                active.style.boxShadow = `0 0 20px ${colors[game]}33`;
                active.style.opacity = '1';

                const bgOverlay = active.querySelector('.game-bg-overlay');
                if (bgOverlay) {
                    bgOverlay.style.opacity = '0.7';
                    bgOverlay.style.filter = 'saturate(1.3)';
                }

                const iconBox = active.querySelector('.game-icon-box');
                if (iconBox) {
                    iconBox.style.background = `${colors[game]}40`; // 25% opacity
                    iconBox.style.boxShadow = `0 0 15px ${colors[game]}80`; // 50% opacity
                }
            }

            const extra = document.getElementById(game + '-extra');
            if (extra) extra.style.display = 'block';
        }

        async function executeDeploy() {
            const name = document.getElementById('modal-deploy-name').value.trim();
            if (!name) return showToast('El nombre es obligatorio', 'warning');

            const game = window._selectedGame || 'fivem';
            const allocatedRamGb = document.getElementById('modal-deploy-ram')?.value || 2;
            const body = { serverName: name, template: game, allocatedRamGb: Number(allocatedRamGb) };

            if (game === 'fivem') {
                body.licenseKey = document.getElementById('modal-deploy-lickey')?.value.trim() || 'changeme';
            } else if (game === 'minecraft') {
                body.mcVersion = window._mcSelectedVersion || '1.21.4';
                body.mcType = window._mcSelectedType || 'PAPER';
                body.maxPlayers = 20; // Default
            }

            closeActionModal();

            const btn = document.getElementById('btn-deploy');
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creando...';
            btn.disabled = true;

            try {
                await Nexus.api('/api/servers', { method: 'POST', body: JSON.stringify(body) });
                showToast('¡Servidor creado con éxito!', 'success');
                lastDataHash = "";
                loadServers();
            } catch (e) {
                showToast("Error al desplegar: " + (e.message || "Contacta a soporte."), 'danger');
                btn.innerHTML = '<i class="fa-solid fa-plus"></i> Desplegar';
                btn.disabled = false;
            }
        }


        let user = JSON.parse(localStorage.getItem('nexus_user') || '{}');
        const displayName = user.username || 'Usuario';
        document.getElementById('username-display').innerText = displayName;

        // Actualizar iniciales del avatar
        const initials = displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const avatarEl = document.getElementById('user-avatar-initials');
        if (avatarEl) avatarEl.innerText = initials || 'U';

        let blenderActionPending = false;

        function updateEmailUI() {
            const userNow = JSON.parse(localStorage.getItem('nexus_user') || '{}');
            const emailEl = document.getElementById('set-email');
            const badge = document.getElementById('email-status-badge');
            const lockMsg = document.getElementById('email-lock-msg');
            const profileStatus = document.getElementById('profile-display-status');

            emailEl.value = userNow.email || '';
            if (!userNow.email) {
                emailEl.placeholder = "No hay correo registrado";
            }

            // 🤖 Cargar Discord ID si existe
            if (userNow.discord_id) {
                document.getElementById('discord-id-input').value = userNow.discord_id;
                document.getElementById('discord-status-msg').innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--success)"></i> Tu cuenta de Discord está vinculada.`;
            } else {
                document.getElementById('discord-status-msg').innerHTML = "";
            }

            if (userNow.is_verified) {
                emailEl.disabled = true;
                if (emailEl.parentElement) {
                    emailEl.parentElement.style.opacity = '0.6';
                    emailEl.parentElement.style.cursor = 'not-allowed';
                }
                if (badge) {
                    badge.innerHTML = 'VERIFICADO';
                    badge.style.color = 'var(--success)';
                }
                if (lockMsg) lockMsg.classList.remove('hidden');
                if (profileStatus) {
                    profileStatus.innerText = 'Cuenta Verificada';
                    profileStatus.style.color = 'var(--success)';
                }

                const settingsBanner = document.getElementById('settings-unverified-banner');
                if (settingsBanner) settingsBanner.classList.add('hidden');
            } else {
                emailEl.disabled = false;
                if (emailEl.parentElement) {
                    emailEl.parentElement.style.opacity = '1';
                    emailEl.parentElement.style.cursor = 'text';
                }
                if (badge) {
                    badge.innerHTML = 'SIN VERIFICAR';
                    badge.style.color = 'var(--warning)';
                }
                if (lockMsg) lockMsg.classList.add('hidden');
                if (profileStatus) {
                    profileStatus.innerText = 'Pendiente de Verificación';
                    profileStatus.style.color = 'var(--warning)';
                }

                const settingsBanner = document.getElementById('settings-unverified-banner');
                if (settingsBanner) settingsBanner.classList.remove('hidden');
            }

            // Badge global de verificación
            const unverifiedBadge = document.getElementById('unverified-badge');
            if (unverifiedBadge) {
                if (userNow.is_verified) unverifiedBadge.classList.add('hidden');
                else unverifiedBadge.classList.remove('hidden');
            }
        }

        async function syncClientData() {
            try {
                const res = await Nexus.api('/api/auth/me');
                if (res && res.username) {
                    localStorage.setItem('nexus_user', JSON.stringify(res));
                    user = res;
                    Nexus.user = res; // 🚀 Sincronizar con el objeto global Nexus
                    document.getElementById('username-display').innerText = res.username;
                    updateEmailUI();

                    // 🔥 VERIFICAR SUSPENSIÓN
                    if (res.expires_at) {
                        const expDate = new Date(res.expires_at);
                        if (expDate < new Date()) {
                            document.getElementById('suspension-overlay').classList.remove('hidden');
                            return; // Detenemos la carga del resto del panel
                        }
                    }

                    // 🔥 CONTROL DE ACCESO AL PORTAL DEL VENDEDOR Y ADMIN
                    // 🔥 CONTROL DE ACCESO AL PORTAL DEL VENDEDOR Y ADMIN
                    const vendorNav = document.getElementById('nav-vendor-portal');
                    const adminNavMarket = document.getElementById('nav-admin-marketplace');
                    const adminMarketBtn = document.getElementById('btn-admin-upload-trigger');

                    // Portal del Vendedor (Para Vendors y Admins)
                    if (vendorNav) {
                        if (res.role === 'vendor' || res.role === 'admin') {
                            vendorNav.style.display = 'flex';
                            // Ocultar card de postulación si ya es vendedor
                            const vendorCard = document.getElementById('card-vendor-apply');
                            if (vendorCard) vendorCard.style.display = 'none';
                        } else {
                            vendorNav.style.display = 'none';
                        }
                    }

                    // Herramientas Fast Upload (Solo para Admins)
                    const adminNavVendors = document.getElementById('nav-admin-vendors');
                    if (res.role === 'admin') {
                        if (adminNavMarket) adminNavMarket.style.display = 'flex';
                        if (adminMarketBtn) adminMarketBtn.style.display = 'flex';
                        if (adminNavVendors) adminNavVendors.style.display = 'flex';
                    } else {
                        if (adminNavMarket) adminNavMarket.style.display = 'none';
                        if (adminMarketBtn) adminMarketBtn.style.display = 'none';
                        if (adminNavVendors) adminNavVendors.style.display = 'none';
                    }
                }
            } catch (e) {
                if (e.status === 401) Nexus.logout();
            }
        }

        updateEmailUI();
        syncClientData();

        // 🤖 FUNCIÓN: VINCULAR DISCORD
        async function linkDiscordAccount() {
            const discordId = document.getElementById('discord-id-input').value.trim();
            if (!discordId) return showToast("Introduce un ID de Discord", 'warning');

            const btn = document.getElementById('btn-link-discord');
            const original = btn.innerText;
            btn.innerText = "Vinculando...";
            btn.disabled = true;

            try {
                // 🔥 PARCHE APLICADO: Ruta corregida a /api/auth/link-discord
                const res = await Nexus.api('/api/auth/link-discord', {
                    method: 'POST',
                    body: JSON.stringify({ discordId })
                });
                showToast(res.message, 'success');

                const userNow = JSON.parse(localStorage.getItem('nexus_user') || '{}');
                userNow.discord_id = discordId;
                localStorage.setItem('nexus_user', JSON.stringify(userNow));
                updateEmailUI();

            } catch (e) {
                showToast(e.message || "Error al vincular Discord", 'danger');
            } finally {
                btn.innerText = original;
                btn.disabled = false;
            }
        }

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('verified') === 'true') {
            showToast("¡Cuenta verificada exitosamente!", 'success');
            user.is_verified = true;
            localStorage.setItem('nexus_user', JSON.stringify(user));
            updateEmailUI();
            window.history.replaceState({}, document.title, "/panel");
        }

        // 🚀 Deep Linking para vistas específicas (ej: Marketplace)
        const targetView = urlParams.get('view');
        if (targetView && ['marketplace', 'billing', 'settings'].includes(targetView)) {
            setTimeout(() => {
                switchView(targetView);
                if (urlParams.get('adminUpload') === 'true') {
                    setTimeout(openAdminUploadModal, 300);
                }
            }, 100);
            window.history.replaceState({}, document.title, "/panel");
        }

        let currentServerId = null;
        window._selectedServerId = localStorage.getItem('nexus_selected_server_id') || undefined;
        let currentServer = null; // 🚀 Almacena el objeto completo del servidor activo
        let currentFilePath = "server.cfg";
        let currentFolderPath = "/";
        let editorInstance = null;
        let globalServersList = [];
        let serverActionsPending = new Map(); // id -> { action, timestamp }
        let globalSafeHost = "";
        let lastDataHash = "";
        let isBlenderIframeLoaded = false;
        let txTargetUrl = "";
        let txFallbackUrl = "";
        let txLoadTimer = null;

        function isPrivatePanelHost(hostname) {
            return hostname === 'localhost' ||
                hostname === '127.0.0.1' ||
                hostname.startsWith('192.168.') ||
                hostname.startsWith('10.') ||
                /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
        }

        function ensureTrailingSlash(url) {
            if (!url) return "";
            return url.endsWith('/') ? url : `${url}/`;
        }

        function buildTxAdminTargets(server) {
            let publicUrl = server.txadmin_url;
            if (!publicUrl || publicUrl.includes('//s')) {
                publicUrl = `https://tx${server.txadmin_port}.ragenodes.com`;
            }
            publicUrl = ensureTrailingSlash(publicUrl);
            return {
                primary: publicUrl,
                fallback: ""
            };
        }

        function hideTxAdminConnectOverlay() {
            const overlay = document.getElementById('txadmin-connect-overlay');
            if (overlay) overlay.classList.add('hidden');
        }

        function showTxAdminConnectOverlay(message) {
            const overlay = document.getElementById('txadmin-connect-overlay');
            const text = document.getElementById('txadmin-connect-message');
            const fallbackBtn = document.getElementById('txadmin-fallback-btn');
            if (text) text.textContent = message || 'La URL de txAdmin no respondió a tiempo.';
            if (fallbackBtn) fallbackBtn.style.display = txFallbackUrl ? 'inline-flex' : 'none';
            if (overlay) {
                overlay.classList.remove('hidden');
                overlay.classList.remove('opacity-0');
                overlay.classList.remove('pointer-events-none');
            }
        }

        function armTxAdminLoadWatch() {
            clearTimeout(txLoadTimer);
            txLoadTimer = setTimeout(() => {
                showTxAdminConnectOverlay('La URL pública de txAdmin no respondió. Puedes abrirlo fuera del iframe o probar la ruta alternativa.');
            }, 12000);
        }

        function loadTxAdminFrame(url) {
            const iframe = document.getElementById('txadmin-iframe');
            if (!iframe || !url) return;
            hideTxAdminConnectOverlay();
            iframe.onload = () => {
                clearTimeout(txLoadTimer);
                hideTxAdminConnectOverlay();
            };
            iframe.onerror = () => {
                clearTimeout(txLoadTimer);
                showTxAdminConnectOverlay('No se pudo cargar txAdmin desde esta ruta.');
            };
            iframe.src = url;
            armTxAdminLoadWatch();
        }

        function useTxAdminFallback() {
            if (!txFallbackUrl) return openTxAdminPopup();
            const nextUrl = txFallbackUrl;
            txFallbackUrl = txTargetUrl;
            txTargetUrl = nextUrl;
            loadTxAdminFrame(txTargetUrl);
        }
        let globalBackupLimit = 1;

        require.config({ paths: { 'vs': '/vendor/monaco/vs' } });
        require(['vs/editor/editor.main'], function () {
            editorInstance = monaco.editor.create(document.getElementById('monaco-container'), {
                value: '', language: 'ini', theme: 'vs-dark', automaticLayout: true, minimap: { enabled: false },
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                scrollbar: { useShadows: false },
                renderLineHighlight: 'none'
            });
        });

        let lastNotifHash = "";
        async function loadNotifications() {
            try {
                const data = await Nexus.api('/api/notifications');
                const container = document.getElementById('notifications-container');
                if (!data.items || data.items.length === 0) {
                    container.classList.add('hidden');
                    container.innerHTML = '';
                    lastNotifHash = "";
                    return;
                }
                const currentHash = btoa(unescape(encodeURIComponent(JSON.stringify(data.items))));
                if (lastNotifHash === currentHash) return;
                lastNotifHash = currentHash;
                container.classList.remove('hidden');

                container.innerHTML = data.items.map(n => {
                    let bg = n.type === 'danger' ? 'rgba(239, 68, 68, 0.15)' : n.type === 'warning' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(56, 189, 248, 0.15)';
                    let border = n.type === 'danger' ? 'rgba(239, 68, 68, 0.4)' : n.type === 'warning' ? 'rgba(245, 158, 11, 0.4)' : 'rgba(56, 189, 248, 0.4)';
                    let color = n.type === 'danger' ? '#fca5a5' : n.type === 'warning' ? '#fcd34d' : '#7dd3fc';
                    let icon = n.type === 'danger' ? 'fa-triangle-exclamation' : n.type === 'warning' ? 'fa-bolt' : 'fa-circle-info';
                    return `<div class="notif-banner" style="background: ${bg}; border: 1px solid ${border};">
                      <i class="fa-solid ${icon}" style="color: ${color}; font-size: 1.2rem;"></i>
                      <div style="display:flex; align-items:center; gap: 10px;">
                          <strong style="color: ${color}; font-size: 0.95rem;">${n.title}:</strong>
                          <span style="font-size: 0.85rem; color: #e4e4e7;">${n.content}</span>
                      </div>
                  </div>`;
                }).join('');
            } catch (e) { }
        }

        let activeView = 'servers';
        function switchView(viewId, element) {
            if (activeView === viewId && viewId !== 'servers') return; // Evitar recargas innecesarias (excepto en dashboard que puede requerir refresco)

            if (window.innerWidth <= 1024) {
                document.getElementById('sidebar').classList.remove('open');
                document.getElementById('sidebar-overlay').classList.remove('active');
            }

            document.querySelectorAll('.view-fullscreen').forEach(el => {
                if (el.id === 'view-' + viewId) el.classList.remove('hidden');
                else el.classList.add('hidden');
            });

            const gameViews = document.getElementById('game-specific-views');
            if (gameViews) {
                const hasVisibleChild = gameViews.querySelector('.view-fullscreen:not(.hidden)');
                if (!hasVisibleChild) {
                    gameViews.style.display = 'none';
                } else {
                    gameViews.style.display = 'flex';
                    gameViews.style.flexDirection = 'column';
                    gameViews.style.flexGrow = '1';
                    gameViews.style.height = '100%';
                    gameViews.style.width = '100%';
                }
            }

            // Actualizar el estado activo en la barra lateral
            const navElement = element || document.getElementById('nav-' + viewId);
            if (navElement && navElement.classList.contains('nav-item')) {
                document.querySelectorAll('.sidebar .nav-item').forEach(nav => nav.classList.remove('active'));
                navElement.classList.add('active');
            }

            activeView = viewId;
            if (viewId !== 'servers') {
                document.getElementById('btn-deploy').style.display = 'none';
            }

            if (viewId === 'servers') {
                document.getElementById('page-sub').innerText = "Gestiona tu instancia y recursos";
                document.getElementById('view-servers').classList.remove('hidden'); lastDataHash = ""; loadServers();
            } else if (viewId === 'marketplace') {
                document.getElementById('page-sub').innerText = "Adquiere scripts exclusivos protegidos por Vault™";
                document.getElementById('view-marketplace').classList.remove('hidden');
                loadMarketplace();
            } else if (viewId === 'vendor-portal') {
                document.getElementById('page-sub').innerText = "Panel de control para desarrolladores de scripts";
                document.getElementById('view-vendor-portal').classList.remove('hidden');
                loadVendorScripts();
            } else if (viewId === 'my-licenses') {
                document.getElementById('page-sub').innerText = "Tus compras y descargas";
                document.getElementById('view-my-licenses').classList.remove('hidden');
                loadMyLicenses();
            } else if (viewId === 'mc-config') {
                document.getElementById('page-sub').innerText = "Ajustes visuales del servidor";
                loadGameConfig();
            } else if (viewId === 'mc-mods') {
                document.getElementById('page-sub').innerText = "Personaliza tu experiencia con mods y plugins";
                loadGameModsView();
            } else if (viewId === 'editor') {
                document.getElementById('page-sub').innerText = "Navega, sube y edita la configuración";
                document.getElementById('view-editor').classList.remove('hidden'); loadFolder('/');
                setTimeout(() => { if (editorInstance) editorInstance.layout(); }, 150);
            } else if (viewId === 'logs') {
                document.getElementById('page-sub').innerText = "Visualiza el arranque y errores";
                document.getElementById('view-logs').classList.remove('hidden'); startLogStreaming();
            } else if (viewId === 'wpadmin') {
                document.getElementById('page-sub').innerText = "Interfaz Web";
                document.getElementById('view-wpadmin').classList.remove('hidden');
            } else if (viewId === 'txadmin') {
                document.getElementById('page-sub').innerText = "Administración de FiveM";
                document.getElementById('view-txadmin').classList.remove('hidden');
            } else if (viewId === 'database') {
                document.getElementById('page-sub').innerText = "Gestión de tablas MySQL";
                document.getElementById('view-database').classList.remove('hidden');
                const pmaIframe = document.getElementById('pma-iframe');
                if (pmaIframe && (pmaIframe.src === 'about:blank' || !pmaIframe.src)) {
                    pmaIframe.src = '/pma/';
                }
            } else if (viewId === 'backups') {
                document.getElementById('page-sub').innerText = "Puntos de restauración de tu servidor";
                document.getElementById('view-backups').classList.remove('hidden');
                if (currentServerId) loadClientBackups();
            } else if (viewId === 'blender') {
                document.getElementById('page-sub').innerText = "Entorno gráfico para MLOs y Peds";
                if (currentServer && currentServer.blender_status !== 'running') {
                    showToast('Iniciando entorno 3D automáticamente...', 'info');
                    sessionStorage.removeItem('blenderUrl_' + currentServerId);
                    isBlenderIframeLoaded = false;
                    toggleBlender(null, currentServerId, 'start').then(() => {
                        openBlender(currentServerId);
                    });
                } else {
                    const savedBlenderUrl = sessionStorage.getItem('blenderUrl_' + currentServerId);
                    if (currentServerId && !isBlenderIframeLoaded && !savedBlenderUrl) {
                        openBlender(currentServerId);
                    } else if (savedBlenderUrl) {
                        const iframe = document.getElementById('blender-iframe');
                        iframe.style.display = 'block';
                        if (iframe.src !== savedBlenderUrl) iframe.src = savedBlenderUrl;
                        isBlenderIframeLoaded = true;
                        // 🚀 Asegurar que se carguen las credenciales
                        openBlender(currentServerId);
                    }
                }
            } else if (viewId === 'settings') {
                document.getElementById('page-sub').innerText = "Seguridad y Ajustes de Cuenta";
                document.getElementById('view-settings').classList.remove('hidden');

                const userNow = JSON.parse(localStorage.getItem('nexus_user') || '{}');
                document.getElementById('set-username').value = userNow.username || 'Desconocido';

                // 🚀 Actualizar Profile Header
                document.getElementById('profile-display-name').innerText = userNow.username || 'Desconocido';
                document.getElementById('profile-display-plan').innerText = 'Plan ' + (userNow.plan || 'Hobby').charAt(0).toUpperCase() + (userNow.plan || 'Hobby').slice(1);

                if (userNow.created_at) {
                    const date = new Date(userNow.created_at);
                    document.getElementById('profile-display-date').innerText = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
                } else {
                    document.getElementById('profile-display-date').innerText = 'Reciente';
                }

                updateEmailUI();
            } else if (viewId === 'billing') {
                document.getElementById('page-sub').innerText = "Expansiones y Planes";
                document.getElementById('view-billing').classList.remove('hidden');
                loadBillingInfo();
            } else if (viewId === 'rcon') {
                document.getElementById('page-sub').innerText = "Gestión de Jugadores en vivo y Consola RCON";
                document.getElementById('view-rcon').classList.remove('hidden');
                loadRconView();
            } else if (viewId === 'subusers') {
                document.getElementById('page-sub').innerText = "Gestión de Equipo y Sub-usuarios";
                document.getElementById('view-subusers').classList.remove('hidden');
                loadSubusersView();
            }
        }

        async function loadClientBackups() {
            if (!currentServerId) return;
            const tbody = document.getElementById('client-backups-table-body');
            tbody.innerHTML = '<tr><td colspan="3" style="padding: 20px;"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text" style="width: 80%;"></div></td></tr>';

            try {
                const res = await Nexus.api(`/api/servers/${currentServerId}/backups`);
                const items = res.items || [];

                // 🚀 NUEVO: Filtramos para contar SOLO los manuales reales
                const manualItems = items.filter(b => !b.isAuto && !b.filename.includes('_auto_'));
                const manualCount = manualItems.length;

                const badge = document.getElementById('backup-limit-badge');
                if (badge) badge.innerText = `Límite: ${manualCount} / ${globalBackupLimit} Manuales`;

                const btn = document.getElementById('btn-trigger-backup');
                if (btn) {
                    if (manualCount >= globalBackupLimit) {
                        btn.disabled = true;
                        btn.innerHTML = '<i class="fa-solid fa-lock"></i> Límite Alcanzado';
                        btn.className = 'btn-ghost';
                        btn.style.opacity = '0.5';
                        btn.style.cursor = 'not-allowed';
                    } else {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fa-solid fa-play"></i> Iniciar';
                        btn.className = 'btn-success';
                        btn.style.opacity = '1';
                        btn.style.cursor = 'pointer';
                    }
                }

                if (items.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 30px;" class="muted">No hay copias de seguridad generadas.</td></tr>';
                    return;
                }

                // 🚀 NUEVO: Mejoramos la tabla para que muestre una etiqueta visual "Auto" o "Manual"
                tbody.innerHTML = items.map(b => {
                    const isAuto = b.isAuto || b.filename.includes('_auto_');
                    const badgeType = isAuto ? 'badge outline' : 'badge';
                    const badgeColor = isAuto ? 'style="border-color: var(--info); color: var(--info); transform: scale(0.8);"' : 'style="background: rgba(16, 185, 129, 0.1); color: var(--success); transform: scale(0.8);"';
                    const typeLabel = isAuto ? '<i class="fa-solid fa-robot"></i> Auto' : '<i class="fa-solid fa-user"></i> Manual';

                    return `
                  <tr>
                      <td class="mono" style="padding-left: 20px; font-size:0.75rem; color:var(--info); word-break: break-all; display: flex; align-items: center; gap: 8px;">
                          <span ${badgeColor} class="${badgeType}">${typeLabel}</span>
                          ${b.filename}
                      </td>
                      <td><span class="muted"><i class="fa-regular fa-clock" style="margin-right:5px;"></i>${b.date}</span></td>
                      <td style="text-align: right; padding-right: 20px;">
                          <div style="display:flex; gap:6px; justify-content:flex-end;">
                              <button class="btn-tbl green" title="Restaurar Copia" ${rnBind("click", (event, element) => { restoreClientBackup((b.filename)) })}>
                                  <i class="fa-solid fa-clock-rotate-left"></i>
                              </button>
                              <button class="btn-tbl red" title="Eliminar Copia" ${rnBind("click", (event, element) => { deleteClientBackup((b.filename)) })}>
                                  <i class="fa-solid fa-trash"></i>
                              </button>
                          </div>
                      </td>
                  </tr>
              `}).join('');
            } catch (e) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--danger); padding: 30px;">Error cargando copias de seguridad.</td></tr>';
            }
        }

        async function triggerBackup(event) {
            if (!currentServerId) return;
            const customName = document.getElementById('manual-backup-name').value.trim();
            if (!confirm('¿Generar copia de seguridad manual?')) return;

            const btn = event.currentTarget;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> En cola...';
            btn.disabled = true;
            btn.style.pointerEvents = 'none';

            try {
                const response = await Nexus.api(`/api/servers/${currentServerId}/backup`, {
                    method: 'POST',
                    body: JSON.stringify({ customName })
                });

                if (response.jobId) {
                    showToast(`Backup en cola. Posición: ${response.queuePosition || 1}`, 'info');
                    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';
                    const job = await waitForBackupJob(response.jobId, '/api/servers/backup-jobs/');
                    showToast(`✅ Backup generado: ${job.result?.file || 'completado'}`, 'success');
                } else {
                    showToast(`✅ Backup generado exitosamente.`, 'success');
                }

                document.getElementById('manual-backup-name').value = '';
            } catch (e) {
                console.error(e);
                showToast("❌ Error generando el backup: " + (e.message || ''), 'danger');
            } finally {
                btn.innerHTML = originalHTML;
                btn.disabled = false;
                btn.style.pointerEvents = '';
                await loadClientBackups();
            }
        }

        async function waitForBackupJob(jobId, baseUrl) {
            const started = Date.now();
            const timeoutMs = 60 * 60 * 1000;

            while (Date.now() - started < timeoutMs) {
                const job = await Nexus.api(`${baseUrl}${encodeURIComponent(jobId)}`);
                if (job.status === 'completed') return job;
                if (job.status === 'failed') throw new Error(job.error || 'El backup falló.');
                await new Promise(resolve => setTimeout(resolve, 2500));
            }

            throw new Error('El backup sigue en proceso. Revisa la lista en unos minutos.');
        }

        async function restoreClientBackup(filename) {
            if (!confirm(`⚠️ PELIGRO DE PÉRDIDA DE DATOS:\n¿Estás seguro de querer restaurar la copia [${filename}]?\n\nEsto apagará el servidor, borrará TODOS tus archivos actuales y sobreescribirá tu Base de Datos. Esta acción es irreversible.`)) return;

            try {
                showToast('Restaurando sistema. Por favor espera...', 'info');
                await Nexus.api(`/api/servers/${currentServerId}/backups/restore`, {
                    method: 'POST',
                    body: JSON.stringify({ filename })
                });
                showToast('✅ Restauración completada. Servidor reiniciando.', 'success');
                lastDataHash = "";
                loadServers();
            } catch (e) {
                showToast('❌ Error al restaurar la copia.', 'danger');
            }
        }

        async function deleteClientBackup(filename) {
            if (!confirm(`¿Borrar permanentemente la copia de seguridad ${filename}?`)) return;

            try {
                await Nexus.api(`/api/servers/${currentServerId}/backups/${filename}`, { method: 'DELETE' });
                showToast('✅ Copia de seguridad eliminada.', 'success');
                loadClientBackups();
            } catch (e) {
                showToast('❌ Error al eliminar la copia.', 'danger');
            }
        }

        function openTxAdminPopup() {
            let publicTarget = txTargetUrl;
            if (currentServer) {
                publicTarget = currentServer.txadmin_url;
                if (!publicTarget || publicTarget.includes('//s')) {
                    publicTarget = `https://tx${currentServer.txadmin_port}.ragenodes.com`;
                }
                publicTarget = ensureTrailingSlash(publicTarget);
            }
            if (!publicTarget) return showToast("El servidor no está iniciado", "warning");
            txTargetUrl = publicTarget;

            const w = 600; const h = 750;
            const left = (screen.width / 2) - (w / 2);
            const top = (screen.height / 2) - (h / 2);

            const popup = window.open(publicTarget, 'txAdminAuth', `width=${w},height=${h},top=${top},left=${left},toolbar=no,menubar=no,scrollbars=yes`);

            if (!popup) return showToast('El navegador bloqueó la ventana emergente. Por favor, permítela.', 'danger');

            const timer = setInterval(() => {
                if (popup.closed) {
                    clearInterval(timer);
                    hideAuthOverlay();
                }
            }, 1000);
        }

        function hideAuthOverlay() {
            document.getElementById('txadmin-auth-overlay').style.display = 'none';
            if (currentServerId) {
                sessionStorage.setItem('txLinked_' + currentServerId, 'true');
            }
            refreshTxAdmin();
        }

        function refreshTxAdmin() {
            if (txTargetUrl) {
                showToast('Recargando txAdmin...', 'info');
                loadTxAdminFrame(txTargetUrl);
            } else {
                showToast('El servidor debe estar encendido para recargar.', 'warning');
            }
        }

        let isStatsHistoryInFlight = false;
        let isLoadServersInFlight = false;
        let historyChartInstance = null;
        let lastHistoryLoad = 0;
        let currentStatsView = 'live'; // 'live' o 'history'

        async function loadStatsHistory(serverId, serverObj = null) {
            // Ya no bloqueamos por vista, siempre cargamos si estamos en servers

            const now = Date.now();
            if (isStatsHistoryInFlight) return;
            if (historyChartInstance && (!document.body.contains(historyChartInstance.canvas) || historyChartInstance.canvas.id !== 'mainHistoryChart')) {
                historyChartInstance.destroy();
                historyChartInstance = null;
            }
            if (now - lastHistoryLoad < 30000 && historyChartInstance) return;
            lastHistoryLoad = now;
            isStatsHistoryInFlight = true;

            try {
                const data = await Nexus.api(`/api/servers/${serverId}/stats-history`);
                const stats = data.items || [];

                // Ordenar estadísticas de forma cronológica (más antiguo a más reciente)
                stats.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));

                const labels = [];
                const cpuData = [];
                const ramData = [];

                for (let i = 0; i < stats.length; i++) {
                    const s = stats[i];
                    const date = new Date(s.created_at);

                    if (i > 0) {
                        const prevDate = new Date(stats[i-1].created_at);
                        const diffMinutes = (date - prevDate) / (1000 * 60);
                        if (diffMinutes > 15) {
                            labels.push("—");
                            cpuData.push(null);
                            ramData.push(null);
                        }
                    }

                    labels.push(String(date.getDate()).padStart(2,'0') + "/" + String(date.getMonth()+1).padStart(2,'0') + " " + date.getHours() + ":" + String(date.getMinutes()).padStart(2, '0'));
                    cpuData.push(s.cpu);
                    ramData.push(s.ram);
                }

                // Append live data if available
                if (serverObj && serverObj.status === 'running') {
                    const now = new Date();
                    labels.push(String(now.getDate()).padStart(2,'0') + "/" + String(now.getMonth()+1).padStart(2,'0') + " " + now.getHours() + ":" + String(now.getMinutes()).padStart(2, '0'));
                    cpuData.push(serverObj.cpu || 0);
                    ramData.push(serverObj.ram || 0);
                }

                const canvas = document.getElementById('mainHistoryChart');
                if (!canvas) return;
                const ctx = canvas.getContext('2d');

                if (historyChartInstance) {
                    historyChartInstance.data.labels = labels;
                    historyChartInstance.data.datasets[0].data = cpuData;
                    historyChartInstance.data.datasets[1].data = ramData;
                    historyChartInstance.update('none');
                } else {
                    historyChartInstance = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: labels,
                            datasets: [
                                {
                                    label: 'CPU (%)',
                                    data: cpuData,
                                    borderColor: '#38bdf8',
                                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                                    fill: true,
                                    tension: 0.4,
                                    spanGaps: false
                                },
                                {
                                    label: 'RAM (%)',
                                    data: ramData,
                                    borderColor: '#a855f7',
                                    backgroundColor: 'rgba(168, 85, 247, 0.1)',
                                    fill: true,
                                    tension: 0.4,
                                    spanGaps: false
                                }
                            ]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            layout: { padding: { top: 20, bottom: 10, left: 10, right: 20 } },
                            scales: {
                                y: { beginAtZero: true, suggestedMax: 5, grace: '5%', grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#666', font: { size: 10 } } },
                                x: { grid: { display: false }, ticks: { color: '#666', font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }
                            },
                            plugins: {
                                legend: { display: true, position: 'top', labels: { color: 'rgba(255,255,255,0.7)', font: { size: 10 } } },
                                tooltip: {
                                    backgroundColor: 'rgba(18, 18, 20, 0.9)',
                                    titleColor: '#fff',
                                    bodyColor: '#ccc',
                                    borderColor: 'rgba(255,255,255,0.1)',
                                    borderWidth: 1,
                                    displayColors: true,
                                    padding: 10
                                }
                            },
                            interaction: { intersect: false, mode: 'index' }
                        }
                    });
                }
            } catch (e) {
                console.error("Error al cargar historial:", e);
            } finally {
                isStatsHistoryInFlight = false;
            }
        }

        window.isRefreshingStats = false;
        function switchStatsView(btnElement) {
            window.isRefreshingStats = true;
            const icon = document.getElementById('actualizar-icon') || (btnElement && btnElement.querySelector ? btnElement.querySelector('i') : null);
            if (icon) icon.classList.add('fa-spin');
            setTimeout(() => {
                window.isRefreshingStats = false;
                const activeIcon = document.getElementById('actualizar-icon');
                if (activeIcon) activeIcon.classList.remove('fa-spin');
            }, 1000);

            if (currentServerId) {
                lastHistoryLoad = 0;
                loadStatsHistory(currentServerId);
            }
        }

        window.toggleMainChart = function() {
            const chartDiv = document.getElementById('stats-history-view');
            const icon = document.getElementById('toggle-chart-icon');
            const text = document.getElementById('toggle-chart-text');
            const liveView = document.getElementById('stats-live-view');
            if (chartDiv) {
                if (chartDiv.style.display === 'none') {
                    chartDiv.style.display = 'block';
                    if(icon) icon.className = 'fa-solid fa-compress';
                    if(text) text.innerText = 'Colapsar';
                    if(liveView) liveView.classList.remove('expanded-rings');
                } else {
                    chartDiv.style.display = 'none';
                    if(icon) icon.className = 'fa-solid fa-expand';
                    if(text) text.innerText = 'Expandir';
                    if(liveView) liveView.classList.add('expanded-rings');
                }
            }
        };

        async function loadServers() {
            if (blenderActionPending || isLoadServersInFlight) return;
            isLoadServersInFlight = true;

            try {
                const data = await Nexus.api('/api/servers');
                globalServersList = data.items || [];

                // 🧠 Gestión de acciones pendientes (Limpieza por estado o timeout)
                const now = Date.now();
                for (const [id, meta] of serverActionsPending.entries()) {
                    const s = globalServersList.find(srv => srv.id === id);
                    if (s) {
                        let isDone = false;
                        if (meta.action === 'start' && s.status === 'running') isDone = true;
                        if (meta.action === 'stop' && s.status === 'stopped') isDone = true;
                        if (meta.action === 'restart') {
                            // Restart: esperamos al menos 3 seg y que esté running
                            if (now - meta.timestamp > 3500 && s.status === 'running') isDone = true;
                        }

                        // Timeout de seguridad: 30 segundos
                        if (now - meta.timestamp > 30000) isDone = true;

                        if (isDone) {
                            serverActionsPending.delete(id);
                            lastDataHash = ""; // Forzar re-render final para habilitar botones
                        }
                    } else {
                        // Si el servidor no está en la lista y la acción era destruir, hemos terminado
                        if (meta.action === 'delete') {
                            serverActionsPending.delete(id);
                            lastDataHash = "";
                        }
                    }
                }
                globalSafeHost = (data.publicHost && data.publicHost.includes('.')) ? data.publicHost : location.hostname;

                if (globalServersList.length === 0) {
                    const btnDeploy = document.getElementById('btn-deploy');
                    if (btnDeploy) btnDeploy.style.display = 'inline-flex';
                    const topbarPoolText = document.getElementById('topbar-pool-text');
                    if (topbarPoolText) topbarPoolText.innerText = `0/1`;
                    const clientServers = document.getElementById('client-servers');
                    if (clientServers) {
                        clientServers.innerHTML = `<div class="card muted" style="text-align:center; padding:50px; max-width:600px; margin: 50px auto;"><i class="fa-solid fa-server" style="font-size:3.5rem; margin-bottom:20px; color:var(--line)"></i><br><h3 style="color:white; font-size:1.4rem; margin-bottom:10px;">Sin Servidores</h3>Aún no tienes una instancia asignada. Haz clic en "Desplegar" para comenzar.</div>`;
                    }
                    currentServerId = null;
                    if (window._downloadInterval) clearInterval(window._downloadInterval);
                    return;
                }

                let s = globalServersList.find(srv => srv.id === window._selectedServerId);
                if (!s) {
                    s = globalServersList[0];
                    window._selectedServerId = s.id;
                    localStorage.setItem('nexus_selected_server_id', s.id);
                }
                currentServerId = s.id;
                currentServer = s; // 🚀 Actualizar servidor global para todas las vistas

                // Cargar dinámicamente el panel del juego antes de comprobar elementos de la UI
                await loadGamePremiumPanels();

                // 🧠 Lógica quirúrgica para el Sidebar de Blender (Solo FiveM)
                const navBlender = document.getElementById('nav-blender');
                if (navBlender) {
                    const planName = (s.runtime_plan || '').toLowerCase();
                    if (s.template === 'fivem' && planName !== 'hobby') {
                        const liveBadge = document.getElementById('badge-blender-live');
                        const icon = navBlender.querySelector("i");

                        if (s.blender_status === "running") {
                            if (icon.style.color !== "var(--success)") icon.style.color = "var(--success)";
                            if (liveBadge && liveBadge.classList.contains("hidden")) liveBadge.classList.remove("hidden");

                            if (navBlender.dataset.status !== "running") {
                                navBlender.onclick = function () { switchView("blender", navBlender); };
                                navBlender.dataset.status = "running";
                            }
                        } else if (s.blender_status === "stopped") {
                            if (icon.style.color !== "var(--danger)") icon.style.color = "var(--danger)";
                            if (liveBadge && !liveBadge.classList.contains("hidden")) liveBadge.classList.add("hidden");
                        } else {
                            if (icon.style.color !== "") icon.style.color = "";
                            if (liveBadge && !liveBadge.classList.contains("hidden")) liveBadge.classList.add("hidden");

                            if (navBlender.dataset.status !== "stopped") {
                                navBlender.onclick = function () { showToast("El entorno está apagado, inícialo desde el botón en la tarjeta técnica", "warning"); };
                                navBlender.dataset.status = "stopped";
                            }
                        }
                    }
                }

                const isRunning = s.status === 'running';

                // 🧠 Lógica para txAdmin (SOLO para FiveM)
                const wpIframe = document.getElementById('wpadmin-iframe');
                if (s.template === "wordpress") {
                    if (isRunning) {
                        const wpUrl = "https://wp" + s.fivem_port + ".ragenodes.com";
                        if (wpIframe && !wpIframe.src.startsWith(wpUrl)) {
                            wpIframe.src = wpUrl;
                        }
                    } else {
                        if (wpIframe) wpIframe.src = 'about:blank';
                    }
                }
                const txIframe = document.getElementById('txadmin-iframe');
                const txOffline = document.getElementById('txadmin-offline-overlay');
                const txAuthOverlay = document.getElementById('txadmin-auth-overlay');

                if (s.template === 'fivem') {
                    if (isRunning) {
                        const txTargets = buildTxAdminTargets(s);
                        txTargetUrl = txTargets.primary;
                        txFallbackUrl = txTargets.fallback;

                        if (txOffline) txOffline.style.display = 'none';
                        if (!sessionStorage.getItem('txLinked_' + s.id)) {
                            if (txAuthOverlay) {
                                txAuthOverlay.style.display = 'flex';
                                const btn = document.getElementById('tx-btn-vincular');
                                if (!window.txRouteVerified) window.txRouteVerified = {};
                                if (!window.txPingActive) window.txPingActive = {};

                                if (!window.txRouteVerified[s.id]) {
                                    if (btn) {
                                        btn.style.opacity = '0.5';
                                        btn.style.pointerEvents = 'none';
                                        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Conectando Túnel...';
                                    }
                                    if (!window.txPingActive[s.id]) {
                                        window.txPingActive[s.id] = true;
                                        const pingTunnel = () => {
                                            if(window.txRouteVerified[s.id]) return;
                                            const img = new Image();
                                            img.onload = () => {
                                                window.txRouteVerified[s.id] = true;
                                                window.txPingActive[s.id] = false;
                                                if (currentServerId === s.id && btn) {
                                                    btn.style.opacity = '1';
                                                    btn.style.pointerEvents = 'auto';
                                                    btn.innerHTML = '<i class="fa-solid fa-key"></i> Vincular PIN (Popup)';
                                                }
                                            };
                                            img.onerror = () => {
                                                if(!window.txRouteVerified[s.id]) setTimeout(pingTunnel, 3000);
                                            };
                                            img.src = txTargetUrl.replace(/\/$/, '') + '/favicon_default.svg?_t=' + Date.now();
                                        };
                                        pingTunnel();
                                    }
                                } else {
                                    if (btn) {
                                        btn.style.opacity = '1';
                                        btn.style.pointerEvents = 'auto';
                                        btn.innerHTML = '<i class="fa-solid fa-key"></i> Vincular PIN (Popup)';
                                    }
                                }
                            }
                        } else {
                            if (txAuthOverlay) txAuthOverlay.style.display = 'none';
                        }

                        const currentIframeSrc = txIframe ? txIframe.src.replace(/\/$/, '') : "";
                        const newTargetUrl = txTargetUrl.replace(/\/$/, '');

                        if (txIframe && currentIframeSrc !== newTargetUrl) {
                            loadTxAdminFrame(txTargetUrl);
                        }
                    } else {
                        if (txOffline) txOffline.style.display = 'flex';
                        if (txAuthOverlay) txAuthOverlay.style.display = 'none';
                        txTargetUrl = "";
                        txFallbackUrl = "";
                        hideTxAdminConnectOverlay();
                        if (txIframe && txIframe.src !== 'about:blank' && txIframe.src !== window.location.href) {
                            txIframe.src = 'about:blank';
                        }
                    }
                } else {
                    // Limpiar para otros juegos
                    if (txOffline) txOffline.style.display = 'none';
                    if (txAuthOverlay) txAuthOverlay.style.display = 'none';
                    txFallbackUrl = "";
                    hideTxAdminConnectOverlay();
                    if (txIframe) txIframe.src = 'about:blank';
                }

                const safeId = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
                safeId('db-tab-user', s.db_user); safeId('db-tab-pass', s.db_pass);
                safeId('tx-top-db', s.db_name); safeId('tx-top-user', s.db_user); safeId('tx-top-pass', s.db_pass);

                const safeDisplay = (id, val) => { const el = document.getElementById(id); if (el && el.style.display !== val) el.style.display = val; };
                const isMC = s.template === 'minecraft';
                const isRust = s.template === 'rust';
                const isPalworld = s.template === 'palworld';
                const isCS2 = s.template === 'cs2';
                const isValheim = s.template === 'valheim';
                const isZomboid = s.template === 'zomboid';
                const isARK = s.template === 'ark';
                const isSDTD = s.template === 'sdtd';
                const isWordPress = s.template === 'wordpress';
                const isDatabase = s.template === 'database';
                const isDiscordBot = s.template === 'discord';
                const isNonFivem = isMC || isRust || isPalworld || isCS2 || isValheim || isZomboid || isARK || isSDTD || isWordPress || isDatabase || isDiscordBot;

                safeDisplay('nav-editor', 'flex');
                safeDisplay('nav-logs', 'flex');
                safeDisplay('nav-mc-config', (isNonFivem && !isWordPress && !isDatabase && !isDiscordBot) ? 'flex' : 'none'); // Todos los juegos no-FiveM usan config visual
                const hasMods = isMC || isRust || isZomboid || isARK || isValheim || isPalworld || isSDTD;
                safeDisplay('nav-mc-mods', hasMods ? 'flex' : 'none'); // Juegos con soporte de Mods/Plugins
                const isVendor = user.role === 'vendor' || user.role === 'admin';
                safeDisplay('nav-fivem-admin', isNonFivem ? 'none' : 'flex');
                safeDisplay('nav-database', (isNonFivem && !isARK && !isDatabase) ? 'none' : 'flex');
                safeDisplay('nav-vendor-portal', (isNonFivem || !isVendor) ? 'none' : 'flex');
                safeDisplay('nav-marketplace', isNonFivem ? 'none' : 'flex');
                safeDisplay('nav-backups', 'flex');
                safeDisplay('nav-rcon', (isNonFivem && !isMC && !isWordPress && !isDatabase && !isDiscordBot) ? 'flex' : 'none');
                safeDisplay('nav-schedules', 'flex');
                safeDisplay('nav-subusers', 'flex');

                const isFivem = (s.template === 'fivem');
                safeDisplay('nav-txadmin', isFivem ? 'flex' : 'none');
                safeDisplay('nav-wpadmin', isWordPress ? 'flex' : 'none');
                safeDisplay('label-multimedia', isFivem ? 'flex' : 'none');
                safeDisplay('group-multimedia', isFivem ? 'block' : 'none');

                // Blender logic
                const blenderPlanCheck = (s.runtime_plan || '').toLowerCase();
                const canUseBlender = (isFivem && blenderPlanCheck !== 'hobby');
                safeDisplay('nav-blender', canUseBlender ? 'flex' : 'none');

                // ⚡ OPTIMIZACIÓN CRÍTICA: No actualizar el DOM pesado del dashboard si no estamos en él
                if (document.getElementById('view-servers').classList.contains('hidden')) {
                    return;
                }

                const container = document.getElementById('client-servers');
                const isSameServer = container.dataset.renderedId === s.id;

                if (!historyChartInstance || (Date.now() - lastHistoryLoad) >= 30000) {
                    loadStatsHistory(s.id, s);
                }

                if (document.getElementById('auto-restart-enabled')) {
                    document.getElementById('auto-restart-enabled').checked = !!s.auto_restart_enabled;
                    document.getElementById('auto-restart-time').value = s.auto_restart_time || '06:00';
                    document.getElementById('backup-before-restart').checked = !!s.backup_before_restart;
                }

                // 🎮 Adaptación de la Barra Lateral
                const inputBar = document.getElementById('console-input-bar');
                const termTitle = document.getElementById('terminal-title');
                const navMarket = document.getElementById('nav-marketplace');
                const navLicenses = document.getElementById('nav-my-licenses');

                if (inputBar) inputBar.style.display = isNonFivem ? 'flex' : 'none';

                let gameLabel = 'bash';
                if (isMC) gameLabel = 'minecraft';
                if (isRust) gameLabel = 'rust';
                if (isPalworld) gameLabel = 'palworld';
                if (isCS2) gameLabel = 'cs2';
                if (isValheim) gameLabel = 'valheim';
                if (isZomboid) gameLabel = 'zomboid';
                if (isARK) gameLabel = 'ark';
                if (isSDTD) gameLabel = '7dtd';
                if (isWordPress) gameLabel = 'wordpress';
                if (isDatabase) gameLabel = 'database';
                if (isDiscordBot) gameLabel = 'discord';

                if (termTitle) termTitle.textContent = isNonFivem ? `${gameLabel} ● ${s.name}` : `bash - /opt/fivem/run.sh`;

                // El marketplace y licencias ya se manejan arriba con safeDisplay para mayor consistencia

                if (navLicenses) navLicenses.style.display = isNonFivem ? 'none' : 'flex';

                const isUnlimited = !s.expires_at || new Date(s.expires_at).getFullYear() <= 1970;
                const expDate = isUnlimited ? null : new Date(s.expires_at);
                const isExpired = !isUnlimited && expDate < new Date();

                const planName = (s.runtime_plan || '').toLowerCase();
                let maxRam = 4; let maxDisk = 20; let maxCores = 2;
                let backupMax = 1; let backupFreq = 'Ninguna'; let backupRet = '0 días'; let autoEnabled = false;

                if (planName === 'standard') {
                    maxRam = 8; maxDisk = 40; maxCores = 4;
                    backupMax = 3; backupFreq = 'Cada 24 Horas'; backupRet = '3 copias'; autoEnabled = true;
                } else if (planName === 'elite' || planName === 'premium') {
                    maxRam = 16; maxDisk = 80; maxCores = 6;
                    backupMax = 5; backupFreq = 'Cada 12 Horas'; backupRet = '7 días'; autoEnabled = true;
                } else if (planName === 'platinum' || planName === 'plan_platinum' || planName === 'partner') {
                    maxRam = 32; maxDisk = 250; maxCores = 8;
                    backupMax = 10; backupFreq = 'Cada 6 Horas'; backupRet = '14 días'; autoEnabled = true;
                }

                maxDisk += Number(s.extra_disk_gb || 0);

                globalBackupLimit = backupMax;

                const timeInput = document.getElementById('backup-time-pref');
                const timeBtn = document.getElementById('backup-time-btn');
                if (timeInput && timeBtn) {
                    timeInput.disabled = !autoEnabled;
                    timeBtn.disabled = !autoEnabled;
                    timeInput.value = s.backup_time || '04:00';
                    timeBtn.onclick = () => saveBackupTime(s.id, timeInput.value);
                }

                safeId('backup-auto-freq', backupFreq);
                safeId('backup-auto-ret', backupRet);

                const autoStatus = document.getElementById('backup-auto-status');
                const upMsg = document.getElementById('backup-upgrade-msg');
                if (autoEnabled) {
                    autoStatus.className = 'badge running'; autoStatus.innerText = 'ACTIVADO';
                    upMsg.classList.add('hidden');
                } else {
                    autoStatus.className = 'badge stopped'; autoStatus.innerText = 'INACTIVO';
                    upMsg.classList.remove('hidden');
                }

                window.lastNetworkStats = window.lastNetworkStats || {};
                const currentTime = Date.now();
                let netSpeedMb = "0.00";
                let netSpeedUnit = "Mbps";
                let netSpeedValForDash = 0; // For tachometer path calculation
                let netTxLabel = "0 B";
                let netRxLabel = "0 B";
                let pingMs = 0;
                if (isRunning) {
                    pingMs = Math.floor(Math.random() * (28 - 12 + 1) + 12);
                }

                if (s.stats?.net_rx && s.stats?.net_tx && isRunning) {
                    const currentRx = parseFloat(s.stats.net_rx) || 0;
                    const currentTx = parseFloat(s.stats.net_tx) || 0;
                    const lastStats = window.lastNetworkStats[s.id];

                    if (lastStats && (currentTime - lastStats.timestamp) > 0) {
                        const elapsedSecs = (currentTime - lastStats.timestamp) / 1000;
                        const rxDiff = currentRx - lastStats.rx;
                        const txDiff = currentTx - lastStats.tx;

                        const rxBps = (rxDiff >= 0 ? rxDiff : 0) * 8 / elapsedSecs;
                        const txBps = (txDiff >= 0 ? txDiff : 0) * 8 / elapsedSecs;

                        let totalBps = (rxBps + txBps);

                        // Add tiny idle background traffic if server is running but there's no real traffic
                        if (totalBps === 0 && isRunning) {
                            totalBps = Math.random() * 5000 + 1000; // 1 to 6 Kbps idle noise
                        }

                        if (totalBps < 1000000) {
                            netSpeedMb = (totalBps / 1000).toFixed(1);
                            netSpeedUnit = "Kbps";
                            netSpeedValForDash = (totalBps / 1000) / 1000; // Scale down for tachometer
                        } else {
                            netSpeedMb = (totalBps / 1000000).toFixed(2);
                            netSpeedUnit = "Mbps";
                            netSpeedValForDash = totalBps / 1000000;
                        }
                    }

                    window.lastNetworkStats[s.id] = { rx: currentRx, tx: currentTx, timestamp: currentTime };

                    const formatBytes = (bytes) => {
                        if (bytes === 0) return '0 B';
                        const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'], i = Math.floor(Math.log(bytes) / Math.log(k));
                        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
                    };
                    netRxLabel = formatBytes(currentRx);
                    netTxLabel = formatBytes(currentTx);
                }

                let rawCpu = parseFloat(s.stats?.cpu || 0);
                let calcCpuPct = rawCpu / maxCores;
                const cpuPct = calcCpuPct > 100 ? 100 : calcCpuPct.toFixed(1);

                const ramUsedVal = parseFloat(s.stats?.ramGb || 0);
                const diskUsedVal = parseFloat(s.stats?.diskGb || 0);

                let calcRamPct = (ramUsedVal / maxRam) * 100;
                let calcDiskPct = (diskUsedVal / maxDisk) * 100;

                const ramPct = calcRamPct > 100 ? 100 : calcRamPct.toFixed(1);
                const diskPct = calcDiskPct > 100 ? 100 : calcDiskPct.toFixed(1);

                const ramText = `${maxRam} GB`;
                const diskText = `${maxDisk} GB`;
                const cpuText = `${maxCores} vCPU`;

                const hasCustomIcon = s.template === 'fivem' && Boolean(s.db_name) && Boolean(s.has_icon);
                const iconUrl = hasCustomIcon ? `/data/${s.id}/txData/${s.db_name}.base/icon.png` : '';
                let sIconClass = 'fa-solid fa-car';
                if (s.template === 'minecraft') sIconClass = 'fa-solid fa-cube';
                else if (s.template === 'rust') sIconClass = 'fa-solid fa-radiation';
                else if (s.template === 'cs2') sIconClass = 'fa-solid fa-crosshairs';
                else if (s.template === 'ark') sIconClass = 'fa-solid fa-dragon';
                else if (s.template === 'palworld') sIconClass = 'fa-solid fa-paw';
                else if (s.template === 'valheim') sIconClass = 'fa-solid fa-helmet-safety';
                else if (s.template === 'zomboid') sIconClass = 'fa-solid fa-skull';
                else if (s.template === 'sdtd') sIconClass = 'fa-solid fa-biohazard';
                else if (s.template === 'discordbot') sIconClass = 'fa-brands fa-discord';
                else if (s.template === 'wordpress') sIconClass = 'fa-brands fa-wordpress';
                else if (s.template === 'database') sIconClass = 'fa-solid fa-database';
                const fallbackIcon = `
              <div class="fallback-static-bg" style="position:absolute; inset:0; border-radius:12px; background: radial-gradient(circle at center, rgba(56, 189, 248, 0.2) 0%, #121214 70%); z-index:1;"></div>
              <!-- Anillo exterior giratorio tech -->
              <svg class="fallback-rotating-ring" viewBox="0 0 100 100" style="position:absolute; top:-25%; left:-25%; width:150%; height:150%; z-index:2; filter:drop-shadow(0 0 8px var(--info));">
                  <defs>
                      <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stop-color="var(--info)" stop-opacity="1"></stop>
                          <stop offset="50%" stop-color="var(--primary)" stop-opacity="0.5"></stop>
                          <stop offset="100%" stop-color="var(--info)" stop-opacity="0"></stop>
                      </linearGradient>
                  </defs>
                  <circle cx="50" cy="50" r="42" fill="none" stroke="url(#ringGrad)" stroke-width="3" stroke-dasharray="30 15 10 15 40 20" stroke-linecap="round"></circle>
                  <circle cx="50" cy="50" r="36" fill="none" stroke="var(--primary)" stroke-width="1.5" stroke-dasharray="10 30 20 30" stroke-opacity="0.4"></circle>
              </svg>
              <!-- Icono central estático con brillo -->
              <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:1.8rem; color:var(--info); z-index:3; text-shadow:0 0 15px rgba(56, 189, 248, 0.6);">
                  <i class="${sIconClass}"></i>
              </div>
          `;

                const pending = serverActionsPending.get(s.id);
                let controlButtons = "";
                if (pending) {
                    controlButtons = `<button class="btn-control" disabled style="opacity:0.7; cursor:wait; background: rgba(255,255,255,0.05); color: var(--muted);"><i class="fa-solid fa-spinner fa-spin" style="margin-right:8px;"></i> Procesando...</button>`;
                } else {
                    const verifyBtn = s.game === 'ark' ? `<button class="btn-control" style="background: rgba(139, 92, 246, 0.15); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.3);" title="Forzar Verificación de Archivos (Útil si SteamCMD se atasca)" ${rnBind("click", (event, element) => { verifyArkVersion((s.id), element) })}><i class="fa-solid fa-hammer"></i> Validar Versión</button>` : '';
                    controlButtons = isRunning
                        ? `<button class="btn-control restart" title="Reiniciar servidor" ${pending ? 'disabled' : ''} ${rnBind("click", (event, element) => { srvAction((s.id), 'restart') })}>
                                   ${pending && pending.action === 'restart'
                            ? '<i class="fa-solid fa-spinner fa-spin"></i> Reiniciando'
                            : '<i class="fa-solid fa-rotate-right"></i> Reiniciar'}
                               </button>
                               <button class="btn-control stop" title="Apagar servidor" ${pending ? 'disabled' : ''} ${rnBind("click", (event, element) => { srvAction((s.id), 'stop') })}>
                                   ${pending && pending.action === 'stop'
                            ? '<i class="fa-solid fa-spinner fa-spin"></i> Apagando'
                            : '<i class="fa-solid fa-power-off"></i> Apagar'}
                               </button> ${verifyBtn}`
                        : `<button class="btn-control start" title="Iniciar servidor" ${pending ? 'disabled' : ''} ${rnBind("click", (event, element) => { srvAction((s.id), 'start') })}>
                                   ${pending && pending.action === 'start'
                            ? '<i class="fa-solid fa-spinner fa-spin"></i> Iniciando'
                            : '<i class="fa-solid fa-play"></i> Iniciar'}
                               </button> ${verifyBtn}`;
                }


                const existingLiveView = container.querySelector('#stats-live-view') !== null;
                const hasMatchingView = (isRunning === existingLiveView);

                // 🚀 FASE 3: CÁLCULOS Y RENDERIZADO DE LA BOLSA DE RECURSOS GLOBAL
                let totalAllocatedRamGb = 0;
                for (const srv of globalServersList) {
                    totalAllocatedRamGb += (srv.allocated_ram_gb > 0) ? srv.allocated_ram_gb : Math.round(maxRam);
                }
                const planLimitMap = {
                    hobby: { ram: 4, disk: 30, slots: 1 },
                    standard: { ram: 8, disk: 80, slots: 1 },
                    premium: { ram: 16, disk: 150, slots: 2 },
                    platinum: { ram: 32, disk: 300, slots: 4 },
                    partner: { ram: 32, disk: 300, slots: 10 }
                };
                const pLimits = planLimitMap[planName] || planLimitMap.hobby;
                const maxSlots = pLimits.slots;
                const maxPlanRam = pLimits.ram;

                const topbarPoolText = document.getElementById('topbar-pool-text');
                if (topbarPoolText) {
                    topbarPoolText.innerText = `${globalServersList.length}/${maxSlots}`;
                }
                const topbarPoolCount = document.getElementById('topbar-pool-count');
                if (topbarPoolCount) {
                    topbarPoolCount.setAttribute('title', `Has creado ${globalServersList.length} servidores de los ${maxSlots} que permite tu plan actual.`);
                }

                const modalKpis = document.getElementById('modal-pool-kpis');
                if (modalKpis) {
                    modalKpis.innerHTML = `
                  <div class="compact-stat" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center;">
                      <div style="font-size: 0.70rem; color: var(--muted); text-transform: uppercase; margin-bottom: 8px; font-weight:800; letter-spacing: 0.5px;">Instancias (Slots)</div>
                      <div style="font-size: 1.8rem; font-weight: 900; color: ${globalServersList.length >= maxSlots ? '#ef4444' : '#38bdf8'}; text-shadow: 0 0 15px ${globalServersList.length >= maxSlots ? 'rgba(239,68,68,0.4)' : 'rgba(56,189,248,0.4)'};">${globalServersList.length} / ${maxSlots}</div>
                  </div>
                  <div class="compact-stat" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center;">
                      <div style="font-size: 0.70rem; color: var(--muted); text-transform: uppercase; margin-bottom: 8px; font-weight:800; letter-spacing: 0.5px;">Cuota de RAM</div>
                      <div style="font-size: 1.8rem; font-weight: 900; color: ${totalAllocatedRamGb >= maxPlanRam ? '#ef4444' : '#34d399'}; text-shadow: 0 0 15px ${totalAllocatedRamGb >= maxPlanRam ? 'rgba(239,68,68,0.4)' : 'rgba(52,211,153,0.4)'};">${totalAllocatedRamGb} / ${maxPlanRam} <span style="font-size:1rem; opacity:0.8;">GB</span></div>
                  </div>
                  <div class="compact-stat" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center;">
                      <div style="font-size: 0.70rem; color: var(--muted); text-transform: uppercase; margin-bottom: 8px; font-weight:800; letter-spacing: 0.5px;">Disco NVMe</div>
                      <div style="font-size: 1.8rem; font-weight: 900; color: #a855f7; text-shadow: 0 0 15px rgba(168,85,247,0.4);">${pLimits.disk} <span style="font-size:1rem; opacity:0.8;">GB</span></div>
                  </div>
              `;
                }
                const modalServerList = document.getElementById('modal-pool-server-list');
                if (modalServerList) {
                    modalServerList.innerHTML = globalServersList.map(srv => {
                        const isSelected = srv.id === currentServerId;
                        let sIcon = 'fa-solid fa-car';
                        if (srv.template === 'minecraft') sIcon = 'fa-solid fa-cube';
                        else if (srv.template === 'rust') sIcon = 'fa-solid fa-radiation';
                        else if (srv.template === 'cs2') sIcon = 'fa-solid fa-crosshairs';
                        else if (srv.template === 'ark') sIcon = 'fa-solid fa-dragon';
                        else if (srv.template === 'palworld') sIcon = 'fa-solid fa-paw';
                        else if (srv.template === 'valheim') sIcon = 'fa-solid fa-helmet-safety';
                        else if (srv.template === 'zomboid') sIcon = 'fa-solid fa-skull';
                        else if (srv.template === 'sdtd') sIcon = 'fa-solid fa-biohazard';
                        else if (srv.template === 'discordbot') sIcon = 'fa-brands fa-discord';
                        else if (srv.template === 'wordpress') sIcon = 'fa-brands fa-wordpress';
                        else if (srv.template === 'database') sIcon = 'fa-solid fa-database';
                        const sColor = srv.status === 'running' ? '#34d399' : '#94a3b8';
                        let sImage = '/assets/bg_fivem.webp';
                        if (srv.template === 'minecraft') sImage = '/assets/games/minecraft.webp';
                        else if (srv.template === 'rust') sImage = '/assets/games/steam_252490_header.webp';
                        else if (srv.template === 'cs2') sImage = '/assets/games/steam_730_header.webp';
                        else if (srv.template === 'ark') sImage = '/assets/games/steam_2399830_header.webp';
                        else if (srv.template === 'palworld') sImage = '/assets/games/steam_1623730_header.webp';
                        else if (srv.template === 'valheim') sImage = '/assets/games/steam_892970_header.webp';
                        else if (srv.template === 'zomboid') sImage = '/assets/games/steam_108600_header.webp';
                        else if (srv.template === 'sdtd') sImage = '/assets/games/steam_251570_header.webp';
                        else if (srv.template === 'discordbot') sImage = '/assets/discord_bot_bg.webp';
                        else if (srv.template === 'wordpress') sImage = '/assets/web_hosting_bg.webp';
                        else if (srv.template === 'database') sImage = '/assets/bg_premium.webp';

                        return `
                      <div class="card" ${rnBind("click", (event, element) => { selectServerFromPool((srv.id)) })} style="
                          position: relative; overflow: hidden;
                          padding: 25px 20px; background: #0a0a0a;
                          border: 1px solid ${isSelected ? 'rgba(56, 189, 248, 0.6)' : 'rgba(255,255,255,0.05)'}; border-radius: 12px;
                          cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; transition: all 0.3s ease; box-shadow: ${isSelected ? '0 0 20px rgba(56,189,248,0.15)' : '0 4px 15px rgba(0,0,0,0.3)'}; margin-bottom: 0; text-align: center;
                      ">
                          <div style="position: absolute; inset: 0; background: url('${sImage}') center/cover no-repeat; opacity: ${isSelected ? '0.7' : '0.3'}; filter: saturate(${isSelected ? '1.3' : '0.5'}); transition: all 0.3s ease; pointer-events: none;"></div>
                          <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(10,10,10,0.85) 0%, rgba(10,10,10,0.2) 100%); pointer-events: none;"></div>

                          <div style="position: relative; z-index: 1; width: 44px; height: 44px; border-radius: 10px; background: ${isSelected ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.05)'}; display: flex; align-items: center; justify-content: center; box-shadow: ${isSelected ? '0 0 15px rgba(56,189,248,0.5)' : 'none'};">
                              <i class="${sIcon}" style="color: ${isSelected ? '#38bdf8' : sColor}; font-size: 1.3rem;"></i>
                          </div>

                          <div style="position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                              <div style="font-weight: 900; font-size: 1.05rem; color: ${isSelected ? '#38bdf8' : 'white'}; display: flex; align-items: center; justify-content: center; gap: 8px; text-shadow: 0 0 12px rgba(0,0,0,1);">
                                  ${srv.name}
                                  <span class="live-dot" style="margin-top:2px; ${srv.status !== 'running' ? 'background:var(--muted); animation:none; box-shadow:none;' : ''}"></span>
                              </div>
                              <div style="font-size: 0.65rem; color: rgba(255,255,255,0.8); text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px; text-shadow: 0 0 10px rgba(0,0,0,1);">${srv.template} • ${srv.allocated_ram_gb > 0 ? srv.allocated_ram_gb : maxPlanRam} GB RAM</div>
                          </div>
                          ${isSelected ? `<i class="fa-solid fa-chevron-down" style="position: relative; z-index: 1; color: #38bdf8; opacity: 0.9; font-size: 0.8rem; margin-top: 5px;"></i>` : ''}
                      </div>
                  `;
                    }).join('');
                }
                const modalPlanName = document.getElementById('modal-pool-plan-name');
                if (modalPlanName) {
                    modalPlanName.innerText = s.runtime_plan.toUpperCase();
                    const modalPlanBadge = document.getElementById('modal-pool-plan-badge');
                    if (modalPlanBadge) {
                        const planLower = String(s.runtime_plan).toLowerCase();
                        modalPlanBadge.classList.remove('badge-platinum');
                        modalPlanBadge.style.background = '';
                        modalPlanBadge.style.color = '';
                        modalPlanBadge.style.border = '';
                        modalPlanBadge.style.textShadow = '';

                        if (planLower.includes('hobby')) {
                            modalPlanBadge.style.background = 'rgba(148, 163, 184, 0.12)';
                            modalPlanBadge.style.color = '#94a3b8';
                            modalPlanBadge.style.border = '1px solid rgba(148, 163, 184, 0.3)';
                        } else if (planLower.includes('standard')) {
                            modalPlanBadge.style.background = 'rgba(99, 102, 241, 0.15)';
                            modalPlanBadge.style.color = '#a5b4fc';
                            modalPlanBadge.style.border = '1px solid rgba(99, 102, 241, 0.4)';
                        } else if (planLower.includes('premium')) {
                            modalPlanBadge.style.background = 'rgba(234, 179, 8, 0.15)';
                            modalPlanBadge.style.color = '#fbbf24';
                            modalPlanBadge.style.border = '1px solid rgba(234, 179, 8, 0.6)';
                            modalPlanBadge.style.textShadow = '0 0 8px rgba(251, 191, 36, 0.5)';
                        } else if (planLower.includes('platinum')) {
                            modalPlanBadge.classList.add('badge-platinum');
                        }
                    }
                }

                const globalPoolHtml = "";

                if (isSameServer && hasMatchingView) {
                    const gContainer = document.getElementById('global-pool-container');
                    if (gContainer) gContainer.outerHTML = globalPoolHtml;
                    // ACTUALIZACIÓN QUIRÚRGICA: Solo valores
                    const header = container.querySelector('.server-header');
                    if (header) {
                        header.className = `server-header ${isRunning ? 'running' : 'stopped'}`;
                        const badge = header.querySelector('.badge');
                        if (badge) {
                            badge.className = `badge ${s.status}`;
                            badge.innerText = isRunning ? 'EN LÍNEA' : (s.status === 'stopped' ? 'APAGADO' : s.status.toUpperCase());
                        }
                        const controls = header.querySelector('div[style*="z-index: 1"]:last-child');
                        if (controls) controls.innerHTML = controlButtons;
                    }

                    if (isRunning) {
                        // Actualizar Barras
                        const liveView = container.querySelector('#stats-live-view');
                        const updateRing = (type, pct, abs) => {
                            if (!liveView) return;
                            const barFill = liveView.querySelector(`.bar-${type}-fill`);
                            const textPct = liveView.querySelector(`.bar-${type}-pct`);
                            const textAbs = liveView.querySelector(`.bar-${type}-abs`);

                            if (textPct) textPct.textContent = `${pct}%`;
                            if (textAbs) textAbs.textContent = abs;

                            const val = parseFloat(pct);
                            if (barFill) barFill.style.width = val > 0 ? `${Math.max(1, val)}%` : '0%';

                            if (barFill) {
                                if (val >= 90) barFill.style.backgroundColor = 'var(--danger)';
                                else if (val >= 70) barFill.style.backgroundColor = 'var(--warning)';
                                else barFill.style.backgroundColor = type === 'cpu' ? 'var(--primary)' : (type === 'ram' ? 'var(--info)' : 'var(--success)');
                            }
                        };

                        updateRing('cpu', cpuPct, `${cpuPct}% de ${maxCores} vCPUs`);
                        updateRing('ram', ramPct, `${ramUsedVal.toFixed(2)} GB / ${maxRam} GB`);
                        updateRing('disk', diskPct, `${diskUsedVal.toFixed(2)} GB / ${maxDisk} GB`);

                        // 🚀 Actualizar Tacómetros Discretos
                        const tachoContainer = document.getElementById('global-tachometers');
                        if (tachoContainer) {
                            tachoContainer.style.display = 'flex';
                        }

                        const pingVal = document.getElementById('tacho-ping-val');
                        if (pingVal) {
                            pingVal.innerHTML = `${pingMs}<span style="font-size: 0.65rem; color: var(--muted); margin-left: 2px;">ms</span>`;
                        }

                        const netVal = document.getElementById('tacho-net-val');
                        if (netVal) {
                            netVal.innerHTML = `${netSpeedMb}<span style="font-size: 0.65rem; color: var(--muted); margin-left: 2px;">${netSpeedUnit}</span>`;
                        }
                        // Auto-cargar historial periódicamente
                        if (Date.now() - lastHistoryLoad > 60000) {
                            loadStatsHistory(s.id);
                        }
                    } else {
                        const tachoContainer = document.getElementById('global-tachometers');
                        if (tachoContainer) {
                            tachoContainer.style.display = 'none';
                        }
                    }

                    // Actualizar Info Técnica
                    const infoList = container.querySelector('.info-list');
                    if (infoList) {
                        const items = infoList.querySelectorAll('li .mono, li span:last-child');
                        if (items[1]) items[1].innerText = s.container_name;
                        if (items[2]) items[2].innerText = s.db_name;

                        // 🚀 Actualizar Estado de Blender quirúrgicamente
                        const blenderStatus = container.querySelector('#blender-status-text');
                        if (blenderStatus) {
                            blenderStatus.style.color = s.blender_status === 'running' ? 'var(--success)' : 'var(--muted)';
                            blenderStatus.innerHTML = s.blender_status === 'running'
                                ? '<i class="fa-solid fa-circle-check"></i> En Línea'
                                : `<button class="btn-success" style="padding:2px 8px; font-size:0.65rem;" ${rnBind("click", (event, element) => { toggleBlender(event, (s.id), 'start') })}><i class="fa-solid fa-power-off"></i> Iniciar</button>`;
                        }

                        // 🚀 Actualizar Pago y Caducidad quirúrgicamente
                        const paymentStatus = container.querySelector('.payment-status-text');
                        const expiryDate = container.querySelector('.expiry-date-text');
                        const isUnlimitedSurgical = !s.expires_at || new Date(s.expires_at).getFullYear() <= 1970;
                        const isExpiredSurgical = !isUnlimitedSurgical && new Date(s.expires_at) < new Date();

                        if (paymentStatus) {
                            paymentStatus.style.color = isExpiredSurgical ? 'var(--danger)' : 'var(--success)';
                            paymentStatus.innerText = isExpiredSurgical ? 'Vencido' : 'Al Día';
                        }
                        if (expiryDate) {
                            expiryDate.style.color = isExpiredSurgical ? 'var(--danger)' : 'white';
                            expiryDate.innerText = isUnlimitedSurgical ? 'Sin vencimiento' : new Date(s.expires_at).toLocaleDateString();
                        }
                    }
                    return; // Fin de actualización quirúrgica
                }

                let planBadgeStyle = 'color:white; border-color:var(--primary);';
                let planBadgeClass = '';
                const planLower = String(s.runtime_plan).toLowerCase();
                if (planLower.includes('hobby')) {
                    planBadgeStyle = 'background: rgba(148, 163, 184, 0.12); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.3); font-weight: 700;';
                } else if (planLower.includes('standard')) {
                    planBadgeStyle = 'background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); text-shadow: 0 0 5px rgba(52, 211, 153, 0.3); font-weight: 700;';
                } else if (planLower.includes('premium')) {
                    planBadgeStyle = 'background: rgba(234, 179, 8, 0.15); color: #fbbf24; border: 1px solid rgba(234, 179, 8, 0.6); text-shadow: 0 0 8px rgba(251, 191, 36, 0.5); font-weight: 800;';
                } else if (planLower.includes('platinum')) {
                    planBadgeStyle = '';
                    planBadgeClass = 'badge-platinum';
                }

                const newHtml = `
            ${globalPoolHtml}
            <div style="display: flex; flex-direction: column; min-height: 100%;" data-ui-version="3d-v2">
                <div class="server-header ${isRunning ? 'running' : 'stopped'}">
                    <div style="display: flex; align-items: center; z-index: 1;">
                        <div class="server-icon">
                            ${hasCustomIcon ? `
                                <img src="${iconUrl}" class="static-bg" ${rnBind("error", (event, element) => { element.onerror=null; element.style.display='none'; if (element.nextElementSibling) element.nextElementSibling.style.display='none'; const fb = element.parentElement.querySelector('.fallback-icon'); if (fb) fb.style.display='flex'; })}>
                                <img src="${iconUrl}" class="rotating-core" ${rnBind("error", (event, element) => { element.onerror=null; element.style.display='none'; })}>
                                <div class="fallback-icon" style="display:none; width:100%; height:100%; align-items:center; justify-content:center;">${fallbackIcon}</div>
                            ` : `
                                <div class="fallback-icon" style="display:flex; width:100%; height:100%; align-items:center; justify-content:center;">${fallbackIcon}</div>
                            `}
                            <div class="lightning-container">
                                <svg class="bolt-svg b-1" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                                <svg class="bolt-svg b-2" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                                <svg class="bolt-svg b-3" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                                <svg class="bolt-svg b-4" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                                <svg class="bolt-svg b-5" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                                <svg class="bolt-svg b-6" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                            </div>
                        </div>
                        <div>
                            <h1 style="font-size: 1.6rem; margin-bottom: 6px;">${s.name}</h1>
                            <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
                                <span class="badge ${s.status}">${s.status === 'running' ? 'EN LÍNEA' : (s.status === 'stopped' ? 'APAGADO' : s.status.toUpperCase())}</span>
                                <span class="muted" style="font-size:0.8rem; display: flex; align-items: center;"><i class="fa-solid fa-server" style="margin-right:6px; color:var(--primary); opacity: 0.8;"></i> ${s.node_id === 1 ? 'RageNodes Node 02' : 'Nodo Maestro Titán R1'}</span>
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px; z-index: 1;">${controlButtons}</div>
                </div>

                <div class="dashboard-grid">
                    <div class="col-left">
                        <div id="card-recursos" class="card" style="padding: 15px 20px; display:flex; flex-direction:column; gap: 15px; flex-grow: 1;">
                            <div class="card-header" style="margin-bottom:0; padding-bottom:10px; border-bottom: 1px solid rgba(255,255,255,0.03);">
                                <h3 style="font-size: 1rem;"><i class="fa-solid fa-chart-area" style="color:var(--info);"></i> Monitorización de Recursos</h3>
                                <div style="display:flex; align-items:center; gap:8px; margin-left:auto;">
                                    <button class="btn-ghost" style="padding: 4px 12px; font-size: 0.7rem; border-radius: 30px; border-color: rgba(255,255,255,0.1); background: rgba(255,255,255,0.03);" ${rnBind("click", (event, element) => { toggleMainChart() })} title="Mostrar/Ocultar gráfica">
                                        <i class="fa-solid fa-compress" id="toggle-chart-icon"></i> <span id="toggle-chart-text" style="display: none;">Colapsar</span>
                                    </button>
                                    ${isRunning ? `<div style="display:flex; align-items:center; gap:8px; background:rgba(16, 185, 129, 0.1); padding: 4px 10px; border-radius:12px; border:1px solid rgba(16, 185, 129, 0.2); cursor:pointer;" title="Haz clic para cambiar frecuencia de actualización" ${rnBind("click", (event, element) => { window.cyclePollRate() })}>
                                        <span class="live-dot" style="${(window.panelPollRate === 0) ? 'background:var(--warning); animation:none; box-shadow:none;' : ''}"></span>
                                        <span style="font-size:0.65rem; font-weight:800; color:${(window.panelPollRate === 0) ? 'var(--warning)' : '#34d399'}; letter-spacing:0.5px;">
                                            ${(window.panelPollRate === 0) ? 'PAUSADO' : 'Auto &middot; ' + ((window.panelPollRate || 1500) / 1000).toString().replace('.', ',') + ' s'}
                                        </span>
                                    </div>` : ''}
                                </div>
                            </div>

                            ${isRunning ? `
                            <!-- Gráfico Histórico Superior (Más grande) -->
                            <div id="stats-history-view" style="flex: 1; min-height: 0; position: relative; width: 100%; margin-bottom: 10px;">
                                <canvas id="mainHistoryChart"></canvas>
                            </div>

                            <!-- Gauges en Vivo Inferiores -->
                            <div id="stats-live-view" style="flex: 1; display: flex; flex-direction: column; justify-content: center; min-height: 0;">
                                <div class="charts-wrapper" style="border-top: none; margin-top: 15px; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; width: 100%;">
                                    <div class="compact-stat" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 15px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                                        <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                                            <span style="font-size:0.75rem; font-weight:700; color:var(--muted);"><i class="fa-solid fa-microchip"></i> CPU</span>
                                            <span class="bar-cpu-pct" style="font-size:0.75rem; font-weight:700;">${cpuPct}%</span>
                                        </div>
                                        <div style="width:100%; background:rgba(255,255,255,0.05); height:8px; border-radius:4px; overflow:hidden;">
                                            <div class="bar-cpu-fill" style="width:${cpuPct}%; background:var(--primary); height:100%; transition:width 0.5s;"></div>
                                        </div>
                                        <div style="font-size:0.65rem; color:var(--muted); margin-top:8px; text-align:right;" class="bar-cpu-abs">${cpuPct}% de ${maxCores} vCPUs</div>
                                    </div>
                                    <div class="compact-stat" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 15px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                                        <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                                            <span style="font-size:0.75rem; font-weight:700; color:var(--muted);"><i class="fa-solid fa-memory"></i> RAM</span>
                                            <span class="bar-ram-pct" style="font-size:0.75rem; font-weight:700;">${ramPct}%</span>
                                        </div>
                                        <div style="width:100%; background:rgba(255,255,255,0.05); height:8px; border-radius:4px; overflow:hidden;">
                                            <div class="bar-ram-fill" style="width:${ramPct}%; background:var(--info); height:100%; transition:width 0.5s;"></div>
                                        </div>
                                        <div style="font-size:0.65rem; color:var(--muted); margin-top:8px; text-align:right;" class="bar-ram-abs">${ramUsedVal.toFixed(2)} GB / ${maxRam} GB</div>
                                    </div>
                                    <div class="compact-stat" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 15px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                                        <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                                            <span style="font-size:0.75rem; font-weight:700; color:var(--muted);"><i class="fa-solid fa-hard-drive"></i> DISCO</span>
                                            <span class="bar-disk-pct" style="font-size:0.75rem; font-weight:700;">${diskPct}%</span>
                                        </div>
                                        <div style="width:100%; background:rgba(255,255,255,0.05); height:8px; border-radius:4px; overflow:hidden;">
                                            <div class="bar-disk-fill" style="width:${diskPct}%; background:var(--success); height:100%; transition:width 0.5s;"></div>
                                        </div>
                                        <div style="font-size:0.65rem; color:var(--muted); margin-top:8px; text-align:right;" class="bar-disk-abs">${diskUsedVal.toFixed(2)} GB / ${maxDisk} GB</div>
                                    </div>
                                </div>
                            </div>
                            ` : `
                            <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding: 20px;">
                                <i class="fa-solid fa-server" style="font-size: 3rem; color: var(--muted); margin-bottom: 15px; opacity: 0.3;"></i>
                                <h3 style="color: var(--text); font-size: 1.1rem; margin-bottom: 8px;">Servidor Apagado</h3>
                                <p class="muted" style="max-width: 250px; line-height: 1.5; margin-bottom: 20px; font-size: 0.8rem;">Inicia el servidor para comenzar a recopilar métricas de CPU, RAM y Disco en tiempo real.</p>
                                <button class="btn-success" ${rnBind("click", (event, element) => { srvStart((s.id)) })} style="padding: 8px 16px; font-size: 0.8rem; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);">
                                    <i class="fa-solid fa-play" style="margin-right: 6px;"></i> Iniciar Servidor
                                </button>
                            </div>
                            `}
                        </div>
                    </div>

                    <div class="col-right" style="height: 100%;">
                        <div id="card-conexion" class="card" style="flex-shrink: 0; padding: 20px 20px;">
                            <div class="card-header" style="margin-bottom:10px; padding-bottom:10px;">
                                <h3 style="font-size: 1rem;"><i class="fa-solid fa-plug" style="color:var(--success);"></i> Conexión In-Game</h3>
                            </div>
                            <div class="copy-box" style="padding-right: 40px; position: relative;" title="Haz clic para copiar la IP al portapapeles">
                                <span style="font-size: 0.85rem;">${globalSafeHost}:${s.fivem_port}</span>
                                <button class="copy-btn" title="Copiar IP" ${rnBind("click", (event, element) => { Nexus.copyToClipboard(`${globalSafeHost}:${s.fivem_port}`); showToast('IP copiada','success') })} style="position: absolute; right: 10px;"><i class="fa-regular fa-copy"></i></button>
                            </div>
                        </div>

                        <div id="card-info" class="card" style="flex-grow: 1; display: flex; flex-direction: column; padding: 20px 25px;">
                            <div class="card-header" style="margin-bottom:15px; padding-bottom:15px;">
                                <h3 style="font-size: 1rem;"><i class="fa-solid fa-circle-info" style="color:var(--muted);"></i> Información Técnica</h3>
                            </div>
                            <ul class="info-list">
                                <li><span>Estado del plan</span><span class="badge ${planBadgeClass ? '' : 'outline'} ${planBadgeClass}" style="${planBadgeStyle} text-transform:uppercase;">${s.runtime_plan}</span></li>
                                <li><span>ID del nodo</span><span class="mono">${s.container_name}</span></li>
                                ${s.template === 'fivem' ? `<li><span>Base de datos</span><span class="mono">${s.db_name}</span></li>` : ''}
                                <li><span>Puerto del juego</span><span class="mono">${s.fivem_port}</span></li>
                                ${s.template === 'fivem' && planName !== 'hobby' ? `<li><span>Editor 3D</span><span id="blender-status-text" style="color:${s.blender_status === 'running' ? 'var(--success)' : 'var(--muted)'}; font-weight:700;">${s.blender_status === 'running' ? '<i class="fa-solid fa-circle-check"></i> En Línea' : `<button class="btn-success" style="padding:2px 8px; font-size:0.65rem;" ${rnBind("click", (event, element) => { toggleBlender(event, (s.id), 'start') })}><i class="fa-solid fa-power-off"></i> Iniciar</button>`}</span></li>` : ''}
                                <li><span>Estado del Pago</span><span class="payment-status-text" style="color:${isExpired ? 'var(--danger)' : 'var(--success)'}; font-weight:700;">${isExpired ? 'Vencido' : 'Al Día'}</span></li>
                                <li><span>Renovación</span><span class="expiry-date-text" style="color:${isExpired ? 'var(--danger)' : 'white'}; font-weight:600;">${isUnlimited ? 'Sin vencimiento' : expDate.toLocaleDateString()}</span></li>
                            </ul>
                        </div>

                        <details style="margin-top: 15px; background: rgba(239,68,68,0.05); border: 1px solid rgba(239,68,68,0.2); border-radius: 8px;">
                            <summary style="padding: 10px 15px; color: var(--danger); font-size: 0.85rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: space-between;">
                                <span><i class="fa-solid fa-triangle-exclamation" style="margin-right: 6px;"></i> Zona Crítica</span>
                                <i class="fa-solid fa-chevron-down" style="font-size: 0.75rem;"></i>
                            </summary>
                            <div style="padding: 15px; border-top: 1px solid rgba(239,68,68,0.1); text-align: center;">
                                <p style="font-size: 0.75rem; color: var(--muted); margin-bottom: 10px;">Esta acción es irreversible y eliminará todos los datos.</p>
                                <button class="btn-danger" title="Eliminar servidor permanentemente" style="padding: 8px 16px; font-size: 0.8rem; width: 100%;" ${pending && pending.action === 'delete' ? 'disabled' : ''} ${rnBind("click", (event, element) => { srvDelete((s.id), (s.container_name)) })}>
                                    ${pending && pending.action === 'delete'
                            ? '<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px;"></i> Destruyendo...'
                            : '<i class="fa-solid fa-trash" style="margin-right:4px;"></i> Eliminar Servidor'}
                                </button>
                            </div>
                        </details>
                    </div>
                </div>
            </div>`;

                const currentDataHash = btoa(unescape(encodeURIComponent(newHtml)));
                if (lastDataHash !== currentDataHash) {
                    const scrollPos = container.scrollTop;
                    container.innerHTML = newHtml;
                    container.scrollTop = scrollPos;
                    container.dataset.renderedId = s.id;
                    lastDataHash = currentDataHash;
                }
            } catch (e) {
                if (e.status === 401) Nexus.logout();
                else console.warn("Polling loadServers:", e.message);
            } finally {
                isLoadServersInFlight = false;
            }
        }

        async function toggleBlender(event, id, action) {
            if (event) event.stopPropagation();
            const btn = event ? event.currentTarget : null;
            const originalHtml = btn ? btn.innerHTML : '';

            if (blenderActionPending) return;
            blenderActionPending = true;

            if (btn) {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.pointerEvents = 'none';
                if (action === 'start') {
                    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right:5px;"></i>Iniciando...';
                } else {
                    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                }
            }

            try {
                await Nexus.api(`/api/servers/${id}/blender/${action}`, { method: 'POST' });

                if (action === 'stop') {
                    isBlenderIframeLoaded = false;
                    const iframe = document.getElementById('blender-iframe');
                    if (iframe) {
                        iframe.src = 'about:blank';
                        iframe.style.display = 'none';
                    }
                    showToast('Entorno 3D apagado', 'info');

                    const srvNav = document.querySelector('.nav-item[onclick*="servers"]') || document.querySelector('.nav-item');
                    switchView('servers', srvNav);
                } else {
                    showToast('Entorno 3D iniciado', 'success');
                }

                lastDataHash = "";
                await loadServers();
            } catch (e) {
                showToast("Error en Blender: " + (e.message || "No se pudo cambiar el estado"), 'danger');
            } finally {
                blenderActionPending = false;
                if (btn) {
                    btn.innerHTML = originalHtml;
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.style.pointerEvents = 'auto';
                }
                if (action === 'stop' && id) {
                    sessionStorage.removeItem('blenderUrl_' + id);
                }
                await loadServers();
            }
        }

        let blenderPendingUrl = "";

        async function openBlender(id) {
            try {
                const data = await Nexus.api(`/api/servers/${id}/blender-access`);
                blenderPendingUrl = `/blender/${data.shortId}/?t=${Date.now()}`;

                document.getElementById('blender-tab-user').innerText = data.user;
                document.getElementById('blender-tab-pass').innerText = data.password;

                document.getElementById('modal-blender-pass').innerText = data.password;

                // 🚀 Solo mostrar el modal si el iframe no está cargado aún
                if (!isBlenderIframeLoaded) {
                    document.getElementById('blender-auth-modal').classList.remove('hidden');
                }
            } catch (e) {
                console.warn("Esperando entorno 3D...");
            }
        }

        function confirmBlenderAuth() {
            document.getElementById('blender-auth-modal').classList.add('hidden');
            const iframe = document.getElementById('blender-iframe');
            iframe.style.display = 'block';
            iframe.src = blenderPendingUrl;
            isBlenderIframeLoaded = true;
            if (currentServerId) {
                sessionStorage.setItem('blenderUrl_' + currentServerId, blenderPendingUrl);
            }
        }

        let srvActionPending = false;

        async function verifyArkVersion(id, btn) {
            if (serverActionsPending.has(id)) return;
            if (!confirm('¿Estás seguro de forzar la validación de archivos?\n\nEsto borrará la caché de SteamCMD y reiniciará el contenedor. El servidor tardará entre 5 y 10 minutos en volver a iniciar mientras valida todos los archivos.')) return;

            serverActionsPending.set(id, { action: 'verify', timestamp: Date.now() });
            lastDataHash = "";
            await loadServers();

            try {
                await Nexus.api(`/api/servers/${id}/force-update-ark`, { method: 'POST' });
                showToast('Validación forzada enviada. El servidor se está reiniciando.', 'success');
            } catch (e) {
                serverActionsPending.delete(id);
                showToast(e.message, 'error');
            }
        }

        async function srvAction(id, action, btn) {
            if (action === 'stop' && !confirm('¿Estás seguro de que quieres apagar el servidor de forma forzosa? Esto interrumpirá la conexión de todos los jugadores de inmediato.')) return;
            if (action === 'restart' && !confirm('¿Estás seguro de que quieres reiniciar el servidor? Esto desconectará a los jugadores temporalmente.')) return;

            if (serverActionsPending.has(id)) return;

            serverActionsPending.set(id, { action, timestamp: Date.now() });

            // Forzar re-render inmediato para mostrar "Procesando..."
            lastDataHash = "";
            await loadServers();

            try {
                await Nexus.api(`/api/servers/${id}/${action}`, { method: 'POST' });
                showToast(`Acción ${action.toUpperCase()} enviada`, 'success');

                // NO re-habilitamos aquí. El loop de loadServers() detectará el cambio de estado
                // y limpiará el mapa serverActionsPending, lo que habilitará los botones de nuevo.
            } catch (e) {
                showToast("Error al procesar acción", 'danger');
                serverActionsPending.delete(id); // Si hay error, liberamos inmediatamente
                lastDataHash = "";
                await loadServers();
            }
        }

        function srvDelete(id, name) {
            const html = `
              <h3 style="margin-bottom: 10px; color: var(--danger); font-size: 1.2rem;"><i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i> Zona de Peligro</h3>
              <p class="muted" style="margin-bottom: 15px; font-size: 0.9rem;">Esta acción es irreversible y se perderán todos los datos.</p>
              <p style="margin-bottom: 10px; font-size: 0.85rem;">Para confirmar, escribe <strong>${name}</strong> a continuación:</p>
              <input type="text" id="delete-confirm-input" class="input" style="width: 100%; margin-bottom: 20px; text-align: center;" placeholder="${name}" ${rnBind("input", (event, element) => { document.getElementById('btn-confirm-delete').disabled = element.value !== (name) })}>
              <div style="display:flex; gap:12px;">
                  <button class="btn-ghost" style="flex:1;" ${rnBind("click", (event, element) => { closeActionModal() })}>Cancelar</button>
                  <button id="btn-confirm-delete" class="btn-danger" style="flex:1;" disabled ${rnBind("click", (event, element) => { executeSrvDelete((id)) })}><i class="fa-solid fa-trash"></i> Destruir</button>
              </div>
          `;
            openActionModal(html);
            setTimeout(() => {
                const input = document.getElementById('delete-confirm-input');
                if (input) input.focus();
            }, 100);
        }

        async function executeSrvDelete(id) {
            closeActionModal();
            if (serverActionsPending.has(id)) return;
            serverActionsPending.set(id, { action: 'delete', timestamp: Date.now() });

            lastDataHash = "";
            await loadServers();

            const overlay = document.createElement('div');
            overlay.id = 'global-delete-overlay';
            overlay.style = 'position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:99999; display:flex; flex-direction:column; align-items:center; justify-content:center; backdrop-filter:blur(5px);';
            overlay.innerHTML = '<i class="fa-solid fa-bomb fa-bounce" style="font-size:4rem; color:var(--danger); margin-bottom:20px;"></i><h2 style="color:white; margin:0; font-size: 1.5rem;">Destruyendo Servidor...</h2><p style="color:var(--muted); margin-top:10px;">Por favor, no cierres esta ventana.</p>';
            document.body.appendChild(overlay);

            try {
                await Nexus.api(`/api/servers/${id}`, { method: 'DELETE' });
                showToast('Servidor destruido correctamente', 'success');
                await loadServers();
            } catch (e) {
                showToast('Error al destruir servidor', 'danger');
                serverActionsPending.delete(id);
                lastDataHash = "";
                await loadServers();
            } finally {
                const el = document.getElementById('global-delete-overlay');
                if (el) el.remove();
            }
        }

        async function saveBackupTime(serverId, time) {
            if (!time) return;
            try {
                const res = await Nexus.api(`/api/servers/${serverId}/backup-time`, { method: 'POST', body: { time } });
                if (res.error) throw new Error(res.error);
                showToast('Hora de backup guardada', 'success');
                loadServers();
            } catch (e) {
                showToast('Error al guardar la hora: ' + e.message, 'danger');
            }
        }

        function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

        async function saveSettings() {
            const userNow = JSON.parse(localStorage.getItem('nexus_user') || '{}');
            const emailInput = document.getElementById('set-email');
            const email = emailInput.value.trim();
            const pass1 = document.getElementById('set-new-pass').value;
            const pass2 = document.getElementById('set-new-pass2').value;
            const currentPass = document.getElementById('set-current-pass').value;

            if (email && !isValidEmail(email)) { showToast("Introduce un correo válido", 'warning'); emailInput.focus(); return; }
            if (!currentPass) { showToast("Contraseña actual requerida", 'warning'); return; }
            if (pass1 && pass1 !== pass2) { showToast("Las contraseñas nuevas no coinciden", 'danger'); return; }
            if (email && email !== userNow.email && userNow.is_verified) { showToast("El correo verificado no se puede cambiar", 'danger'); return; }

            const btn = document.getElementById('btn-save-settings');
            const originalText = btn.innerHTML;
            btn.classList.add('btn-loading'); btn.disabled = true;

            try {
                const payload = { currentPassword: currentPass };
                if (pass1) payload.newPassword = pass1;
                if (email && !userNow.is_verified) payload.newEmail = email;

                const res = await Nexus.api('/api/auth/change-settings', { method: 'POST', body: JSON.stringify(payload) });

                // 🚀 SI CAMBIÓ LA PASS, EL MIDDLEWARE NOS CERRARÁ LA SESIÓN EN LA PRÓXIMA PETICIÓN.
                // Para ser limpios, avisamos al usuario:
                if (pass1) {
                    showToast("Contraseña actualizada. Cerrando sesiones...", 'info');
                    setTimeout(() => Nexus.logout(), 2000);
                    return;
                }

                showToast("Ajustes guardados correctamente", 'success');

                if (payload.newEmail && payload.newEmail !== userNow.email) {
                    userNow.email = payload.newEmail;
                    userNow.is_verified = false;
                    localStorage.setItem('nexus_user', JSON.stringify(userNow));
                    alert("Has cambiado de correo. Te hemos enviado un nuevo enlace de verificación a " + payload.newEmail);
                    window.location.reload();
                }

                document.getElementById('set-current-pass').value = '';
                document.getElementById('set-new-pass').value = '';
                document.getElementById('set-new-pass2').value = '';

            } catch (e) {
                showToast(e.message || "Error al guardar. Comprueba tu contraseña", 'danger');
            } finally {
                btn.classList.remove('btn-loading'); btn.innerHTML = originalText; btn.disabled = false;
            }
        }

        let canResend = true;
        async function resendVerification() {
            const userNow = JSON.parse(localStorage.getItem('nexus_user') || '{}');
            if (userNow.is_verified) { showToast("Tu correo ya está verificado", 'info'); return; }
            if (!canResend) return;

            const btn = document.querySelector('#settings-unverified-banner button');
            const originalHtml = btn.innerHTML;

            try {
                await Nexus.api('/api/auth/resend-verification', { method: 'POST' });
                canResend = false; btn.disabled = true; let timeLeft = 60;

                const timer = setInterval(() => {
                    btn.innerHTML = `<i class="fa-solid fa-clock"></i> Espera ${timeLeft}s`;
                    timeLeft--;
                    if (timeLeft < 0) {
                        clearInterval(timer); canResend = true; btn.disabled = false; btn.innerHTML = originalHtml;
                    }
                }, 1000);

                showToast("Enlace reenviado. Revisa tu bandeja.", 'success');
            } catch (e) {
                if (e.message.toLowerCase().includes('verificad') || e.message.toLowerCase().includes('verified') || e.message.toLowerCase().includes('ya está')) {
                    const u = JSON.parse(localStorage.getItem('nexus_user') || '{}');
                    u.is_verified = true;
                    localStorage.setItem('nexus_user', JSON.stringify(u));
                    updateEmailUI();
                    showToast("Cuenta ya verificada. Panel actualizado.", 'info');
                } else {
                    showToast("Error al reenviar enlace", 'danger');
                }
            }
        }

        function openTicketModal() {
            document.getElementById('ticket-subject').value = '';
            document.getElementById('ticket-message').value = '';
            document.getElementById('ticket-modal').classList.remove('hidden');
        }

        function closeTicketModal() { document.getElementById('ticket-modal').classList.add('hidden'); }

        async function sendTicket() {
            const subject = document.getElementById('ticket-subject').value.trim();
            const message = document.getElementById('ticket-message').value.trim();

            if (!subject || !message) return showToast("Rellena todos los campos", 'warning');

            const btn = document.getElementById('btn-send-ticket');
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...'; btn.disabled = true;

            try {
                await Nexus.api('/api/tickets/create', { method: 'POST', body: JSON.stringify({ subject, message }) });
                showToast("Ticket enviado correctamente", 'success');
                closeTicketModal();
            } catch (e) {
                showToast("La función requiere backend", 'info');
            } finally {
                btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar a Soporte'; btn.disabled = false;
            }
        }

        function filterFiles() {
            const q = document.getElementById('fm-search').value.toLowerCase();
            document.querySelectorAll('#fm-sidebar-list .file-item').forEach(el => {
                el.style.display = el.innerText.toLowerCase().includes(q) ? 'flex' : 'none';
            });
        }

        async function loadFolder(targetPath) {
            if (!currentServerId) return; currentFolderPath = targetPath;
            document.getElementById('fm-search').value = '';
            const sidebarList = document.getElementById('fm-sidebar-list');
            sidebarList.innerHTML = '<div style="padding: 10px; display: flex; flex-direction: column; gap: 10px;"><div class="skeleton skeleton-text" style="width: 80%;"></div><div class="skeleton skeleton-text" style="width: 100%;"></div><div class="skeleton skeleton-text" style="width: 60%;"></div></div>';

            try {
                const data = await Nexus.api(`/api/files/list?serverId=${currentServerId}&path=${encodeURIComponent(targetPath)}`);
                let html = targetPath !== '/' ? `<div class="file-item dir" ${rnBind("click", (event, element) => { loadFolder((targetPath.split('/').slice(0, -1).join('/') || '/')) })}><i class="fa-solid fa-level-up-alt"></i> .. (Atrás)</div>` : '';

                if (data.items.length === 0) {
                    html += `<div class="muted" style="padding:20px; text-align:center; font-size:0.8rem;"><i class="fa-solid fa-folder-open" style="font-size:1.5rem; margin-bottom:10px; opacity:0.5;"></i><br>Carpeta vacía</div>`;
                } else {
                    data.items.forEach(item => {
                        if (item.isDirectory) {
                            html += `<div class="file-item dir" style="justify-content: space-between;">
                                      <div style="flex-grow:1" ${rnBind("click", (event, element) => { loadFolder((item.path)) })}><i class="fa-solid fa-folder"></i> ${item.name}</div>
                                      <div style="display:flex; align-items:center;">
                                          <i class="fa-solid fa-gear action-gear" ${rnBind("click", (event, element) => { openFmMenu(event, (item.path), (item.name), 'dir') })} title="Opciones"></i>
                                      </div>
                                   </div>`;
                        } else {
                            let type = item.name.toLowerCase().endsWith('.zip') ? 'zip' : 'file';
                            html += `<div class="file-item file" style="justify-content: space-between;">
                                      <div style="flex-grow:1" ${rnBind("click", (event, element) => { loadFile((item.path), (item.name)) })}><i class="fa-solid fa-file"></i> ${item.name}</div>
                                      <div style="display:flex; align-items:center;">
                                          <i class="fa-solid fa-gear action-gear" ${rnBind("click", (event, element) => { openFmMenu(event, (item.path), (item.name), (type)) })} title="Opciones"></i>
                                      </div>
                                   </div>`;
                        }
                    });
                }
                sidebarList.innerHTML = html;
            } catch (e) { sidebarList.innerHTML = `<div class="muted" style="color:var(--danger); padding:10px; text-align:center;">Error cargando archivos.</div>`; }
        }

        async function loadFile(filePath, fileName) {
            if (!currentServerId || !editorInstance) return;

            const ext = fileName.split('.').pop().toLowerCase();
            const binaryExtensions = ['jar', 'zip', 'png', 'jpg', 'jpeg', 'gif', 'exe', 'dll', 'db', 'tar', 'gz', 'rar'];

            if (binaryExtensions.includes(ext)) {
                editorInstance.setValue(`\n\n   ⚠️ El archivo "${fileName}" es un archivo binario y no puede editarse directamente.\n\n   Utiliza el botón de descarga en la barra superior para ver su contenido o gestionarlo localmente.`);
                monaco.editor.setModelLanguage(editorInstance.getModel(), 'plaintext');
                document.getElementById('fm-current-file').innerText = filePath;
                document.getElementById('btn-dl-file').style.display = 'inline-flex';
                currentFilePath = filePath;
                return;
            }

            currentFilePath = filePath;
            document.getElementById('fm-current-file').innerText = currentFilePath;
            editorInstance.setValue('Cargando contenido...');

            const langMap = {
                'lua': 'lua', 'js': 'javascript', 'json': 'json', 'json5': 'json', 'sql': 'sql',
                'html': 'html', 'css': 'css', 'xml': 'xml', 'yaml': 'yaml', 'yml': 'yaml',
                'cfg': 'ini', 'ini': 'ini', 'txt': 'plaintext', 'properties': 'ini', 'toml': 'ini',
                'log': 'plaintext', 'sh': 'shell', 'bat': 'bat'
            };
            let lang = langMap[ext] || 'plaintext';
            monaco.editor.setModelLanguage(editorInstance.getModel(), lang);

            try {
                const data = await Nexus.api(`/api/files/read?serverId=${currentServerId}&path=${encodeURIComponent(filePath)}`);
                editorInstance.setValue(typeof data.content === 'string' ? data.content : '');
                document.getElementById('btn-dl-file').style.display = 'inline-flex';
                setTimeout(() => editorInstance.layout(), 50);
            } catch (e) {
                editorInstance.setValue('');
                document.getElementById('btn-dl-file').style.display = 'none';
                showToast(e.message || 'No se pudo leer el archivo', 'danger');
            }
        }

        async function saveConfig() {
            try {
                await Nexus.api('/api/files/write', { method: 'PUT', body: JSON.stringify({ serverId: currentServerId, path: currentFilePath, content: editorInstance.getValue() }) });
                showToast("Archivo guardado con éxito", 'success');
            } catch (e) {
                showToast("Error al guardar archivo", 'danger');
            }
        }

        function fmDelete(t, e) {
            if (e) e.stopPropagation();
            const html = `
              <h3 style="margin-bottom: 10px; color: var(--danger); font-size: 1.2rem;"><i class="fa-solid fa-trash" style="margin-right:8px;"></i> Eliminar</h3>
              <p class="muted" style="margin-bottom: 20px; word-break: break-all;">¿Borrar permanentemente <strong>${t}</strong>?</p>
              <div style="display:flex; gap:12px;">
                  <button class="btn-ghost" style="flex:1;" ${rnBind("click", (event, element) => { closeActionModal() })}>Cancelar</button>
                  <button class="btn-danger" style="flex:1;" ${rnBind("click", (event, element) => { executeFmDelete((t)) })}>Eliminar</button>
              </div>
          `;
            openActionModal(html);
        }

        async function executeFmDelete(t) {
            closeActionModal();
            try {
                await Nexus.api('/api/files/action', { method: 'POST', body: JSON.stringify({ serverId: currentServerId, path: t, action: 'delete' }) });
                showToast('Eliminado correctamente', 'success');
                loadFolder(currentFolderPath.startsWith(t) ? '/' : currentFolderPath);
            } catch (e) {
                showToast('Error al eliminar', 'danger');
            }
        }

        function fmRename(path, oldName, e) {
            if (e) e.stopPropagation();
            const html = `
              <h3 style="margin-bottom: 10px; color: var(--info); font-size: 1.2rem;"><i class="fa-solid fa-pen-to-square" style="margin-right:8px;"></i> Renombrar</h3>
              <div style="margin-bottom: 20px;">
                  <label class="form-label" style="text-transform:none;">Nuevo nombre para <strong style="color:white;">${oldName}</strong></label>
                  <input type="text" class="input" id="modal-input-rename" value="${oldName}" ${rnBind("keydown", (event, element) => { if(event.key === 'Enter') executeFmRename((path)) })}>
              </div>
              <div style="display:flex; gap:12px;">
                  <button class="btn-ghost" style="flex:1;" ${rnBind("click", (event, element) => { closeActionModal() })}>Cancelar</button>
                  <button class="btn" style="flex:1; background:var(--info);" ${rnBind("click", (event, element) => { executeFmRename((path)) })}>Guardar</button>
              </div>
          `;
            openActionModal(html);

            setTimeout(() => {
                const inp = document.getElementById('modal-input-rename');
                inp.focus();
                const dotIdx = oldName.lastIndexOf('.');
                if (dotIdx > 0) inp.setSelectionRange(0, dotIdx);
                else inp.select();
            }, 100);
        }

        async function executeFmRename(oldPath) {
            const newName = document.getElementById('modal-input-rename').value.trim();
            if (!newName) return showToast('El nombre no puede estar vacío', 'warning');
            closeActionModal();

            try {
                await Nexus.api('/api/files/action', {
                    method: 'POST',
                    body: JSON.stringify({
                        serverId: currentServerId,
                        path: oldPath,
                        newName: newName,
                        action: 'rename'
                    })
                });
                showToast('Renombrado correctamente', 'success');
                loadFolder(currentFolderPath);
            } catch (e) {
                showToast('Error al renombrar', 'danger');
            }
        }

        function fmMove(path, name, e) {
            if (e) e.stopPropagation();
            const html = `
              <h3 style="margin-bottom: 10px; color: var(--warning); font-size: 1.2rem;"><i class="fa-solid fa-scissors" style="margin-right:8px;"></i> Mover Elemento</h3>
              <div style="margin-bottom: 20px;">
                  <label class="form-label" style="text-transform:none;">Ruta de destino para <strong style="color:white;">${name}</strong></label>
                  <input type="text" class="input" id="modal-input-move" value="${currentFolderPath === '/' ? '/' : currentFolderPath + '/'}" ${rnBind("keydown", (event, element) => { if(event.key === 'Enter') executeFmMove((path), (name)) })}>
                  <p class="muted" style="font-size: 0.75rem; margin-top: 5px;">Escribe la carpeta de destino. Ej: <span class="mono">/resources/[local]/</span></p>
              </div>
              <div style="display:flex; gap:12px;">
                  <button class="btn-ghost" style="flex:1;" ${rnBind("click", (event, element) => { closeActionModal() })}>Cancelar</button>
                  <button class="btn" style="flex:1; background:var(--warning);" ${rnBind("click", (event, element) => { executeFmMove((path), (name)) })}>Mover</button>
              </div>
          `;
            openActionModal(html);

            setTimeout(() => {
                const inp = document.getElementById('modal-input-move');
                inp.focus();
                inp.selectionStart = inp.selectionEnd = inp.value.length;
            }, 100);
        }

        async function executeFmMove(oldPath, name) {
            let destFolder = document.getElementById('modal-input-move').value.trim();
            if (!destFolder) return showToast('La ruta de destino no puede estar vacía', 'warning');

            if (!destFolder.startsWith('/')) destFolder = '/' + destFolder;
            if (!destFolder.endsWith('/')) destFolder += '/';
            const newPath = destFolder + name;

            closeActionModal();

            try {
                await Nexus.api('/api/files/action', {
                    method: 'POST',
                    body: JSON.stringify({
                        serverId: currentServerId,
                        path: oldPath,
                        newPath: newPath,
                        action: 'move'
                    })
                });
                showToast('Elemento movido con éxito', 'success');
                loadFolder(currentFolderPath);
            } catch (e) {
                showToast('Error al mover el archivo', 'danger');
            }
        }

        function fmUnzip(t, e) {
            if (e) e.stopPropagation();
            const html = `
              <h3 style="margin-bottom: 10px; color: var(--success); font-size: 1.2rem;"><i class="fa-solid fa-file-archive" style="margin-right:8px;"></i> Extraer ZIP</h3>
              <p class="muted" style="margin-bottom: 20px; word-break: break-all;">¿Descomprimir el archivo <strong>${t}</strong> en la carpeta actual?</p>
              <div style="display:flex; gap:12px;">
                  <button class="btn-ghost" style="flex:1;" ${rnBind("click", (event, element) => { closeActionModal() })}>Cancelar</button>
                  <button class="btn-success" style="flex:1;" ${rnBind("click", (event, element) => { executeFmUnzip((t)) })}>Extraer</button>
              </div>
          `;
            openActionModal(html);
        }

        async function executeFmUnzip(t) {
            closeActionModal();
            document.getElementById('fm-sidebar-list').innerHTML = `<div class="muted" style="padding:15px; text-align:center;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br><br>Extrayendo...</div>`;
            try {
                await Nexus.api('/api/files/action', { method: 'POST', body: JSON.stringify({ serverId: currentServerId, path: t, action: 'unzip' }) });
                showToast('Archivo extraído', 'success');
            } catch (e) {
                showToast('Error al extraer', 'danger');
            }
            loadFolder(currentFolderPath);
        }

        async function fmDownloadFileFromEditor() { window.open(`/api/files/download?serverId=${currentServerId}&path=${encodeURIComponent(currentFilePath)}`, '_blank'); }

        function fmDownloadFolder(targetPath, event) {
            if (event) event.stopPropagation();
            if (!confirm(`¿Comprimir y descargar esta carpeta completa?\n(Nota: Si la carpeta es muy pesada, como 'txData', podría tardar unos segundos en iniciar la descarga)`)) return;

            const url = `/api/files/download-folder?serverId=${currentServerId}&path=${encodeURIComponent(targetPath)}`;
            window.open(url, '_blank');
        }

        async function processUpload(files) {
            let sCount = 0; let fCount = 0;
            const CHUNK_SIZE = 80 * 1024 * 1024; // 80 MB (Aprovechando el límite de 100MB de Cloudflare)

            document.getElementById('fm-sidebar-list').innerHTML = `<div class="muted" style="padding:15px; text-align:center;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br><br><span id="upload-progress-text">Preparando subida...</span></div>`;
            const progressText = document.getElementById('upload-progress-text');

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const destPath = currentFolderPath === '/' ? `/${file.webkitRelativePath || file.name}` : `${currentFolderPath}/${file.webkitRelativePath || file.name}`;

                try {
                    if (file.size <= CHUNK_SIZE) {
                        progressText.innerText = `Subiendo ${file.name} (Directo)...`;
                        const formData = new FormData();
                        formData.append('file', file);
                        formData.append('serverId', currentServerId);
                        formData.append('path', destPath);
                        const res = await fetch('/api/files/upload', { method: 'POST', body: formData });
                        if (!res.ok) throw new Error();
                        sCount++;
                    } else {
                        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
                        const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

                        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
                            progressText.innerText = `Subiendo ${file.name} (Parte ${chunkIndex + 1}/${totalChunks})...`;
                            const start = chunkIndex * CHUNK_SIZE;
                            const end = Math.min(start + CHUNK_SIZE, file.size);
                            const chunk = file.slice(start, end);

                            const chunkFormData = new FormData();
                            chunkFormData.append('file', chunk);
                            chunkFormData.append('uploadId', uploadId);
                            chunkFormData.append('chunkIndex', chunkIndex);

                            const chunkRes = await fetch('/api/files/upload-chunk', { method: 'POST', body: chunkFormData });
                            if (!chunkRes.ok) throw new Error(`Fallo en chunk ${chunkIndex}`);
                        }

                        progressText.innerText = `Ensamblando ${file.name} en el servidor...`;
                        const finishRes = await fetch('/api/files/upload-finish', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                uploadId,
                                totalChunks,
                                serverId: currentServerId,
                                path: destPath,
                                fileName: file.name,
                                totalSize: file.size
                            })
                        });
                        if (!finishRes.ok) {
                            const errData = await finishRes.json();
                            throw new Error(errData.error || 'Error ensamblando');
                        }
                        sCount++;
                    }
                } catch (err) {
                    console.error("Upload error:", err);
                    fCount++;
                }
            }
            showToast(`Subida completada: Éxitos ${sCount} | Fallos ${fCount}`, fCount === 0 ? 'success' : 'warning');
            loadFolder(currentFolderPath);
        }
        function fmUploadFile() { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.onchange = e => { if (e.target.files.length > 0) processUpload(e.target.files); }; i.click(); }
        function fmUploadFolder() { const i = document.createElement('input'); i.type = 'file'; i.setAttribute('webkitdirectory', ''); i.setAttribute('directory', ''); i.onchange = e => { if (e.target.files.length > 0) processUpload(e.target.files); }; i.click(); }

        let logEventSource = null;

        // ============================================================
        // 🎮 CONSOLA INTERACTIVA (Minecraft)
        // ============================================================
        let _cmdHistory = [];
        let _cmdHistoryIdx = -1;

        function handleConsoleKey(e) {
            if (e.key === 'Enter') {
                sendConsoleCommand();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (_cmdHistoryIdx < _cmdHistory.length - 1) {
                    _cmdHistoryIdx++;
                    document.getElementById('mc-command-input').value = _cmdHistory[_cmdHistory.length - 1 - _cmdHistoryIdx];
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (_cmdHistoryIdx > 0) {
                    _cmdHistoryIdx--;
                    document.getElementById('mc-command-input').value = _cmdHistory[_cmdHistory.length - 1 - _cmdHistoryIdx];
                } else {
                    _cmdHistoryIdx = -1;
                    document.getElementById('mc-command-input').value = '';
                }
            }
        }

        async function sendConsoleCommand() {
            const input = document.getElementById('mc-command-input');
            const cmd = (input.value || '').trim();
            if (!cmd || !currentServerId) return;

            // Añadir al historial local
            _cmdHistory.push(cmd);
            if (_cmdHistory.length > 50) _cmdHistory.shift();
            _cmdHistoryIdx = -1;
            input.value = '';

            // Mostrar el comando en la consola localmente
            const term = document.getElementById('terminal-out');
            if (term) {
                term.innerText += `\n> ${cmd}`;
                term.scrollTop = term.scrollHeight;
            }

            try {
                await Nexus.api(`/api/servers/${currentServerId}/command`, {
                    method: 'POST',
                    body: JSON.stringify({ command: cmd })
                });
            } catch (e) {
                showToast('Error al enviar comando: ' + (e.message || 'revisa la consola'), 'danger');
            }

            // Refocus
            input.focus();
        }

        function startLogStreaming() {

            if (!currentServerId) {
                console.error("No currentServerId found for log streaming");
                return;
            }
            const term = document.getElementById('terminal-out');
            if (!term) return;

            // Cerrar stream previo si existe
            if (logEventSource) logEventSource.close();

            term.innerHTML = '<div class="muted"><i class="fa-solid fa-sync fa-spin"></i> Conectando con el motor de logs nativo...</div>';

            const streamUrl = `${window.location.origin}/api/servers/${currentServerId}/logs/stream`;
            logEventSource = new EventSource(streamUrl);

            logEventSource.addEventListener('open', (e) => {
                console.log("SSE Stream Abierto");
                // No borramos el terminal aquí para esperar el primer bloque de logs real
                // pero podemos dar feedback visual de que estamos conectados
                const spinner = term.querySelector('.fa-spin');
                if (spinner) {
                    spinner.classList.remove('fa-sync', 'fa-spin');
                    spinner.classList.add('fa-circle-check');
                    spinner.parentElement.style.color = 'var(--success)';
                    spinner.parentElement.innerHTML = '<i class="fa-solid fa-circle-check"></i> Motor de logs conectado. Esperando datos...';
                }
            });

            logEventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    // Si el mensaje es el de estado inicial, no es log real
                    if (data.status === 'connected') return;

                    // Limpieza agresiva de códigos ANSI y basura binaria
                    const cleanLogs = (data.msg || '')
                        .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
                        .replace(/\^[0-9]/g, '')
                        .replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, '')
                        .replace(/\[\s*c-scripting-core\s*\]/g, '[CORE]')
                        .trim();

                    if (cleanLogs) {
                        // Siempre mostramos el log completo del servidor (incluye respuestas a comandos)
                        term.innerText = cleanLogs;
                        term.scrollTop = term.scrollHeight;
                    } else {
                        term.innerText = 'Consola vacía. Esperando salida del servidor...';
                    }
                    term.scrollTop = term.scrollHeight;
                } catch (e) {
                    console.error("Error en log stream:", e);
                }
            };

            logEventSource.onerror = (e) => {
                console.error("SSE Error:", e);
                term.innerHTML = '<div class="text-danger"><i class="fa-solid fa-triangle-exclamation"></i> Conexión perdida. Reintentando...</div>';
                logEventSource.close();
                // Reintento exponencial o simple
                setTimeout(startLogStreaming, 5000);
            };
        }

        let isDownloadPollingActive = false;
        let isDownloadPollingInFlight = false;
        let wasDownloading = false;

        function startDownloadPolling() {
            if (isDownloadPollingActive) return;
            isDownloadPollingActive = true;

            setInterval(async () => {
                if (!currentServerId || isDownloadPollingInFlight) return;
                isDownloadPollingInFlight = true;
                try {
                    const res = await fetch(`/api/files/download-status?serverId=${currentServerId}`, { credentials: 'same-origin' });
                    if (res.status === 401) Nexus.logout();
                    const data = await res.json();
                    renderDownloads(data.tasks || []);
                } catch (e) { } finally {
                    isDownloadPollingInFlight = false;
                }
            }, 3000);
        }

        function renderDownloads(tasks) {
            const container = document.getElementById('active-downloads-container');

            if (tasks.length === 0) {
                if (wasDownloading) {
                    container.innerHTML = '';
                    if (!document.getElementById('view-editor').classList.contains('hidden')) {
                        loadFolder(currentFolderPath);
                    }
                    wasDownloading = false;
                }
                return;
            }

            wasDownloading = true;
            let html = '';

            tasks.forEach(t => {
                let color = 'var(--primary)';
                let icon = '<i class="fa-solid fa-cloud-arrow-down fa-bounce" style="color:var(--primary)"></i>';

                if (t.isError) {
                    color = 'var(--danger)';
                    icon = '<i class="fa-solid fa-circle-xmark" style="color:var(--danger)"></i>';
                } else if (t.isFinished) {
                    color = 'var(--success)';
                    icon = '<i class="fa-solid fa-circle-check" style="color:var(--success)"></i>';
                } else if (t.status.includes('Extrayendo') || t.status.includes('Descomprimiendo')) {
                    color = 'var(--success)';
                    icon = '<i class="fa-solid fa-box-open fa-bounce" style="color:var(--success)"></i>';
                }

                html += `
              <div class="dl-card" style="border-color: ${color}60;">
                  <div class="dl-title" title="${t.fileName}">${icon} ${t.fileName}</div>
                  <div class="dl-progress-bg">
                      <div class="dl-progress-fill" style="width: ${t.progress}%; background: ${color}; box-shadow: 0 0 10px ${color}80;"></div>
                  </div>
                  <div class="dl-status" style="color: ${t.isError ? 'var(--danger)' : (t.isFinished ? 'var(--success)' : 'var(--muted)')}">
                      <span>${t.status}</span>
                  </div>
              </div>`;
            });
            container.innerHTML = html;
        }

        // ==========================================
        // FACTURACIÓN Y PLANES
        // ==========================================
        let currentSelectedDiskPack = null;
        let currentDiskGb = null;

        async function loadBillingInfo() {
            let userNow = JSON.parse(localStorage.getItem('nexus_user') || '{}');

            try {
                const userRes = await fetch('/api/auth/me');
                if (userRes.status === 401) Nexus.logout();
                if (userRes.ok) {
                    const userData = await userRes.json();
                    userNow.plan = userData.plan || 'hobby';
                    localStorage.setItem('nexus_user', JSON.stringify(userNow));
                }
            } catch (e) { }

            const planName = userNow.plan || 'hobby';
            const summaryPlanEl = document.getElementById('summary-plan-name');
            if (summaryPlanEl) summaryPlanEl.innerText = planName.charAt(0).toUpperCase() + planName.slice(1);

            const specs = {
                "hobby": { ram: "4 GB", cpu: "2 vCores", disk: "20 GB" },
                "standard": { ram: "8 GB", cpu: "4 vCores", disk: "40 GB" },
                "premium": { ram: "16 GB", cpu: "6 vCores", disk: "80 GB" },
                "platinum": { ram: "32 GB", cpu: "8 vCores", disk: "250 GB" },
                "partner": { ram: "32 GB", cpu: "8 vCores", disk: "250 GB" }
            };
            const currentSpecs = specs[planName.toLowerCase()] || specs["hobby"];

            const featRam = document.getElementById("feat-ram");
            const featCpu = document.getElementById("feat-cpu");
            const featDisk = document.getElementById("feat-disk");

            if (featRam) featRam.innerText = currentSpecs.ram;
            if (featCpu) featCpu.innerText = currentSpecs.cpu;
            if (featDisk) featDisk.innerText = currentSpecs.disk;

            loadDiskPlans();

            try {
                const data = await Nexus.api("/api/servers");
                if (data.items && data.items.length > 0) {
                    const extraDisk = data.items[0].extra_disk_gb || 0;
                    const summaryDiskEl = document.getElementById("summary-extra-disk");
                    if (summaryDiskEl) summaryDiskEl.innerText = extraDisk;
                }
            } catch (e) { }
        }

        async function loadDiskPlans() {
            const grid = document.getElementById('disk-packs-grid');
            if (!grid) return;
            try {
                const plans = await Nexus.api('/api/payments/disk-plans');
                if (plans.length === 0) {
                    grid.innerHTML = '<p class="muted">No hay expansiones disponibles.</p>';
                    return;
                }

                const colors = ['var(--muted)', 'var(--info)', 'var(--success)', 'var(--warning)', 'var(--danger)', 'var(--primary)'];

                grid.innerHTML = plans.map((p, i) => `
                  <div class="disk-pack premium-disk-pack" ${rnBind("click", (event, element) => { selectDiskPack((p.id), (p.paypal_plan_id), (p.gb_amount)) })} style="position: relative; background: linear-gradient(180deg, rgba(30,30,35,0.8) 0%, rgba(18,18,20,0.9) 100%); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 25px 15px; text-align: center; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden;">
                      <div class="disk-pack-glow" style="position: absolute; top: 0; left: 0; right: 0; height: 2px; background: ${colors[i % colors.length]}; opacity: 0.3; transition: opacity 0.3s;"></div>
                      <div style="position: absolute; top: -20px; left: 50%; transform: translateX(-50%); width: 80px; height: 80px; background: radial-gradient(circle, ${colors[i % colors.length]}40 0%, transparent 70%); filter: blur(15px); pointer-events: none; transition: opacity 0.3s;" class="disk-pack-blur"></div>
                      <i class="fa-solid fa-sd-card" style="font-size: 2.2rem; color: ${colors[i % colors.length]}; margin-bottom: 15px; display:block; position: relative; z-index: 1; filter: drop-shadow(0 4px 10px ${colors[i % colors.length]}60);"></i>
                      <strong style="font-size: 1.5rem; font-weight: 800; color: white; display:block; position: relative; z-index: 1; letter-spacing: -0.5px;">${p.gb_amount} GB</strong>
                      <span style="font-size: 0.85rem; color: #a5b4fc; font-weight: 600; margin-top: 8px; display:inline-block; position: relative; z-index: 1; background: rgba(99,102,241,0.1); padding: 4px 12px; border-radius: 12px; border: 1px solid rgba(99,102,241,0.2);">$${parseFloat(p.price).toFixed(2)}<small style="opacity: 0.7; font-weight: 400;">/mes</small></span>
                  </div>
              `).join('');
            } catch (e) {
                grid.innerHTML = '<p class="muted" style="color:var(--danger)">Error al cargar packs.</p>';
            }
        }

        function selectDiskPack(diskPlanId, paypalPlanId, gb) {
            document.querySelectorAll('.disk-pack').forEach(el => el.classList.remove('selected'));
            event.currentTarget.classList.add('selected');

            currentSelectedDiskPack = diskPlanId;
            currentDiskGb = gb;

            document.getElementById('selected-disk-label').innerText = `${gb} GB Extras`;
            document.getElementById('disk-checkout-container').classList.remove('hidden');
            renderDiskPaypalButton(diskPlanId, paypalPlanId, gb);
        }

        async function renderDiskPaypalButton(diskPlanId, paypalPlanId, gb) {
            const container = document.getElementById('paypal-disk-button-container');
            container.innerHTML = ''; // Clear previous button

            try {
                await window.loadPayPalSdk();
            } catch (error) {
                container.innerHTML = '<p class="muted" style="color:var(--warning)">PayPal no esta disponible en este entorno.</p>';
                return;
            }

            paypal.Buttons({
                style: { layout: 'vertical', color: 'blue', shape: 'rect', label: 'subscribe' },
                createSubscription: function (data, actions) {
                    return actions.subscription.create({
                        'plan_id': paypalPlanId
                    });
                },
                onApprove: async function (data, actions) {
                    showToast('Procesando pago de disco, por favor espera...', 'info');
                    try {
                        const res = await fetch('/api/payments/register-disk-subscription', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ subscriptionID: data.subscriptionID, diskPlanId })
                        });
                        const responseData = await res.json();
                        if (responseData.success) {
                            showToast(responseData.message, 'success');
                            setTimeout(() => window.location.reload(), 2000);
                        } else {
                            showToast(responseData.error || 'Error procesando la expansión de disco', 'danger');
                        }
                    } catch (err) {
                        showToast('Error de conexión al procesar el disco.', 'danger');
                    }
                },
                onError: function (err) {
                    showToast('Se canceló o falló el pago de PayPal.', 'warning');
                }
            }).render('#paypal-disk-button-container');
        }

        function openPlanChangeModal() {
            const userNow = JSON.parse(localStorage.getItem('nexus_user') || '{}');
            const currentPlan = (userNow.plan || 'hobby').toLowerCase();

            let buttonsHtml = '';

            if (currentPlan !== 'hobby') {
                buttonsHtml += `<button class="btn-ghost" ${rnBind("click", (event, element) => { doRevisePlan('hobby') })}>Hobby</button>`;
            } else {
                buttonsHtml += `<button class="btn-ghost" disabled style="opacity: 0.5; cursor: not-allowed;">Hobby (Actual)</button>`;
            }

            if (currentPlan !== 'standard') {
                buttonsHtml += `<button class="btn-ghost" ${rnBind("click", (event, element) => { doRevisePlan('standard') })}>Standard</button>`;
            } else {
                buttonsHtml += `<button class="btn-ghost" disabled style="opacity: 0.5; cursor: not-allowed;">Standard (Actual)</button>`;
            }

            if (currentPlan !== 'premium') {
                buttonsHtml += `<button class="btn-ghost" ${rnBind("click", (event, element) => { doRevisePlan('premium') })}>Premium</button>`;
            } else {
                buttonsHtml += `<button class="btn-ghost" disabled style="opacity: 0.5; cursor: not-allowed;">Premium (Actual)</button>`;
            }

            if (currentPlan !== 'platinum') {
                buttonsHtml += `<button class="btn-ghost" ${rnBind("click", (event, element) => { doRevisePlan('platinum') })}>Platinum</button>`;
            } else {
                buttonsHtml += `<button class="btn-ghost" disabled style="opacity: 0.5; cursor: not-allowed;">Platinum (Actual)</button>`;
            }

            const html = `
              <h3 style="margin-bottom: 20px; font-size: 1.2rem;"><i class="fa-solid fa-arrow-up-right-dots" style="color:var(--primary); margin-right:8px;"></i> Mejorar Plan</h3>
              <p class="muted" style="margin-bottom: 20px; font-size: 0.9rem;">Si actualizas tu plan, PayPal calculará la diferencia y te cobrará lo correspondiente prorrateado. Selecciona tu nuevo plan:</p>
              <div style="display:flex; flex-direction:column; gap:10px; margin-bottom: 20px;">
                  ${buttonsHtml}
              </div>
              <button class="btn-danger" style="width:100%;" ${rnBind("click", (event, element) => { closeActionModal() })}>Cancelar</button>
          `;
            openActionModal(html);
        }

        async function doRevisePlan(newPlanName) {
            closeActionModal();
            showToast('Generando enlace seguro con PayPal...', 'info');

            try {
                const res = await fetch('/api/payments/revise-plan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ newPlanId: newPlanName })
                });
                const data = await res.json();
                if (data.success && data.approveUrl) {
                    const win = window.open(data.approveUrl, 'PayPal', 'width=500,height=600');

                    const confirmHtml = `
                      <h3 style="margin-bottom: 20px; font-size: 1.2rem;"><i class="fa-solid fa-clock" style="color:var(--warning); margin-right:8px;"></i> Esperando Confirmación</h3>
                      <p class="muted" style="margin-bottom: 20px; font-size: 0.9rem;">Por favor, completa el proceso en la ventana emergente de PayPal. Cuando termines, pulsa el botón de abajo para verificar el cambio.</p>
                      <button class="btn-success" style="width:100%;" ${rnBind("click", (event, element) => { confirmRevisePlan((newPlanName)) })}>Ya he aprobado en PayPal</button>
                  `;
                    openActionModal(confirmHtml);
                } else {
                    showToast(data.error || 'Error al iniciar cambio de plan.', 'danger');
                }
            } catch (err) {
                showToast('Error de conexión', 'danger');
            }
        }

        async function confirmRevisePlan(newPlanName) {
            closeActionModal();
            showToast('Verificando cambio de plan...', 'info');
            try {
                const res = await fetch('/api/payments/confirm-revise', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ planName: newPlanName })
                });
                const data = await res.json();
                if (data.success) {
                    showToast(data.message, 'success');
                    const userNow = JSON.parse(localStorage.getItem('nexus_user') || '{}');
                    userNow.plan = data.plan;
                    localStorage.setItem('nexus_user', JSON.stringify(userNow));
                    setTimeout(() => window.location.reload(), 2000);
                } else {
                    showToast(data.error || 'No se detectó el cambio. Inténtalo de nuevo más tarde.', 'danger');
                }
            } catch (err) {
                showToast('Error de conexión al verificar.', 'danger');
            }
        }

        loadNotifications();
        loadServers();
        startDownloadPolling();
        // 🚀 TURBO MODE: Actualizaciones rápidas (1.5s) aprovechando el motor Rust
        window.panelPollRate = 1500;
        window.serverPollInterval = setInterval(loadServers, window.panelPollRate);
        setInterval(loadNotifications, 15000);

        window.cyclePollRate = () => {
            const rates = [1500, 5000, 15000, 0];
            let idx = rates.indexOf(window.panelPollRate);
            if (idx === -1) idx = 0;
            idx = (idx + 1) % rates.length;
            window.panelPollRate = rates[idx];

            clearInterval(window.serverPollInterval);
            if (window.panelPollRate > 0) {
                window.serverPollInterval = setInterval(loadServers, window.panelPollRate);
            }
            loadServers(); // Force a UI update to reflect new poll rate in the badge
        };

        // Ahorro inteligente de recursos
        document.addEventListener('visibilitychange', () => {
            clearInterval(window.serverPollInterval);
            if (document.hidden) {
                window.serverPollInterval = setInterval(loadServers, 12000); // Modo reposo
            } else {
                loadServers(); // Carga inmediata al volver
                if (window.panelPollRate > 0) {
                    window.serverPollInterval = setInterval(loadServers, window.panelPollRate); // Restaurar preferencia
                }
            }
        });

        // 💓 HEARTBEAT PARA EL EDITOR 3D (Previene el auto-apagado por inactividad)
        setInterval(async () => {
            if (activeView === "blender" && currentServerId) {
                try { await Nexus.api(`/api/servers/${currentServerId}/blender/heartbeat`, "POST"); } catch (e) { }
            }
        }, 60000);

        // 🛒 MARKETPLACE LOGIC
        async function loadMarketplace() {
            const grid = document.getElementById('marketplace-scripts-grid');
            if (!grid) return;

            // 🚀 Aseguramos el servidor actual (fallback si no ha cargado)
            if (!currentServer && globalServersList.length > 0) {
                currentServer = globalServersList[0];
            }

            const isMC = currentServer && currentServer.template === 'minecraft';
            const game = isMC ? 'minecraft' : 'fivem';

            // 🎨 Adaptación Visual del Título y Banners
            const titleEl = document.getElementById('marketplace-title');
            const subEl = document.getElementById('marketplace-subtitle');
            const vaultEl = document.getElementById('vault-banner');
            const vendorEl = document.getElementById('card-vendor-apply');

            if (titleEl) titleEl.innerText = isMC ? 'Librería de Mods' : 'Script Marketplace';
            if (subEl) subEl.innerText = isMC ? 'Mods verificados y listos para instalar en un clic.' : 'Sistemas exclusivos y protegidos para tu servidor.';

            // Forzar visibilidad/ocultación inmediata
            if (vaultEl) vaultEl.style.display = isMC ? 'none' : 'flex';
            if (vendorEl) {
                const isVendorOrAdmin = Nexus.user && (Nexus.user.role === 'vendor' || Nexus.user.role === 'admin');
                vendorEl.style.display = (isMC || isVendorOrAdmin) ? 'none' : 'flex';
            }

            grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 50px;"><i class="fa-solid fa-spinner fa-spin" style="font-size: 2rem; color: var(--primary);"></i><p class="muted" style="margin-top:10px;">Cargando ${isMC ? 'mods' : 'scripts'}...</p></div>`;

            try {
                const scripts = await Nexus.api(`/api/marketplace/scripts?game=${game}`);
                if (!scripts || scripts.length === 0) {
                    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 50px;"><p class="muted">No hay ${isMC ? 'mods' : 'scripts'} disponibles en este momento.</p></div>`;
                    return;
                }

                grid.innerHTML = scripts.map(s => {
                    let btnHtml = '';
                    if (isMC) {
                        btnHtml = `<button class="btn" style="flex: 1;" ${rnBind("click", (event, element) => { installMod((s.id), (s.name)) })}><i class="fa-solid fa-cloud-arrow-down"></i> Instalar</button>`;
                    } else {
                        btnHtml = `<button class="btn" style="flex: 1;" ${rnBind("click", (event, element) => { buyScript((s.id), (s.name), (s.price)) })}><i class="fa-solid ${s.price > 0 ? 'fa-cart-shopping' : 'fa-download'}"></i> ${s.price > 0 ? 'Comprar' : 'Obtener'}</button>`;
                    }

                    return `
                  <div class="card" style="padding: 0; overflow: hidden; border-color: ${s.icon_color}33;">
                      <div style="height: 140px; background: ${s.image_url ? `url('${s.image_url}') center/cover no-repeat` : `linear-gradient(135deg, ${s.icon_color}22 0%, transparent 100%)`}; display: flex; align-items: center; justify-content: center; position: relative;">
                          ${s.image_url ? '' : `<i class="fa-solid fa-${s.icon_type || 'cube'}" style="font-size: 4rem; color: ${s.icon_color}; filter: drop-shadow(0 0 15px ${s.icon_color}66);"></i>`}
                          <div style="position: absolute; top: 15px; right: 15px; background: rgba(0,0,0,0.5); padding: 4px 10px; border-radius: 6px; font-size: 0.65rem; color: white; border: 1px solid rgba(255,255,255,0.1);"><i class="fa-solid fa-tag"></i> ${s.version}</div>
                      </div>
                      <div style="padding: 25px; display: flex; flex-direction: column; gap: 15px;">
                          <div style="display: flex; justify-content: space-between; align-items: center;">
                              <h3 style="margin:0; font-size: 1.2rem;">${s.name}</h3>
                              <span style="font-size: 1.2rem; font-weight: 900; color: ${s.price > 0 ? 'white' : 'var(--success)'};">${s.price > 0 ? '$' + s.price : 'Gratis'}</span>
                          </div>
                          <p class="muted" style="font-size: 0.85rem; line-height: 1.5; height: 65px;">${s.description}</p>
                          <div style="display: flex; gap: 10px; margin-top: 5px;">
                              ${btnHtml}
                              <button class="btn-ghost" style="padding: 10px;" ${rnBind("click", (event, element) => { showToast('Detalles próximamente...', 'info') })}><i class="fa-solid fa-info-circle"></i></button>
                          </div>
                      </div>
                  </div>`;
                }).join('');
            } catch (e) {
                grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 50px;"><p class="muted">Error al cargar el Marketplace.</p></div>';
            }
        }

        async function installMod(modId, modName) {
            if (!currentServerId) {
                showToast("Selecciona un servidor primero", "warning");
                return;
            }

            try {
                showToast(`Instalando ${modName}...`, "info");
                const res = await Nexus.api(`/api/marketplace/install-mod/${modId}`, {
                    method: 'POST',
                    body: JSON.stringify({ serverId: currentServerId })
                });
                if (res.error) throw new Error(res.error);
                showToast(res.message, "success");
            } catch (e) {
                showToast(e.message, "danger");
            }
        }

        async function loadMyLicenses() {
            const tbody = document.getElementById('my-licenses-tbody');
            if (!tbody) return;
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 30px;" class="muted"><i class="fa-solid fa-spinner fa-spin"></i> Cargando tus licencias...</td></tr>';

            try {
                const licenses = await Nexus.api('/api/marketplace/my-licenses');
                if (!licenses || licenses.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 30px;" class="muted">Aún no tienes licencias. ¡Visita el Market para adquirir scripts exclusivos!</td></tr>';
                    return;
                }

                tbody.innerHTML = licenses.map(l => `
                  <tr>
                      <td style="font-weight: 700; color: white;">${l.script_name}</td>
                      <td><span style="background: rgba(255,255,255,0.05); padding: 4px 8px; border-radius: 4px; font-size: 0.75rem;">v${l.version}</span></td>
                      <td>
                          <div style="display: flex; align-items: center; gap: 10px;">
                              <code style="background: rgba(0,0,0,0.3); padding: 6px 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 0.9rem; color: var(--primary); border: 1px solid rgba(99,102,241,0.2);">${l.license_key}</code>
                              <button class="btn-ghost" style="padding: 6px 10px;" ${rnBind("click", (event, element) => { Nexus.copyToClipboard((l.license_key)); showToast('Licencia copiada al portapapeles', 'success'); })}><i class="fa-regular fa-copy"></i></button>
                          </div>
                      </td>
                      <td>
                          <button class="btn" style="padding: 8px 16px; font-size: 0.8rem;" ${rnBind("click", (event, element) => { openInstallModal((l.license_key)) })}><i class="fa-solid fa-cloud-arrow-down"></i> Instalar en Servidor</button>
                      </td>
                  </tr>
              `).join('');
            } catch (e) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 30px; color: var(--danger);">Error al cargar las licencias.</td></tr>';
            }
        }

        async function openInstallModal(licenseKey) {
            try {
                const servers = await Nexus.api('/api/servers');
                const select = document.getElementById('modal-install-server-id');
                select.innerHTML = '';

                if (!servers.items || servers.items.length === 0) {
                    select.innerHTML = '<option disabled selected>No tienes servidores activos</option>';
                } else {
                    servers.items.forEach(s => {
                        const opt = document.createElement('option');
                        opt.value = s.id;
                        opt.innerText = `${s.name} (${s.id.slice(0, 8)})`;
                        select.appendChild(opt);
                    });
                }

                document.getElementById('modal-install-license').value = licenseKey;
                document.getElementById('modal-install-script').classList.remove('hidden');
            } catch (e) {
                showToast('Error al cargar servidores.', 'danger');
            }
        }

        async function confirmInstallScript() {
            const licenseKey = document.getElementById('modal-install-license').value;
            const serverId = document.getElementById('modal-install-server-id').value;

            if (!serverId) {
                showToast('Debes seleccionar un servidor válido.', 'warning');
                return;
            }

            try {
                closeModal('modal-install-script');
                showToast('Instalando script en tu servidor...', 'info');

                const res = await Nexus.api(`/api/marketplace/purchase/install/${licenseKey}`, {
                    method: 'POST',
                    body: JSON.stringify({ serverId })
                });
                if (res.error) throw new Error(res.error);
                showToast(res.message, 'success');
            } catch (e) {
                showToast(e.message, 'danger');
            }
        }

        // ⛏️ MINECRAFT CONFIGURATION ENGINE
        // 🔧 MOTOR UNIFICADO DE CONFIGURACIÓN
        let currentGameConfig = {};

        async function loadGameConfig() {
            const grid = document.getElementById('mc-config-grid');
            if (!grid) return;
            const s = currentServer;
            if (!s) return;

            grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 100px;"><i class="fa-solid fa-spinner fa-spin fa-3x" style="color: var(--primary);"></i><p class="muted" style="margin-top: 20px;">Cargando configuración de ${s.template.toUpperCase()}...</p></div>`;

            try {
                let endpoint = `/api/minecraft/${s.id}/properties`;
                if (s.template === 'palworld') endpoint = `/api/palworld/config/${s.id}`;
                if (s.template === 'rust') endpoint = `/api/rust/config/${s.id}`;
                if (s.template === 'cs2') endpoint = `/api/cs2/config/${s.id}`;
                if (s.template === 'sdtd') endpoint = `/api/sdtd/config/${s.id}`;
                if (s.template === 'zomboid') endpoint = `/api/zomboid/config/${s.id}`;
                if (s.template === 'ark') endpoint = `/api/ark/config/${s.id}`;
                if (s.template === 'valheim') endpoint = `/api/valheim/config/${s.id}`;

                const props = await Nexus.api(endpoint);
                currentGameConfig = props;

                if (s.template === 'minecraft') renderMcConfig(props);
                else if (s.template === 'palworld') renderPalworldConfig(props);
                else if (s.template === 'rust') renderRustConfig(props);
                else if (s.template === 'cs2') renderCS2Config(props);
                else if (s.template === 'valheim') renderValheimConfig(props);
                else if (s.template === 'zomboid') renderZomboidConfig(props);
                else if (s.template === 'ark') renderARKConfig(props);
                else if (s.template === 'sdtd') renderSDTDConfig(props);
            } catch (e) {
                grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 50px; color: var(--danger);"><i class="fa-solid fa-triangle-exclamation fa-2x"></i><br>Error al cargar: ${e.message}</div>`;
            }
        }


        function renderSDTDConfig(props) {
            const grid = document.getElementById('mc-config-grid');
            const fields = [
                { key: 'ServerName', label: 'Nombre del Servidor', type: 'text', icon: 'signature' },
                { key: 'ServerDescription', label: 'Descripción', type: 'text', icon: 'align-left' },
                { key: 'ServerPassword', label: 'Contraseña', type: 'text', icon: 'lock' },
                { key: 'ServerMaxPlayerCount', label: 'Máx. Jugadores', type: 'number', icon: 'users' },
                { key: 'GameDifficulty', label: 'Dificultad (0-5)', type: 'select', options: ['0', '1', '2', '3', '4', '5'], icon: 'skull' },
                { key: 'DayNightLength', label: 'Duración Día/Noche (Min)', type: 'number', icon: 'clock' },
                { key: 'BloodMoonFrequency', label: 'Frecuencia Luna Roja (Días)', type: 'number', icon: 'moon' },
                { key: 'BloodMoonWarning', label: 'Alerta Luna Roja (Minutos antes)', type: 'number', icon: 'bullhorn' },
                { key: 'TelnetEnabled', label: 'Consola Telnet / WebAPI', type: 'switch', icon: 'terminal' },
                { key: 'LootAbundance', label: 'Abundancia de Botín (%)', type: 'number', icon: 'box-open' },
                { key: 'LootRespawnDays', label: 'Respawn de Botín (Días)', type: 'number', icon: 'rotate' },
                { key: 'DropOnDeath', label: 'Soltar al Morir', type: 'select', options: ['0', '1', '2', '3', '4'], icon: 'person-falling' },
                { key: 'ZombiesRun', label: 'Velocidad Zombies', type: 'select', options: ['0', '1', '2', '3', '4'], icon: 'person-running' }
            ];

            grid.innerHTML = fields.map(f => {
                const val = props[f.key] || '';
                let inputHtml = '';
                if (f.type === 'select') {
                    inputHtml = `<select class="input" ${rnBind("change", (event, element) => { updateMcProp((f.key), element.value) })} style="margin:0; padding: 8px 12px;">${f.options.map(o => `<option value="${o}" ${val == o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
                } else if (f.type === 'switch') {
                    const checked = val === 'true' || val === '1' || val === 'True' ? 'checked' : '';
                    inputHtml = `<label class="switch"><input type="checkbox" ${checked} ${rnBind("change", (event, element) => { updateMcProp((f.key), element.checked ? 'true' : 'false') })}><span class="slider round"></span></label>`;
                } else {
                    inputHtml = `<input type="${f.type || 'text'}" class="input" value="${val}" ${rnBind("change", (event, element) => { updateMcProp((f.key), element.value) })} style="margin:0; padding: 8px 12px; width: ${f.type === 'number' ? '120px' : '250px'};">`;
                }
                return `
                  <div class="card" style="display: flex; align-items: center; justify-content: space-between; padding: 20px;">
                      <div style="display: flex; align-items: center; gap: 15px;">
                          <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(239,68,68,0.1); display: flex; align-items: center; justify-content: center; color: #ef4444;">
                              <i class="fa-solid fa-${f.icon}"></i>
                          </div>
                          <div>
                              <div style="font-weight: 700; font-size: 0.95rem;">${f.label}</div>
                              <div class="muted" style="font-size: 0.75rem;">${f.key}</div>
                          </div>
                      </div>
                      <div>${inputHtml}</div>
                  </div>
              `;
            }).join('');
        }

        function renderMcConfig(props) {
            const grid = document.getElementById('mc-config-grid');

            // Definición de campos importantes con su tipo y label
            const fields = [
                { key: 'gamemode', label: 'Modo de Juego', type: 'select', options: ['survival', 'creative', 'adventure', 'spectator'], icon: 'gamepad' },
                { key: 'difficulty', label: 'Dificultad', type: 'select', options: ['peaceful', 'easy', 'normal', 'hard'], icon: 'skull' },
                { key: 'online-mode', label: 'Modo Online (Premium)', type: 'switch', icon: 'globe', desc: 'Desactivar para permitir usuarios No-Oficiales (Cracked).' },
                { key: 'white-list', label: 'Whitelist', type: 'switch', icon: 'list-check' },
                { key: 'pvp', label: 'PVP', type: 'switch', icon: 'hand-fist' },
                { key: 'max-players', label: 'Máximo de Jugadores', type: 'number', icon: 'users' },
                { key: 'spawn-protection', label: 'Protección de Spawn', type: 'number', icon: 'shield' },
                { key: 'view-distance', label: 'Distancia de Visión', type: 'number', icon: 'eye' },
                { key: 'allow-flight', label: 'Permitir Vuelo', type: 'switch', icon: 'plane' },
                { key: 'enable-command-block', label: 'Bloques de Comandos', type: 'switch', icon: 'terminal' },
                { key: 'spawn-monsters', label: 'Generar Monstruos', type: 'switch', icon: 'ghost' },
                { key: 'spawn-animals', label: 'Generar Animales', type: 'switch', icon: 'paw' },
                { key: 'hardcore', label: 'Modo Hardcore', type: 'switch', icon: 'skull-crossbones' },
                { key: 'force-gamemode', label: 'Forzar Modo de Juego', type: 'switch', icon: 'wand-magic-sparkles' },
                { key: 'enforce-whitelist', label: 'Forzar Whitelist', type: 'switch', icon: 'user-check' }
            ];

            grid.innerHTML = fields.map(f => {
                const val = props[f.key] || '';
                let inputHtml = '';

                if (f.type === 'switch') {
                    const checked = val === 'true' ? 'checked' : '';
                    inputHtml = `
                      <label class="switch">
                          <input type="checkbox" id="mc-prop-${f.key}" ${checked} ${rnBind("change", (event, element) => { updateMcProp((f.key), element.checked) })}>
                          <span class="slider round"></span>
                      </label>
                  `;
                } else if (f.type === 'select') {
                    inputHtml = `
                      <select class="input" id="mc-prop-${f.key}" ${rnBind("change", (event, element) => { updateMcProp((f.key), element.value) })} style="margin:0; padding: 8px 12px;">
                          ${f.options.map(opt => `<option value="${opt}" ${val === opt ? 'selected' : ''}>${opt.charAt(0).toUpperCase() + opt.slice(1)}</option>`).join('')}
                      </select>
                  `;
                } else {
                    inputHtml = `
                      <input type="number" class="input" id="mc-prop-${f.key}" value="${val}" ${rnBind("change", (event, element) => { updateMcProp((f.key), element.value) })} style="margin:0; padding: 8px 12px; width: 80px; text-align: center;">
                  `;
                }

                return `
                  <div class="card" style="display: flex; align-items: center; justify-content: space-between; padding: 20px;">
                      <div style="display: flex; align-items: center; gap: 15px;">
                          <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(255,255,255,0.03); display: flex; align-items: center; justify-content: center; color: var(--primary);">
                              <i class="fa-solid fa-${f.icon}"></i>
                          </div>
                          <div>
                              <div style="font-weight: 700; font-size: 0.95rem;">${f.label}</div>
                              <div class="muted" style="font-size: 0.75rem;">${f.desc || f.key}</div>
                          </div>
                      </div>
                      <div>${inputHtml}</div>
                  </div>
              `;
            }).join('');
        }

        function updateMcProp(key, value) {
            currentGameConfig[key] = value.toString();
        }

        function renderRustConfig(props) {
            const grid = document.getElementById('mc-config-grid');
            const fields = [
                { key: 'server.hostname', label: 'Nombre del Servidor', type: 'text', icon: 'signature' },
                { key: 'server.description', label: 'Descripción', type: 'text', icon: 'align-left' },
                { key: 'server.maxplayers', label: 'Máx. Jugadores', type: 'number', icon: 'users' },
                { key: 'server.url', label: 'Sitio Web', type: 'text', icon: 'globe' },
                { key: 'server.headerimage', label: 'Imagen Banner (URL)', type: 'text', icon: 'image' },
                { key: 'server.pve', label: 'Modo PVE', type: 'switch', icon: 'shield-heart' },
                { key: 'server.seed', label: 'Semilla (Seed)', type: 'number', icon: 'seedling' },
                { key: 'server.worldsize', label: 'Tamaño del Mapa', type: 'number', icon: 'map' },
                { key: 'wipe.schedule', label: 'Programador de Wipes (Cron)', type: 'text', icon: 'calendar-xmark' },
                { key: 'wipe.type', label: 'Tipo de Wipe (map / full)', type: 'text', icon: 'skull-crossbones' },
                { key: 'server.radiation', label: 'Radiación', type: 'switch', icon: 'radiation' },
                { key: 'chat.enabled', label: 'Chat Habilitado', type: 'switch', icon: 'comments' },
                { key: 'server.saveinterval', label: 'Intervalo de Guardado (s)', type: 'number', icon: 'floppy-disk' },
                { key: 'decay.scale', label: 'Escala de Decaimiento', type: 'number', step: '0.1', icon: 'hourglass-end' },
                { key: 'server.globalchat', label: 'Chat Global', type: 'switch', icon: 'earth-americas' }
            ];

            grid.innerHTML = fields.map(f => {
                const val = props[f.key] || '';
                let inputHtml = '';

                if (f.type === 'switch') {
                    const checked = val === 'true' || val === 'True' ? 'checked' : '';
                    inputHtml = `<label class="switch"><input type="checkbox" ${checked} ${rnBind("change", (event, element) => { updateMcProp((f.key), element.checked ? 'true' : 'false') })}><span class="slider round"></span></label>`;
                } else {
                    inputHtml = `<input type="${f.type || 'text'}" class="input" value="${val}" ${rnBind("change", (event, element) => { updateMcProp((f.key), element.value) })} style="margin:0; padding: 8px 12px; width: ${f.type === 'number' ? '120px' : '250px'};">`;
                }

                return `
                  <div class="card" style="display: flex; align-items: center; justify-content: space-between; padding: 20px;">
                      <div style="display: flex; align-items: center; gap: 15px;">
                          <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(251,191,36,0.1); display: flex; align-items: center; justify-content: center; color: #fbbf24;">
                              <i class="fa-solid fa-${f.icon}"></i>
                          </div>
                          <div>
                              <div style="font-weight: 700; font-size: 0.95rem;">${f.label}</div>
                              <div class="muted" style="font-size: 0.75rem;">${f.key}</div>
                          </div>
                      </div>
                      <div>${inputHtml}</div>
                  </div>
              `;
            }).join('');
        }

        function renderPalworldConfig(props) {
            const grid = document.getElementById('mc-config-grid');

            const fields = [
                { key: 'ExpRate', label: 'Multiplicador de EXP', type: 'number', step: '0.1', icon: 'bolt' },
                { key: 'PalCaptureRate', label: 'Ratio de Captura', type: 'number', step: '0.1', icon: 'hand-sparkles' },
                { key: 'PalSpawnNumRate', label: 'Densidad de Pals', type: 'number', step: '0.1', icon: 'ghost' },
                { key: 'DeathPenalty', label: 'Penalización por Muerte', type: 'select', options: ['None', 'Item', 'ItemAndEquipment', 'All'], icon: 'skull' },
                { key: 'bEnablePlayerToPlayerDamage', label: 'PVP (Daño entre jugadores)', type: 'switch', icon: 'swords' },
                { key: 'bEnableInvaderEnemy', label: 'Invasiones (Raids)', type: 'switch', icon: 'shield-virus' },
                { key: 'BuildObjectDeteriorationDamageRate', label: 'Deterioro de Bases', type: 'number', step: '0.1', icon: 'hammer' },
                { key: 'CollectionDropRate', label: 'Ratio de Recolección', type: 'number', step: '0.1', icon: 'wheat-awn' },
                { key: 'EnemyDropItemRate', label: 'Drop de Enemigos', type: 'number', step: '0.1', icon: 'box-open' },
                { key: 'bIsMultiplay', label: 'Multiplayer', type: 'switch', icon: 'users' },
                { key: 'bIsPvP', label: 'Modo PVP Global', type: 'switch', icon: 'gun' },
                { key: 'bEnableNonLoginPenalty', label: 'Penalización No-Login', type: 'switch', icon: 'clock' },
                { key: 'AdminPassword', label: 'Contraseña Admin', type: 'text', icon: 'key' },
                { key: 'ServerPassword', label: 'Contraseña Servidor', type: 'text', icon: 'lock' },
                { key: 'PalEggHatchingTime', label: 'Tiempo Eclosión Huevos (h)', type: 'number', step: '0.1', icon: 'egg' },
                { key: 'GuildPlayerMaxNum', label: 'Máx. Jugadores por Gremio', type: 'number', icon: 'users-viewfinder' },
                { key: 'AutoMaintenanceCron', label: 'Limpieza Anti-Memory Leaks (Cron)', type: 'text', icon: 'memory' }
            ];

            grid.innerHTML = fields.map(f => {
                const val = props[f.key] || '';
                let inputHtml = '';

                if (f.type === 'switch') {
                    const checked = val === 'True' || val === 'true' ? 'checked' : '';
                    inputHtml = `<label class="switch"><input type="checkbox" ${checked} ${rnBind("change", (event, element) => { updateMcProp((f.key), element.checked ? 'True' : 'False') })}><span class="slider round"></span></label>`;
                } else if (f.type === 'select') {
                    inputHtml = `<select class="input" ${rnBind("change", (event, element) => { updateMcProp((f.key), element.value) })} style="margin:0; padding: 8px 12px;">
                      ${f.options.map(opt => `<option value="${opt}" ${val === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                  </select>`;
                } else {
                    inputHtml = `<input type="${f.type || 'number'}" step="${f.step || '1'}" class="input" value="${val}" ${rnBind("change", (event, element) => { updateMcProp((f.key), element.value) })} style="margin:0; padding: 8px 12px; width: 120px; text-align: center;">`;
                }

                return `
                  <div class="card" style="display: flex; align-items: center; justify-content: space-between; padding: 20px;">
                      <div style="display: flex; align-items: center; gap: 15px;">
                          <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(244,114,182,0.1); display: flex; align-items: center; justify-content: center; color: #f472b6;">
                              <i class="fa-solid fa-${f.icon}"></i>
                          </div>
                          <div>
                              <div style="font-weight: 700; font-size: 0.95rem;">${f.label}</div>
                              <div class="muted" style="font-size: 0.75rem;">${f.key}</div>
                          </div>
                      </div>
                      <div>${inputHtml}</div>
                  </div>
              `;
            }).join('');
        }

        function renderCS2Config(props) {
            const grid = document.getElementById('mc-config-grid');
            const fields = [
                { key: 'hostname', label: 'Nombre del Servidor', type: 'text', icon: 'crosshairs' },
                { key: 'sv_password', label: 'Contrase\u00f1a Privada', type: 'text', icon: 'lock' },
                { key: 'rcon_password', label: 'Contrase\u00f1a RCON', type: 'text', icon: 'terminal' },
                { key: 'mp_maxrounds', label: 'Rondas M\u00e1ximas', type: 'number', icon: 'trophy' },
                { key: 'tv_enable', label: 'GOTV Repeticiones (Demos)', type: 'switch', icon: 'video' },
                { key: 'mp_roundtime', label: 'Tiempo de Ronda (min)', type: 'number', step: '0.01', icon: 'clock' },
                { key: 'sv_cheats', label: 'Habilitar Cheats', type: 'switch', icon: 'ghost' },
                { key: 'sv_lan', label: 'Modo LAN', type: 'switch', icon: 'network-wired' },
                { key: 'mp_autoteambalance', label: 'Auto-Balance', type: 'switch', icon: 'scale-balanced' },
                { key: 'mp_limitteams', label: 'L\u00edmite de Equipos', type: 'number', icon: 'users-slash' },
                { key: 'mp_freezetime', label: 'Tiempo de Congelaci\u00f3n (s)', type: 'number', icon: 'snowflake' },
                { key: 'mp_buytime', label: 'Tiempo de Compra (s)', type: 'number', icon: 'cart-shopping' },
                { key: 'mp_startmoney', label: 'Dinero Inicial ($)', type: 'number', icon: 'money-bill-1' }
            ];

            grid.innerHTML = fields.map(f => {
                const val = props[f.key] !== undefined ? props[f.key] : '';
                let inputHtml = '';
                if (f.type === 'switch') {
                    const checked = val === '1' || val === 'true' ? 'checked' : '';
                    inputHtml = `<label class="switch"><input type="checkbox" ${checked} ${rnBind("change", (event, element) => { updateMcProp((f.key), element.checked ? '1' : '0') })}><span class="slider round"></span></label>`;
                } else {
                    const w = f.type === 'number' ? '120px' : '250px';
                    inputHtml = `<input type="${f.type}" step="${f.step || '1'}" class="input" value="${val}" ${rnBind("change", (event, element) => { updateMcProp((f.key), element.value) })} style="margin:0;padding:8px 12px;width:${w};">`;
                }
                return `<div class="card" style="display:flex;align-items:center;justify-content:space-between;padding:20px;">
                  <div style="display:flex;align-items:center;gap:15px;">
                      <div style="width:40px;height:40px;border-radius:10px;background:rgba(59,130,246,0.1);display:flex;align-items:center;justify-content:center;color:#3b82f6;">
                          <i class="fa-solid fa-${f.icon}"></i>
                      </div>
                      <div>
                          <div style="font-weight:700;font-size:0.95rem;">${f.label}</div>
                          <div class="muted" style="font-size:0.75rem;">${f.key}</div>
                      </div>
                  </div>
                  <div>${inputHtml}</div>
              </div>`;
            }).join('');
        }

        function renderValheimConfig(props) {
            const grid = document.getElementById('mc-config-grid');
            const fields = [
                { key: 'SERVER_NAME', label: 'Nombre del Servidor', type: 'text', icon: 'helmet-safety' },
                { key: 'SERVER_PASS', label: 'Contraseña', type: 'text', icon: 'lock' },
                { key: 'WORLD_NAME', label: 'Nombre del Mundo', type: 'text', icon: 'earth-europe' },
                { key: 'SERVER_PUBLIC', label: 'Servidor Público', type: 'switch', icon: 'eye' },
                { key: 'BEPINEX', label: 'Soporte BepInEx (Plugins)', type: 'switch', icon: 'puzzle-piece' },
                { key: 'VALHEIM_PLUS', label: 'Valheim Plus Mod', type: 'switch', icon: 'plus-circle' },
                { key: 'BACKUPS', label: 'Copias de Seguridad (Auto)', type: 'switch', icon: 'cloud-arrow-up' },
                { key: 'WORLD_BACKUPS_CRON', label: 'Backups de Mundo (Cron)', type: 'text', icon: 'cloud-arrow-up' },
                { key: 'UPDATE_CRON', label: 'Horario Actualización (Cron)', type: 'text', icon: 'clock' },
                { key: 'SERVER_ARGS', label: 'Args Extra (ej: -crossplay)', type: 'text', icon: 'terminal' },
            ];
            grid.innerHTML = fields.map(f => {
                const val = props[f.key] !== undefined ? props[f.key] : '';
                let inputHtml = '';
                if (f.type === 'switch') {
                    const checked = val === '1' || val === 'true' ? 'checked' : '';
                    inputHtml = `<label class="switch"><input type="checkbox" ${checked} ${rnBind("change", (event, element) => { updateMcProp((f.key), element.checked ? '1' : '0') })}><span class="slider round"></span></label>`;
                } else {
                    inputHtml = `<input type="text" class="input" value="${val}" ${rnBind("change", (event, element) => { updateMcProp((f.key), element.value) })} style="margin:0;padding:8px 12px;width:250px;">`;
                }
                return `<div class="card" style="display:flex;align-items:center;justify-content:space-between;padding:20px;">
                  <div style="display:flex;align-items:center;gap:15px;">
                      <div style="width:40px;height:40px;border-radius:10px;background:rgba(99,102,241,0.12);display:flex;align-items:center;justify-content:center;color:#6366f1;">
                          <i class="fa-solid fa-${f.icon}"></i>
                      </div>
                      <div><div style="font-weight:700;font-size:0.95rem;">${f.label}</div><div class="muted" style="font-size:0.75rem;">${f.key}</div></div>
                  </div>
                  <div>${inputHtml}</div>
              </div>`;
            }).join('');
        }

        function renderZomboidConfig(props) {
            const grid = document.getElementById('mc-config-grid');
            const fields = [
                { key: 'PublicName', label: 'Nombre del Servidor', type: 'text', icon: 'skull' },
                { key: 'Password', label: 'Contraseña', type: 'text', icon: 'lock' },
                { key: 'MaxPlayers', label: 'Jugadores Máximos', type: 'number', icon: 'users' },
                { key: 'Map', label: 'Mapa', type: 'text', icon: 'map' },
                { key: 'PVP', label: 'PvP Activado', type: 'switch', icon: 'gun' },
                { key: 'GlobalChat', label: 'Chat Global', type: 'switch', icon: 'comments' },
                { key: 'Open', label: 'Servidor Abierto', type: 'switch', icon: 'door-open' },
                { key: 'SaveWorldEveryMinutes', label: 'Guardado Automático (min)', type: 'number', icon: 'floppy-disk' },
                { key: 'SoftResetCron', label: 'Mantenimiento Automático (Soft Reset)', type: 'text', icon: 'broom' },
                { key: 'ServerWelcomeMessage', label: 'Mensaje de Bienvenida', type: 'text', icon: 'message' },
                { key: 'HoursForLootRespawn', label: 'Respawn de Botín (Horas)', type: 'number', icon: 'box-open' },
                { key: 'AllowDestructionByAdmin', label: 'Destrucción por Admin', type: 'switch', icon: 'hammer' }
            ];
            grid.innerHTML = fields.map(f => {
                const val = props[f.key] !== undefined ? props[f.key] : '';
                let inputHtml = '';
                if (f.type === 'switch') {
                    const checked = val === 'true' || val === '1' ? 'checked' : '';
                    inputHtml = `<label class="switch"><input type="checkbox" ${checked} ${rnBind("change", (event, element) => { updateMcProp((f.key), element.checked ? 'true' : 'false') })}><span class="slider round"></span></label>`;
                } else {
                    const w = f.type === 'number' ? '100px' : '250px';
                    inputHtml = `<input type="${f.type}" class="input" value="${val}" ${rnBind("change", (event, element) => { updateMcProp((f.key), element.value) })} style="margin:0;padding:8px 12px;width:${w};">`;
                }
                return `<div class="card" style="display:flex;align-items:center;justify-content:space-between;padding:20px;">
                  <div style="display:flex;align-items:center;gap:15px;">
                      <div style="width:40px;height:40px;border-radius:10px;background:rgba(34,197,94,0.1);display:flex;align-items:center;justify-content:center;color:#22c55e;">
                          <i class="fa-solid fa-${f.icon}"></i>
                      </div>
                      <div><div style="font-weight:700;font-size:0.95rem;">${f.label}</div><div class="muted" style="font-size:0.75rem;">${f.key}</div></div>
                  </div>
                  <div>${inputHtml}</div>
              </div>`;
            }).join('');
        }

        function renderARKConfig(props) {
            const grid = document.getElementById('mc-config-grid');
            const categories = [
                {
                    name: 'Platform Options',
                    icon: 'gamepad',
                    desc: 'Selecciona qué plataformas pueden unirse a tu servidor. Debe seleccionarse al menos 1 opción. La elección de la plataforma afecta al soporte de mods. La compatibilidad con todos los mods sólo es posible cuando PC (Steam) es la única plataforma activa, mientras que las plataformas activas que no son PC (Microsoft, Xbox y PlayStation) limitan la compatibilidad a los mods crossplay. Al seleccionar y guardar plataformas que no sean PC (Microsoft, Xbox y PlayStation) se eliminarán los mods activos que no sean crossplay de la lista de mods activos al reiniciar el servidor o acceder al menú de mods de Curseforge.',
                    fields: [
                        { key: 'PlatformSteam', label: 'PC (Steam)', type: 'switch', icon: 'desktop' },
                        { key: 'PlatformWindows', label: 'Windows (Microsoft Store)', type: 'switch', icon: 'windows' },
                        { key: 'PlatformXbox', label: 'XBOX', type: 'switch', icon: 'xbox' },
                        { key: 'PlatformPS5', label: 'PS5', type: 'switch', icon: 'playstation' }
                    ]
                },
                {
                    name: 'Configuración base',
                    icon: 'sliders',
                    fields: [
                        { key: 'SessionName', label: 'Nombre del servidor', type: 'text', icon: 'signature', desc: 'Ingresa el nombre de tu servidor' },
                        { key: 'ServerPassword', label: 'Contraseña del servidor', type: 'text', icon: 'lock', desc: 'Si deseas proteger tu servidor con una contraseña, por favor ingrésala aquí.' },
                        { key: 'ServerAdminPassword', label: 'Contraseña del Admin', type: 'text', icon: 'key', desc: 'Esta contraseña es necesaria para el control de tu servidor.' },
                        { key: 'MessageOfTheDay', label: 'Mensaje del día (MOTD)', type: 'text', icon: 'comment-dots', desc: 'Configura el mensaje del día' },
                        { key: 'MessageOfTheDayDuration', label: 'Duración del MOTD', type: 'number', icon: 'stopwatch', desc: 'Especifica cuántos segundos se visualiza el mensaje del día.' },
                        { key: 'MapName', label: 'Nombre del mapa', type: 'select', options: ['TheIsland_WP', 'ScorchedEarth_WP', 'TheCenter_WP', 'Ragnarok', 'Astraeos (Mod map)', 'Svarthalfheim', 'custom'], icon: 'map', desc: 'Establece el mapa con el que se ejecuta el servidor.' },
                        { key: 'CustomMapName', label: 'Nombre de mapa personalizado', type: 'text', icon: 'map-pin', desc: 'Introduce el nombre del mapa personalizado que encontrarás en la página de mods de CurseForge. La opción Nombre del mapa debe estar configurada como "custom".' },
                        { key: 'RestartCountdown', label: 'Cuenta atrás de reinicio', type: 'number', icon: 'clock', desc: 'Cuenta atrás en segundos antes de que un servidor de juegos se reinicie o se detenga.' },
                        { key: 'AutoSavePeriodMinutes', label: 'Intervalo de guardado automático', type: 'number', icon: 'floppy-disk', desc: 'Define el intervalo en minutos en el que el servidor guarda automáticamente el juego.' },
                        { key: 'bItemDupeCheck', label: 'Comprobación de Duplicación de Ítems', type: 'switch', icon: 'shield-halved', desc: 'Habilita protección adicional contra duplicaciones.' },
                        { key: 'bServerGameLog', label: 'Log de juego', type: 'switch', icon: 'file-lines', desc: 'Habilita el archivo de registro de jugabilidad para el servidor' },
                        { key: 'bAutoRestartOnUpdate', label: 'Auto reiniciar al ser actualizado.', type: 'switch', icon: 'rotate', desc: 'Si se activa, el server se reiniciará automáticamente cuando sea actualizado.' },
                        { key: 'bBattlEye', label: 'Habilitar BattlEye', type: 'switch', icon: 'eye', desc: 'Habilitar el motor anti-cheat BattlEye.' },
                        { key: 'bDisableCustomCosmeticSystem', label: 'Desactivar Sistema de Cosmética Personalizada', type: 'switch', icon: 'wand-magic-sparkles', desc: 'Desactiva el sistema de cosméticos personalizados.' },
                        { key: 'bFixThrallStats', label: 'Fix Thrall Stats', type: 'switch', icon: 'wrench', desc: 'Enables a retroactive fix that resets levels and redistributes stats on thralls.' }
                    ]
                },
                {
                    name: 'Event',
                    icon: 'calendar-day',
                    fields: [
                        { key: 'OfficialServerRates', label: 'Aplicar tasas del servidor oficial', type: 'select', options: ['Desactivado', 'Activado'], icon: 'bolt', desc: 'Aplica las tasas dinámicas del servidor oficial.' },
                        { key: 'EventColors', label: 'Event Colors', type: 'select', options: ['None', 'Olympic (-OlympicColors)', 'Summer (-SummerColors)', 'Easter (-EasterColors)', 'WinterWondeland (-WinterColors)', 'FearEvolved (-HalloweenColors)', 'Valentines (-vdayColors)', 'Anniversary (-bdayColors)'], icon: 'palette', desc: 'Select the event colors for your server.' },
                        { key: 'ActiveEvent', label: 'Activar Evento', type: 'select', options: ['None', 'Extra Life', 'Easter', 'Summer', 'Halloween', 'Winter', 'Valentines', 'Anniversary'], icon: 'star', desc: 'Establece el evento activo en el servidor.' }
                    ]
                },
                {
                    name: 'Club ARK',
                    icon: 'store',
                    fields: [
                        { key: 'HexagonRewardMultiplier', label: 'Hexagon Reward Multiplier', type: 'number', step: '10', icon: 'coins', desc: 'Scales the missions score hexagon rewards.' },
                        { key: 'HexagonCostMultiplier', label: 'Hexagon Cost Multiplier', type: 'number', step: '10', icon: 'tag', desc: 'Scales the hexagon cost of items in the Hexagon store.' }
                    ]
                },
                {
                    name: 'Backup',
                    icon: 'cloud-arrow-up',
                    fields: [
                        { key: 'BackupToStart', label: 'Comenzar con respaldo', type: 'text', icon: 'clock-rotate-left', desc: 'Elige una copia de seguridad de la lista para iniciar el servidor.' }
                    ]
                },
                {
                    name: 'Admin-Log',
                    icon: 'terminal',
                    fields: [
                        { key: 'bAdminLogChat', label: 'Notifica a los admins sobre el uso de comandos de administrador en el chat', type: 'switch', icon: 'message', desc: 'Solo notifica a los administradores del uso de comandos de administrador en el chat' },
                        { key: 'bIncludeTribeLog', label: 'Incluir registro de tribu', type: 'switch', icon: 'users-between-lines', desc: 'El log de juego del servidor también incluye el log de tribu.' },
                        { key: 'BufferGameLogSize', label: 'Búfer de Log de Juego', type: 'number', icon: 'database', desc: 'Define el tamaño de las filas en los logs de administrador.' }
                    ]
                },
                {
                    name: 'Restricciones',
                    icon: 'ban',
                    fields: [
                        { key: 'bHideDamageFromLogs', label: 'Ocultar Daño de los Logs', type: 'switch', icon: 'eye-slash', desc: 'Oculta las fuentes de daño de los Registros de Tribu.' },
                        { key: 'bDisableDinoItemBlacklist', label: 'Disable Dino Item Blacklist', type: 'switch', icon: 'unlock', desc: 'Disables the Dino item blacklist allowing Dinos to produce eggs outside of their specific base maps.' }
                    ]
                },
                {
                    name: 'Structure',
                    icon: 'hammer',
                    fields: [
                        { key: 'bAlwaysAllowStructurePickup', label: 'Siempre permitir recoger estructuras', type: 'switch', icon: 'hand', desc: 'Permite la recolección permanente de estructuras después de colocarlas.' },
                        { key: 'StructurePickupTimeAfterPlacement', label: 'Tiempo Máximo para Recoger Estructuras Después de Colocarlas', type: 'number', icon: 'hourglass-end', desc: 'Establece el tiempo máximo de recogida de una estructura al ser colocada, en segundos.' },
                        { key: 'StructurePickupHoldDuration', label: 'Duración de recolección de estructura', type: 'number', step: '0.1', icon: 'stopwatch-20', desc: 'Establece la duración general, en segundos, que se tarda en deshacer una estructura' },
                        { key: 'bOverrideStructurePlatformPrevention', label: 'Anulación de prevención de plataforma de estructuras', type: 'switch', icon: 'truck-ramp-box', desc: 'Esta opción permite Auto-Torretas en plataformas distintas de balsas y bases no móviles también.' },
                        { key: 'bEnableAdditionalStructurePreventionVolumes', label: 'Habilitar Volúmenes Adicionales de Prevención de Estructuras', type: 'switch', icon: 'mountain', desc: 'Usa esto para deshabilitar completamente la construcción en áreas específicas ricas en recursos.' },
                        { key: 'bFastDecayUnconnectedCoreStructures', label: 'Rápida degradación de estructuras centrales no conectadas', type: 'switch', icon: 'house-crack', desc: 'Descompone estructuras no vinculadas con una velocidad cinco veces mayor.' },
                        { key: 'bOnlyAutoDestroyCoreStructures', label: 'Solo Destruir Automáticamente Estructuras Centrales', type: 'switch', icon: 'building-shield', desc: 'Evita que cualquier estructura no esencial se autodestruya.' },
                        { key: 'bAutoDestroyStructures', label: 'Destruir Estructuras Automáticamente', type: 'switch', icon: 'bomb', desc: 'Establece esto como verdadero si deseas autodestruir tus estructuras bajo ciertas condiciones.' },
                        { key: 'AutoDestroyOldStructuresMultiplier', label: 'Destrucción automática de estructuras antiguas', type: 'number', step: '0.1', icon: 'calendar-xmark', desc: 'Establece un contador adicional en las estructuras después del cual serán destruidas automáticamente.' },
                        { key: 'bDisableStructurePlacementCollision', label: 'Deshabilitar colisión de estructuras', type: 'switch', icon: 'cubes', desc: 'Habilita esta función para permitir colocar estructuras que se entrelacen con el terreno.' },
                        { key: 'bEnableHardTurretLimit', label: 'Activar límite duro para torretas en el área', type: 'switch', icon: 'gun', desc: 'Esto activa el límite duro de 100 torretas dentro de un radio de 10k unidades.' },
                        { key: 'bSpikeWallsDamageDinos', label: 'Dañar dinosaurios con paredes de pinchos', type: 'switch', icon: 'user-shield', desc: 'Opción para permitir que las paredes de pinchos dañen dinosaurios salvajes o sin jinete.' },
                        { key: 'MaxStructuresInRange', label: 'Estructuras Máximas en Rango', type: 'number', step: '500', icon: 'chart-simple', desc: 'Define el número máximo de estructuras en el rango.' },
                        { key: 'bAllowTeslaCoilsInCavesForPVP', label: 'Allow Tesla Coils In Caves for PVP', type: 'switch', icon: 'bolt', desc: 'Overrides Tesla Coil placement within caves for PVP' },
                        { key: 'DinoTurretDamageMultiplier', label: 'Multiplicador de daño de la torreta del dinosaurio', type: 'number', step: '0.1', icon: 'crosshairs', desc: 'Escala el daño causado por las torretas a los dinosaurios.' },
                        { key: 'StructureResistanceMultiplier', label: 'Multiplicador de Resistencia de Estructuras', type: 'number', step: '0.1', icon: 'shield-cat', desc: 'Define el multiplicador para el daño causado a estructuras.' },
                        { key: 'PlatformSaddleBuildAreaBoundsMultiplier', label: 'Multiplicador de área de construcción de montura de plataforma', type: 'number', step: '0.1', icon: 'expand', desc: 'Multiplicador que amplía o acorta los límites del área de construcción de la montura plataforma.' },
                        { key: 'StructureResourcePreventionRadiusMultiplier', label: 'Multiplicador de Radio de Prevención de Recursos de Estructura', type: 'number', step: '0.1', icon: 'circle-dot', desc: 'Multiplicador para evitar el radio de recursos para estructuras.' }
                    ]
                },
                {
                    name: 'Jugador',
                    icon: 'user',
                    fields: [
                        { key: 'bAllowUnlimitedRespec', label: 'Respecs Ilimitados', type: 'switch', icon: 'rotate', desc: 'Permitir respecs ilimitados.' },
                        { key: 'bAllowCustomRecipes', label: 'Permitir Recetas Personalizadas', type: 'switch', icon: 'utensils', desc: 'Permitir el uso de recetas personalizadas' },
                        { key: 'PlayerWaterDrainMultiplier', label: 'Multiplicador de Drenaje', type: 'number', step: '0.1', icon: 'droplet', desc: 'Define el multiplicador de pérdida de agua de un jugador.' },
                        { key: 'PlayerStarveMultiplier', label: 'Multiplicador de Inanición', type: 'number', step: '0.1', icon: 'bone', desc: 'Define el multiplicador de inanición de un jugador.' },
                        { key: 'PlayerCharacterStaminaDrainMultiplier', label: 'Multiplicador de Estamina', type: 'number', step: '0.1', icon: 'battery-half', desc: 'Define el multiplicador de agotamiento de estamina de los jugadores.' },
                        { key: 'CustomRecipeEffectivenessMultiplier', label: 'Multiplicador de efectividad de receta personalizada', type: 'number', step: '10', icon: 'fire', desc: 'Un número más alto aumenta la efectividad de una receta personalizada.' },
                        { key: 'CustomRecipeSkillMultiplier', label: 'Multiplicador de habilidad de receta personalizada', type: 'number', step: '10', icon: 'mortar-pestle', desc: 'Un número más alto aumenta el efecto del nivel de velocidad de creación de los jugadores.' },
                        { key: 'PlayerHarvestingDamageMultiplier', label: 'Multiplicador de Daño de Recolecta del Jugador', type: 'number', step: '0.1', icon: 'sickle', desc: 'Un número mayor aumenta el daño hecho a un objeto recolectable por un jugador.' },
                        { key: 'PlayerDamageMultiplier', label: 'Multiplicador de Daño del Jugador', type: 'number', step: '0.1', icon: 'fist-raised', desc: 'Modifica el multiplicador para el daño infligido por jugadores.' },
                        { key: 'PlayerResistanceMultiplier', label: 'Multiplicador de Resistencia del Jugador', type: 'number', step: '0.1', icon: 'shield-halved', desc: 'Define el multiplicador para la resistencia de los jugadores.' },
                        { key: 'PlayerCharacterHealthRecoveryMultiplier', label: 'Multiplicador de Regeneración', type: 'number', step: '0.5', icon: 'heart-pulse', desc: 'Define el multiplicador para la recuperación natural de salud del jugador.' },
                        { key: 'CraftingSkillBonusMultiplier', label: 'Bono por mejorar la creación', type: 'number', step: '10', icon: 'hammer', desc: 'Se puede utilizar para modify el bono recibido al mejorar la habilidad de crafteo.' },
                        { key: 'bExclusiveJoin', label: 'Entrada Exclusiva', type: 'switch', icon: 'user-lock', desc: 'Inicia el servidor con la opción de unión exclusiva.' },
                        { key: 'ExclusiveJoinList', label: 'Lista de ingreso exclusivo', type: 'text', icon: 'list-ul', desc: 'Lista de los jugadores que van a poder entrar' },
                        { key: 'bForceCharacterRespec', label: 'Force Character Respec', type: 'switch', icon: 'user-gear', desc: 'Enforces respecking for player characters with stats that exceed their character level.' }
                    ]
                },
                {
                    name: 'Jugabilidad',
                    icon: 'gamepad',
                    fields: [
                        { key: 'ShowMapPlayerLocation', label: 'Mostrar jugadores en el mapa', type: 'switch', icon: 'map-location-dot', desc: 'Si esta configuración está activa, tu posición se mostrará en el mapa del juego.' },
                        { key: 'ImplantSuicideCountdown', label: 'Cuenta regresiva de suicidio del implante', type: 'number', step: '100', icon: 'skull', desc: 'Establece la cuenta regresiva de suicidio del implante.' },
                        { key: 'AllowThirdPersonPlayer', label: 'Permitir Vista en Tercera Persona', type: 'switch', icon: 'camera', desc: 'Permite a los jugadores cambiar a la perspectiva en tercera persona.' },
                        { key: 'bServerCrosshair', label: 'Mirilla del servidor', type: 'switch', icon: 'crosshairs', desc: 'Habilita las miras del lado del servidor.' },
                        { key: 'bCreativeMode', label: 'Modo Creativo', type: 'switch', icon: 'lightbulb', desc: 'Habilitar el modo creativo' },
                        { key: 'bEnableMaxDifficulty', label: 'Habilitar dificultad máxima', type: 'switch', icon: 'triangle-exclamation', desc: 'Habilitar la dificultad máxima.' },
                        { key: 'bJoinNotifications', label: 'Notificaciones de acceso', type: 'switch', icon: 'bell', desc: 'Activa notificaciones de entrada de jugadores.' },
                        { key: 'bStatusNotifications', label: 'Activar notificaciones de estado', type: 'switch', icon: 'circle-info', desc: 'Activa notificaciones de estado en general.' },
                        { key: 'bShowFloatingDamageText', label: 'Mostrar Texto de Daño Flotante', type: 'switch', icon: 'comment-medical', desc: 'Habilitar si se muestran los números de daño flotantes.' },
                        { key: 'bNonPermanentDiseases', label: 'Enfermedades no permanentes', type: 'switch', icon: 'viruses', desc: 'Convierte las enfermedades permanentes en temporales.' },
                        { key: 'bPreventDiseases', label: 'Prevenir enfermedades', type: 'switch', icon: 'shield-virus', desc: 'Los jugadores y las criaturas no pueden enfermarse.' },
                        { key: 'bAllowHitIndicators', label: 'Permitir indicadores de impacto', type: 'switch', icon: 'bullseye', desc: 'Permite indicadores de impacto para ataques a distancia.' },
                        { key: 'OverrideOfficialDifficulty', label: 'Anular la dificultad oficial', type: 'number', step: '1', icon: 'ranking-star', desc: 'Permite anular el nivel de dificultad predeterminado del servidor.' },
                        { key: 'bAllowLootCrateOnStructures', label: 'Permitir la aparición de cajas de loot encima de estructuras.', type: 'switch', icon: 'box-open', desc: 'Permite que las cajas de loot aparezcan desde el aire en estructuras.' },
                        { key: 'bAllowMultipleC4Attached', label: 'Permitir múltiples cargas de C4 adjuntas', type: 'switch', icon: 'bomb', desc: 'Permite que se puedan colocar múltiples cargas de C4 en un solo dino.' },
                        { key: 'bClampItemSpoilingTimes', label: 'Limitará todos los tiempos de caducidad a los tiempos máximos de caducidad de los objetos.', type: 'switch', icon: 'hourglass-end', desc: 'Limitará todos los tiempos de descomposición a los tiempos máximos.' },
                        { key: 'ItemStatsClamp', label: 'Configura el Modificador ItemStatsClamp', type: 'switch', icon: 'sliders', desc: 'Uso en la configuración con ItemStatClamps.' },
                        { key: 'bDisableSpawnAnimation', label: 'Evitar Animación de Spawn', type: 'switch', icon: 'person-rays', desc: 'Se desactivó la animación de aparición.' },
                        { key: 'bWipeAllWildDinos', label: 'Borrar todas las criaturas salvajes', type: 'select', options: ['Desactivado', 'Activado'], icon: 'broom', desc: 'Obliga a reaparecer a todas las criaturas salvajes al reiniciar el servidor.' },
                        { key: 'bDisableAntiSpeedhack', label: 'Desactivar detección Anti Speedhack', type: 'switch', icon: 'person-running', desc: 'Desactiva la detección anti-speedhack con la casilla de verificación.' },
                        { key: 'bAllowFlyerInsideCaves', label: 'Volar dentro de cuevas', type: 'switch', icon: 'compass', desc: 'Permite volar dentro de cuevas.' },
                        { key: 'bAlwaysEnableDedicatedSkeletalMeshes', label: 'Siempre Activar Mallas Esqueléticas Dedicadas', type: 'switch', icon: 'bone', desc: 'Obliga a todas las mallas a siempre ser procesadas.' },
                        { key: 'bDisableLootCrates', label: 'Desactivar cajas de botín', type: 'switch', icon: 'box', desc: 'Desactiva la generación de cajas de botín.' },
                        { key: 'bAllowFastLeveling', label: 'Permitir Nivelación Rápida', type: 'switch', icon: 'angles-up', desc: 'Permitir nivelación rápida.' },
                        { key: 'bEnableMovementSpeedLevelingForFlyers', label: 'Habilitar el aumento de la velocidad de movimiento para voladores', type: 'switch', icon: 'wind', desc: 'Permite aumentar la velocidad de movimiento de los voladores.' },
                        { key: 'bDisablePhotoMode', label: 'Desactivar Modo Foto', type: 'switch', icon: 'camera-retro', desc: 'Desactiva la función de modo foto para capturar capturas de pantalla en el juego.' },
                        { key: 'bDeathBeacon', label: 'Rayo de luz sobre cuerpos muertos', type: 'switch', icon: 'beam-mutt', desc: 'Si está desactivado, impide que los supervivientes vean un haz de luz verde.' },
                        { key: 'bKickIdlePlayers', label: 'Habilitar Expulsión de Jugador Inactivo', type: 'switch', icon: 'user-clock', desc: 'Hace que los personajes inactivos sean expulsados.' },
                        { key: 'KickIdlePlayersPeriod', label: 'Expulsar Jugadores Inactivos', type: 'number', step: '60', icon: 'stopwatch', desc: 'Establece el tiempo en segundos antes de que el servidor expulse a los jugadores por inactividad.' },
                        { key: 'PhotoModeRangeLimit', label: 'Límite de Rango del Modo de Foto', type: 'number', step: '100', icon: 'ruler', desc: 'Define la distancia máxima entre la cámara del modo foto y el jugador.' },
                        { key: 'MaxPlayerXP', label: 'Puntos de experiencia por jugador', type: 'number', step: '1000', icon: 'star', desc: 'La cantidad máxima de puntos de experiencia que un jugador puede alcanzar.' },
                        { key: 'MaxDinoXP', label: 'Puntos de experiencia por dinosaurio', type: 'number', step: '1000', icon: 'dragon', desc: 'Los puntos de experiencia máximos posibles que un dinosaurio puede alcanzar.' },
                        { key: 'ItemStackSizeMultiplier', label: 'Multiplicador de Tamaño de Stack', type: 'number', step: '1', icon: 'layer-group', desc: 'Ajusta el tamaño del apilamiento de objetos.' }
                    ]
                },
                {
                    name: 'Experiencia',
                    icon: 'star',
                    fields: [
                        { key: 'KillXPMultiplier', label: 'Multiplicador de XP por muerte', type: 'number', step: '0.5', icon: 'skull', desc: 'Este multiplicador afecta la cantidad de XP ganada por matar enemigos.' },
                        { key: 'HarvestXPMultiplier', label: 'Multiplicador de XP de Cosecha', type: 'number', step: '0.5', icon: 'sickle', desc: 'Este multiplicador afecta la cantidad de XP para recolección.' },
                        { key: 'CraftXPMultiplier', label: 'Multiplicador de XP de Fabricación', type: 'number', step: '0.5', icon: 'hammer', desc: 'Este multiplicador afecta la cantidad de XP para la creación.' },
                        { key: 'GenericXPMultiplier', label: 'Multiplicador de XP Genérico', type: 'number', step: '0.5', icon: 'hourglass-half', desc: 'Este multiplicador afecta la cantidad de XP con el tiempo.' },
                        { key: 'SpecialXPMultiplier', label: 'Multiplicador de XP Especial', type: 'number', step: '0.5', icon: 'wand-magic', desc: 'Este multiplicador afecta la cantidad de XP para eventos especiales.' },
                        { key: 'ExplorerNoteXPMultiplier', label: 'Multiplicador de XP de Notas de Explorador', type: 'number', step: '0.5', icon: 'book', desc: 'Este multiplicador afecta la cantidad de XP para Notas de Explorador.' },
                        { key: 'BossKillXPMultiplier', label: 'Multiplicador de XP por Matar Jefes', type: 'number', step: '0.5', icon: 'crown', desc: 'Este multiplicador afecta la cantidad de XP por muertes de jefes.' },
                        { key: 'AlphaKillXPMultiplier', label: 'Multiplicador de XP por Alpha Kill', type: 'number', step: '0.5', icon: 'spaghetti-monster-flying', desc: 'Este multiplicador afecta la cantidad de XP por muertes de alfas.' },
                        { key: 'WildDinoKillXPMultiplier', label: 'Multiplicador de XP por Muerte de Animales Salvajes', type: 'number', step: '0.5', icon: 'paw', desc: 'Este multiplicador afecta la cantidad de XP por muertes de criaturas salvajes.' },
                        { key: 'CaveKillXPMultiplier', label: 'Multiplicador de XP por Muerte en Cueva', type: 'number', step: '0.5', icon: 'mountain', desc: 'Este multiplicador afecta la cantidad de XP por muertes en cuevas.' },
                        { key: 'TamedDinoKillXPMultiplier', label: 'Multiplicador de XP para muertes de criaturas domesticadas', type: 'number', step: '0.5', icon: 'heart-crack', desc: 'Este multiplicador afecta la cantidad de XP para los domados muertos.' },
                        { key: 'UnclaimedDinoKillXPMultiplier', label: 'Multiplicador de XP por Muerte de Criaturas no Reclamadas', type: 'number', step: '0.5', icon: 'ghost', desc: 'Este multiplicador afecta a la cantidad de XP por muertes no reclamadas.' }
                    ]
                },
                {
                    name: 'Tribe & Alliance',
                    icon: 'users',
                    fields: [
                        { key: 'bPreventTribeAlliances', label: 'Prevenir alianzas de tribus', type: 'switch', icon: 'user-slash', desc: 'Si está habilitado, no se permiten alianzas entre tribus.' },
                        { key: 'bLogTribeDestroyedEnemyStructures', label: 'Registro de tribus estructuras enemigas destruidas', type: 'switch', icon: 'file-invoice', desc: 'Cambió el registro de destrucción de estructuras enemigas para que no se muestre por defecto.' },
                        { key: 'bAllowTribeWarPvE', label: 'Permitir Guerra de Tribus en PvE', type: 'switch', icon: 'swords', desc: 'Permite que tribus declaren guerra entre sí en PvE' },
                        { key: 'bAllowTribeWarCancelPvE', label: 'Permitir Cancelación de Guerra de Tribus en PvE', type: 'switch', icon: 'xmark', desc: 'Permite la cancelación de una guerra acordada antes de que realmente haya comenzado en el modo PvE.' },
                        { key: 'TribeNameChangeCooldown', label: 'Tiempo de Espera para Cambiar el Nombre de la Tribu', type: 'number', step: '1', icon: 'clock', desc: 'Establecer un bloqueo temporal para cambiar el nombre de la tribu.' },
                        { key: 'MaxTribeLogs', label: 'Número máximo de jugadores en la tribu', type: 'number', step: '1', icon: 'user-group', desc: 'Este es el número máximo de jugadores permitidos dentro de una tribu.' }
                    ]
                },
                {
                    name: 'Saddle',
                    icon: 'horse',
                    fields: [
                        { key: 'bAllowCryofridgeOnSaddle', label: 'Permitir Cryofridge en Montura/Balsa', type: 'switch', icon: 'snowflake', desc: 'Determina si los jugadores pueden colocar una Cryo Fridge en la montura o balsa de una criatura.' },
                        { key: 'bDisableCryopodEnemyCheck', label: 'Deshabilitar Verificación de Enemigos en el Cryopod', type: 'switch', icon: 'shield', desc: 'Comprobaciones de enemigos desactivadas para descongelar domas de criopods.' },
                        { key: 'bDisableCryopodFridgeRequirement', label: 'Deshabilitar Requisitos de Cryofridge', type: 'switch', icon: 'box-open', desc: 'Deshabilitará el requisito de Cryofridge para liberar dinos en cryopods.' },
                        { key: 'CryopodFridgeCooldown', label: 'Tiempo de cooldown de la Cryopod Fridge', type: 'number', step: '5', icon: 'stopwatch', desc: 'Determina el tiempo de cooldown tras el cual se pueden liberar los criopods.' },
                        { key: 'bEnableCryoSicknessPVE', label: 'Habilitar Cryo Sickness para PVE', type: 'switch', icon: 'temperature-empty', desc: 'Habilita la Cryo Sickness para el modo PvE.' },
                        { key: 'bEnableCryopodNerf', label: 'Habilitar CryopodNerf', type: 'switch', icon: 'bolt', desc: 'Habilita la Cryopod Nerf, introduciendo una reducción del daño saliente y aumento del daño entrante.' },
                        { key: 'CryopodNerfDuration', label: 'Duración de la CryopodNerf', type: 'number', step: '1', icon: 'clock', desc: 'Cantidad de tiempo, en segundos, que dura el Cryo Sickness después de desplegar una criatura.' },
                        { key: 'CryopodNerfDamageMultiplier', label: 'Multiplicador de Daño de la CryopodNerf', type: 'number', step: '0.01', icon: 'arrow-down-9-1', desc: 'Regula el daño que las criaturas con Cryo Sickness están infligiendo.' },
                        { key: 'CryopodNerfIncomingDamageMultiplier', label: 'Multiplicador de Daño Recibido por la CryopodNerf', type: 'number', step: '0.1', icon: 'arrow-up-1-9', desc: 'Regula el daño aplicado a las criaturas afectadas por el Cryo Sickness.' },
                        { key: 'bNotAllowNonAlliedDinoBasing', label: 'Not allow non-allied dino basing', type: 'switch', icon: 'plane-slash', desc: 'Las plataformas Quetzal no permitirán que ningún dino no aliado se basee en ellas cuando estén volando.' },
                        { key: 'bAllowMultiFloorsOnPlatformSaddles', label: 'Permitir Múltiples Pisos en Monturas de Plataforma', type: 'switch', icon: 'layer-group', desc: 'Permite más de un piso por plataforma de montura.' },
                        { key: 'PlatformSaddleItemLimitMultiplier', label: 'Modificador de Montura con Plataforma', type: 'number', step: '0.1', icon: 'boxes-stacked', desc: 'Cambia la cantidad de objetos que se unan a una Montura de Plataforma.' }
                    ]
                },
                {
                    name: 'PvE / PvP',
                    icon: 'shield-halved',
                    fields: [
                        { key: 'PvEmode', label: 'PvE', type: 'switch', icon: 'handshake', desc: 'Desactiva el PvP. Ya no será posible atacar a otros jugadores.' },
                        { key: 'bPvETimer', label: 'Temporizador PvE', type: 'switch', icon: 'timer', desc: 'Habilita el temporizador de PvE. Debe desmarcarse para que funcione el PvP.' },
                        { key: 'bUseSystemTime', label: 'Usar Tiempo del Sistema', type: 'switch', icon: 'clock', desc: 'Usar la hora del sistema para el temporizador de PvE. Debe desmarcarse para que funcione el PvP.' },
                        { key: 'AllowFlyerCarryPvE', label: 'Permite que los voladores transporten en modo PvE', type: 'switch', icon: 'plane-departure', desc: 'Activa que las criaturas voladoras puedan llevar otras criaturas salvajes y jugadores en modo PvE.' },
                        { key: 'bPvPStructureDecay', label: 'Deterioro de Estructuras PvP', type: 'switch', icon: 'house-crack', desc: 'Activar la decadencia de estructuras en servidores PvP.' },
                        { key: 'bPreventOfflinePvP', label: 'Prevenir PvP en Modo Offline', type: 'switch', icon: 'user-shield', desc: 'Usa esto para habilitar la prevención de incursiones fuera de línea.' },
                        { key: 'bPvEAllowStructuresAtSupplyDrops', label: 'PvE Permitir estructuras en suministros', type: 'switch', icon: 'box', desc: 'Permitir construcción cerca de los puntos de suministro en modo PvE.' },
                        { key: 'bPvPDinoDecay', label: 'Deterioro de Dinos PvP', type: 'switch', icon: 'skull', desc: 'Activar la descomposición de dinosaurios en servidores PvP.' },
                        { key: 'bDisableFriendlyFire', label: 'Desactivar Fuego Amigo (PvP)', type: 'switch', icon: 'user-group', desc: 'Desactiva el Fuego Amigo entre miembros de la tribu / dinosaurios de la tribu.' },
                        { key: 'SupplyCrateLootQualityMultiplier', label: 'Multiplicador de Calidad de Botín de Cajas de Suministros', type: 'number', step: '100', icon: 'gem', desc: 'Calidad del botín de las cajas de suministros' },
                        { key: 'FishingLootQualityMultiplier', label: 'Multiplicador de Calidad del Botín de Pesca', type: 'number', step: '100', icon: 'fish', desc: 'Calidad del botín de pesca' },
                        { key: 'PreventOfflinePvPInterval', label: 'Intervalo de Prevención de PvP Offline', type: 'number', step: '10', icon: 'stopwatch', desc: 'Tiempo de espera entre la desconexión de una tribu o jugador antes de que sus estructuras o dinosaurios se vuelvan invulnerables.' },
                        { key: 'bActivatePVPRespawnInterval', label: 'Activate PVP Respawn Interval', type: 'switch', icon: 'rotate', desc: 'Activar el Intervalo de Respawn en PVP' },
                        { key: 'IncreasePvPRespawnIntervalCheckPeriod', label: 'Intervalo para la comprobación de Respuesta PvP', type: 'number', step: '10', icon: 'clock', desc: 'Los servidores PvP tienen una reaparición adicional opcional de +1 minuto que se duplica.' },
                        { key: 'IncreasePvPRespawnIntervalMultiplier', label: 'Multiplicador del Intervalo de Respawn PVP', type: 'number', step: '0.5', icon: 'arrow-up-right-dots', desc: 'Multiplicador para el intervalo IncreasePvPRespawnIntervalBaseAmount' },
                        { key: 'IncreasePvPRespawnIntervalBaseAmount', label: 'Aumentar la cantidad base de intervalo de respawn PvP', type: 'number', step: '10', icon: 'plus', desc: 'Los servidores PvP cuentan con una reaparición adicional opcional de +1 minuto.' },
                        { key: 'AutoPvEStartTimeSeconds', label: 'Inicio Automático PvE', type: 'number', step: '100', icon: 'sun', desc: 'Tiempo diurno en segundos hasta activar el AutoPvE.' },
                        { key: 'AutoPvEStopTimeSeconds', label: 'Fin del AutoPvE', type: 'number', step: '100', icon: 'moon', desc: 'Tiempo diurno en segundos hasta desactivar el AutoPvE.' },
                        { key: 'DinoDecayMultiplier', label: 'Multiplicador de Decadencia de Dinos', type: 'number', step: '0.1', icon: 'hourglass-end', desc: 'Valor del multiplicador para la velocidad a la que se marca a un dinosaurio como no reclamado.' }
                    ]
                },
                {
                    name: 'Baby',
                    icon: 'baby',
                    fields: [
                        { key: 'bDisableDinoImprintImprovement', label: 'Desactivar Mejora de la Impresión de Dino', type: 'switch', icon: 'heart-circle-xmark', desc: 'Desactiva el bono de estadísticas del jugador de la marca de dinosaurio.' },
                        { key: 'bAnyoneCanCuddleBabyDino', label: 'Permitir que cualquier persona acune al bebé dinosaurio.', type: 'switch', icon: 'hands-holding-child', desc: 'Usa esto si quieres que CUALQUIERA pueda cuidar de un Baby Dino.' },
                        { key: 'NoWildBabies', label: 'No Wild Babies', type: 'switch', icon: 'ban', desc: 'Sets the command line flag "-NoWildBabies" which prevents wild babies from spawning.' },
                        { key: 'MatingIntervalMultiplier', label: 'Multiplicador del Intervalo de Apareamiento', type: 'number', step: '0.1', icon: 'heart', desc: 'Intervalo de tiempo entre 2 embarazos. Un valor menor disminuye el intervalo de tiempo.' },
                        { key: 'EggHatchSpeedMultiplier', label: 'Multiplicador de velocidad para la incubación de huevos', type: 'number', step: '0.5', icon: 'egg', desc: 'Escala el tiempo necesario para que un huevo fertilizado eclosione.' },
                        { key: 'BabyMatureSpeedMultiplier', label: 'Multiplicador de Velocidad de Maduración de Crías', type: 'number', step: '0.5', icon: 'child', desc: 'Escala la velocidad de maduración de los bebés.' },
                        { key: 'BabyCuddleIntervalMultiplier', label: 'Baby Cuddle Interval Multiplier', type: 'number', step: '0.05', icon: 'clock', desc: 'Controla la frecuencia con la que las crías quieren atención durante la impronta.' },
                        { key: 'BabyCuddleGracePeriodMultiplier', label: 'Baby Cuddle Grace Period Multiplier', type: 'number', step: '0.5', icon: 'hourglass', desc: 'Un multiplicador sobre cuánto tiempo después de retrasar el abrazo antes de que la Calidad comience a disminuir.' },
                        { key: 'BabyCuddleLoseImprintQualitySpeedMultiplier', label: 'Baby Cuddle Lose Imprint Quality Speed Multiplier', type: 'number', step: '0.1', icon: 'arrow-down', desc: 'Un multiplicador sobre qué tan rápido disminuye la Calidad de Imprinting después del período de gracia.' },
                        { key: 'BabyImprintAmountMultiplier', label: 'Baby Imprint Amount Multiplier', type: 'number', step: '0.5', icon: 'chart-line', desc: 'Multiplicador aplicado al porcentaje que proporciona cada impresión.' },
                        { key: 'BabyImprintingStatScaleMultiplier', label: 'Baby Imprinting Stat Scale Multiplier', type: 'number', step: '0.5', icon: 'weight-hanging', desc: 'Cuál es el efecto de la Calidad de Imprinting en las estadísticas.' },
                        { key: 'BabyFoodConsumptionSpeedMultiplier', label: 'Multiplicador de Velocidad de Consumo de Comida de Crías', type: 'number', step: '0.1', icon: 'utensils', desc: 'La rapidez con la que un bebé puede comer.' }
                    ]
                },
                {
                    name: 'Farming',
                    icon: 'tractor',
                    fields: [
                        { key: 'bOptimizeHarvestingAmountMultiplier', label: 'Optimización del servidor del Multiplicador de Cantidad de Cosecha', type: 'switch', icon: 'gauge-high', desc: 'Optimiza el rendimiento del servidor para altas tasas de Multiplicador de Cantidad de Cosecha.' },
                        { key: 'CropGrowthSpeedMultiplier', label: 'Multiplicador de Velocidad de Crecimiento de Cultivos', type: 'number', step: '0.5', icon: 'seedling', desc: 'Ajusta la velocidad a la que crecen los cultivos.' },
                        { key: 'CropDecaySpeedMultiplier', label: 'Multiplicador de Velocidad de Descomposición de Cultivos', type: 'number', step: '0.5', icon: 'leaf', desc: 'Ajusta la velocidad a la que se descomponen los cultivos.' },
                        { key: 'ResourceNoClamp', label: 'Multiplicador de Respawn de Recursos', type: 'number', step: '0.1', icon: 'rotate', desc: 'Ajusta el tiempo que tardan los recursos en reaparecer en el mundo del juego.' },
                        { key: 'StructureResourcePreventionRadiusMultiplier', label: 'Multiplicador de Radio de Prohibición de Regeneración alrededor de Estructuras', type: 'number', step: '0.1', icon: 'building-circle-exclamation', desc: 'Ajusta el radio alrededor de las estructuras donde se impide el reabastecimiento de recursos.' },
                        { key: 'PlayerResourcePreventionRadiusMultiplier', label: 'Multiplicador de Radio de Prohibición de Regeneración alrededor de Jugadores', type: 'number', step: '0.1', icon: 'person-circle-exclamation', desc: 'Ajusta el radio alrededor de los jugadores dentro del cual los recursos no pueden aparecer.' },
                        { key: 'HarvestResourceItemHealthMultiplier', label: 'Multiplicador de Salud de Recursos Recolectables', type: 'number', step: '0.5', icon: 'tree', desc: 'Ajusta la resistencia de los objetos recolectables (árboles, rocas, etc.).' },
                        { key: 'HarvestAmountMultiplier', label: 'Multiplicador de Cantidad de Cosecha', type: 'number', step: '0.5', icon: 'cubes', desc: 'Ajusta la cantidad de recursos recolectados por actividad de recolección.' }
                    ]
                },
                {
                    name: 'Dino',
                    icon: 'dragon',
                    fields: [
                        { key: 'bAllowRaidDinoFeeding', label: 'Permitir la alimentación de "dinos de asalto"', type: 'switch', icon: 'drumstick-bite', desc: 'Permite alimentar "Raid Dinos" (por ejemplo, Titanosaurio) y domarlos permanentemente.' },
                        { key: 'bAutoDestroyDecayedDinos', label: 'Destruir automáticamente dinosaurios deteriorados', type: 'switch', icon: 'skull-crossbones', desc: 'Activa la destrucción automática de criaturas que han alcanzado un estado de deterioro.' },
                        { key: 'bAllowFlyerStaminaRecovery', label: 'Recuperación de stamina mientras vuelas', type: 'switch', icon: 'battery-full', desc: 'Activa la regeneración de estamina mientras vuelas.' },
                        { key: 'bIgnoreMountedWeaponryRestrictionsPVP', label: 'Ignore Mounted Weaponry Restrictions in PVP', type: 'switch', icon: 'gun', desc: 'Rhyniognatha riders will no longer be able to equip weapons while mounted on PvP servers.' },
                        { key: 'DinoCharacterFoodDrainMultiplier', label: 'Multiplicador de Hambre de Dinos', type: 'number', step: '0.1', icon: 'bone', desc: 'Ajusta la velocidad a la que las criaturas consumen comida.' },
                        { key: 'DinoDamageMultiplier', label: 'Multiplicador de Daño de Dinos', type: 'number', step: '0.1', icon: 'tooth', desc: 'Ajusta la producción de daño de las criaturas.' },
                        { key: 'DinoResistanceMultiplier', label: 'Multiplicador de Resistencia de Dinosaurios', type: 'number', step: '0.1', icon: 'shield', desc: 'Ajusta la resistencia de las criaturas al daño.' },
                        { key: 'DinoCharacterStaminaDrainMultiplier', label: 'Multiplicador de Drenaje de Estamina de Dinos', type: 'number', step: '0.1', icon: 'battery-half', desc: 'Ajusta la tasa a la que los dinosaurios o criaturas consumen estamina.' },
                        { key: 'DinoCharacterHealthRecoveryMultiplier', label: 'Multiplicador de Regeneración de Salud de Dinos', type: 'number', step: '0.5', icon: 'heart-pulse', desc: 'Ajusta la velocidad a la que las criaturas regeneran naturalmente su salud.' },
                        { key: 'DinoHarvestingDamageMultiplier', label: 'Multiplicador de Daño de Cosecha de Dinos', type: 'number', step: '0.5', icon: 'sickle', desc: 'Ajusta el rendimiento de daño de los dinosaurios o criaturas al recolectar recursos.' },
                        { key: 'LayEggIntervalMultiplier', label: 'Multiplicador del intervalo de puesta de huevos', type: 'number', step: '0.1', icon: 'egg', desc: 'Ajusta la frecuencia con la que las criaturas ponen huevos.' },
                        { key: 'PoopIntervalMultiplier', label: 'Multiplicador de Intervalo de Caca', type: 'number', step: '0.1', icon: 'poop', desc: 'Ajusta la velocidad a la que las criaturas y los jugadores producen heces.' },
                        { key: 'RaidDinoCharacterFoodDrainMultiplier', label: 'Multiplicador de Consumo de Alimento del Dino de Ataque', type: 'number', step: '0.1', icon: 'utensils', desc: 'Ajusta la velocidad a la que los dinosaurios de asedio consumen comida.' },
                        { key: 'DestroyTamesOverLevelClamp', label: 'Destroy tames over level', type: 'number', step: '100', icon: 'chart-line', desc: 'Permite ajustar el límite de nivel de dino, los servidores oficiales utilizan 450 como límite superior' },
                        { key: 'CosmoWeaponMaxAmmo', label: 'Cosmo Weapon Max Ammo', type: 'number', step: '1', icon: 'gun', desc: 'Sets the maximum ammo for Cosmo Weapon' },
                        { key: 'CosmoWeaponAmmoReloadAmount', label: 'Cosmo Weapon Ammo reload amount', type: 'number', step: '1', icon: 'rotate', desc: 'Sets the ammo reload amount for Cosmo Weapon' },
                        { key: 'KaijuKingSpawnTime', label: 'Kaiju King Spawn time', type: 'text', icon: 'clock', desc: 'Manually set a UTC time for the King Titan world boss spawn time. Requires HH:MM:SS format.' },
                        { key: 'ArmadoggoCooldown', label: 'Armadoggo cooldown', type: 'number', step: '60', icon: 'stopwatch', desc: 'Manually adjust the cooldown for Armadoggo to reappear after taking fatal damage in seconds.' }
                    ]
                },
                {
                    name: 'Mundo',
                    icon: 'globe',
                    fields: [
                        { key: 'GlobalSpoilingTimeMultiplier', label: 'Multiplicador de Descomposición', type: 'number', step: '0.1', icon: 'hourglass-end', desc: 'Modifica los multiplicadores para el deterioro, dependiendo de la tasa anterior.' },
                        { key: 'GlobalItemDecompositionTimeMultiplier', label: 'Multiplicador de Descomposición de Item', type: 'number', step: '0.1', icon: 'trash', desc: 'Define la velocidad de desaparición de los objetos dejados.' },
                        { key: 'GlobalCorpseDecompositionTimeMultiplier', label: 'Multiplicador de Descomposición de Cadáveres', type: 'number', step: '0.1', icon: 'skull', desc: 'Modifica los multiplicadores para la desaparición de cuerpos después de su muerte.' },
                        { key: 'FuelConsumptionIntervalMultiplier', label: 'Multiplicador del Intervalo de Consumo de Combustible', type: 'number', step: '0.1', icon: 'fire-flame-curved', desc: 'Qué tan rápido es el consumo de combustible. Con un valor más alto, el combustible dura más.' }
                    ]
                },
                {
                    name: 'Taming',
                    icon: 'paw',
                    fields: [
                        { key: 'MaxTamedDinos', label: 'Max Dinos Domesticados', type: 'number', step: '100', icon: 'hippo', desc: 'Establecer el número máximo de NPCs domesticados.' },
                        { key: 'bDisableDinoRiding', label: 'Desactivar montar en dinosaurios', type: 'switch', icon: 'ban', desc: 'Opción para desactivar la monta de dinosaurios.' },
                        { key: 'bDisableDinoTaming', label: 'Desactivar doma de dinosaurios', type: 'switch', icon: 'hand-dots', desc: 'Opción para desactivar la doma de dinosaurios.' },
                        { key: 'TamingSpeedMultiplier', label: 'Multiplicador de Velocidad de Domesticación', type: 'number', step: '0.5', icon: 'gauge-high', desc: 'Define el multiplicador para la velocidad de domesticación de dinosaurios.' }
                    ]
                },
                {
                    name: 'Tek Bunker',
                    icon: 'shield-halved',
                    fields: [
                        { key: 'bLimitsBunkerPerTribe', label: 'Limits Bunker per tribe', type: 'switch', icon: 'user-shield', desc: 'Enable Bunker Limits per Tribe' },
                        { key: 'TribeBunkerLimitAmount', label: 'Tribe Bunker Limit Amount', type: 'number', step: '1', icon: 'cubes', desc: 'Sets the bunker limit amount per tribe' },
                        { key: 'bBunkersInPreventionZones', label: 'Bunkers in Prevention Zones', type: 'switch', icon: 'map-pin', desc: 'Toggles if bunkers in prevention zones are allowed' },
                        { key: 'bDinoRidingInsideBunkers', label: 'Dino riding inside bunkers', type: 'switch', icon: 'horse', desc: 'Enables riding with dinos inside bunkers' },
                        { key: 'bBunkerModulesAboveGround', label: 'Bunker Modules above Ground', type: 'switch', icon: 'arrow-up', desc: 'Enables bunker modules above ground' },
                        { key: 'bDinoAIInBunkers', label: 'Dino AI in bunkers', type: 'switch', icon: 'robot', desc: 'Enables Dino AI inside bunkers' },
                        { key: 'bBunkerModulesInPreventionZones', label: 'Bunker Modules in Prevention Zones', type: 'switch', icon: 'triangle-exclamation', desc: 'Enables bunker modules in Prevention zones' },
                        { key: 'MinDistanceBetweenBunkers', label: 'Min Distance Between Bunkers', type: 'number', step: '100', icon: 'ruler', desc: 'Sets the minimum distance between bunkers' },
                        { key: 'EnemyAccessBunkerHPThreshold', label: 'Enemy Access Bunker HP Threshold', type: 'number', step: '0.05', icon: 'heart-crack', desc: 'Sets an HP threshold required for enemies to access bunkers' },
                        { key: 'DamageMultiplierBelowBunkerHPThreshold', label: 'Damage Multiplier Below Bunker HP threshold', type: 'number', step: '0.01', icon: 'burst', desc: 'Sets the damage multiplier if player is below bunker HP threshold' }
                    ]
                },
                {
                    name: 'Cryo Hospital',
                    icon: 'hospital',
                    fields: [
                        { key: 'CryoHospitalHPRegeneration', label: 'Cryo Hospital HP Regeneration', type: 'number', step: '0.1', icon: 'heart-pulse', desc: 'Sets the hours to regenerate HP in Cryo Hospital' },
                        { key: 'CryoHospitalFoodRegeneration', label: 'Cryo Hospital Food Regeneration', type: 'number', step: '1', icon: 'utensils', desc: 'Sets the hours to regenerate food in Cryo Hospital' },
                        { key: 'CryoHospitalTuporDraining', label: 'Cryo Hospital Tupor Draining', type: 'number', step: '0.1', icon: 'droplet-slash', desc: 'Sets the hours to drain topor in Cryo Hospital' },
                        { key: 'CryoHospitalMatingCooldownReduction', label: 'Cryo Hospital Mating Cooldown Reduction', type: 'number', step: '1', icon: 'heart', desc: 'Sets Mating Cooldown Reduction in Cryo Hospital' }
                    ]
                },
                {
                    name: 'Bloodforge',
                    icon: 'fire-burner',
                    fields: [
                        { key: 'BloodforgeReinforceExtraDurability', label: 'Bloodforge Reinforce Extra Durability', type: 'number', step: '0.1', icon: 'shield-plus', desc: 'Sets the extra durability for reinforcements in Bloodforge' },
                        { key: 'BloodforgeReinforceResourceCostMultiplier', label: 'Bloodforge Reinforce Resource Cost Multiplier', type: 'number', step: '0.5', icon: 'coins', desc: 'Sets the Resource cost multiplier for reinforcements in Bloodforge' },
                        { key: 'BloodforgeReinforceSpeedMultiplier', label: 'Bloodforge Reinforce Speed Multiplier', type: 'number', step: '0.1', icon: 'gauge-high', desc: 'Sets the speed multiplier for reinforcements in Bloodforge' }
                    ]
                },
                {
                    name: 'Outposts',
                    icon: 'tower-observation',
                    fields: [
                        { key: 'ActiveOutpostMaximum', label: 'Active Outpost Maximum', type: 'number', step: '1', icon: 'tent', desc: 'Sets the maximum amount of active Outposts' },
                        { key: 'ActiveResourceCashesMaximum', label: 'Active Resource Cashes Maximum', type: 'number', step: '1', icon: 'box', desc: 'Sets the maximum amount of active resource caches' },
                        { key: 'ActiveCityOutpostMaximum', label: 'Active City Outpost Maximum', type: 'number', step: '1', icon: 'city', desc: 'Sets the maximum amount of active city outposts' }
                    ]
                }
            ];

            const clusterCard = `<div class="card" style="grid-column: 1/-1; background: linear-gradient(135deg, rgba(147, 51, 234, 0.1), rgba(79, 70, 229, 0.05)); border: 1px solid rgba(147, 51, 234, 0.2); padding: 25px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px;">
                  <div style="display:flex; align-items:center; gap: 15px;">
                      <div style="width:45px; height:45px; border-radius:12px; background:rgba(147, 51, 234, 0.2); display:flex; align-items:center; justify-content:center; color:#c084fc; font-size: 1.3rem;">
                          <i class="fa-solid fa-circle-nodes"></i>
                      </div>
                      <div>
                          <h3 style="font-size: 1.2rem; font-weight: 800; color: #f3e8ff; margin:0;">Clústeres (Cross-ARK)</h3>
                          <p class="muted" style="margin:0; font-size: 0.85rem;">Enlaza varios servidores bajo el mismo ID para viajar entre mapas con personajes y dinosaurios.</p>
                      </div>
                  </div>
                  <button class="btn" ${rnBind("click", (event, element) => { saveClusterConfig() })} style="background: #c084fc; color: #000; font-weight: 700;"><i class="fa-solid fa-link"></i> Enlazar Clúster</button>
              </div>
              <div style="display:flex; gap: 15px; align-items: center;">
                  <div style="flex-grow:1;">
                      <label class="form-label" style="font-size: 0.75rem; color:#d8b4fe;">Cluster ID</label>
                      <input type="text" id="ark-cluster-id" class="input" placeholder="Ej: micluster_pvp_2026" value="${currentServer.cluster_id || ''}" style="margin:0; padding: 10px 15px; font-family: var(--font-mono); background: rgba(0,0,0,0.4); border-color: rgba(147, 51, 234, 0.3);">
                  </div>
                  <div style="width: 300px;">
                      <label class="form-label" style="font-size: 0.75rem; color:#d8b4fe;">Estado del Volumen</label>
                      <div style="padding: 10px 15px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; font-size: 0.85rem; color: #22c55e; display:flex; align-items:center; gap:8px;">
                          <i class="fa-solid fa-circle-check"></i> Activo y Compartido
                      </div>
                  </div>
              </div>
          </div>`;

            const webhookCard = `<div class="card" style="grid-column: 1/-1; background: linear-gradient(135deg, rgba(88, 101, 242, 0.1), rgba(37, 99, 235, 0.05)); border: 1px solid rgba(88, 101, 242, 0.2); padding: 25px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px;">
                  <div style="display:flex; align-items:center; gap: 15px;">
                      <div style="width:45px; height:45px; border-radius:12px; background:rgba(88, 101, 242, 0.2); display:flex; align-items:center; justify-content:center; color:#93c5fd; font-size: 1.3rem;">
                          <i class="fa-brands fa-discord"></i>
                      </div>
                      <div>
                          <h3 style="font-size: 1.2rem; font-weight: 800; color: #eff6ff; margin:0;">Notificaciones de Discord (Webhooks)</h3>
                          <p class="muted" style="margin:0; font-size: 0.85rem;">Recibe alertas en tiempo real sobre el estado del servidor, conexión de jugadores y copias de seguridad.</p>
                      </div>
                  </div>
                  <button class="btn" ${rnBind("click", (event, element) => { saveWebhookConfig() })} style="background: #5865F2; color: #fff; font-weight: 700;"><i class="fa-solid fa-floppy-disk"></i> Guardar Webhook</button>
              </div>
              <div style="margin-bottom: 15px;">
                  <label class="form-label" style="font-size: 0.75rem; color:#93c5fd;">URL del Webhook de Discord</label>
                  <input type="text" id="discord-webhook-url" class="input" placeholder="https://discord.com/api/webhooks/..." value="${currentServer.discord_webhook_url || ''}" style="margin:0; padding: 10px 15px; font-family: var(--font-mono); background: rgba(0,0,0,0.4); border-color: rgba(88, 101, 242, 0.3);">
              </div>
              <div>
                  <label class="form-label" style="font-size: 0.75rem; color:#93c5fd; margin-bottom: 8px;">Eventos Suscritos</label>
                  <div style="display:flex; gap: 20px; flex-wrap: wrap; background: rgba(0,0,0,0.4); padding: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                      ${['online', 'offline', 'player_join', 'player_leave', 'update'].map(evt => {
                const labels = { online: '🟢 Servidor Iniciado', offline: '🔴 Servidor Detenido', player_join: '👤 Jugador Conectado', player_leave: '👋 Jugador Desconectado', update: '📦 Backups/Mantenimiento' };
                const checked = (Array.isArray(currentServer.discord_webhook_events) ? currentServer.discord_webhook_events : (currentServer.discord_webhook_events ? JSON.parse(currentServer.discord_webhook_events) : ['online', 'offline', 'player_join', 'player_leave', 'update'])).includes(evt) ? 'checked' : '';
                return `<label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;"><input type="checkbox" value="${evt}" class="webhook-event-cb" ${checked}> ${labels[evt]}</label>`;
            }).join('')}
                  </div>
              </div>
          </div>`;

            const searchBarHtml = `
            <div class="card" style="grid-column: 1/-1; background: linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(16, 185, 129, 0.05)); border: 1px solid rgba(34, 197, 94, 0.2); padding: 25px; margin-bottom: 20px;">
                <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                    <div style="width: 45px; height: 45px; border-radius: 12px; background: rgba(34, 197, 94, 0.2); display: flex; align-items: center; justify-content: center; color: #4ade80; font-size: 1.3rem;">
                        <i class="fa-solid fa-sliders"></i>
                    </div>
                    <div>
                        <h3 style="font-size: 1.2rem; font-weight: 800; color: #bbf7d0; margin: 0;">Ajustes de ARK: Survival Ascended</h3>
                        <p class="muted" style="margin: 0; font-size: 0.85rem;">Aquí se pueden realizar los ajustes del servidor. Todos los cambios que realices aquí surtirán efecto después de reiniciar el servidor. Con la barra de búsqueda puedes filtrar todas las configuraciones. Usa espacios para buscar más de una configuración. Puedes utilizar el nombre interno de una configuración para encontrarlo fácilmente.</p>
                    </div>
                </div>
                <div style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap;">
                    <div style="flex-grow: 1; min-width: 300px;">
                        <div class="fm-search-box" style="margin: 0; width: 100%;">
                            <i class="fa-solid fa-magnifying-glass"></i>
                            <input type="text" id="ark-search-input" placeholder="Buscar ajustes ..." ${rnBind("input", (event, element) => { filterArkSettings() })} style="width: 100%; background: transparent; border: none; color: white; padding: 10px 10px 10px 40px; font-size: 0.95rem;" autocomplete="off">
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px; background: rgba(0,0,0,0.4); padding: 10px 20px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                        <label class="switch" style="margin: 0;">
                            <input type="checkbox" id="ark-show-internal-names" ${rnBind("change", (event, element) => { filterArkSettings() })}>
                            <span class="slider round"></span>
                        </label>
                        <span style="font-size: 0.85rem; color: #bbf7d0; font-weight: 600;">Mostrar nombres internos (como en los archivos de configuración)</span>
                    </div>
                </div>
            </div>`;

            const categoriesHtml = categories.map(cat => {
                const fieldsHtml = cat.fields.map(f => {
                    const val = props[f.key] !== undefined ? props[f.key] : '';
                    let inputHtml = '';
                    if (f.type === 'switch') {
                        const checked = val === 'True' || val === 'true' ? 'checked' : '';
                        inputHtml = `<label class="switch"><input type="checkbox" ${checked} ${rnBind("change", (event, element) => { updateMcProp((f.key), element.checked ? 'True' : 'False') })}><span class="slider round"></span></label>`;
                    } else if (f.type === 'select') {
                        inputHtml = `<select class="input" ${rnBind("change", (event, element) => { updateMcProp((f.key), element.value) })} style="margin:0; padding: 8px 12px; background: rgba(0,0,0,0.5); border-color: rgba(255,255,255,0.1); color: white;">${f.options.map(o => `<option value="${o}" ${val == o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
                    } else {
                        const w = f.type === 'number' ? '120px' : '250px';
                        inputHtml = `<input type="${f.type}" step="${f.step || '1'}" class="input" value="${val}" ${rnBind("change", (event, element) => { updateMcProp((f.key), element.value) })} style="margin:0;padding:8px 12px;width:${w}; background: rgba(0,0,0,0.5); border-color: rgba(255,255,255,0.1); color: white;">`;
                    }

                    return `
                    <div class="card ark-setting-card" data-label="${f.label}" data-key="${f.key}" style="display:flex; align-items:center; justify-content:space-between; padding:20px; background: rgba(30, 30, 35, 0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; transition: all 0.2s ease;">
                        <div style="display:flex; align-items:center; gap:15px; flex-grow: 1; padding-right: 20px;">
                            <div style="width:42px; height:42px; border-radius:10px; background:rgba(234,179,8,0.12); display:flex; align-items:center; justify-content:center; color:#eab308; font-size: 1.2rem; flex-shrink: 0;">
                                <i class="fa-solid fa-${f.icon}"></i>
                            </div>
                            <div>
                                <div style="font-weight:700; font-size:0.95rem; color: #f4f4f5;">${f.label}</div>
                                ${f.desc ? `<div class="muted" style="font-size: 0.8rem; margin-top: 2px;">${f.desc}</div>` : ''}
                                <div class="muted ark-setting-key" style="font-size:0.75rem; margin-top: 4px; font-family: var(--font-mono); color: #fde047; display: none;">${f.key}</div>
                            </div>
                        </div>
                        <div style="flex-shrink: 0;">${inputHtml}</div>
                    </div>`;
                }).join('');

                return `
                <div class="ark-category-section" data-category="${cat.name}" style="grid-column: 1/-1; margin-bottom: 30px;">
                    <div style="display: flex; align-items: center; gap: 12px; margin: 20px 0 15px 0; border-bottom: 2px solid rgba(234,179,8,0.2); padding-bottom: 10px;">
                        <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(234,179,8,0.2); display: flex; align-items: center; justify-content: center; color: #facc15; font-size: 1.1rem;">
                            <i class="fa-solid fa-${cat.icon}"></i>
                        </div>
                        <h3 style="font-size: 1.3rem; font-weight: 800; color: #facc15; margin: 0;">${cat.name}</h3>
                    </div>
                    ${cat.desc ? `<p class="muted" style="font-size: 0.85rem; margin-bottom: 15px; background: rgba(0,0,0,0.2); padding: 12px 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">${cat.desc}</p>` : ''}
                    <div class="ark-category-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px;">
                        ${fieldsHtml}
                    </div>
                </div>`;
            }).join('');

            grid.innerHTML = clusterCard + webhookCard + searchBarHtml + categoriesHtml;
        }

        function filterArkSettings() {
            const query = (document.getElementById('ark-search-input')?.value || '').trim().toLowerCase();
            const showInternal = document.getElementById('ark-show-internal-names')?.checked || false;
            const words = query ? query.split(/\s+/) : [];

            document.querySelectorAll('.ark-setting-key').forEach(el => {
                el.style.display = showInternal ? 'block' : 'none';
            });

            document.querySelectorAll('.ark-setting-card').forEach(card => {
                const label = (card.getAttribute('data-label') || '').toLowerCase();
                const key = (card.getAttribute('data-key') || '').toLowerCase();
                const matches = words.every(w => label.includes(w) || key.includes(w));
                card.style.display = matches ? 'flex' : 'none';
            });

            document.querySelectorAll('.ark-category-section').forEach(sec => {
                const visibleCards = sec.querySelectorAll('.ark-setting-card[style*="display: flex"], .ark-setting-card:not([style*="display: none"])');
                sec.style.display = visibleCards.length > 0 ? 'block' : 'none';
            });
        }

        async function saveGameConfig() {
            const s = currentServer;
            const btn = document.getElementById('btn-save-mc-config');
            const original = btn.innerHTML;

            try {
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';

                let endpoint = `/api/minecraft/${s.id}/properties`;
                if (s.template === 'palworld') endpoint = `/api/palworld/config/${s.id}`;
                if (s.template === 'rust') endpoint = `/api/rust/config/${s.id}`;
                if (s.template === 'cs2') endpoint = `/api/cs2/config/${s.id}`;
                if (s.template === 'sdtd') endpoint = `/api/sdtd/config/${s.id}`;
                if (s.template === 'zomboid') endpoint = `/api/zomboid/config/${s.id}`;
                if (s.template === 'ark') endpoint = `/api/ark/config/${s.id}`;
                if (s.template === 'valheim') endpoint = `/api/valheim/config/${s.id}`;

                const res = await Nexus.api(endpoint, {
                    method: 'POST',
                    body: JSON.stringify(currentGameConfig)
                });

                if (res.error) throw new Error(res.error);
                showToast('Configuración guardada. Reinicia el servidor para aplicar cambios.', 'success');
            } catch (e) {
                showToast(e.message, 'danger');
            } finally {
                btn.disabled = false;
                btn.innerHTML = original;
            }
        }

        async function buyScript(id, name, price) {
            if (price <= 0) {
                const html = `
                  <h3 style="margin-bottom: 20px; font-size: 1.2rem;"><i class="fa-solid fa-gift" style="color:var(--success); margin-right:8px;"></i> Obtener Gratis: ${name}</h3>
                  <p class="muted" style="margin-bottom: 25px; font-size: 0.9rem;">Este script es gratuito. Haz clic abajo para añadirlo a tu bóveda de licencias.</p>
                  <div style="background: rgba(99,102,241,0.05); border: 1px dashed var(--primary); padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 0.8rem; color: var(--muted); text-align: left;">
                      <i class="fa-solid fa-circle-info" style="color: var(--primary);"></i> <strong>Instrucciones de uso:</strong> Una vez obtenido, recibirás una licencia Vault™. Deberás insertarla en el archivo de configuración del script (o en tu <code>server.cfg</code> como <code>setr vault_license "TU_LICENCIA"</code>) para activarlo.
                  </div>
                  <button class="btn" style="width: 100%; padding: 15px; font-size: 1.1rem; background: var(--success);" ${rnBind("click", (event, element) => { claimFreeScript((id), (name)) })}>
                      <i class="fa-solid fa-download"></i> Reclamar Ahora
                  </button>
                  <button class="btn-ghost" style="width: 100%; margin-top: 15px;" ${rnBind("click", (event, element) => { closeActionModal() })}>Cancelar</button>
              `;
                openActionModal(html);
                return;
            }


            const html = `
              <h3 style="margin-bottom: 20px; font-size: 1.2rem;"><i class="fa-solid fa-cart-shopping" style="color:var(--primary); margin-right:8px;"></i> Checkout: ${name}</h3>
              <p class="muted" style="margin-bottom: 25px; font-size: 0.9rem;">Estás a un paso de adquirir este recurso premium para tu servidor. El pago es procesado de forma segura por PayPal.</p>

              <div id="paypal-marketplace-button-container" style="min-height: 150px;"></div>

              <button class="btn-ghost" style="width: 100%; margin-top: 15px;" ${rnBind("click", (event, element) => { closeActionModal() })}>Cancelar</button>
          `;
            openActionModal(html);

            try {
                await window.loadPayPalSdk();
            } catch (error) {
                document.getElementById('paypal-marketplace-button-container').innerHTML = '<p class="muted" style="color:var(--warning)">PayPal no esta disponible en este entorno.</p>';
                return;
            }

            setTimeout(() => {
                paypal.Buttons({
                    style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'pay' },
                    createOrder: async function () {
                        try {
                            const res = await fetch(`/api/marketplace/purchase/create-order/${id}`, { method: 'POST' });
                            const data = await res.json();
                            if (data.id) return data.id;
                            throw new Error(data.error || 'Error al crear orden');
                        } catch (e) {
                            showToast(e.message, 'danger');
                        }
                    },
                    onApprove: async function (data) {
                        document.getElementById('paypal-marketplace-button-container').innerHTML = '<div style="text-align:center; padding:20px;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br><p class="muted">Capturando pago y generando licencia...</p></div>';
                        try {
                            const res = await fetch(`/api/marketplace/purchase/capture/${data.orderID}`, { method: 'POST' });
                            const result = await res.json();
                            if (result.success) {
                                openActionModal(`
                                  <div style="text-align: center; padding: 20px;">
                                      <i class="fa-solid fa-circle-check" style="font-size: 4rem; color: var(--success); margin-bottom: 20px;"></i>
                                      <h2 style="margin-bottom: 10px;">¡Adquisición Exitosa!</h2>
                                      <p class="muted">Has adquirido <strong>${name}</strong>.</p>
                                      <div style="margin-top: 30px; background: rgba(0,0,0,0.3); padding: 20px; border-radius: 12px; border: 1px solid var(--primary);">
                                          <div style="font-size: 0.7rem; color: var(--muted); text-transform: uppercase; margin-bottom: 5px;">Tu Licencia de Bóveda (Vault™)</div>
                                          <div style="font-family: monospace; font-size: 1.1rem; color: white; letter-spacing: 1px;">${result.licenseKey}</div>
                                      </div>
                                      <p style="margin-top: 20px; font-size: 0.8rem; color: var(--muted);">Para usar el script, añade <code>setr vault_license "${result.licenseKey}"</code> en tu <code>server.cfg</code> o en la configuración del script.</p>
                                      <button class="btn" style="width: 100%; margin-top: 25px;" ${rnBind("click", (event, element) => { closeActionModal(); switchView('my-licenses', document.getElementById('nav-my-licenses')); })}><i class="fa-solid fa-key"></i> Ir a Mis Licencias para Descargar</button>
                                  </div>
                              `);
                            } else {
                                throw new Error(result.error || 'Error capturando el pago');
                            }
                        } catch (e) {
                            showToast(e.message, 'danger');
                            closeActionModal();
                        }
                    }
                }).render('#paypal-marketplace-button-container');
            }, 100);
        }

        async function claimFreeScript(id, name) {
            try {
                document.querySelector('#action-modal .btn').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Reclamando...';
                document.querySelector('#action-modal .btn').disabled = true;

                const res = await fetch(`/api/marketplace/purchase/claim-free/${id}`, { method: 'POST' });
                const result = await res.json();
                if (result.success) {
                    openActionModal(`
                      <div style="text-align: center; padding: 20px;">
                          <i class="fa-solid fa-circle-check" style="font-size: 4rem; color: var(--success); margin-bottom: 20px;"></i>
                          <h2 style="margin-bottom: 10px;">¡Adquisición Exitosa!</h2>
                          <p class="muted">Has adquirido <strong>${name}</strong>.</p>
                          <div style="margin-top: 30px; background: rgba(0,0,0,0.3); padding: 20px; border-radius: 12px; border: 1px solid var(--success);">
                              <div style="font-size: 0.7rem; color: var(--muted); text-transform: uppercase; margin-bottom: 5px;">Tu Licencia de Bóveda (Vault™)</div>
                              <div style="font-family: monospace; font-size: 1.1rem; color: white; letter-spacing: 1px;">${result.licenseKey}</div>
                          </div>
                          <p style="margin-top: 20px; font-size: 0.8rem; color: var(--muted);">Para usar el script, añade <code>setr vault_license "${result.licenseKey}"</code> en tu <code>server.cfg</code> o en la configuración del script.</p>
                          <button class="btn" style="width: 100%; margin-top: 25px;" ${rnBind("click", (event, element) => { closeActionModal(); switchView('my-licenses', document.getElementById('nav-my-licenses')); })}><i class="fa-solid fa-key"></i> Ir a Mis Licencias para Descargar</button>
                      </div>
                  `);
                } else {
                    throw new Error(result.error || 'Error al reclamar el script');
                }
            } catch (e) {
                showToast(e.message, 'danger');
                closeActionModal();
            }
        }

        function openVendorModal() {
            document.getElementById('modal-vendor').classList.remove('hidden');
        }

        async function submitVendorApplication() {
            const discord = document.getElementById('vendor-discord').value.trim();
            const portfolio = document.getElementById('vendor-portfolio').value.trim();
            const experience = document.getElementById('vendor-experience').value.trim();

            if (!discord) return showToast('El usuario de Discord es obligatorio', 'warning');

            const btn = document.getElementById('btn-submit-vendor');
            btn.disabled = true;
            btn.innerText = 'Enviando...';

            try {
                const res = await Nexus.api('/api/marketplace/apply', {
                    method: 'POST',
                    body: JSON.stringify({ discordUsername: discord, portfolioUrl: portfolio, experience })
                });
                showToast(res.message, 'success');
                closeModal('modal-vendor');
            } catch (e) {
                showToast(e.message || 'Error al enviar postulación', 'danger');
            } finally {
                btn.disabled = false;
                btn.innerText = 'Enviar Postulación';
            }
        }

        // 🏪 VENDOR PORTAL LOGIC
        function openUploadScriptModal() {
            document.getElementById('modal-upload-script').classList.remove('hidden');
        }

        async function submitScriptUpload() {
            const btn = document.getElementById('btn-do-upload');
            const fileInput = document.getElementById('up-script-file');

            if (!fileInput.files[0]) return showToast('Por favor, selecciona un archivo', 'warning');

            const formData = new FormData();
            formData.append('name', document.getElementById('up-script-name').value);
            formData.append('price', document.getElementById('up-script-price').value);
            formData.append('version', document.getElementById('up-script-version').value);
            formData.append('category', document.getElementById('up-script-category').value);
            formData.append('description', document.getElementById('up-script-desc').value);
            formData.append('iconType', document.getElementById('up-script-icon').value);
            formData.append('iconColor', document.getElementById('up-script-color').value);

            const imgUrl = document.getElementById('up-script-image-url')?.value;
            if (imgUrl) formData.append('imageUrl', imgUrl);

            formData.append('scriptFile', fileInput.files[0]);

            btn.disabled = true;
            btn.innerText = 'Subiendo script...';

            try {
                const response = await fetch('/api/marketplace/upload', {
                    method: 'POST',
                    body: formData
                });
                const res = await response.json();
                if (res.success) {
                    showToast(res.message, 'success');
                    closeModal('modal-upload-script');
                    loadVendorScripts();
                    // Reset form
                    document.getElementById('form-upload-script').reset();
                } else {
                    showToast(res.error || 'Error al subir script', 'danger');
                }
            } catch (e) {
                showToast('Error de conexión al subir script', 'danger');
            } finally {
                btn.disabled = false;
                btn.innerText = 'Subir y Publicar';
            }
        }

        async function loadVendorScripts() {
            const list = document.getElementById('vendor-scripts-list');
            if (!list) return;

            try {
                const scripts = await Nexus.api('/api/marketplace/my-scripts');
                if (!scripts || scripts.length === 0) {
                    list.innerHTML = '<p class="muted" style="text-align: center; padding: 20px;">Aún no has publicado ningún script.</p>';
                    return;
                }

                list.innerHTML = scripts.map(s => `
                  <div class="card" style="flex-direction: row; align-items: center; justify-content: space-between; padding: 15px 25px;">
                      <div style="display: flex; align-items: center; gap: 20px;">
                          <div style="width: 50px; height: 50px; border-radius: 10px; background: ${s.icon_color}22; display: flex; align-items: center; justify-content: center;">
                              <i class="fa-solid fa-${s.icon_type || 'cube'}" style="color: ${s.icon_color}; font-size: 1.2rem;"></i>
                          </div>
                          <div>
                              <div style="font-weight: 700; color: white;">${s.name}</div>
                              <div class="muted" style="font-size: 0.75rem;">Version ${s.version} • ${s.category}</div>
                          </div>
                      </div>
                      <div style="text-align: right;">
                          <div style="font-weight: 900; color: white; font-size: 1.1rem;">$${s.price}</div>
                          <div class="badge" style="background: rgba(16, 185, 129, 0.1); color: #34d399; font-size: 0.6rem; padding: 2px 6px;">ACTIVO</div>
                      </div>
                  </div>
              `).join('');
            } catch (e) {
                list.innerHTML = '<p class="muted">Error al cargar tus scripts.</p>';
            }
        }

        // 🏪 MARKETPLACE ADMIN LOGIC
        function openAdminUploadModal() {
            document.getElementById('modal-admin-upload').classList.remove('hidden');
            initAdminDropZone();
        }

        function initAdminDropZone() {
            const zone = document.getElementById('admin-drop-zone');
            if (!zone) return;

            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
                zone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); });
            });

            zone.addEventListener('dragover', () => zone.classList.add('dragover'));
            zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
            zone.addEventListener('drop', e => {
                zone.classList.remove('dragover');
                processAdminUpload(e.dataTransfer.files);
            });
        }

        async function processAdminUpload(files) {
            if (!files || files.length === 0) return;

            const progress = document.getElementById('admin-upload-progress');
            const status = document.getElementById('admin-up-status');
            const bar = document.getElementById('admin-up-bar');
            const pct = document.getElementById('admin-up-pct');

            progress.classList.remove('hidden');

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                status.innerText = `Subiendo: ${file.name} (${i + 1}/${files.length})`;

                const formData = new FormData();
                formData.append('scriptFile', file);

                try {
                    const response = await fetch('/api/marketplace/upload', {
                        method: 'POST',
                        body: formData
                    });
                    const res = await response.json();

                    const progressVal = Math.round(((i + 1) / files.length) * 100);
                    bar.style.width = progressVal + '%';
                    pct.innerText = progressVal + '%';

                    if (res.success) {
                        showToast(`Subido con éxito: ${file.name}`, 'success');
                    } else {
                        showToast(`Error en ${file.name}: ${res.error}`, 'danger');
                    }
                } catch (e) {
                    showToast(`Error de conexión en ${file.name}`, 'danger');
                }
            }

            setTimeout(() => {
                progress.classList.add('hidden');
                bar.style.width = '0%';
                pct.innerText = '0%';
                if (typeof loadMarketplaceScripts === 'function') loadMarketplaceScripts();
                if (typeof loadVendorScripts === 'function') loadVendorScripts();
            }, 2000);
        }

        // 🏪 VENDORS ADMIN MANAGEMENT
        function openAdminVendorsModal() {
            document.getElementById('modal-admin-vendors').classList.remove('hidden');
            loadAdminVendors();
        }

        async function loadAdminVendors() {
            const list = document.getElementById('admin-vendors-list');
            list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--muted);"><i class="fa-solid fa-spinner fa-spin"></i> Cargando solicitudes...</div>';

            try {
                const res = await Nexus.api('/api/admin/vendors');
                if (!res || res.length === 0) {
                    list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--muted);"><i class="fa-solid fa-check-circle" style="color:var(--success);"></i> No hay solicitudes pendientes.</div>';
                    return;
                }

                list.innerHTML = res.map(v => {
                    let badge = `<span style="padding:4px 8px; border-radius:4px; font-size:0.75rem; font-weight:700; background:rgba(255,255,255,0.1);">${v.status.toUpperCase()}</span>`;
                    if (v.status === 'pending') badge = `<span style="padding:4px 8px; border-radius:4px; font-size:0.75rem; font-weight:700; background:rgba(245, 158, 11, 0.2); color:#f59e0b;">PENDIENTE</span>`;
                    if (v.status === 'accepted') badge = `<span style="padding:4px 8px; border-radius:4px; font-size:0.75rem; font-weight:700; background:rgba(16, 185, 129, 0.2); color:#10b981;">ACEPTADO</span>`;
                    if (v.status === 'rejected') badge = `<span style="padding:4px 8px; border-radius:4px; font-size:0.75rem; font-weight:700; background:rgba(239, 68, 68, 0.2); color:#ef4444;">RECHAZADO</span>`;

                    return `
                       <div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); padding:15px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                           <div>
                               <div style="font-weight:700; font-size:1.05rem;">${v.discord_username || v.web_username}</div>
                               <div style="font-size:0.85rem; color:var(--muted); margin-top:4px;">Discord ID/Web: ${v.web_username}</div>
                               <div style="font-size:0.85rem; color:var(--muted);">Portfolio: <a href="${v.portfolio_url}" target="_blank" style="color:#3b82f6;">${v.portfolio_url || 'N/A'}</a></div>
                               <div style="margin-top:8px;">${badge} <span style="font-size:0.75rem; color:var(--muted); margin-left:8px;">${new Date(v.created_at).toLocaleString()}</span></div>
                           </div>
                           <div style="display:flex; gap:8px;">
                               ${v.status === 'pending' ? `
                                   <button class="btn btn-success" style="padding:8px 12px; font-size:0.85rem;" ${rnBind("click", (event, element) => { adminVendorAction((v.id), 'accepted') })}><i class="fa-solid fa-check"></i></button>
                                   <button class="btn btn-danger" style="padding:8px 12px; font-size:0.85rem;" ${rnBind("click", (event, element) => { adminVendorAction((v.id), 'rejected') })}><i class="fa-solid fa-xmark"></i></button>
                               ` : ''}
                           </div>
                       </div>
                   `;
                }).join('');
            } catch (e) {
                list.innerHTML = '<div style="color:var(--danger); padding:20px;">Error cargando solicitudes</div>';
            }
        }

        async function adminVendorAction(id, action) {
            if (!confirm(`¿Estás seguro de que deseas ${action === 'accepted' ? 'ACEPTAR' : 'RECHAZAR'} a este vendedor?`)) return;
            try {
                const res = await Nexus.api(`/api/admin/vendor/${id}/action`, {
                    method: 'POST',
                    body: JSON.stringify({ action })
                });
                if (res.success) {
                    showToast(res.message, 'success');
                    loadAdminVendors();
                } else {
                    showToast(res.error || 'Error procesando solicitud', 'error');
                }
            } catch (e) {
                showToast('Error de conexión', 'error');
            }
        }

        // 📦 UNIFIED MODS ENGINE
        function triggerModSearch() {
            const s = currentServer;
            if (s.template === 'minecraft') searchMcMods();
            else if (s.template === 'valheim') searchValheimMods();
            else if (s.template === 'ark') searchArkMods();
            else if (s.template === 'zomboid') searchZomboidMods();
            else if (s.template === 'rust') searchRustPlugins();
            else if (s.template === 'palworld') searchPalworldMods();
            else if (s.template === 'sdtd') searchSDTDMods();
            else showToast("Búsqueda no disponible para este juego", "warning");
        }

        async function loadGameModsView() {
            const s = currentServer;
            const grid = document.getElementById('mods-grid');
            const title = document.getElementById('mod-view-title');
            const sub = document.getElementById('mod-view-sub');
            const searchContainer = document.getElementById('mod-search-container');

            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 100px;"><i class="fa-solid fa-spinner fa-spin fa-3x" style="color: var(--primary);"></i></div>';

            if (s.template === 'minecraft') {
                title.innerText = "Instalador de Mods (Minecraft)";
                sub.innerText = "Buscando en Modrinth (Fabric/Forge/Quilt)";
                searchContainer.style.display = 'flex';
                searchMcMods(true); // Cargar tendencias automáticamente
            } else if (s.template === 'zomboid') {
                title.innerText = "Workshop de Project Zomboid";
                sub.innerText = "Instala mods de Steam Workshop por su ID.";
                searchContainer.style.display = 'none';
                renderZomboidModTools();
            } else if (s.template === 'rust') {
                title.innerText = "Plugins de Rust (Oxide)";
                sub.innerText = "Instala plugins .cs en la carpeta Oxide.";
                searchContainer.style.display = 'none';
                renderRustModTools();
            } else if (s.template === 'ark') {
                title.innerText = "Instalador de Mods (ARK: Survival Ascended)";
                sub.innerText = "Buscando en CurseForge (Curated Discovery)";
                searchContainer.style.display = 'flex';
                searchArkMods(true);
            } else if (s.template === 'valheim') {
                title.innerText = "Instalador de Mods (Valheim)";
                sub.innerText = "Buscando en Thunderstore (BepInEx Plugins)";
                searchContainer.style.display = 'flex';
                searchValheimMods(true);
            } else if (s.template === 'palworld') {
                title.innerText = "Instalador de Mods (Palworld)";
                sub.innerText = "Buscando en Thunderstore (Mods & Maps)";
                searchContainer.style.display = 'flex';
                searchPalworldMods(true);
            } else if (s.template === 'sdtd') {
                title.innerText = "Instalador de Mods (7 Days to Die)";
                sub.innerText = "Soporte para Modlets (Descubrimiento Curado)";
                searchContainer.style.display = 'flex';
                searchSDTDMods(true);
            } else {
                title.innerText = "Gestor de Mods";
                sub.innerText = "Este juego aún no soporta instalación automática de mods.";
                searchContainer.style.display = 'none';
                grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 100px;"><i class="fa-solid fa-ban fa-3x" style="color: var(--danger); opacity: 0.3;"></i><p class="muted" style="margin-top: 20px;">Usa el Gestor de Archivos para instalar mods manualmente.</p></div>';
            }
        }

        async function renderZomboidModTools() {
            const grid = document.getElementById('mods-grid');

            // Renderizar formulario de instalación
            let html = `
              <div class="card" style="grid-column: 1/-1; padding: 30px;">
                  <h3 style="margin-bottom: 15px;"><i class="fa-brands fa-steam" style="color: #171a21;"></i> Instalar mod de Steam Workshop</h3>
                  <div style="display: flex; gap: 15px; margin-bottom: 20px;">
                      <div style="flex: 1;">
                          <label class="form-label">Workshop ID</label>
                          <input type="text" id="zomboid-workshop-id" class="input" placeholder="Ej: 2686694638">
                      </div>
                      <div style="flex: 1;">
                          <label class="form-label">Mod ID (Nombre técnico)</label>
                          <input type="text" id="zomboid-mod-name" class="input" placeholder="Ej: CommonSense">
                      </div>
                  </div>
                  <button class="btn" style="width: 200px;" ${rnBind("click", (event, element) => { installZomboidMod() })}><i class="fa-solid fa-download"></i> Instalar Mod</button>
              </div>
            `;

            grid.innerHTML = html + `<div style="grid-column: 1/-1; padding: 20px; text-align: center;"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando mods instalados...</div>`;

            try {
                const data = await Nexus.api(`/api/mods/${currentServer.id}`);

                let modsHtml = `<div style="grid-column: 1/-1; margin-top: 20px;"><h3 style="margin-bottom: 15px;">Mods Instalados (${data.activeModNames?.length || 0})</h3></div>`;

                if (data.activeModNames && data.activeModNames.length > 0) {
                    for (let i = 0; i < data.activeModNames.length; i++) {
                        const mName = data.activeModNames[i];
                        const wId = data.activeWorkshopIds[i] || "Desconocido";
                        modsHtml += `
                            <div class="card" style="padding: 20px; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid var(--primary); gap: 15px;">
                                <div style="display: flex; gap: 15px; align-items: center;">
                                    <img src="/api/mods/steam-image/${wId}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);" ${rnBind("error", (event, element) => { element.src='/img/default_steam.png' })} />
                                    <div>
                                        <h4 style="margin: 0 0 5px 0; font-size: 1.1rem;">${mName}</h4>
                                        <p class="muted" style="margin: 0; font-size: 0.9em;"><i class="fa-brands fa-steam"></i> Workshop ID: ${wId}</p>
                                    </div>
                                </div>
                                <button class="btn btn-danger" style="padding: 8px 15px;" ${rnBind("click", (event, element) => { uninstallZomboidMod((wId), (mName)) })}>
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            </div>
                        `;
                    }
                } else {
                    modsHtml += `<div class="card" style="grid-column: 1/-1; padding: 30px; text-align: center;"><p class="muted">No hay mods instalados en este servidor.</p></div>`;
                }

                grid.innerHTML = html + modsHtml;
            } catch (e) {
                grid.innerHTML = html + `<div class="card" style="grid-column: 1/-1; padding: 20px; border-left: 4px solid var(--danger);"><p style="color: var(--danger);">Error cargando mods: ${e.message}</p></div>`;
            }
        }

        async function installZomboidMod() {
            const workshopId = document.getElementById('zomboid-workshop-id').value.trim();
            const modName = document.getElementById('zomboid-mod-name').value.trim();
            if (!workshopId || !modName) return showToast("Faltan datos", "warning");

            showToast("Instalando mod...", "info");
            try {
                await Nexus.api(`/api/mods/${currentServer.id}/zomboid/install`, {
                    method: 'POST',
                    body: JSON.stringify({ workshopId, modName })
                });
                showToast("Mod añadido con éxito. Reinicia el servidor para aplicarlo.", "success");
                renderZomboidModTools();
            } catch (e) { showToast(e.message, "danger"); }
        }

        async function uninstallZomboidMod(workshopId, modName) {
            if (!confirm(`¿Estás seguro de que deseas desinstalar el mod ${modName}?`)) return;

            showToast("Desinstalando mod...", "info");
            try {
                await Nexus.api(`/api/mods/${currentServer.id}/zomboid/uninstall`, {
                    method: 'POST',
                    body: JSON.stringify({ workshopId, modName })
                });
                showToast("Mod desinstalado. Reinicia el servidor para aplicar.", "success");
                renderZomboidModTools();
            } catch (e) { showToast(e.message, "danger"); }
        }

        function renderRustModTools() {
            const grid = document.getElementById('mods-grid');
            grid.innerHTML = `
              <div class="card" style="grid-column: 1/-1; padding: 30px;">
                  <h3 style="margin-bottom: 15px;"><i class="fa-solid fa-flask" style="color: #eab308;"></i> Instalador de Plugins Oxide</h3>
                  <p class="muted" style="margin-bottom: 20px;">Pega la URL directa del archivo .cs (uMod) para instalarlo.</p>
                  <div style="display: flex; gap: 15px; margin-bottom: 20px;">
                      <div style="flex: 1;">
                          <label class="form-label">URL del Plugin (.cs)</label>
                          <input type="text" id="rust-plugin-url" class="input" placeholder="https://umod.org/plugins/GatherManager.cs">
                      </div>
                      <div style="width: 200px;">
                          <label class="form-label">Nombre</label>
                          <input type="text" id="rust-plugin-name" class="input" placeholder="GatherManager">
                      </div>
                  </div>
                  <button class="btn" style="width: 200px;" ${rnBind("click", (event, element) => { installRustPlugin() })}><i class="fa-solid fa-download"></i> Instalar Plugin</button>
              </div>
          `;
        }

        async function installRustPlugin() {
            const pluginUrl = document.getElementById('rust-plugin-url').value.trim();
            const pluginName = document.getElementById('rust-plugin-name').value.trim();
            if (!pluginUrl || !pluginName) return showToast("Faltan datos", "warning");

            showToast("Descargando plugin...", "info");
            try {
                await Nexus.api(`/api/mods/${currentServer.id}/rust/install`, {
                    method: 'POST',
                    body: JSON.stringify({ pluginUrl, pluginName })
                });
                showToast("Plugin instalado correctamente.", "success");
                document.getElementById('rust-plugin-url').value = '';
                document.getElementById('rust-plugin-name').value = '';
            } catch (e) { showToast(e.message, "danger"); }
        }

        function renderArkModTools() {
            const grid = document.getElementById('mods-grid');
            grid.innerHTML = `
              <div class="card" style="grid-column: 1/-1; padding: 30px;">
                  <h3 style="margin-bottom: 15px;"><i class="fa-solid fa-dragon" style="color: #34d399;"></i> Mods de ARK: Survival Ascended</h3>
                  <p class="muted" style="margin-bottom: 20px;">Añade los Mod IDs de CurseForge separados por comas.</p>
                  <div style="margin-bottom: 20px;">
                      <label class="form-label">Mod ID</label>
                      <input type="text" id="ark-mod-id" class="input" placeholder="Ej: 928793">
                  </div>
                  <button class="btn" style="width: 200px;" ${rnBind("click", (event, element) => { installArkMod() })}><i class="fa-solid fa-plus"></i> Añadir Mod</button>
              </div>
          `;
        }

        async function installArkMod(modId, modName) {
            if (!modId) modId = document.getElementById('ark-mod-id')?.value?.trim();
            if (!modId) return showToast("Falta el ID", "warning");

            showToast(`Añadiendo ${modName || modId}...`, "info");
            try {
                await Nexus.api(`/api/mods/${currentServer.id}/ark/install`, {
                    method: 'POST',
                    body: JSON.stringify({ modId })
                });
                showToast("Mod añadido a la configuración. Reinicia para aplicar.", "success");
                const input = document.getElementById('ark-mod-id');
                if (input) input.value = '';
            } catch (e) { showToast(e.message, "danger"); }
        }

        async function searchArkMods(isInitial = false) {
            const query = document.getElementById('mod-search-input').value.trim();
            const grid = document.getElementById('mods-grid');
            const loadingText = query ? `Buscando "${query}" en CurseForge...` : 'Cargando mods populares...';
            grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 100px;"><i class="fa-solid fa-spinner fa-spin fa-3x" style="color: var(--primary);"></i><p class="muted" style="margin-top: 20px;">${loadingText}</p></div>`;

            try {
                const results = await Nexus.api(`/api/mods/${currentServer.id}/ark/search?q=${encodeURIComponent(query)}`);
                renderUnifiedModResults(results, 'ark');
            } catch (e) {
                grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 50px; color: var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Error: ${e.message}</div>`;
            }
        }

        async function searchValheimMods(isInitial = false) {
            const query = document.getElementById('mod-search-input').value.trim();
            const grid = document.getElementById('mods-grid');
            const loadingText = query ? `Buscando "${query}" en Thunderstore...` : 'Cargando plugins populares...';
            grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 100px;"><i class="fa-solid fa-spinner fa-spin fa-3x" style="color: var(--primary);"></i><p class="muted" style="margin-top: 20px;">${loadingText}</p></div>`;

            try {
                const results = await Nexus.api(`/api/mods/${currentServer.id}/valheim/search?q=${encodeURIComponent(query)}`);
                renderUnifiedModResults(results, 'valheim');
            } catch (e) {
                grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 50px; color: var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Error: ${e.message}</div>`;
            }
        }

        async function searchPalworldMods(isInitial = false) {
            const query = document.getElementById('mod-search-input').value.trim();
            const grid = document.getElementById('mods-grid');
            const loadingText = query ? `Buscando "${query}" en Thunderstore...` : 'Cargando mods populares...';
            grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 100px;"><i class="fa-solid fa-spinner fa-spin fa-3x" style="color: var(--primary);"></i><p class="muted" style="margin-top: 20px;">${loadingText}</p></div>`;

            try {
                const results = await Nexus.api(`/api/mods/${currentServer.id}/palworld/search?q=${encodeURIComponent(query)}`);
                renderUnifiedModResults(results, 'palworld');
            } catch (e) {
                grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 50px; color: var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Error: ${e.message}</div>`;
            }
        }

        async function searchSDTDMods(isInitial = false) {
            const query = document.getElementById('mod-search-input').value.trim();
            const grid = document.getElementById('mods-grid');
            const loadingText = query ? `Buscando "${query}" en Thunderstore...` : 'Cargando modlets populares...';
            grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 100px;"><i class="fa-solid fa-spinner fa-spin fa-3x" style="color: var(--primary);"></i><p class="muted" style="margin-top: 20px;">${loadingText}</p></div>`;

            try {
                const results = await Nexus.api(`/api/mods/${currentServer.id}/sdtd/search?q=${encodeURIComponent(query)}`);
                renderUnifiedModResults(results, 'sdtd');
            } catch (e) {
                grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 50px; color: var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Error: ${e.message}</div>`;
            }
        }

        function renderUnifiedModResults(results, type) {
            const grid = document.getElementById('mods-grid');
            if (!results || results.length === 0) {
                grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 100px;"><p class="muted">No se encontraron resultados.</p></div>';
                return;
            }

            grid.innerHTML = results.map(m => `
              <div class="card" style="padding: 15px; gap: 10px; min-width: 280px; max-width: 400px; flex: 1;">
                  <div style="display: flex; gap: 12px; align-items: flex-start;">
                      <img src="${m.icon_url || 'https://placehold.co/100x100/1a1a1e/38bdf8?text=MOD'}" ${rnBind("error", (event, element) => { element.onerror=null; element.src='https://placehold.co/100x100/1a1a1e/38bdf8?text=MOD' })} style="width: 50px; height: 50px; border-radius: 8px; background: #1a1a1e; object-fit: cover;">
                      <div style="flex: 1;">
                          <h4 style="margin: 0; font-size: 0.95rem;">${m.title}</h4>
                          <p class="muted" style="font-size: 0.75rem; margin: 4px 0; line-height: 1.3;">${m.description.slice(0, 70)}${m.description.length > 70 ? '...' : ''}</p>
                          <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px;">
                              <span class="badge outline" style="font-size: 0.55rem; padding: 2px 6px;">${m.author}</span>
                              ${m.downloads ? `<span class="badge" style="font-size: 0.55rem; padding: 2px 6px; background: rgba(16,185,129,0.1); color: #34d399;">${m.downloads.toLocaleString()} DLs</span>` : ''}
                          </div>
                      </div>
                  </div>
                  <button class="btn" style="width: 100%; justify-content: center; padding: 6px;" ${rnBind("click", (event, element) => { installGenericMod(type, m.project_id, m.title) })}>
                      <i class="fa-solid fa-download"></i> Instalar
                  </button>
              </div>
          `).join('');
        }

        async function installGenericMod(type, id, name) {
            if (type === 'ark') return installArkMod(id, name);
            showToast(`Instalación de ${type} no automatizada aún`, 'warning');
        }

        async function searchMcMods(isInitial = false) {
            const searchInput = document.getElementById('mod-search-input');
            const query = searchInput ? searchInput.value.trim() : '';

            const grid = document.getElementById('mods-grid');
            if (!grid) return;
            const loadingText = query ? `Buscando "${query}" en Modrinth...` : 'Cargando mods populares...';
            grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 100px;"><i class="fa-solid fa-spinner fa-spin fa-3x" style="color: var(--primary);"></i><p class="muted" style="margin-top: 20px;">${loadingText}</p></div>`;

            try {
                const results = await Nexus.api(`/api/minecraft-mods/${currentServer.id}/search?q=${encodeURIComponent(query)}`);

                if (!results || results.length === 0) {
                    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 100px;"><p class="muted">No se encontraron resultados.</p></div>';
                    return;
                }

                grid.innerHTML = results.map(m => `
                  <div class="card" style="padding: 15px; gap: 10px; min-width: 280px; max-width: 400px; flex: 1;">
                      <div style="display: flex; gap: 12px; align-items: flex-start;">
                          <img src="${m.icon_url || 'https://placehold.co/100x100/1a1a1e/38bdf8?text=MOD'}" ${rnBind("error", (event, element) => { element.onerror=null; element.src='https://placehold.co/100x100/1a1a1e/38bdf8?text=MOD' })} style="width: 50px; height: 50px; border-radius: 8px; background: #1a1a1e; object-fit: cover;">
                          <div style="flex: 1;">
                              <h4 style="margin: 0; font-size: 0.95rem;">${m.title}</h4>
                              <p class="muted" style="font-size: 0.75rem; margin: 4px 0; line-height: 1.3;">${m.description.slice(0, 70)}${m.description.length > 70 ? '...' : ''}</p>
                              <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px;">
                                  <span class="badge outline" style="font-size: 0.55rem; padding: 2px 6px;">${m.author}</span>
                                  <span class="badge" style="font-size: 0.55rem; padding: 2px 6px; background: rgba(16,185,129,0.1); color: #34d399;">${m.downloads.toLocaleString()} DLs</span>
                              </div>
                          </div>
                      </div>
                      <button class="btn-ghost" style="width: 100%; justify-content: center; padding: 6px;" ${rnBind("click", (event, element) => { loadModVersions(m.project_id, m.title) })}>
                          <i class="fa-solid fa-list-ul"></i> Versiones
                      </button>
                  </div>
              `).join('');
            } catch (e) {
                grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 50px; color: var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Error: ${e.message}</div>`;
            }
        }

        async function loadModVersions(projectId, modName) {
            showToast('Cargando versiones...', 'info');
            try {
                const versions = await Nexus.api(`/api/minecraft-mods/${currentServer.id}/project/${projectId}/versions`);

                const html = `
                  <h3 style="margin-bottom: 20px;"><i class="fa-solid fa-cubes" style="color: var(--primary);"></i> Instalar ${modName}</h3>
                  <p class="muted" style="margin-bottom: 20px; font-size: 0.85rem;">Selecciona la versión que deseas descargar en tu servidor.</p>

                  <div style="max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 5px;">
                      ${versions.slice(0, 15).map(v => `
                          <div class="card" style="padding: 12px; flex-direction: row; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02); border-color: rgba(255,255,255,0.05);">
                              <div>
                                  <div style="font-weight: 700; font-size: 0.9rem;">${v.version_number}</div>
                                  <div class="muted" style="font-size: 0.7rem;">${v.game_versions.join(', ')} • ${v.loaders.join(', ')}</div>
                              </div>
                              <button class="btn-success" style="padding: 6px 12px; font-size: 0.75rem;" ${rnBind("click", (event, element) => { installMcMod((v.id), (modName)) })}>
                                  <i class="fa-solid fa-download"></i> Instalar
                              </button>
                          </div>
                      `).join('')}
                  </div>
                  <button class="btn-ghost" style="width: 100%; margin-top: 20px;" ${rnBind("click", (event, element) => { closeActionModal() })}>Cancelar</button>
              `;
                openActionModal(html);
            } catch (e) {
                showToast('Error al cargar versiones', 'danger');
            }
        }

        async function installMcMod(versionId, modName) {
            closeActionModal();
            showToast(`Iniciando descarga de ${modName}...`, 'info');

            try {
                const res = await Nexus.api(`/api/minecraft-mods/${currentServer.id}/install`, {
                    method: 'POST',
                    body: JSON.stringify({ versionId, modName })
                });

                if (res.error) throw new Error(res.error);

                showToast(res.message + ' Reinicia el servidor para activar el mod.', 'success');
            } catch (e) {
                showToast(e.message, 'danger');
            }
        }

        async function saveClusterConfig() {
            const clusterId = document.getElementById('ark-cluster-id').value.trim();
            try {
                const res = await Nexus.api(`/api/servers/${currentServer.id}/cluster`, {
                    method: 'POST',
                    body: JSON.stringify({ clusterId })
                });
                if (res.error) throw new Error(res.error);
                currentServer.cluster_id = clusterId;
                showToast('Clúster configurado correctamente.', 'success');
            } catch (e) { showToast(e.message, 'danger'); }
        }

        async function saveWebhookConfig() {
            const webhookUrl = document.getElementById('discord-webhook-url').value.trim();
            const events = Array.from(document.querySelectorAll('.webhook-event-cb:checked')).map(cb => cb.value);
            try {
                const res = await Nexus.api(`/api/servers/${currentServer.id}/webhooks`, {
                    method: 'POST',
                    body: JSON.stringify({ webhookUrl, events })
                });
                if (res.error) throw new Error(res.error);
                currentServer.discord_webhook_url = webhookUrl;
                currentServer.discord_webhook_events = events;
                showToast('Webhook de Discord guardado correctamente.', 'success');
            } catch (e) { showToast(e.message, 'danger'); }
        }

        window.saveAutoRestartConfig = async function() {
            if (!currentServer) return;
            const enabled = document.getElementById('auto-restart-enabled').checked;
            const time = document.getElementById('auto-restart-time').value || '06:00';
            const backupBeforeRestart = document.getElementById('backup-before-restart').checked;
            try {
                const res = await Nexus.api(`/api/servers/${currentServer.id}/auto-restart`, {
                    method: 'POST',
                    body: JSON.stringify({ enabled, time, backupBeforeRestart })
                });
                if (res.error) throw new Error(res.error);
                currentServer.auto_restart_enabled = enabled;
                currentServer.auto_restart_time = time;
                currentServer.backup_before_restart = backupBeforeRestart;
                showToast('Configuración de reinicio automático guardada.', 'success');
            } catch (e) { showToast(e.message, 'danger'); }
        };

        let rconInterval = null;

        async function loadRconView() {
            if (rconInterval) clearInterval(rconInterval);
            await loadRconPlayers();
            await loadRconChat();
            await loadGamePremiumPanels();
            rconInterval = setInterval(() => {
                if (activeView === 'rcon') {
                    loadRconPlayers();
                    loadRconChat();
                    loadGamePremiumPanels();
                } else {
                    clearInterval(rconInterval);
                }
            }, 5000);
        }

        async function loadGamePremiumPanels() {
            if (!currentServer) return;
            const t = currentServer.template;

            if (window._loadedGameTemplates !== t) {
                try {
                    let fetchFile = t; if (t === "fivem") fetchFile = "fivem_v3"; const res = await fetch(`/games/${fetchFile}.html?v=${Date.now()}`);
                    if (res.ok) {
                        const html = await res.text();

                        const sidebarContainer = document.getElementById('game-specific-sidebar');
                        const viewsContainer = document.getElementById('game-specific-views');
                        if (sidebarContainer) sidebarContainer.innerHTML = '';
                        if (viewsContainer) viewsContainer.innerHTML = '';

                        // Use a detached element to parse the templates
                        const parserDiv = document.createElement('div');
                        parserDiv.innerHTML = html;

                        const templates = parserDiv.querySelectorAll('template.game-module-sidebar, template.game-module-views, template.game-module-rcon');
                        templates.forEach(tpl => {
                            if (tpl.classList.contains('game-module-sidebar') && sidebarContainer) {
                                sidebarContainer.appendChild(tpl.content.cloneNode(true));
                            } else if (tpl.classList.contains('game-module-views') && viewsContainer) {
                                viewsContainer.appendChild(tpl.content.cloneNode(true));
                            } else if (tpl.classList.contains('game-module-rcon')) {
                                // If there is an rcon container, append it, otherwise ignore
                                const rconContainer = document.getElementById('rcon-premium-content');
                                if (rconContainer) {
                                    rconContainer.appendChild(tpl.content.cloneNode(true));
                                }
                            }
                        });

                        window._loadedGameTemplates = t;
                    }
                } catch(e) {
                    console.error("Error loading partial for", t, e);
                }
            }
            // ----------------------------------------

            document.querySelectorAll('[id^="rcon-panel-"]').forEach(el => el.classList.add('hidden'));

            const activePanel = document.getElementById('rcon-panel-' + t);
            if (activePanel) activePanel.classList.remove('hidden');

            try {
                if (t === 'rust') {
                    const res = await Nexus.api(`/api/rcon/${currentServer.id}/killfeed`);
                    const list = document.getElementById('rust-killfeed-list');
                    if (list && res.feed) {
                        list.innerHTML = res.feed.length === 0 ? '<div class="muted">No hay muertes recientes.</div>' :
                            res.feed.map(k => `<div style="padding:6px 10px; background:rgba(251,191,36,0.1); border-left:3px solid #fbbf24; border-radius:4px; font-size:0.85rem;">
                              <span style="color:#f87171; font-weight:bold;">${k.victim}</span> fue eliminado por <span style="color:#34d399; font-weight:bold;">${k.killer}</span> (${k.weapon})
                          </div>`).join('');
                    }
                } else if (t === 'palworld') {
                    const res = await Nexus.api(`/api/rcon/${currentServer.id}/guilds`);
                    const list = document.getElementById('palworld-guilds-list');
                    if (list && res.guilds) {
                        list.innerHTML = res.guilds.length === 0 ? '<div class="muted">No hay gremios activos.</div>' :
                            res.guilds.map(g => `<div style="padding:8px 12px; background:rgba(244,114,182,0.1); border:1px solid #f472b6; border-radius:6px;">
                              <div style="font-weight:bold; color:#fbcfe8;">${g.name} <span class="badge" style="background:#db2777;">Líder: ${g.leader}</span></div>
                              <div class="muted" style="font-size:0.75rem; margin-top:4px;">Miembros: ${g.members.join(', ')}</div>
                          </div>`).join('');
                    }
                } else if (t === 'valheim') {
                    const res = await Nexus.api(`/api/rcon/${currentServer.id}/valheim-lists`);
                    const box = document.getElementById('valheim-lists-box');
                    if (box && res.lists) {
                        box.innerHTML = '';
                        for (const [listName, content] of Object.entries(res.lists)) {
                            if (!content || !content.trim()) continue;
                            const ids = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('//'));
                            ids.forEach(id => {
                                const type = listName.replace('.txt','');
                                box.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(99,102,241,0.1); border:1px solid #6366f1; border-radius:6px;">
                                    <div style="font-weight:bold; color:#e0e7ff;">[${type.toUpperCase()}] <span style="font-family:monospace; margin-left:5px; color:#a5b4fc;">${id}</span></div>
                                    <button class="btn btn-danger" style="padding:4px 8px; font-size:0.75rem;" ${rnBind("click", (event, element) => { updateValheimAccess('remove', (type), (id)) })}><i class="fa-solid fa-trash"></i></button>
                                </div>`;
                            });
                        }
                        if (box.innerHTML === '') box.innerHTML = '<div class="muted">No hay jugadores en ninguna lista.</div>';
                    }
                } else if (t === 'sdtd') {
                    const dayEl = document.getElementById('sdtd-horde-day');
                    if (dayEl) dayEl.innerText = Math.floor(Math.random() * 7) + 1;
                }
            } catch (e) { }
        }

        async function updateValheimAccess(action, forcedListType = null, forcedSteamId = null) {
            if (!currentServer) return;
            let listType = forcedListType;
            let steamId = forcedSteamId;
            if (action === 'add') {
                listType = document.getElementById('valheim-list-type').value;
                const input = document.getElementById('valheim-list-input');
                steamId = input.value.trim();
                input.value = '';
            }
            if (!steamId) return;
            try {
                const res = await Nexus.api(`/api/rcon/${currentServer.id}/valheim-lists/update`, {
                    method: 'POST',
                    body: JSON.stringify({ listType, action, steamId })
                });
                if (res.error) throw new Error(res.error);
                showToast('Lista de Valheim actualizada.', 'success');
                loadGamePremiumPanels();
            } catch (e) { showToast(e.message, 'danger'); }
        }

        async function sendMatchpadCmd(command) {
            if (!currentServer) return;
            try {
                const res = await Nexus.api(`/api/rcon/${currentServer.id}/matchpad`, {
                    method: 'POST',
                    body: JSON.stringify({ command })
                });
                if (res.error) throw new Error(res.error);
                showToast(`Comando '${command}' enviado.`, 'success');
                const box = document.getElementById('rcon-chat-box');
                if (box && res.output) {
                    box.innerHTML += `<div style="padding: 6px 10px; background: rgba(59,130,246,0.2); border-radius: 6px; color:#93c5fd;">[Matchpad] ${res.output}</div>`;
                    box.scrollTop = box.scrollHeight;
                }
            } catch (e) { showToast(e.message, 'danger'); }
        }

        async function loadRconPlayers() {
            if (!currentServer) return;
            try {
                const res = await Nexus.api(`/api/rcon/${currentServer.id}/players`);
                const list = document.getElementById('rcon-players-list');
                if (!list) return;
                if (!res.players || res.players.length === 0) {
                    list.innerHTML = '<div class="muted" style="text-align:center; padding: 20px;">No hay jugadores conectados en este momento.</div>';
                    return;
                }
                list.innerHTML = res.players.map(p => `<div style="display:flex; justify-content:space-between; align-items:center; padding: 12px 15px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px;">
                  <div style="display:flex; align-items:center; gap:12px;">
                      <div style="width:35px; height:35px; border-radius:50%; background: #38bdf8; color:#000; display:flex; align-items:center; justify-content:center; font-weight:bold;">
                          ${p.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                          <div style="font-weight:700; font-size:0.95rem; color:#fff;">${p.name}</div>
                          <div class="muted" style="font-size:0.75rem; font-family:var(--font-mono);">${p.steamId}</div>
                      </div>
                  </div>
                  <div style="display:flex; gap:6px;">
                      <button class="btn-ghost" style="padding:5px 10px; font-size:0.75rem; color:#f59e0b;" ${rnBind("click", (event, element) => { rconAction('kick', (p.steamId)) })} title="Expulsar"><i class="fa-solid fa-user-slash"></i> Kick</button>
                      <button class="btn-ghost" style="padding:5px 10px; font-size:0.75rem; color:#ef4444;" ${rnBind("click", (event, element) => { rconAction('ban', (p.steamId)) })} title="Banear"><i class="fa-solid fa-gavel"></i> Ban</button>
                      <button class="btn-ghost" style="padding:5px 10px; font-size:0.75rem; color:#22c55e;" ${rnBind("click", (event, element) => { rconAction('whitelist', (p.steamId)) })} title="Whitelistar"><i class="fa-solid fa-user-check"></i> WL</button>
                  </div>
              </div>`).join('');
            } catch (e) { }
        }

        async function loadRconChat() {
            if (!currentServer) return;
            try {
                const res = await Nexus.api(`/api/rcon/${currentServer.id}/chat`);
                const box = document.getElementById('rcon-chat-box');
                if (!box) return;
                if (!res.chat || res.chat.length === 0) {
                    box.innerHTML = '<div class="muted" style="text-align:center; padding: 20px;">No hay mensajes de chat recientes.</div>';
                    return;
                }
                box.innerHTML = res.chat.map(m => `<div style="padding: 6px 10px; background: rgba(255,255,255,0.02); border-radius: 6px; border-left: 3px solid #a855f7;">
                  <span style="color:#c084fc; font-weight:bold;">${m.sender || 'SERVER'}:</span> <span style="color:#f3e8ff;">${m.text}</span>
              </div>`).join('');
                box.scrollTop = box.scrollHeight;
            } catch (e) { }
        }

        async function sendRconCommand() {
            const input = document.getElementById('rcon-input');
            const command = input.value.trim();
            if (!command || !currentServer) return;
            input.value = '';
            const box = document.getElementById('rcon-chat-box');
            box.innerHTML += `<div style="padding: 6px 10px; background: rgba(56, 189, 248, 0.1); border-radius: 6px; border-left: 3px solid #38bdf8; color:#e0f2fe;">> ${command}</div>`;
            box.scrollTop = box.scrollHeight;
            try {
                const res = await Nexus.api(`/api/rcon/${currentServer.id}/command`, {
                    method: 'POST',
                    body: JSON.stringify({ command })
                });
                if (res.error) throw new Error(res.error);
                box.innerHTML += `<div style="padding: 6px 10px; background: rgba(0,0,0,0.4); border-radius: 6px; color:#a3e635; font-family:var(--font-mono); white-space:pre-wrap;">${res.output || 'OK'}</div>`;
                box.scrollTop = box.scrollHeight;
            } catch (e) {
                box.innerHTML += `<div style="padding: 6px 10px; background: rgba(239, 68, 68, 0.1); border-radius: 6px; color:#fca5a5;">Error: ${e.message}</div>`;
                box.scrollTop = box.scrollHeight;
            }
        }

        async function rconAction(action, steamId) {
            if (!currentServer) return;
            try {
                const res = await Nexus.api(`/api/rcon/${currentServer.id}/players/${action}`, {
                    method: 'POST',
                    body: JSON.stringify({ steamId })
                });
                if (res.error) throw new Error(res.error);
                showToast(`Acción '${action}' ejecutada sobre ${steamId}.`, 'success');
                loadRconPlayers();
            } catch (e) { showToast(e.message, 'danger'); }
        }

        async function loadSubusersView() {
            if (!currentServer) return;
            const tbody = document.getElementById('subusers-table-body');
            if (!tbody) return;
            tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align:center;" class="muted"><i class="fa-solid fa-spinner fa-spin"></i> Cargando miembros...</td></tr>';
            try {
                const res = await Nexus.api(`/api/servers/${currentServer.id}/subusers`);
                if (res.error) throw new Error(res.error);
                if (!res.items || res.items.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="padding: 30px; text-align:center;" class="muted">No hay miembros en el equipo de este servidor.</td></tr>';
                    return;
                }
                tbody.innerHTML = res.items.map(su => `<tr>
                  <td style="padding-left: 20px; font-weight:bold; color:#fff;">${su.username}</td>
                  <td class="muted">${su.email}</td>
                  <td><span class="badge" style="background:rgba(244,114,182,0.2); color:#f472b6;">${(Array.isArray(su.permissions) ? su.permissions : JSON.parse(su.permissions || '[]')).join(', ')}</span></td>
                  <td class="muted">${new Date(su.created_at).toLocaleDateString()}</td>
                  <td style="text-align: right; padding-right: 20px;">
                      <button class="btn-ghost" style="color: #ef4444; padding: 6px 12px;" ${rnBind("click", (event, element) => { removeSubuser((su.subuser_id)) })}><i class="fa-solid fa-trash"></i> Quitar</button>
                  </td>
              </tr>`).join('');
            } catch (e) { tbody.innerHTML = `<tr><td colspan="5" style="padding: 20px; text-align:center; color:var(--danger);">${e.message}</td></tr>`; }
        }

        async function inviteSubuser() {
            if (!currentServer) return showToast('Error: Servidor no seleccionado', 'error');
            const input = document.getElementById('subuser-invite-input');
            const permSelect = document.getElementById('subuser-perm-select');
            const usernameOrEmail = input.value.trim();
            const permissions = permSelect.value.split(',');

            if (!usernameOrEmail) {
                return showToast('Por favor, ingresa el correo del usuario que deseas añadir.', 'warning');
            }

            try {
                showToast('Procesando invitación y configurando cuenta...', 'info');
                const res = await Nexus.api(`/api/servers/${currentServer.id}/subusers`, {
                    method: 'POST',
                    body: JSON.stringify({ usernameOrEmail, permissions })
                });
                if (res.error) throw new Error(res.error);
                input.value = '';
                showToast(res.message || 'Miembro añadido al equipo correctamente.', 'success');
                loadSubusersView();
            } catch (e) { showToast(e.message, 'danger'); }
        }

        async function removeSubuser(subuserId) {
            if (!currentServer || !confirm("¿Seguro que deseas eliminar a este miembro del equipo?")) return;
            try {
                const res = await Nexus.api(`/api/servers/${currentServer.id}/subusers/${subuserId}`, { method: 'DELETE' });
                if (res.error) throw new Error(res.error);
                showToast('Miembro eliminado del equipo.', 'success');
                loadSubusersView();
            } catch (e) { showToast(e.message, 'danger'); }
        }
        // ==========================================
        // 🕒 SISTEMA DE TAREAS PROGRAMADAS (SCHEDULES)
        // ==========================================

        window.openScheduleModal = function() {
            document.getElementById('cron-modal').classList.remove('hidden');
        }

        window.closeScheduleModal = function() {
            document.getElementById('cron-modal').classList.add('hidden');
        }

        window.loadSchedules = async function() {
            if(!currentServerId) return;
            const container = document.getElementById('schedules-card-container');
            if(!container) return; // safeguard

            // Loading State
            container.innerHTML = `
                <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 12px; padding: 40px; text-align: center; color: var(--muted);">
                    <i class="fa-solid fa-spinner fa-spin" style="font-size: 2rem; color: var(--primary); margin-bottom: 15px;"></i><br>
                    Cargando tareas programadas...
                </div>
            `;

            try {
                const res = await fetch(`/api/cron/${currentServerId}`);
                const data = await res.json();
                const schedules = data.items || [];
                if(!res.ok) throw new Error(data.error || 'Endpoint no configurado');

                if(schedules.length === 0) {
                    container.innerHTML = `
                        <div style="background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 16px; padding: 60px 20px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                            <div style="width: 80px; height: 80px; background: rgba(255,255,255,0.05); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 20px;">
                                <i class="fa-solid fa-calendar-xmark" style="font-size: 2.5rem; color: rgba(255,255,255,0.2);"></i>
                            </div>
                            <h4 style="color: white; font-size: 1.2rem; margin-bottom: 10px;">No hay tareas programadas</h4>
                            <p style="color: var(--muted); max-width: 400px; margin-bottom: 25px;">Automatiza procesos de tu servidor creando tareas que se ejecuten en intervalos específicos.</p>
                            <button class="btn" ${rnBind("click", (event, element) => { openScheduleModal() })} style="background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2);"><i class="fa-solid fa-plus"></i> Crear Primera Tarea</button>
                        </div>
                    `;
                    return;
                }

                let html = '';
                schedules.forEach(s => {
                    const nextRun = s.next_run_at ? new Date(s.next_run_at).toLocaleString() : 'Pendiente';
                    const statusColor = s.is_active ? 'var(--success)' : 'var(--muted)';
                    const statusText = s.is_active ? 'Activa' : 'Inactiva';

                    html += `
                        <div style="background: rgba(15,15,18,0.4); border: 1px solid var(--line); border-radius: 12px; padding: 20px 25px; display: flex; flex-wrap: wrap; gap: 20px; align-items: center; justify-content: space-between; transition: all 0.3s; position: relative; overflow: hidden;" ${rnBind("mouseover", (event, element) => { element.style.borderColor='rgba(255,255,255,0.1)'; element.style.background='rgba(20,20,24,0.6)'; })} ${rnBind("mouseout", (event, element) => { element.style.borderColor='var(--line)'; element.style.background='rgba(15,15,18,0.4)'; })}>
                            <div style="position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: ${statusColor};"></div>

                            <div style="display: flex; gap: 15px; align-items: center; flex-grow: 1;">
                                <div style="width: 45px; height: 45px; background: rgba(255,255,255,0.05); border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                                    <i class="fa-solid fa-calendar-check" style="font-size: 1.2rem; color: ${statusColor};"></i>
                                </div>
                                <div>
                                    <h4 style="color: white; font-size: 1.1rem; margin: 0 0 5px 0; font-weight: 600;">Acción: ${s.action}</h4>
                                    <div style="display: flex; gap: 15px; align-items: center;">
                                        <span class="mono" style="background: rgba(0,0,0,0.5); padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; color: var(--primary); border: 1px solid rgba(99,102,241,0.2);"><i class="fa-solid fa-clock"></i> Todos los días a las ${s.time_hh_mm}</span>
                                        ${s.payload ? `<span style="color: var(--muted); font-size: 0.85rem;"><i class="fa-solid fa-terminal"></i> ${s.payload}</span>` : ''}
                                    </div>
                                </div>
                            </div>

                            <div style="display: flex; flex-direction: column; align-items: flex-end; justify-content: center; min-width: 200px;">
                                <span style="font-size: 0.8rem; color: var(--muted); margin-bottom: 4px; text-transform: uppercase;">Próxima Ejecución</span>
                                <span style="color: #e2e8f0; font-size: 0.9rem; font-weight: 500;">${nextRun}</span>
                            </div>

                            <div style="display: flex; gap: 10px; align-items: center;">
                                <div style="display: flex; align-items: center; gap: 6px; margin-right: 15px; background: rgba(255,255,255,0.05); padding: 6px 12px; border-radius: 20px;">
                                    <div style="width: 8px; height: 8px; border-radius: 50%; background: ${statusColor}; box-shadow: 0 0 8px ${statusColor};"></div>
                                    <span style="font-size: 0.85rem; color: ${statusColor}; font-weight: 600;">${statusText}</span>
                                </div>
                                <button class="btn-ghost" ${rnBind("click", (event, element) => { deleteSchedule((s.id)) })} style="color: #ef4444; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); padding: 8px; border-radius: 8px; transition: all 0.2s;" ${rnBind("mouseover", (event, element) => { element.style.background='rgba(239,68,68,0.2)' })} ${rnBind("mouseout", (event, element) => { element.style.background='rgba(239,68,68,0.1)' })} title="Eliminar Tarea">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    `;
                });
                container.innerHTML = html;
            } catch(e) {
                console.error(e);
                container.innerHTML = `
                    <div style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 12px; padding: 25px; text-align: center; color: #fca5a5;">
                        <i class="fa-solid fa-circle-exclamation" style="font-size: 2rem; margin-bottom: 10px;"></i><br>
                        Error al cargar las tareas (o falta endpoint en el backend).
                    </div>
                `;
            }
        }

        window.saveCronJob = async function() {
            if(!currentServerId) return showToast('Selecciona un servidor primero', 'error');
            const time_hh_mm = document.getElementById('cron-time').value;
            const action = document.getElementById('cron-action').value;
            const payload = document.getElementById('cron-payload').value;
            if(!time_hh_mm || !action) return showToast('Completa los campos', 'error');

            try {
                const res = await fetch(`/api/cron/${currentServerId}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ time_hh_mm, action, payload })
                });
                const data = await res.json();
                if(!res.ok) throw new Error(data.error || 'Endpoint no configurado');

                showToast('Tarea guardada exitosamente', 'success');
                closeScheduleModal();
                loadSchedules();
            } catch(e) {
                showToast(e.message, 'error');
            }
        }

        window.deleteSchedule = async function(id) {
            if(!confirm('¿Seguro que deseas eliminar esta tarea programada?')) return;
            try {
                const res = await fetch(`/api/cron/${currentServerId}/${id}`, { method: 'DELETE' });
                if(!res.ok) throw new Error('Error eliminando');
                showToast('Eliminado', 'success');
                loadSchedules();
            } catch(e) {
                showToast(e.message, 'error');
            }
        }

        const originalSwitchViewForSchedules = window.switchView;
        window.switchView = function(viewId, element) {
            if(originalSwitchViewForSchedules) originalSwitchViewForSchedules(viewId, element);
            if(viewId === 'schedules') {
                const pageSub = document.getElementById('page-sub');
                if(pageSub) pageSub.innerText = "Automatización de Tareas y Cron Jobs";
                loadSchedules();
            }
        };
