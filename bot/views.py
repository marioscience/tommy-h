import discord
import asyncio
import logging
from datetime import datetime

logger = logging.getLogger("RageNodesBot")

RAGE_COLOR = 0x6366F1
RAGE_GREEN = 0x2ECC71
RAGE_RED_ALERT = 0xEF4444
STAFF_ROLE_NAME = "👑 Admin"
CLIENTE_ROLE_NAME = "✅ Cliente"
ANUNCIOS_ROLE_NAME = "📢 Anuncios"
MANTENIMIENTOS_ROLE_NAME = "🛠️ Mantenimientos"
OFERTAS_ROLE_NAME = "🎁 Ofertas"


async def safe_delete(message):
    try:
        await message.delete()
    except Exception:
        pass


class VendorSelect(discord.ui.Select):
    def __init__(self, options):
        super().__init__(placeholder="Selecciona una postulación...", options=options, custom_id="vendor_select_menu")

    async def callback(self, interaction: discord.Interaction):
        val = self.values[0]
        if val.startswith("vendor_select_"):
            app_id = val.split("_")[2]
            await interaction.response.defer(ephemeral=True)
            from .main import bot
            view = VendorRevokeView(bot)
            await interaction.followup.send(f"Gestionando Postulación ID: `{app_id}`\nElige una acción para este usuario:", view=view, ephemeral=True)

class VendorPanelSetupView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="🗂️ Ver Solicitudes Vendedores", style=discord.ButtonStyle.secondary, custom_id="vendor_panel_btn")
    async def view_vendors(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)
        from .main import API_URL_BASE, API_KEY, bot, logger
        try:
            async with bot.session.get(f"{API_URL_BASE}/vendors", headers={"x-api-key": API_KEY}) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    vendors = data.get("vendors", [])
                    if not vendors:
                        await interaction.followup.send("📭 No hay postulaciones registradas.", ephemeral=True)
                        return
                    
                    options = []
                    for v in vendors[:25]:
                        status = v.get("status")
                        emoji = "✅" if status == "accepted" else ("📁" if status == "pending" else "🚫")
                        desc = str(v.get('portfolio_url') or 'N/A')
                        options.append(discord.SelectOption(
                            label=f"{v.get('discord_username')} ({status})",
                            description=desc[:50],
                            emoji=emoji,
                            value=f"vendor_select_{v.get('id')}"
                        ))
                    
                    select = VendorSelect(options)
                    view = discord.ui.View(timeout=None)
                    view.add_item(select)
                    await interaction.followup.send("Selecciona una postulación del archivo para moderar:", view=view, ephemeral=True)
                else:
                    await interaction.followup.send("❌ Error obteniendo lista de vendedores.", ephemeral=True)
        except Exception as e:
            logger.error(f"Error fetching vendors: {e}")
            await interaction.followup.send("⚠️ Error interno.", ephemeral=True)

