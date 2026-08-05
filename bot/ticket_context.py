import asyncio
import logging
from collections import deque
from datetime import datetime

logger = logging.getLogger("RageNodesBot")

# Contexto de conversacion por canal (en memoria)
_ticket_contexts: dict[int, "TicketContext"] = {}

class TicketContext:
    """Memoria de conversacion por canal de ticket."""
    def __init__(self, canal_id: int, user_id: int, username: str):
        self.canal_id = canal_id
        self.user_id = user_id
        self.username = username
        self.mensajes: deque = deque(maxlen=30)
        self.intenciones_detectadas: list[str] = []
        self.temas_tratados: set[str] = set()
        self.resuelto_por_ia = False
        self.escalado_a_humano = False
        self.staff_present = False  # 🛡️ Silenciar bot si entra staff
        self.patron_usado_id: int | None = None
        self.creado_at = datetime.utcnow()
        self.ultimo_mensaje_at = datetime.utcnow()

    def registrar_mensaje(self, autor: str, contenido: str, es_bot: bool = False):
        self.mensajes.append({
            "autor": autor,
            "contenido": contenido,
            "es_bot": es_bot,
            "ts": datetime.utcnow().isoformat()
        })
        self.ultimo_mensaje_at = datetime.utcnow()

    def registrar_intencion(self, intencion: str):
        if intencion not in self.intenciones_detectadas:
            self.intenciones_detectadas.append(intencion)
        self.temas_tratados.add(intencion)

    def ya_se_hablo_de(self, intencion: str) -> bool:
        return intencion in self.temas_tratados

    def to_log_dict(self) -> dict:
        return {
            "discord_user_id": str(self.user_id),
            "discord_username": self.username,
            "canal_id": str(self.canal_id),
            "mensajes": list(self.mensajes),
            "intenciones_detectadas": self.intenciones_detectadas,
            "resuelto_por_ia": self.resuelto_por_ia,
            "escalado_a_humano": self.escalado_a_humano,
            "patron_usado_id": self.patron_usado_id,
        }


def get_context(canal_id: int, user_id: int = 0, username: str = "") -> TicketContext:
    if canal_id not in _ticket_contexts:
        _ticket_contexts[canal_id] = TicketContext(canal_id, user_id, username)
    return _ticket_contexts[canal_id]


def remove_context(canal_id: int) -> TicketContext | None:
    return _ticket_contexts.pop(canal_id, None)


def limpiar_contextos_viejos(horas: int = 24):
    """Limpia contextos de tickets con más de N horas de inactividad."""
    ahora = datetime.utcnow()
    a_eliminar = [
        cid for cid, ctx in _ticket_contexts.items()
        if (ahora - ctx.ultimo_mensaje_at).total_seconds() > horas * 3600
    ]
    for cid in a_eliminar:
        _ticket_contexts.pop(cid, None)
    if a_eliminar:
        logger.info(f"🧹 Limpiados {len(a_eliminar)} contextos de tickets viejos.")
