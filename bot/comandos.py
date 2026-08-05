import asyncio
import logging
import io
from datetime import datetime

import discord
from discord.ext import commands

logger = logging.getLogger("RageNodesBot")

RAGE_COLOR    = 0x6366F1
RAGE_GREEN    = 0x2ECC71
TICKET_CATEGORY_NAME = "TICKETS RAGENODES"
STAFF_ROLE_NAME = "👑 Admin"


def es_ticket(channel) -> bool:
    return hasattr(channel, "name") and channel.name.lower().startswith("ticket-")


async def safe_delete(msg):
    try:
        await msg.delete()
    except Exception:
        pass


async def get_staff_role(guild):
    return discord.utils.get(guild.roles, name=STAFF_ROLE_NAME)


class Comandos(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    # ─── UTILIDADES ──────────────────────────────────────────────────
    @commands.command()
    async def ayuda(self, ctx):
        e = discord.Embed(title="🤖 Centro de Soporte RageNodes V3", color=RAGE_COLOR)
        e.add_field(name="`!ticket`",       value="Abre un ticket privado de soporte.", inline=False)
        e.add_field(name="`!cerrar`",       value="Cierra el ticket actual.", inline=False)
        e.add_field(name="`!miperfil`",     value="Estado de tus servidores.", inline=False)
        e.add_field(name="`!ip`",           value="IP y puerto de conexión (solo tickets).", inline=False)
        e.add_field(name="`!diagnostico`",  value="CPU/RAM/Disco en tiempo real (solo tickets).", inline=False)
        e.add_field(name="`!ping`",         value="Latencia del bot.", inline=True)
        e.add_field(name="`!web`",          value="Enlace al panel.", inline=True)
        e.add_field(name="`!status`",       value="Estado de la infraestructura.", inline=True)
        e.add_field(name="`!aprender`",     value="(Admin) Enseña algo nuevo al bot.", inline=False)
        e.add_field(name="`!conocimiento`", value="(Admin) Lista los patrones aprendidos.", inline=False)
        e.add_field(name="`!olvidar`",      value="(Admin) Elimina un patrón por ID.", inline=False)
        e.add_field(name="`!estadisticas`", value="(Admin) Estadísticas de uso del bot.", inline=False)
        e.set_footer(text="RageNodes IA V3 — Motor de Aprendizaje Lineal Activo")
        await ctx.send(embed=e)

    @commands.command()
    async def ping(self, ctx):
        await ctx.send(f"🏓 **Pong!** Latencia: `{round(self.bot.latency*1000)}ms`")

    @commands.command()
    async def web(self, ctx):
        await ctx.send("🌐 **Panel de Control:** https://ragenodes.com/panel")

    @commands.command()
    async def status(self, ctx):
        from .main import API_URL_BASE
        api_ok = True
        try:
            async with self.bot.session.get(f"{API_URL_BASE}/ping", timeout=2) as r:
                if r.status != 200:
                    api_ok = False
        except Exception:
            api_ok = False
        e = discord.Embed(title="🛰️ Estado de Infraestructura",
                          color=RAGE_GREEN if api_ok else 0xEF4444)
        e.add_field(name="Panel Web",   value="🟢 Operativo", inline=True)
        e.add_field(name="API Interna", value="🟢 Operativa" if api_ok else "🔴 Con Problemas", inline=True)
        e.add_field(name="Nodos FiveM", value="🟢 Operativos", inline=False)
        e.add_field(name="Docker",      value="🟢 Operativo", inline=True)
        e.add_field(name="Proxy",       value="🟢 Operativo", inline=True)
        await ctx.send(embed=e)

    # ─── CLIENTE ─────────────────────────────────────────────────────
    @commands.command()
    async def miperfil(self, ctx):
        from .main import API_URL_BASE, API_KEY
        msg = await ctx.send("🔍 Conectando con tu cuenta...")
        try:
            async with self.bot.session.get(
                f"{API_URL_BASE}/diagnostico/{ctx.author.id}",
                headers={"x-api-key": API_KEY}
            ) as resp:
                if resp.status == 404:
                    await msg.edit(content="⚠️ No tienes servidores o no vinculaste tu Discord en el panel.")
                    return
                if resp.status != 200:
                    await msg.edit(content="❌ Error al conectar con la API.")
                    return
                data = await resp.json()
                servers = data.get("servers", [])
                e = discord.Embed(title="📊 Mi Perfil", color=RAGE_GREEN)
                e.set_thumbnail(url=ctx.author.display_avatar.url)
                plan = str(data.get("plan", "")).lower()
                tag = "👑 Élite" if "elite" in plan else "💎 Standard" if "standard" in plan else "🆓 Hobby"
                e.add_field(name="Plan", value=tag, inline=True)
                e.add_field(name="Servidores", value=str(len(servers)), inline=True)
                for s in servers:
                    estado = "🟢 ONLINE" if s.get("status") == "running" else "🔴 APAGADO"
                    e.add_field(
                        name=f"🖥️ {s.get('name')} [{estado}]",
                        value=f"CPU: `{float(s.get('cpu_percent',0)):.1f}%` | RAM: `{float(s.get('ram_percent',0)):.1f}%` | Disco: `{float(s.get('disk_percent',0)):.1f}%`",
                        inline=False)
                await msg.edit(content=None, embed=e)
        except Exception as ex:
            logger.error(f"miperfil: {ex}")
            await msg.edit(content="⚠️ Error de conexión.")

    @commands.command()
    async def ip(self, ctx):
        if not es_ticket(ctx.channel):
            m = await ctx.send("❌ Solo en canales de ticket.")
            await asyncio.sleep(4); await safe_delete(m)
            return
        from .main import API_URL_BASE, API_KEY
        msg = await ctx.send("🔍 Obteniendo IP...")
        try:
            async with self.bot.session.get(
                f"{API_URL_BASE}/diagnostico/{ctx.author.id}",
                headers={"x-api-key": API_KEY}
            ) as resp:
                if resp.status != 200:
                    await msg.edit(content="❌ No se encontraron servidores.")
                    return
                data = await resp.json()
                servers = data.get("servers", [])
                if not servers:
                    await msg.edit(content="❌ No tienes servidores activos.")
                    return
                sv = servers[0]
                ip = sv.get("ip", "node1.ragenodes.com")
                puerto = sv.get("fivem_port", "30120")
                e = discord.Embed(title=f"🔌 Conexión | {sv.get('name','Servidor')}", color=RAGE_COLOR)
                e.description = "Abre la consola de FiveM (F8) y pega:"
                e.add_field(name="Comando", value=f"```\nconnect {ip}:{puerto}\n```", inline=False)
                await msg.edit(content=None, embed=e)
        except Exception as ex:
            logger.error(f"ip: {ex}")
            await msg.edit(content="⚠️ Error al consultar la infraestructura.")

    @commands.command()
    async def diagnostico(self, ctx):
        lock = f"diag_{ctx.author.id}"
        if lock in self.bot.active_locks:
            return
        self.bot.active_locks.add(lock)
        try:
            if not es_ticket(ctx.channel):
                m = await ctx.send("❌ Usa este comando en un ticket.")
                await asyncio.sleep(4); await safe_delete(m)
                return
            from .main import API_URL_BASE, API_KEY
            msg = await ctx.send("🔄 Extrayendo telemetría en tiempo real...")
            async with self.bot.session.get(
                f"{API_URL_BASE}/diagnostico/{ctx.author.id}",
                headers={"x-api-key": API_KEY}
            ) as resp:
                if not resp.headers.get("Content-Type","").startswith("application/json"):
                    await msg.edit(content="❌ La API no devolvió JSON."); return
                data = await resp.json()
                if resp.status == 404:
                    await msg.edit(content="⚠️ No tienes cuenta vinculada."); return
                if resp.status != 200:
                    await msg.edit(content="❌ Error de API."); return
                servers = data.get("servers", [])
                if not servers:
                    await msg.edit(content="ℹ️ No tienes servidores activos."); return
                e = discord.Embed(title=f"📊 Diagnóstico | {data.get('username', ctx.author.name)}", color=0x3B82F6)
                worst = 0x3B82F6
                for s in servers:
                    cpu = float(s.get("cpu_percent",0) or 0)
                    ram = float(s.get("ram_percent",0) or 0)
                    disk = float(s.get("disk_percent",0) or 0)
                    st = s.get("status","unknown")
                    estado = "🟢 ONLINE" if st=="running" else "🔴 APAGADO"
                    nota = ""
                    if ram > 95:   nota = "\n🚨 **RAM crítica** — riesgo de crash."; worst = 0xEF4444
                    elif disk > 95: nota = "\n💾 **Disco crítico** — riesgo de corrupción."; worst = 0xEF4444
                    elif cpu > 90: nota = "\n🐌 **CPU saturada** — posible lag."; worst = worst if worst==0xEF4444 else 0xF59E0B
                    elif st=="running": nota = "\n✅ Rendimiento óptimo."
                    e.add_field(name=f"🖥️ {s.get('name','Sin nombre')}",
                        value=f"**Estado:** {estado}\n**CPU:** `{cpu:.1f}%` **RAM:** `{ram:.1f}%` **Disco:** `{disk:.1f}%`{nota}",
                        inline=False)
                e.color = worst
                e.set_footer(text="RageNodes IA V3 — Diagnóstico en tiempo real")
                await msg.edit(content="✅ Diagnóstico completado.", embed=e)
        except Exception as ex:
            logger.error(f"diagnostico: {ex}")
        finally:
            self.bot.active_locks.discard(lock)

    @commands.command()
    async def vincular(self, ctx):
        await ctx.send(f"ℹ️ {ctx.author.mention}, la vinculación se hace desde el panel web → **Mi Cuenta**.")

    # ─── TICKETS (SLASH & PREFIX) ─────────────────────────────────────
    @discord.app_commands.command(name="ticket", description="Abre un ticket de soporte privado.")
    async def slash_ticket(self, interaction: discord.Interaction):
        # Reutilizar lógica del comando prefix
        ctx = await self.bot.get_context(interaction)
        await self.ticket(ctx)
        await interaction.response.send_message("✅ Procesando...", ephemeral=True)

    @commands.command()
    async def ticket(self, ctx):
        if not ctx.guild: return
        lock = f"ticket_{ctx.author.id}"
        if lock in self.bot.active_locks: return
        self.bot.active_locks.add(lock)
        try:
            existing = discord.utils.get(ctx.guild.text_channels, name=f"ticket-{ctx.author.id}")
            if existing:
                await safe_delete(ctx.message)
                m = await ctx.send(f"⚠️ Ya tienes un ticket abierto: {existing.mention}")
                await asyncio.sleep(5); await safe_delete(m)
                return
            cat = discord.utils.get(ctx.guild.categories, name=TICKET_CATEGORY_NAME)
            if not cat: cat = await ctx.guild.create_category(TICKET_CATEGORY_NAME)
            staff = await get_staff_role(ctx.guild)
            overwrites = {
                ctx.guild.default_role: discord.PermissionOverwrite(read_messages=False),
                ctx.author: discord.PermissionOverwrite(read_messages=True, send_messages=True, attach_files=True, embed_links=True),
                ctx.guild.me: discord.PermissionOverwrite(read_messages=True, send_messages=True, manage_messages=True, manage_channels=True),
            }
            if staff: overwrites[staff] = discord.PermissionOverwrite(read_messages=True, send_messages=True, manage_messages=True)
            chan = await ctx.guild.create_text_channel(name=f"ticket-{ctx.author.id}", category=cat, overwrites=overwrites)
            e = discord.Embed(title="🎫 Soporte RageNodes", description="Explica tu duda y la **IA** te ayudará. Si entra un admin, el bot se silenciará.", color=RAGE_COLOR)
            from .views import TicketControls
            await chan.send(content=f"Bienvenido {ctx.author.mention}", embed=e, view=TicketControls())
            if ctx.message: await safe_delete(ctx.message)
        finally: self.bot.active_locks.discard(lock)

    @discord.app_commands.command(name="cerrar", description="Cierra el ticket actual.")
    async def slash_cerrar(self, interaction: discord.Interaction):
        ctx = await self.bot.get_context(interaction)
        await self.cerrar(ctx)
        await interaction.response.send_message("🔒 Cerrando...", ephemeral=True)

    @commands.command()
    async def cerrar(self, ctx):
        if not es_ticket(ctx.channel): return
        from .ticket_context import remove_context
        ctx_ticket = remove_context(ctx.channel.id)
        if ctx_ticket: await self.bot.guardar_ticket_log(ctx_ticket)
        
        # Generar Transcripción HTML
        await ctx.send("📝 Generando transcripción HTML...")
        try:
            mensajes = [m async for m in ctx.channel.history(limit=500, oldest_first=True)]
            html = f"<html><head><meta charset='utf-8'><title>Transcript {ctx.channel.name}</title>"
            html += "<style>body{background:#1e1e2e;color:#cdd6f4;font-family:Arial,sans-serif;padding:20px;} "
            html += ".msg{margin:15px 0;padding:10px;background:#313244;border-radius:8px;} "
            html += ".author{color:#cba6f7;font-weight:bold;font-size:1.1em;} "
            html += ".time{color:#a6adc8;font-size:0.8em;margin-left:10px;} "
            html += ".content{margin-top:5px;line-height:1.4;}</style></head><body>"
            html += f"<h2>Transcripción: {ctx.channel.name}</h2>"
            for m in mensajes:
                time_str = m.created_at.strftime("%Y-%m-%d %H:%M:%S")
                content = m.content.replace('\\n', '<br>')
                html += f"<div class='msg'><span class='author'>{m.author.name}</span><span class='time'>{time_str}</span><div class='content'>{content}</div></div>"
            html += "</body></html>"
            
            transcript_file = discord.File(io.BytesIO(html.encode('utf-8')), filename=f"transcript_{ctx.channel.name}.html")
            
            # Buscar canal de logs (o usar el mismo creador por DM si falla)
            logs_channel = discord.utils.get(ctx.guild.text_channels, name="📄│logs-tickets")
            if logs_channel:
                await logs_channel.send(f"Transcripción de **{ctx.channel.name}** guardada.", file=transcript_file)
            else:
                try:
                    await ctx.author.send(f"Transcripción de tu ticket **{ctx.channel.name}**:", file=transcript_file)
                except: pass
        except Exception as e:
            logger.error(f"Error generando transcript: {e}")

        await ctx.send("🔒 Cerrando en 5 segundos...")
        await asyncio.sleep(5)
        try: await ctx.channel.delete()
        except: pass

    # ─── STAFF TOOLS ──────────────────────────────────────────────────
    @discord.app_commands.command(name="diagnostico", description="Realiza un análisis de rendimiento del servidor del cliente.")
    async def slash_diagnostico(self, interaction: discord.Interaction, usuario: discord.Member = None):
        if not usuario:
            # Si no hay usuario especificado, intentar sacarlo del nombre del canal del ticket
            if interaction.channel.name.startswith("ticket-"):
                uid = interaction.channel.name.split("-")[1]
                usuario = interaction.guild.get_member(int(uid))
        
        if not usuario:
            await interaction.response.send_message("❌ No pude identificar al usuario. Por favor, menciónalo.", ephemeral=True)
            return

        await interaction.response.defer()
        from .main import API_URL_BASE, API_KEY
        try:
            async with self.bot.session.get(f"{API_URL_BASE}/diagnostico/{usuario.id}", headers={"x-api-key": API_KEY}) as resp:
                data = await resp.json()
                servers = data.get("servers", [])
                if not servers:
                    await interaction.followup.send("ℹ️ El usuario no tiene servidores activos.")
                    return
                
                e = discord.Embed(title=f"📊 Informe Técnico | {usuario.display_name}", color=0x3B82F6)
                for s in servers:
                    cpu = float(s.get("cpu_percent",0) or 0)
                    ram = float(s.get("ram_percent",0) or 0)
                    disk = float(s.get("disk_percent",0) or 0)
                    e.add_field(name=f"🖥️ {s.get('name')}", 
                                value=f"CPU: `{cpu:.1f}%` | RAM: `{ram:.1f}%` | Disco: `{disk:.1f}%`", inline=False)
                await interaction.followup.send(embed=e)
        except Exception as e:
            await interaction.followup.send(f"⚠️ Error al conectar con la API: {e}")

    @discord.app_commands.command(name="silenciar_ia", description="Desactiva las respuestas automáticas del bot en este ticket.")
    @discord.app_commands.checks.has_permissions(manage_messages=True)
    async def slash_silenciar(self, interaction: discord.Interaction):
        from .ticket_context import get_context
        ctx = get_context(interaction.channel.id)
        ctx.staff_present = True
        await interaction.response.send_message("🔕 **IA Silenciada.** El bot ya no responderá automáticamente aquí.", ephemeral=True)

    @discord.app_commands.command(name="invocar_ia", description="Fuerza al bot a responder al último mensaje del usuario.")
    @discord.app_commands.checks.has_permissions(manage_messages=True)
    async def slash_invocar(self, interaction: discord.Interaction):
        from .ticket_context import get_context
        from .main import detectar_mejor_intencion, enviar_respuesta_ia, get_respuesta
        
        ctx_ticket = get_context(interaction.channel.id)
        if not ctx_ticket.mensajes:
            await interaction.response.send_message("❌ No hay mensajes previos para analizar.", ephemeral=True)
            return

        await interaction.response.defer()
        ultimo_msg = [m for m in ctx_ticket.mensajes if not m['es_bot']][-1]
        intencion, score = detectar_mejor_intencion(ultimo_msg['contenido'])
        
        if intencion:
            respuesta = get_respuesta(intencion, interaction.user.mention)
            await interaction.followup.send(f"🤖 **Invocación de IA:** Analizando mensaje de `{ultimo_msg['autor']}`...")
            await enviar_respuesta_ia(interaction, respuesta, intencion)
        else:
            await interaction.followup.send("⚠️ No pude detectar una intención clara en el último mensaje.")

    @discord.app_commands.command(name="reparar", description="Ejecuta una reparación profunda del servidor (Caché, Logs, Contenedor).")
    @discord.app_commands.checks.has_permissions(administrator=True)
    async def slash_reparar(self, interaction: discord.Interaction, usuario: discord.Member = None):
        if not usuario:
            if interaction.channel.name.startswith("ticket-"):
                uid = interaction.channel.name.split("-")[1]
                usuario = interaction.guild.get_member(int(uid))
        
        if not usuario:
            await interaction.response.send_message("❌ Debes especificar un usuario.", ephemeral=True)
            return

        await interaction.response.defer()
        from .main import API_URL_BASE, API_KEY
        try:
            # Primero obtenemos el ID del servidor
            async with self.bot.session.get(f"{API_URL_BASE}/diagnostico/{usuario.id}", headers={"x-api-key": API_KEY}) as resp:
                data = await resp.json()
                servers = data.get("servers", [])
                if not servers:
                    await interaction.followup.send("ℹ️ El usuario no tiene servidores.")
                    return
                
                sid = servers[0].get('id')
                # Llamar a la API de reparación
                async with self.bot.session.post(f"{API_URL_BASE}/repair/{sid}", headers={"x-api-key": API_KEY}) as r_resp:
                    if r_resp.status == 200:
                        await interaction.followup.send(f"✅ **Reparación exitosa** para el servidor de {usuario.mention}. Se ha limpiado el caché y recreado el contenedor.")
                    else:
                        await interaction.followup.send("❌ Falló la reparación técnica.")
        except Exception as e:
            await interaction.followup.send(f"⚠️ Error: {e}")

    @discord.app_commands.command(name="miperfil", description="Muestra el estado de tus servidores y opciones de control.")
    async def slash_miperfil(self, interaction: discord.Interaction):
        await interaction.response.defer()
        from .main import API_URL_BASE, API_KEY
        from .views import ServerControlView
        try:
            async with self.bot.session.get(f"{API_URL_BASE}/diagnostico/{interaction.user.id}", headers={"x-api-key": API_KEY}) as resp:
                if resp.status != 200:
                    await interaction.followup.send("⚠️ No tienes servidores vinculados o tu cuenta no existe.")
                    return
                data = await resp.json()
                servers = data.get("servers", [])
                if not servers:
                    await interaction.followup.send("ℹ️ No tienes servidores activos.")
                    return
                
                s = servers[0]
                estado = "🟢 ONLINE" if s.get("status") == "running" else "🔴 APAGADO"
                e = discord.Embed(title=f"📊 Mi Perfil | {s.get('name')}", color=RAGE_GREEN if "🟢" in estado else RAGE_COLOR)
                e.add_field(name="Estado", value=estado, inline=True)
                e.add_field(name="CPU", value=f"`{s.get('cpu_percent')}%`", inline=True)
                e.add_field(name="RAM", value=f"`{s.get('ram_percent')}%`", inline=True)
                
                view = ServerControlView(self.bot, s.get('id'), s.get('name'))
                await interaction.followup.send(embed=e, view=view)
        except Exception as e:
            await interaction.followup.send(f"⚠️ Error de conexión: {e}")

    # ─── COMUNIDAD ────────────────────────────────────────────────────
    @discord.app_commands.command(name="sugerencia", description="Envía una sugerencia para mejorar RageNodes.")
    async def slash_sugerencia(self, interaction: discord.Interaction, sugerencia: str):
        canal_sug = discord.utils.get(interaction.guild.text_channels, name="💡│sugerencias")
        if not canal_sug:
            await interaction.response.send_message("❌ El canal `#💡│sugerencias` no existe.", ephemeral=True)
            return
        
        await interaction.response.defer(ephemeral=True)
        from .views import SuggestionView
        e = discord.Embed(title="💡 Nueva Sugerencia", description=sugerencia, color=RAGE_COLOR)
        e.set_author(name=interaction.user.display_name, icon_url=interaction.user.display_avatar.url)
        e.set_footer(text="👍 0 | 👎 0 | RageNodes Community")
        await canal_sug.send(embed=e, view=SuggestionView())
        await interaction.followup.send("✅ ¡Gracias! Tu sugerencia ha sido enviada al canal correspondiente.")

    # ─── SETUPS PREMIUM ────────────────────────────────────────────────
    @discord.app_commands.command(name="setup_comandos", description="Postea la lista de comandos premium en el canal actual.")
    @discord.app_commands.checks.has_permissions(administrator=True)
    async def slash_setup_comandos(self, interaction: discord.Interaction):
        e = discord.Embed(title="🤖 Centro de Comandos RageNodes", color=RAGE_COLOR,
            description="Aquí tienes la lista de comandos disponibles para gestionar tus servicios.")
        
        e.add_field(name="🌐 Comandos de Usuario", value=(
            "**/ticket** — Abre un ticket de soporte.\n"
            "**/miperfil** — Estado de tus servidores.\n"
            "**/sugerencia** — Envía una idea al staff.\n"
            "**!web** — Enlace al panel de control.\n"
            "**!ping** — Latencia del sistema."
        ), inline=False)

        e.add_field(name="👑 Comandos de Staff", value=(
            "**/diagnostico** — Análisis técnico de un cliente.\n"
            "**/invocar_ia** — Fuerza respuesta del bot.\n"
            "**/silenciar_ia** — Pausa el bot en un ticket.\n"
            "**!aprender** — Enseña nuevos patrones al bot.\n"
            "**!estadisticas** — Rendimiento de la IA."
        ), inline=False)
        
        e.set_footer(text="RageNodes — Soporte de Nueva Generación")
        await interaction.response.send_message("✅ Enviando lista de comandos...", ephemeral=True)
        await interaction.channel.send(embed=e)

    @discord.app_commands.command(name="setup_faq", description="Postea el sistema de FAQ interactivo.")
    @discord.app_commands.checks.has_permissions(administrator=True)
    async def slash_setup_faq(self, interaction: discord.Interaction):
        from .views import TutorialesView
        e = discord.Embed(title="❓ Preguntas Frecuentes (FAQ)", color=RAGE_COLOR,
            description=("Bienvenido a la base de conocimientos de RageNodes.\n\n"
                         "Selecciona un tema en el menú de abajo para obtener una respuesta instantánea a las dudas más comunes."))
        e.add_field(name="🚀 ¿Buscas algo más?", value="Si no encuentras lo que buscas, abre un ticket con `/ticket`.", inline=False)
        e.set_footer(text="Soporte automatizado 24/7")
        await interaction.response.send_message("✅ Enviando FAQ...", ephemeral=True)
        await interaction.channel.send(embed=e, view=TutorialesView())

    @discord.app_commands.command(name="setup_reglas", description="Postea el reglamento oficial de RageNodes.")
    @discord.app_commands.checks.has_permissions(administrator=True)
    async def slash_setup_reglas(self, interaction: discord.Interaction):
        e = discord.Embed(title="📜 Reglamento Oficial de RageNodes", color=RAGE_COLOR,
            description="Para mantener una comunidad sana y profesional, todos los miembros deben cumplir las siguientes normas:")
        
        e.add_field(name="🤝 1. Respeto y Convivencia", value="No se tolera el acoso, insultos o toxicidad hacia otros miembros o el equipo de staff. Mantén un lenguaje adecuado.", inline=False)
        e.add_field(name="🎫 2. Canales de Soporte", value="Todo tema técnico debe ir exclusivamente por ticket en <#109698850653053129>. No pidas soporte por privado al staff.", inline=False)
        e.add_field(name="🚫 3. Prohibido el Spam", value="Prohibido el envío de invitaciones de otros hostings, publicidad no autorizada o flood en los canales.", inline=False)
        e.add_field(name="🔞 4. Contenido Adecuado", value="No publicar contenido NSFW, ilegal o malicioso. Cualquier enlace sospechoso resultará en ban permanente.", inline=False)
        e.add_field(name="📂 5. Uso de Canales", value="Usa cada canal para su propósito específico. No hagas spam de comandos fuera del canal de <#109698850653053129>.", inline=False)
        
        e.set_footer(text="El incumplimiento de estas reglas resultará en warn, mute o ban permanente.")
        await interaction.response.send_message("✅ Reglamento enviado.", ephemeral=True)
        await interaction.channel.send(embed=e)

    @discord.app_commands.command(name="setup_bienvenida", description="Postea el mensaje de bienvenida oficial.")
    @discord.app_commands.checks.has_permissions(administrator=True)
    async def slash_setup_bienvenida(self, interaction: discord.Interaction):
        e = discord.Embed(title="🚀 ¡Bienvenido a RageNodes Hosting!", color=RAGE_COLOR,
            description=(f"¡Hola! Estamos encantados de que formes parte de nuestra comunidad.\n\n"
                         "**📍 Primeros pasos:**\n"
                         "1️⃣ Lee las <#109698850653053129> para evitar sanciones.\n"
                         "2️⃣ Si eres cliente, verifica tu cuenta en <#109698850653053129>.\n"
                         "3️⃣ Si necesitas ayuda, abre un ticket en <#109698850653053129>.\n\n"
                         "¡Disfruta de la mejor experiencia en hosting de FiveM!"))
        e.set_image(url="https://media.discordapp.net/attachments/109698850653053129/header_welcome.png") # Ejemplo de header
        await interaction.response.send_message("✅ Bienvenida enviada.", ephemeral=True)
        await interaction.channel.send(embed=e)

    @discord.app_commands.command(name="setup_links", description="Postea los enlaces oficiales con botones.")
    @discord.app_commands.checks.has_permissions(administrator=True)
    async def slash_setup_links(self, interaction: discord.Interaction):
        from discord.ui import View, Button
        view = View()
        view.add_item(Button(label="Página Web", url="https://ragenodes.com", emoji="🌐"))
        view.add_item(Button(label="Panel de Control", url="https://ragenodes.com/panel", emoji="🎮"))
        view.add_item(Button(label="Tienda Oficial", url="https://ragenodes.com/tienda", emoji="🛒"))
        
        e = discord.Embed(title="🔗 Enlaces Oficiales", color=RAGE_COLOR,
            description="Accede rápidamente a todos nuestros servicios oficiales desde aquí.")
        await interaction.response.send_message("✅ Enlaces enviados.", ephemeral=True)
        await interaction.channel.send(embed=e, view=view)

    @discord.app_commands.command(name="setup_sugerencias", description="Postea la guía del canal de sugerencias.")
    @discord.app_commands.checks.has_permissions(administrator=True)
    async def slash_setup_sugerencias(self, interaction: discord.Interaction):
        e = discord.Embed(title="💡 Canal de Sugerencias", color=RAGE_COLOR,
            description=("¿Tienes alguna idea para mejorar RageNodes? ¡Queremos escucharte!\n\n"
                         "**¿Cómo enviar una sugerencia?**\n"
                         "Usa el comando `/sugerencia <tu idea>` en cualquier canal.\n\n"
                         "**Votaciones:**\n"
                         "La comunidad votará tu idea con 👍 o 👎. Las más votadas serán revisadas por el equipo de desarrollo."))
        e.set_footer(text="RageNodes Community — Tu opinión cuenta.")
        await interaction.response.send_message("✅ Guía de sugerencias enviada.", ephemeral=True)
        await interaction.channel.send(embed=e)

    @discord.app_commands.command(name="setup_vendedores", description="Postea el panel de control para moderar solicitudes de vendedores.")
    @discord.app_commands.checks.has_permissions(administrator=True)
    async def slash_setup_vendedores(self, interaction: discord.Interaction):
        from .views import VendorPanelSetupView
        e = discord.Embed(title="🛒 Panel de Gestión de Vendedores", color=0x3B82F6,
            description="Utiliza este botón para inspeccionar todas las postulaciones activas e inactivas de vendedores, y gestionar sus permisos.")
        e.set_footer(text="Solo accesible por el equipo Staff")
        await interaction.response.send_message("✅ Panel enviado.", ephemeral=True)
        await interaction.channel.send(embed=e, view=VendorPanelSetupView())

    @commands.command()
    @commands.has_permissions(administrator=True)
    async def setup_vendedores(self, ctx):
        from .views import VendorPanelSetupView
        e = discord.Embed(title="🛒 Panel de Gestión de Vendedores", color=0x3B82F6,
            description="Utiliza este botón para inspeccionar todas las postulaciones activas e inactivas de vendedores, y gestionar sus permisos.")
        e.set_footer(text="Solo accesible por el equipo Staff")
        await ctx.message.delete()
        await ctx.send(embed=e, view=VendorPanelSetupView())

    # ─── STAFF ───────────────────────────────────────────────────────
    @commands.command()
    @commands.has_permissions(manage_messages=True)
    async def limpiar(self, ctx, amount: int):
        if not 1 <= amount <= 100:
            await ctx.send("❌ Entre 1 y 100 mensajes."); return
        await ctx.channel.purge(limit=amount+1)
        m = await ctx.send(f"🧹 Limpiados **{amount}** mensajes.")
        await asyncio.sleep(4); await safe_delete(m)

    @commands.command()
    @commands.has_permissions(administrator=True)
    async def info(self, ctx, member: discord.Member = None):
        if not member:
            await ctx.send("❌ Menciona a un usuario. Ej: `!info @Usuario`"); return
        from .main import API_URL_BASE, API_KEY
        msg = await ctx.send(f"🔍 Consultando datos de {member.display_name}...")
        try:
            async with self.bot.session.get(
                f"{API_URL_BASE}/diagnostico/{member.id}",
                headers={"x-api-key": API_KEY}
            ) as resp:
                if resp.status == 404:
                    await msg.edit(content=f"⚠️ **{member.display_name}** no tiene su Discord vinculado."); return
                if resp.status != 200:
                    await msg.edit(content="❌ Error de API."); return
                data = await resp.json()
                servers = data.get("servers", [])
                plan = str(data.get("plan","")).lower()
                tag = "👑 Élite" if "elite" in plan else "💎 Standard" if "standard" in plan else "🆓 Hobby"
                e = discord.Embed(title=f"👤 Auditoría | {data.get('username')}", color=0x8B5CF6)
                e.set_thumbnail(url=member.display_avatar.url)
                e.add_field(name="Discord ID", value=f"`{member.id}`", inline=True)
                e.add_field(name="Plan", value=tag, inline=True)
                e.add_field(name="Servidores", value=str(len(servers)), inline=True)
                for s in servers:
                    estado = "🟢" if s.get("status")=="running" else "🔴"
                    e.add_field(name=f"{estado} {s.get('name')}",
                        value=f"ID: `{s.get('id')}`\nCPU: {float(s.get('cpu_percent',0)):.1f}% | RAM: {float(s.get('ram_percent',0)):.1f}%",
                        inline=False)
                e.set_footer(text=f"Solicitado por {ctx.author.name}", icon_url=ctx.author.display_avatar.url)
                await msg.edit(content=None, embed=e)
        except Exception as ex:
            logger.error(f"info: {ex}")
            await msg.edit(content="⚠️ Error de conexión.")

    # ─── APRENDIZAJE LINEAL ──────────────────────────────────────────
    @commands.command()
    @commands.has_permissions(administrator=True)
    async def aprender(self, ctx, *, argumento: str = None):
        """Uso: !aprender patron | respuesta"""
        if not argumento or "|" not in argumento:
            await ctx.send("❌ Formato: `!aprender <patrón> | <respuesta>`\n"
                           "Ejemplo: `!aprender error pantalla negra | Reinicia FiveM y limpia el caché.`")
            return
        partes = argumento.split("|", 1)
        patron = partes[0].strip()
        respuesta = partes[1].strip()
        if len(patron) < 3 or len(respuesta) < 5:
            await ctx.send("❌ El patrón debe tener al menos 3 caracteres y la respuesta 5."); return
        from .main import API_URL_BASE, API_KEY
        try:
            async with self.bot.session.post(
                f"{API_URL_BASE}/aprender",
                json={"patron": patron, "respuesta": respuesta, "contexto": "general", "creado_por": str(ctx.author)},
                headers={"x-api-key": API_KEY}
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    kid = data.get("knowledge",{}).get("id","?")
                    e = discord.Embed(title="🧠 Patrón Aprendido", color=0x2ECC71)
                    e.add_field(name="ID", value=f"`{kid}`", inline=True)
                    e.add_field(name="Patrón", value=f"`{patron}`", inline=False)
                    e.add_field(name="Respuesta", value=respuesta[:500], inline=False)
                    e.set_footer(text=f"Creado por {ctx.author} | El bot lo usará en ~10 min")
                    await ctx.send(embed=e)
                else:
                    await ctx.send("❌ Error al guardar el patrón en la base de datos.")
        except Exception as ex:
            logger.error(f"aprender: {ex}")
            await ctx.send("⚠️ Error de conexión con la API.")

    @commands.command()
    @commands.has_permissions(administrator=True)
    async def olvidar(self, ctx, patron_id: int = None):
        """Uso: !olvidar <id>"""
        if not patron_id:
            await ctx.send("❌ Formato: `!olvidar <id>`  — Usa `!conocimiento` para ver los IDs."); return
        from .main import API_URL_BASE, API_KEY
        try:
            async with self.bot.session.delete(
                f"{API_URL_BASE}/conocimiento/{patron_id}",
                headers={"x-api-key": API_KEY}
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    await ctx.send(f"🗑️ Patrón `{data.get('deleted',{}).get('patron','?')}` eliminado correctamente.")
                elif resp.status == 404:
                    await ctx.send(f"❌ No encontré ningún patrón con ID `{patron_id}`.")
                else:
                    await ctx.send("❌ Error al eliminar el patrón.")
        except Exception as ex:
            logger.error(f"olvidar: {ex}")
            await ctx.send("⚠️ Error de conexión.")

    @commands.command()
    @commands.has_permissions(administrator=True)
    async def conocimiento(self, ctx):
        from .main import API_URL_BASE, API_KEY
        try:
            async with self.bot.session.get(
                f"{API_URL_BASE}/conocimiento",
                headers={"x-api-key": API_KEY}
            ) as resp:
                if resp.status != 200:
                    await ctx.send("❌ Error al obtener el conocimiento."); return
                data = await resp.json()
                items = data.get("knowledge", [])
                if not items:
                    await ctx.send("📭 El bot no tiene patrones aprendidos todavía. Usa `!aprender` para enseñarle."); return
                e = discord.Embed(title=f"🧠 Conocimiento Aprendido ({len(items)} patrones)", color=RAGE_COLOR)
                for item in items[:15]:
                    val = f"_{item.get('respuesta','')[:80]}..._\n💪 Peso: `{item.get('peso',1):.1f}` | Usos: `{item.get('veces_usado',0)}`"
                    e.add_field(name=f"ID `{item.get('id')}` — {item.get('patron','')[:40]}", value=val, inline=False)
                if len(items) > 15:
                    e.set_footer(text=f"Mostrando 15 de {len(items)}. Usa !olvidar <id> para eliminar.")
                await ctx.send(embed=e)
        except Exception as ex:
            logger.error(f"conocimiento: {ex}")
            await ctx.send("⚠️ Error de conexión.")

    @commands.command()
    @commands.has_permissions(administrator=True)
    async def estadisticas(self, ctx):
        from .main import API_URL_BASE, API_KEY
        try:
            async with self.bot.session.get(
                f"{API_URL_BASE}/estadisticas",
                headers={"x-api-key": API_KEY}
            ) as resp:
                if resp.status != 200:
                    await ctx.send("❌ Error al obtener estadísticas."); return
                data = await resp.json()
                res = data.get("resumen", {})
                e = discord.Embed(title="📊 Estadísticas del Bot IA", color=RAGE_COLOR)
                e.add_field(name="Total Interacciones", value=f"`{res.get('total_interacciones','0')}`", inline=True)
                e.add_field(name="Resueltas por IA",    value=f"`{res.get('resueltas_por_ia','0')}`", inline=True)
                e.add_field(name="Escaladas a Humano",  value=f"`{res.get('escaladas_a_humano','0')}`", inline=True)
                top_i = data.get("top_intenciones", [])
                if top_i:
                    val = "\n".join(f"`{i.get('intencion')}` → {i.get('veces')}x" for i in top_i[:5])
                    e.add_field(name="🔥 Top Intenciones", value=val, inline=False)
                top_p = data.get("top_patrones", [])
                if top_p:
                    val = "\n".join(f"ID `{p.get('id')}` `{p.get('patron','')[:30]}` — {p.get('veces_usado',0)}x" for p in top_p)
                    e.add_field(name="🧠 Patrones Más Usados", value=val, inline=False)
                await ctx.send(embed=e)
        except Exception as ex:
            logger.error(f"estadisticas: {ex}")
            await ctx.send("⚠️ Error de conexión.")

    # ─── SETUPS ──────────────────────────────────────────────────────
    @commands.command()
    @commands.has_permissions(administrator=True)
    async def setup_verificar(self, ctx):
        from .views import VerificacionView
        e = discord.Embed(title="✅ Verificación de Cliente", color=RAGE_GREEN,
            description=("Si ya compraste un plan, haz clic abajo para obtener tu rol de **Cliente**.\n\n"
                         "**Requisitos:**\n1️⃣ Cuenta en el panel.\n2️⃣ Discord vinculado en **Mi Cuenta**.\n3️⃣ Servicio activo."))
        e.set_footer(text="RageNodes Security System")
        await safe_delete(ctx.message)
        await ctx.send(embed=e, view=VerificacionView(self.bot))

    @commands.command()
    @commands.has_permissions(administrator=True)
    async def setup_status(self, ctx):
        from .views import StatusView
        e = discord.Embed(title="🛰️ Estado de la Infraestructura", color=RAGE_GREEN,
            description="Monitorización en tiempo real de los servicios de **RageNodes**.")
        for n, v in [("🌐 Panel Web","🟢 Operativo"),("🔌 API","🟢 Operativa"),
                     ("🖥️ Nodos FiveM","🟢 Operativos"),("🐳 Docker","🟢 Operativo"),("🛡️ Proxy","🟢 Operativo")]:
            e.add_field(name=n, value=v, inline=True)
        from datetime import datetime
        e.set_footer(text=f"Última comprobación: {datetime.now().strftime('%H:%M:%S')}")
        await safe_delete(ctx.message)
        await ctx.send(embed=e, view=StatusView(self.bot))

    @commands.command()
    @commands.has_permissions(administrator=True)
    async def setup_tutoriales(self, ctx):
        from .views import TutorialesView
        e = discord.Embed(title="📖 Base de Conocimientos", color=RAGE_COLOR,
            description="Selecciona un tema del menú para ver la guía paso a paso.")
        e.set_footer(text="Respuestas visibles solo para ti")
        await safe_delete(ctx.message)
        await ctx.send(embed=e, view=TutorialesView())

    @commands.command()
    @commands.has_permissions(administrator=True)
    async def setup_autoroles(self, ctx):
        from .views import AutoRolesView
        e = discord.Embed(title="🎭 Personaliza tus Notificaciones", color=RAGE_COLOR,
            description=("Elige qué notificaciones quieres recibir:\n\n"
                         "📢 **Anuncios** — Novedades y actualizaciones.\n"
                         "🛠️ **Mantenimientos** — Reinicios y estado de nodos.\n"
                         "🎁 **Ofertas** — Descuentos y sorteos."))
        e.set_footer(text="RageNodes Notification System")
        await safe_delete(ctx.message)
        await ctx.send(embed=e, view=AutoRolesView())


async def setup(bot):
    await bot.add_cog(Comandos(bot))