class VendorRevokeView(discord.ui.View):
    def __init__(self, bot):
        super().__init__(timeout=None)
        self.bot = bot

    @discord.ui.button(label="🔴 Revocar Acceso", style=discord.ButtonStyle.danger, custom_id="vendor_revoke")
    async def revoke_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.process_action(interaction, "revoke")

    @discord.ui.button(label="🟢 Reactivar/Aceptar", style=discord.ButtonStyle.success, custom_id="vendor_reactivate")
    async def reactivate_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.process_action(interaction, "accepted")

    async def process_action(self, interaction: discord.Interaction, action: str):
        embed = interaction.message.embeds[0] if interaction.message.embeds else None
        app_id = None
        if embed and embed.footer.text:
            parts = embed.footer.text.split("ID: ")
            if len(parts) > 1:
                app_id = parts[1].strip()
        
        if not app_id:
            await interaction.response.send_message("❌ No se encontró el ID de postulación.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)
        from .main import API_URL_BASE, API_KEY
        try:
            async with self.bot.session.post(
                f"{API_URL_BASE}/vendor-action/{app_id}",
                json={"action": action},
                headers={"x-api-key": API_KEY}
            ) as resp:
                if resp.status == 200:
                    status_text = "🚫 **Acceso Revocado**" if action == "revoke" else "✅ **Postulación Aceptada**"
                    color = 0x000000 if action == "revoke" else 0x10b981
                    
                    embed.color = color
                    embed.fields = [f for f in embed.fields if f.name != "Estado / Decisión"]
                    embed.add_field(name="Estado / Decisión", value=status_text, inline=False)
                    
                    if action == "accepted":
                        await interaction.message.edit(embed=embed, view=VendorRevokeView(self.bot))
                    else:
                        await interaction.message.edit(embed=embed, view=None)
                    
                    await interaction.followup.send(f"Acción completada: {status_text}", ephemeral=True)
                else:
                    await interaction.followup.send(f"❌ Error del servidor ({resp.status}).", ephemeral=True)
        except Exception as e:
            logger.error(f"Error: {e}")
            await interaction.followup.send("⚠️ Error interno.", ephemeral=True)

class VendorActionView(discord.ui.View):
    def __init__(self, bot):
        super().__init__(timeout=None)
        self.bot = bot

    @discord.ui.button(label="Aceptar", style=discord.ButtonStyle.success, custom_id="vendor_accept")
    async def accept_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.process_action(interaction, "accepted", "✅ **Postulación Aceptada** - Permisos otorgados.", 0x10b981)

    @discord.ui.button(label="Guardar", style=discord.ButtonStyle.secondary, custom_id="vendor_save")
    async def save_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.process_action(interaction, "saved", "📁 **Postulación Guardada** - En revisión.", 0x6b7280)

    @discord.ui.button(label="Descartar", style=discord.ButtonStyle.danger, custom_id="vendor_reject")
    async def reject_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.process_action(interaction, "rejected", "❌ **Postulación Rechazada**.", 0xef4444)

    async def process_action(self, interaction: discord.Interaction, action: str, status_text: str, color: int):
        embed = interaction.message.embeds[0] if interaction.message.embeds else None
        app_id = None
        if embed and embed.footer.text:
            parts = embed.footer.text.split("ID: ")
            if len(parts) > 1:
                app_id = parts[1].strip()
        
        if not app_id:
            await interaction.response.send_message("❌ No se encontró el ID de la postulación en el embed.", ephemeral=True)
            return
            
        await interaction.response.defer(ephemeral=True)
        from .main import API_URL_BASE, API_KEY
        try:
            async with self.bot.session.post(
                f"{API_URL_BASE}/vendor-action/{app_id}",
                json={"action": action},
                headers={"x-api-key": API_KEY}
            ) as resp:
                if resp.status == 200:
                    embed.color = color
                    embed.fields = [f for f in embed.fields if f.name != "Estado / Decisión"]
                    embed.add_field(name="Estado / Decisión", value=status_text, inline=False)
                    
                    new_view = VendorRevokeView(self.bot) if action == "accepted" else None
                    await interaction.message.edit(embed=embed, view=new_view)
                    await interaction.followup.send(f"Acción completada: {status_text}", ephemeral=True)
                else:
                    await interaction.followup.send(f"❌ Error del servidor ({resp.status}).", ephemeral=True)
        except Exception as e:
            logger.error(f"Error vendor action: {e}")
            await interaction.followup.send("⚠️ Error interno.", ephemeral=True)

class TicketControls(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Cerrar Ticket", style=discord.ButtonStyle.danger, custom_id="close_ticket_btn", emoji="🔒")
    async def close_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not hasattr(interaction.channel, "name") or not interaction.channel.name.startswith("ticket-"):
            await interaction.response.send_message("Este botón solo funciona en tickets.", ephemeral=True)
            return
        await interaction.response.send_message("🔒 **Cerrando ticket en 5 segundos...**")
        await asyncio.sleep(5)
        try:
            await interaction.channel.delete()
        except discord.NotFound:
            pass


class VerificacionView(discord.ui.View):
    def __init__(self, bot):
        super().__init__(timeout=None)
        self.bot = bot

    @discord.ui.button(label="Verificar Cliente", style=discord.ButtonStyle.success, custom_id="verify_client_btn", emoji="✅")
    async def verify(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)
        try:
            from .main import API_URL_BASE, API_KEY
            async with self.bot.session.get(f"{API_URL_BASE}/diagnostico/{interaction.user.id}", headers={"x-api-key": API_KEY}) as resp:
                if resp.status == 200:
                    role = discord.utils.get(interaction.guild.roles, name=CLIENTE_ROLE_NAME)
                    if not role:
                        await interaction.followup.send("⚠️ El rol de cliente no está configurado. Avisa a un admin.", ephemeral=True)
                        return
                    if role in interaction.user.roles:
                        await interaction.followup.send("¡Ya tienes el rol de Cliente!", ephemeral=True)
                    else:
                        await interaction.user.add_roles(role)
                        await interaction.followup.send("🎉 **¡Verificación exitosa!** Se te asignó el rol de Cliente.", ephemeral=True)
                else:
                    await interaction.followup.send(
                        "❌ **Verificación fallida.** No encontramos una cuenta activa vinculada a tu Discord.\n\n"
                        "👉 Ve a https://ragenodes.com/panel → Mi Cuenta → vincula tu Discord.", ephemeral=True)
        except Exception as e:
            logger.error(f"Error verificación: {e}")
            await interaction.followup.send("⚠️ Error de conexión. Inténtalo más tarde.", ephemeral=True)


class StatusView(discord.ui.View):
    def __init__(self, bot):
        super().__init__(timeout=None)
        self.bot = bot

    @discord.ui.button(label="Actualizar Estado", style=discord.ButtonStyle.primary, custom_id="refresh_status_btn", emoji="🔄")
    async def refresh(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer()
        from .main import API_URL_BASE
        api_status = "🟢 Operativa"
        try:
            async with self.bot.session.get(f"{API_URL_BASE}/ping", timeout=2) as resp:
                if resp.status != 200:
                    api_status = "🔴 Con Problemas"
        except Exception:
            api_status = "🔴 Con Problemas"

        color = RAGE_GREEN if "🟢" in api_status else RAGE_RED_ALERT
        embed = discord.Embed(title="🛰️ Estado de la Infraestructura", color=color,
                              description="Monitorización en tiempo real de los servicios de **RageNodes**.")
        embed.add_field(name="🌐 Panel Web", value="🟢 Operativo", inline=True)
        embed.add_field(name="🔌 API Interna", value=api_status, inline=True)
        embed.add_field(name="🖥️ Nodos FiveM", value="🟢 Operativos", inline=False)
        embed.add_field(name="🐳 Docker Daemon", value="🟢 Operativo", inline=True)
        embed.add_field(name="🛡️ Proxy Anti-DDoS", value="🟢 Operativo", inline=True)
        embed.set_footer(text=f"RageNodes Systems | Última comprobación: {datetime.now().strftime('%H:%M:%S')}")
        await interaction.message.edit(embed=embed, view=self)


class TutorialesSelect(discord.ui.Select):
    def __init__(self):
        options = [
            discord.SelectOption(label="Licencia CFX (Keymaster)", description="Crear y configurar tu clave FiveM.", value="cfx", emoji="🔑"),
            discord.SelectOption(label="Vincular txAdmin", description="Acceso al panel de administración.", value="txadmin", emoji="🛡️"),
            discord.SelectOption(label="Subir Archivos", description="Gestor Web o SFTP.", value="archivos", emoji="📁"),
            discord.SelectOption(label="Base de Datos", description="Conectar con HeidiSQL o scripts.", value="db", emoji="🗄️"),
            discord.SelectOption(label="ESX Framework", description="Configuración básica de ESX.", value="esx", emoji="🔧"),
            discord.SelectOption(label="QBCore Framework", description="Configuración básica de QBCore.", value="qb", emoji="🔧"),
            discord.SelectOption(label="OneSync", description="Activar y configurar OneSync.", value="onesync", emoji="🌐"),
            discord.SelectOption(label="Permisos ACE", description="add_ace / add_principal en server.cfg.", value="ace", emoji="🔑"),
        ]
        super().__init__(placeholder="Elige un tutorial...", min_values=1, max_values=1, options=options, custom_id="tutoriales_select")

    async def callback(self, interaction: discord.Interaction):
        from .respuestas import RESPUESTAS
        from .intent_engine import INTENCIONES
        mapa = {
            "cfx": "licencia_cfx", "txadmin": "txadmin", "archivos": "archivos_ftp",
            "db": "mysql_db", "esx": "esx_scripts", "qb": "qbcore_scripts",
            "onesync": "onesync", "ace": "permisos_ace"
        }
        intencion = mapa.get(self.values[0])
        texto = RESPUESTAS.get(intencion, "No hay tutorial disponible para esta opción.")
        embed = discord.Embed(description=texto if isinstance(texto, str) else texto[0], color=RAGE_COLOR)
        await interaction.response.send_message(embed=embed, ephemeral=True)


class TutorialesView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(TutorialesSelect())


class AutoRolesView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    async def toggle_role(self, interaction: discord.Interaction, role_name: str):
        role = discord.utils.get(interaction.guild.roles, name=role_name)
        if not role:
            await interaction.response.send_message(f"⚠️ El rol `{role_name}` no existe.", ephemeral=True)
            return
        if role in interaction.user.roles:
            await interaction.user.remove_roles(role)
            await interaction.response.send_message(f"❌ Te quité el rol **{role_name}**.", ephemeral=True)
        else:
            await interaction.user.add_roles(role)
            await interaction.response.send_message(f"✅ Te di el rol **{role_name}**.", ephemeral=True)

    @discord.ui.button(label="Anuncios", style=discord.ButtonStyle.primary, custom_id="role_anuncios_btn", emoji="📢")
    async def btn_anuncios(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.toggle_role(interaction, ANUNCIOS_ROLE_NAME)

    @discord.ui.button(label="Mantenimientos", style=discord.ButtonStyle.secondary, custom_id="role_mantenimiento_btn", emoji="🛠️")
    async def btn_mantenimiento(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.toggle_role(interaction, MANTENIMIENTOS_ROLE_NAME)

    @discord.ui.button(label="Ofertas", style=discord.ButtonStyle.success, custom_id="role_ofertas_btn", emoji="🎁")
    async def btn_ofertas(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.toggle_role(interaction, OFERTAS_ROLE_NAME)


# 🚀 VISTA PREMIUM: CONTROL DE SERVIDORES
class ServerControlView(discord.ui.View):
    def __init__(self, bot, server_id, server_name):
        super().__init__(timeout=None)
        self.bot = bot
        self.server_id = server_id
        self.server_name = server_name

    async def call_api(self, interaction, action):
        await interaction.response.defer(ephemeral=True)
        from .main import API_URL_BASE, API_KEY
        try:
            async with self.bot.session.post(
                f"{API_URL_BASE}/control/{self.server_id}/{action}",
                headers={"x-api-key": API_KEY}
            ) as resp:
                if resp.status == 200:
                    emojis = {"start": "▶️", "stop": "⏹️", "restart": "🔄"}
                    await interaction.followup.send(
                        f"{emojis.get(action)} **Acción enviada:** El servidor **{self.server_name}** se está {action}ando.",
                        ephemeral=True
                    )
                else:
                    await interaction.followup.send(f"❌ Error de API ({resp.status}).", ephemeral=True)
        except Exception as e:
            logger.error(f"Error control server ({action}): {e}")
            await interaction.followup.send("⚠️ Error de conexión con la infraestructura.", ephemeral=True)

    @discord.ui.button(label="Iniciar", style=discord.ButtonStyle.success, emoji="▶️")
    async def btn_start(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.call_api(interaction, "start")

    @discord.ui.button(label="Detener", style=discord.ButtonStyle.danger, emoji="⏹️")
    async def btn_stop(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.call_api(interaction, "stop")

    @discord.ui.button(label="Reiniciar", style=discord.ButtonStyle.primary, emoji="🔄")
    async def btn_restart(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.call_api(interaction, "restart")

    @discord.ui.button(label="Diagnóstico", style=discord.ButtonStyle.secondary, emoji="📊")
    async def btn_diag(self, interaction: discord.Interaction, button: discord.ui.Button):
        # Reutilizar el comando existente
        from .comandos import Comandos
        cog = self.bot.get_cog("Comandos")
        if cog:
            # Creamos un contexto falso para invocar el comando
            # NOTA: En discord.py 2.0+ esto es un poco manual si no es un comando de barra
            ctx = await self.bot.get_context(interaction.message)
            ctx.author = interaction.user # Forzar que el autor sea quien pulsó el botón
            await cog.diagnostico.invoke(ctx)
        await interaction.response.send_message("📊 Generando informe...", ephemeral=True)


# 🛠️ VISTA DE REPARACIÓN (Self-Healing)
class RepairView(discord.ui.View):
    def __init__(self, bot, server_id, server_name):
        super().__init__(timeout=None)
        self.bot = bot
        self.server_id = server_id
        self.server_name = server_name

    @discord.ui.button(label="Reparar Servidor", style=discord.ButtonStyle.success, emoji="🛠️")
    async def btn_repair(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)
        from .main import API_URL_BASE, API_KEY
        try:
            async with self.bot.session.post(
                f"{API_URL_BASE}/repair/{self.server_id}",
                headers={"x-api-key": API_KEY}
            ) as resp:
                if resp.status == 200:
                    await interaction.followup.send(
                        "✅ **Mantenimiento completado.** He limpiado el caché, borrado logs de error y reiniciado el contenedor. Tu servidor debería estar online pronto.",
                        ephemeral=True
                    )
                else:
                    await interaction.followup.send("❌ Error durante la reparación. Contacta con soporte.", ephemeral=True)
        except Exception as e:
            logger.error(f"Error repair api: {e}")
            await interaction.followup.send("⚠️ Error de conexión.", ephemeral=True)


# 💡 VISTA DE SUGERENCIAS
class SuggestionView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        self.upvotes = 0
        self.downvotes = 0

    @discord.ui.button(label="Me gusta", style=discord.ButtonStyle.success, emoji="👍", custom_id="upvote_btn")
    async def upvote(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.upvotes += 1
        await self.update_embed(interaction)

    @discord.ui.button(label="No me gusta", style=discord.ButtonStyle.danger, emoji="👎", custom_id="downvote_btn")
    async def downvote(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.downvotes += 1
        await self.update_embed(interaction)

    async def update_embed(self, interaction):
        embed = interaction.message.embeds[0]
        # Actualizar el footer con los votos
        embed.set_footer(text=f"👍 {self.upvotes} | 👎 {self.downvotes} | RageNodes Community")
        await interaction.response.edit_message(embed=embed, view=self)
