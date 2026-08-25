import os, asyncio, aiohttp, time, logging, random
from datetime import datetime
from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

import discord
from discord.ext import commands, tasks

from .intent_engine import detectar_mejor_intencion, extraer_entidades, puntuar_intencion
from .respuestas import get_respuesta
from .ticket_context import get_context, remove_context, limpiar_contextos_viejos
from .views import (TicketControls, VerificacionView, StatusView,
                    TutorialesView, AutoRolesView, ServerControlView, RepairView, SuggestionView, VendorPanelSetupView, VendorActionView, VendorRevokeView, safe_delete, RAGE_COLOR,
                    RAGE_GREEN, RAGE_RED_ALERT, STAFF_ROLE_NAME, CLIENTE_ROLE_NAME)

logging.basicConfig(level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S')
logger = logging.getLogger("RageNodesBot")

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN", "")
NODE_ENV      = os.getenv("NODE_ENV", "development").lower()
API_KEY       = os.getenv("DISCORD_API_KEY", "")
if not API_KEY and NODE_ENV != "production":
    API_KEY = os.getenv("API_KEY", "")
API_URL_BASE  = os.getenv("API_URL_BASE", "http://172.17.0.1:3010/api/discord")
TICKET_CATEGORY_NAME = "TICKETS RAGENODES"
USUARIO_ROLE_NAME    = "👥 Usuario"
ANTI_SPAM_SECONDS    = 2.5
CONOCIMIENTO_RELOAD_INTERVAL = 600  # 10 min


class RageNodesBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.members = True
        super().__init__(command_prefix="!", intents=intents, help_command=None)
        self.session: aiohttp.ClientSession = None
        self.active_locks: set = set()
        self.anti_spam_cache: dict = {}
        self.conocimiento: list = []  # patrones aprendidos en memoria
        self.proxy_alerts_cache: set = set()

    async def setup_hook(self):
        self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8))
        self.add_view(TicketControls())
        self.add_view(VerificacionView(self))
        self.add_view(StatusView(self))
        self.add_view(TutorialesView())
        self.add_view(AutoRolesView())
        self.add_view(VendorPanelSetupView())
        self.add_view(VendorActionView(self))
        self.add_view(VendorRevokeView(self))
        await self.load_extension("bot.comandos")
        guild = discord.Object(id=1496594596266905893)
        self.tree.copy_global_to(guild=guild)
        await self.tree.sync(guild=guild)
        await self.tree.sync()
        self.recargar_conocimiento.start()
        self.limpiar_cache.start()
        self.monitor_oxide_proxy.start()
        logger.info("Vistas persistentes y comandos registrados.")

    async def close(self):
        self.recargar_conocimiento.cancel()
        self.limpiar_cache.cancel()
        self.monitor_oxide_proxy.cancel()
        if self.session:
            await self.session.close()
        await super().close()

    @tasks.loop(seconds=CONOCIMIENTO_RELOAD_INTERVAL)
    async def recargar_conocimiento(self):
        try:
            async with self.session.get(
                f"{API_URL_BASE}/conocimiento",
                headers={"x-api-key": API_KEY}
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.conocimiento = data.get("knowledge", [])
                    logger.info(f"🧠 Conocimiento recargado: {len(self.conocimiento)} patrones.")
        except Exception as e:
            logger.warning(f"No se pudo recargar conocimiento: {e}")

    @tasks.loop(hours=6)
    async def limpiar_cache(self):
        limpiar_contextos_viejos(horas=24)
        ahora = time.time()
        self.anti_spam_cache = {k: v for k, v in self.anti_spam_cache.items() if ahora - v < 600}
        # Limpiar caché de alertas cada 6h para que no crezca infinito
        if len(self.proxy_alerts_cache) > 1000:
            self.proxy_alerts_cache.clear()

    @tasks.loop(seconds=15)
    async def monitor_oxide_proxy(self):
        try:
            async with self.session.get(
                f"{API_URL_BASE}/logs?game_id=SYS",
                headers={"x-api-key": API_KEY}
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    logs = data.get("logs", [])
                    if not logs: return
                    
                    guild = None
                    if self.guilds:
                        guild = self.guilds[0]
                    if not guild: return
                    
                    channel = discord.utils.get(guild.text_channels, name="🛡️│proxy-alerts")
                    if not channel: return
                    
                    for log in reversed(logs): # Procesar los más antiguos primero
                        msg = log.get("message", "")
                        timestamp = log.get("timestamp", "")
                        lvl = str(log.get("level", "")).upper()
                        cache_key = f"{timestamp}-{msg}"
                        
                        if cache_key in self.proxy_alerts_cache: continue
                        self.proxy_alerts_cache.add(cache_key)
                        
                        if "Bloqueado" in msg or "ataque" in msg.lower() or "ERROR" in lvl or "WARN" in lvl:
                            color = 0xEF4444 if "ERROR" in lvl else 0xF59E0B
                            e = discord.Embed(title="🛡️ Alerta de Seguridad | OxideProxy L7", color=color)
                            e.description = f"```\\n{msg}\\n```"
                            e.set_footer(text=f"GameID: SYS | Timestamp: {timestamp}")
                            await channel.send(embed=e)
        except Exception as e:
            pass

    def buscar_en_conocimiento(self, texto: str) -> dict | None:
        """Busca en patrones aprendidos por admins. Retorna el mejor match o None."""
        texto_lower = texto.lower()
        mejor = None
        mejor_peso = 0.0
        for patron_obj in self.conocimiento:
            patron = patron_obj.get("patron", "").lower()
            if not patron:
                continue
            # Match exacto
            if patron in texto_lower:
                peso = float(patron_obj.get("peso", 1.0)) * 2.0
            else:
                # Match difuso por palabras
                palabras_patron = set(patron.split())
                palabras_texto  = set(texto_lower.split())
                coincidencias = len(palabras_patron & palabras_texto)
                if coincidencias == 0:
                    continue
                peso = float(patron_obj.get("peso", 1.0)) * (coincidencias / len(palabras_patron))
            if peso > mejor_peso and peso >= 0.6:
                mejor_peso = peso
                mejor = patron_obj
        return mejor

    async def registrar_uso_patron(self, patron_id: int):
        try:
            async with self.session.post(
                f"{API_URL_BASE}/conocimiento/{patron_id}/uso",
                headers={"x-api-key": API_KEY}
            ) as _:
                pass
        except Exception:
            pass

    async def registrar_estadistica(self, intencion: str, resuelto: bool, escalado: bool, patron_id=None):
        try:
            async with self.session.post(
                f"{API_URL_BASE}/estadistica",
                json={"intencion": intencion, "resuelto": resuelto, "escalado": escalado, "patron_id": patron_id},
                headers={"x-api-key": API_KEY}
            ) as _:
                pass
        except Exception:
            pass

    async def guardar_ticket_log(self, ctx_ticket):
        try:
            async with self.session.post(
                f"{API_URL_BASE}/ticket-log",
                json=ctx_ticket.to_log_dict(),
                headers={"x-api-key": API_KEY}
            ) as _:
                pass
        except Exception:
            pass


bot = RageNodesBot()


def es_ticket(channel) -> bool:
    return hasattr(channel, "name") and channel.name.lower().startswith("ticket-")


async def get_staff_role(guild):
    return discord.utils.get(guild.roles, name=STAFF_ROLE_NAME)


async def enviar_respuesta_ia(message, respuesta: str, intencion: str = "", view: discord.ui.View = None):
    embed = discord.Embed(
        title="💡 Asistente Automático RageNodes",
        description=respuesta,
        color=discord.Color.gold()
    )
    if intencion:
        embed.set_footer(text=f"Categoría detectada: {intencion} | Si esto no resuelve tu duda, un admin te atenderá.")
    else:
        embed.set_footer(text="Si esto no resuelve tu duda, un admin te atenderá.")
    
    await message.channel.send(embed=embed, view=view)


@bot.event
async def on_ready():
    logger.info("=" * 50)
    logger.info(f"✅ Bot conectado como: {bot.user}")
    logger.info("🧠 Motor IA V3 con aprendizaje lineal activo")
    logger.info("=" * 50)
    
    # 🌲 Sincronizar Slash Commands
    try:
        synced = await bot.tree.sync()
        logger.info(f"🌲 Sincronizados {len(synced)} comandos de barra.")
    except Exception as e:
        logger.error(f"Error sincronizando comandos: {e}")

    await bot.change_presence(
        activity=discord.Activity(type=discord.ActivityType.listening, name="a los clientes | !ayuda"))


@bot.event
async def on_member_join(member):
    try:
        rol_usuario = discord.utils.get(member.guild.roles, name=USUARIO_ROLE_NAME)
        if rol_usuario:
            await member.add_roles(rol_usuario)
    except Exception as e:
        logger.error(f"Error asignando rol de usuario: {e}")

    canal = discord.utils.get(member.guild.text_channels, name="👋│bienvenida")
    if canal:
        embed = discord.Embed(
            title="🚀 ¡Bienvenido a RageNodes!",
            description=(
                f"¡Hola {member.mention}! Estamos encantados de tenerte aquí.\n\n"
                "**🛠️ ¿Por dónde empezar?**\n"
                "• Lee las **reglas** del servidor.\n"
                "• Si ya compraste un plan, ve a `#✅│verificar-cliente`.\n"
                "• Personaliza notificaciones en `#🎭│autoroles`.\n"
                "• Para soporte, abre un ticket con `!ticket`."
            ),
            color=RAGE_COLOR
        )
        if member.display_avatar:
            embed.set_thumbnail(url=member.display_avatar.url)
        embed.set_footer(text=f"¡Ya somos {member.guild.member_count} miembros!")
        await canal.send(content=f"¡Bienvenido {member.mention}!", embed=embed)


@bot.event
async def on_message(message):
    if message.author.bot:
        return

    # Anti-spam
    ahora = time.time()
    bot.anti_spam_cache = {k: v for k, v in bot.anti_spam_cache.items() if ahora - v < 600}
    if ahora - bot.anti_spam_cache.get(message.author.id, 0) < ANTI_SPAM_SECONDS:
        await safe_delete(message)
        return
    bot.anti_spam_cache[message.author.id] = ahora

    if message.content.startswith("!"):
        await bot.process_commands(message)
        return

    if not es_ticket(message.channel):
        return

    ctx_ticket = get_context(message.channel.id, message.author.id, str(message.author))

    # 🛡️ DETECCIÓN DE STAFF: Si entra un admin, el bot se silencia
    es_staff = False
    for rol in message.author.roles:
        if rol.name == STAFF_ROLE_NAME or rol.permissions.manage_messages or rol.permissions.administrator:
            es_staff = True
            break

    if es_staff:
        if not ctx_ticket.staff_present:
            ctx_ticket.staff_present = True
            logger.info(f"👤 Staff detectado en ticket {message.channel.id}. Bot silenciado.")
        return # No procesar si es staff (el bot ya no responde automáticamente)

    # 🔇 Si el staff ya intervino, el bot no responde a menos que se le invoque (en comandos)
    if ctx_ticket.staff_present:
        return

    texto = message.content
    mention = message.author.mention
    ctx_ticket.registrar_mensaje(str(message.author), texto)
    entidades = extraer_entidades(texto)

    # 1. Buscar en conocimiento aprendido primero (mayor prioridad)
    patron_aprendido = bot.buscar_en_conocimiento(texto)
    if patron_aprendido:
        respuesta = patron_aprendido.get("respuesta", "")
        pid = patron_aprendido.get("id")
        ctx_ticket.resuelto_por_ia = True
        ctx_ticket.patron_usado_id = pid
        embed = discord.Embed(
            title="💡 Asistente Automático RageNodes",
            description=respuesta,
            color=discord.Color.gold()
        )
        embed.set_footer(text="Respuesta aprendida del equipo de soporte | Si no resuelve tu duda, un admin te ayudará.")
        await message.channel.send(embed=embed)
        await bot.registrar_uso_patron(pid)
        await bot.registrar_estadistica("conocimiento_aprendido", True, False, pid)
        return

    # 2. Motor de intenciones con puntuación
    intencion, score = detectar_mejor_intencion(texto)

    # Saludos y agradecimientos (no requieren score alto)
    if intencion in ("saludo", "agradecimiento") and score > 0:
        respuesta = get_respuesta(intencion, mention)
        await message.channel.send(respuesta)
        ctx_ticket.registrar_intencion(intencion)
        await bot.registrar_estadistica(intencion, True, False)
        return

    # Lag/rendimiento → lanzar diagnóstico automático
    if intencion == "lag_rendimiento" and score >= 0.8:
        await message.channel.send(f"🤖 Detecté un posible problema de rendimiento, {mention}. Ejecutando diagnóstico...")
        fake_ctx = await bot.get_context(message)
        cmd = bot.get_command("diagnostico")
        if cmd:
            await fake_ctx.invoke(cmd)
        ctx_ticket.registrar_intencion(intencion)
        await bot.registrar_estadistica(intencion, True, False)
        return

    # Intención clara detectada
    if intencion and score >= 0.8:
        respuesta = get_respuesta(intencion, mention)
        if respuesta:
            # Si ya se habló de este tema, añadir contexto
            if ctx_ticket.ya_se_hablo_de(intencion):
                respuesta += f"\n\n💬 *Ya hablamos de este tema. Si el problema persiste, un miembro del staff te atenderá.*"
            ctx_ticket.registrar_intencion(intencion)
            ctx_ticket.resuelto_por_ia = True

            # 🚀 MEJORA PREMIUM: Añadir controles de servidor si la intención lo requiere
            view = None
            intenciones_con_control = ("lag_rendimiento", "error_arranque", "conexion_rechazada", "reiniciar_servidor")
            
            if intencion in intenciones_con_control:
                # Intentar obtener el ID del servidor del cliente
                async with bot.session.get(f"{API_URL_BASE}/diagnostico/{message.author.id}", headers={"x-api-key": API_KEY}) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        servers = data.get("servers", [])
                        if servers:
                            s = servers[0]
                            # Si es error de arranque, dar opción de REPARAR (Self-Healing)
                            if intencion == "error_arranque":
                                view = RepairView(bot, s.get('id'), s.get('name'))
                                respuesta += f"\n\n🛠️ **Autoreparación Detectada:** He analizado tu problema y podría deberse a un caché corrupto. Pulsa el botón de abajo para intentar una reparación automática."
                            else:
                                view = ServerControlView(bot, s.get('id'), s.get('name'))
                                respuesta += f"\n\n🛠️ **Acción Sugerida:** He detectado que podrías necesitar gestionar tu servidor **{s.get('name')}**. He habilitado botones de control abajo."

            await enviar_respuesta_ia(message, respuesta, intencion, view)
            await bot.registrar_estadistica(intencion, True, False)
            return

    # Escalado a humano
    if intencion == "escalar_humano" or (score > 0 and score < 0.8):
        staff_role = await get_staff_role(message.guild)
        mention_staff = staff_role.mention if staff_role else f"@{STAFF_ROLE_NAME}"
        await message.channel.send(
            f"🔔 Entiendo, {mention}. Escalando al equipo de soporte humano: {mention_staff}. Te atenderán pronto.")
        ctx_ticket.escalado_a_humano = True
        await bot.registrar_estadistica(intencion or "desconocida", False, True)
        return


@bot.event
async def on_command_error(ctx, error):
    if isinstance(error, commands.CommandNotFound):
        return
    if isinstance(error, commands.MissingPermissions):
        await ctx.send("❌ No tienes permisos para usar este comando.")
        return
    logger.error(f"Error en comando: {error}")

@bot.listen("on_command_error")
async def my_command_error(ctx, error):
    print(f"⚠️ COMANDO ERROR: {error}", flush=True)

if __name__ == "__main__":
    missing = [name for name, value in (
        ("DISCORD_TOKEN", DISCORD_TOKEN),
        ("DISCORD_API_KEY", API_KEY),
    ) if not value]
    if missing:
        raise SystemExit(f"❌ Faltan variables obligatorias: {', '.join(missing)}")
    bot.run(DISCORD_TOKEN)
